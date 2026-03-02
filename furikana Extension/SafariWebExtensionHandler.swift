//
//  SafariWebExtensionHandler.swift
//  furikana Extension
//
//  Created by 林向達 on 2026/02/15.
//

import SafariServices
import NaturalLanguage
import os.log

// トークン情報の構造体
struct TokenInfo: Codable {
    let surface: String      // 表層形
    let reading: String?     // 読み仮名
    let pos: String?         // 品詞
    let range: [Int]         // [start, end]
}

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        NSLog("[FurikanaExt] beginRequest called")

        // リクエストごとにautoreleasepoolで囲み、一時オブジェクトを即座に解放
        // Safari拡張プロセスのメモリ制限下でCFStringTokenizerが安定動作するために必須
        autoreleasepool {
            let request = context.inputItems.first as? NSExtensionItem

            let profile: UUID?
            if #available(iOS 17.0, macOS 14.0, *) {
                profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
            } else {
                profile = request?.userInfo?["profile"] as? UUID
            }

            guard let messageDict = extractMessage(from: request) as? [String: Any],
                  let action = messageDict["action"] as? String else {
                NSLog("[FurikanaExt] Invalid message format, inputItems=%d", context.inputItems.count)
                os_log(.error, "Invalid message format")
                context.cancelRequest(withError: NSError(domain: "FurikanaExtension", code: 1, userInfo: nil))
                return
            }

            NSLog("[FurikanaExt] Action: %@", action)
            os_log(.default, "Received action: %@ (profile: %@)", action, profile?.uuidString ?? "none")

            // アクションに応じて処理を分岐
            var responseData: [String: Any] = ["action": action]

            switch action {
            case "tokenize":
                if let text = messageDict["text"] as? String {
                    NSLog("[Furikana] Tokenizing: %@", text.prefix(30) as NSString)
                    let tokens = tokenizeText(text)
                    responseData["tokens"] = mapTokensToDict(tokens)
                    responseData["success"] = true
                } else {
                    responseData["success"] = false
                    responseData["error"] = "No text provided"
                }

            case "tokenizeBatch":
                if let texts = messageDict["texts"] as? [String] {
                    NSLog("[Furikana] Batch tokenizing %d texts", texts.count)
                    var results: [[String: Any]] = []
                    for text in texts {
                        autoreleasepool {
                            let tokens = tokenizeText(text)
                            results.append([
                                "tokens": mapTokensToDict(tokens),
                                "success": true
                            ])
                        }
                    }
                    responseData["results"] = results
                    responseData["success"] = true
                } else {
                    responseData["success"] = false
                    responseData["error"] = "No texts provided"
                }

            case "getReading":
                if let text = messageDict["text"] as? String {
                    let reading = getReadingForText(text)
                    responseData["reading"] = reading
                    responseData["success"] = true
                } else {
                    responseData["success"] = false
                    responseData["error"] = "No text provided"
                }

            case "loadDictFile":
                if let filename = messageDict["filename"] as? String {
                    // パストラバーサル防止: .. を含むパスを拒否
                    guard !filename.contains("..") else {
                        responseData["success"] = false
                        responseData["error"] = "Invalid filename"
                        break
                    }
                    let chunkSize = (messageDict["chunkSize"] as? Int) ?? (16 * 1024 * 1024)
                    let offset = (messageDict["offset"] as? Int) ?? 0

                    if let bundleURL = Bundle.main.resourceURL {
                        // filename をそのままサブパスとして解決（"sudachi-dict/system.dic" 等）
                        let safeName = filename.components(separatedBy: "/").last ?? filename
                        let candidates = [
                            bundleURL.appendingPathComponent(filename),           // フルパス
                            bundleURL.appendingPathComponent("dict").appendingPathComponent(safeName), // dict/ 下
                            bundleURL.appendingPathComponent(safeName)            // ルート
                        ]
                        let fileURL = candidates.first { FileManager.default.fileExists(atPath: $0.path) }

                        if let fileURL = fileURL, let fh = try? FileHandle(forReadingFrom: fileURL) {
                            defer { fh.closeFile() }
                            let totalSize = Int(fh.seekToEndOfFile())
                            fh.seek(toFileOffset: UInt64(offset))
                            let chunk = fh.readData(ofLength: min(chunkSize, totalSize - offset))
                            os_log(.default, "loadDictFile: %{public}@ offset=%d len=%d total=%d", filename, offset, chunk.count, totalSize)
                            responseData["data"] = chunk.base64EncodedString()
                            responseData["totalSize"] = totalSize
                            responseData["offset"] = offset
                            responseData["success"] = true
                        } else {
                            os_log(.error, "loadDictFile: file not found: %{public}@", filename)
                            responseData["success"] = false
                            responseData["error"] = "File not found: \(filename)"
                        }
                    } else {
                        responseData["success"] = false
                        responseData["error"] = "Bundle resource URL not found"
                    }
                } else {
                    responseData["success"] = false
                    responseData["error"] = "No filename provided"
                }

            case "syncSettings":
                // App Group UserDefaults に設定を保存
                if let settings = messageDict["settings"] as? [String: Any] {
                    let defaults = UserDefaults(suiteName: "group.con3.furikana")
                    NSLog("[Furikana] syncSettings: UserDefaults is %@, saving %d keys", defaults != nil ? "valid" : "NIL", settings.count)
                    defaults?.set(settings, forKey: "furikanaSettings")
                    responseData["success"] = true
                } else {
                    responseData["success"] = false
                    responseData["error"] = "No settings provided"
                }

            case "jsLog":
                // JS からのログを os_log に出力（Console.app で確認可能）
                let level = (messageDict["level"] as? String) ?? "info"
                let msg = (messageDict["message"] as? String) ?? "(no message)"
                switch level {
                case "error":
                    os_log(.error, "[JS] %{public}@", msg)
                case "warn":
                    os_log(.default, "[JS:WARN] %{public}@", msg)
                default:
                    os_log(.default, "[JS] %{public}@", msg)
                }
                responseData["success"] = true

            case "loadUserDict":
                let fm = FileManager.default
                guard let containerURL = fm.containerURL(
                    forSecurityApplicationGroupIdentifier: "group.con3.furikana"
                ) else {
                    responseData["success"] = true
                    responseData["tsv"] = ""
                    break
                }
                let dictURL = containerURL.appendingPathComponent("user_dict.tsv")
                if let content = try? String(contentsOf: dictURL, encoding: .utf8) {
                    responseData["success"] = true
                    responseData["tsv"] = content
                } else {
                    responseData["success"] = true
                    responseData["tsv"] = ""
                }

            case "saveUserDict":
                guard let tsv = messageDict["tsv"] as? String,
                      let containerURL = FileManager.default.containerURL(
                          forSecurityApplicationGroupIdentifier: "group.con3.furikana"
                      ) else {
                    responseData["success"] = false
                    responseData["error"] = "Invalid params"
                    break
                }
                let saveDictURL = containerURL.appendingPathComponent("user_dict.tsv")
                do {
                    try tsv.write(to: saveDictURL, atomically: true, encoding: .utf8)
                    responseData["success"] = true
                } catch {
                    responseData["success"] = false
                    responseData["error"] = error.localizedDescription
                }

            case "loadSettings":
                // App Group UserDefaults から設定を読み込み
                let defaults = UserDefaults(suiteName: "group.con3.furikana")
                let settings = defaults?.dictionary(forKey: "furikanaSettings") ?? [:]
                NSLog("[Furikana] loadSettings: UserDefaults is %@, loaded %d keys", defaults != nil ? "valid" : "NIL", settings.count)
                responseData["settings"] = settings
                responseData["success"] = true

            case "dictionary_status":
                // AppGroup 内のダウンロード済み辞書の存在チェック
                NSLog("[FurikanaExt] dictionary_status: checking AppGroup...")
                let fm = FileManager.default
                guard let containerURL = fm.containerURL(
                    forSecurityApplicationGroupIdentifier: "group.con3.furikana"
                ) else {
                    NSLog("[FurikanaExt] dictionary_status: AppGroup container not found")
                    responseData["success"] = true
                    responseData["available"] = false
                    break
                }
                NSLog("[FurikanaExt] dictionary_status: container=%@", containerURL.path)
                var found = false
                // full → core の優先順で検索
                for dictName in ["sudachi_full.dic", "sudachi_core.dic"] {
                    let dictURL = containerURL.appendingPathComponent(dictName)
                    let exists = fm.fileExists(atPath: dictURL.path)
                    NSLog("[FurikanaExt] dictionary_status: %@ exists=%@", dictName, exists ? "YES" : "NO")
                    if exists,
                       let attrs = try? fm.attributesOfItem(atPath: dictURL.path) {
                        let dictType = dictName.contains("full") ? "full" : "core"
                        let size = (attrs[.size] as? Int) ?? 0
                        responseData["available"] = true
                        responseData["dictType"] = dictType
                        responseData["totalSize"] = size
                        responseData["updatedAt"] = ISO8601DateFormatter().string(
                            from: (attrs[.modificationDate] as? Date) ?? .distantPast)
                        found = true
                        NSLog("[FurikanaExt] dictionary_status: found %@ (%d bytes)", dictType, size)
                        break
                    }
                }
                if !found {
                    NSLog("[FurikanaExt] dictionary_status: no downloaded dict found")
                    responseData["available"] = false
                }
                responseData["success"] = true

            case "read_dictionary_chunk":
                // AppGroup 内辞書のチャンク読み（16MB default — 往復回数を減らしiOSによる強制終了を回避）
                let offset = (messageDict["offset"] as? Int) ?? 0
                let chunkSize = (messageDict["chunkSize"] as? Int) ?? (16 * 1024 * 1024)
                let dictType = (messageDict["dictType"] as? String) ?? "full"
                let dictName = dictType == "core" ? "sudachi_core.dic" : "sudachi_full.dic"
                NSLog("[FurikanaExt] read_dictionary_chunk: %@ offset=%d chunkSize=%d", dictName, offset, chunkSize)
                guard let containerURL = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: "group.con3.furikana"
                ),
                let fh = try? FileHandle(forReadingFrom:
                    containerURL.appendingPathComponent(dictName))
                else {
                    NSLog("[FurikanaExt] read_dictionary_chunk: FAILED to open %@", dictName)
                    responseData["success"] = false
                    responseData["error"] = "Dict not found: \(dictName)"
                    break
                }
                defer { fh.closeFile() }
                let totalSize = Int(fh.seekToEndOfFile())
                fh.seek(toFileOffset: UInt64(offset))
                let data = fh.readData(ofLength: min(chunkSize, totalSize - offset))
                responseData["data"] = data.base64EncodedString()
                responseData["totalSize"] = totalSize
                responseData["success"] = true
                // 10% ごとにログ出力（チャンクが多いため間引き）
                let pct = totalSize > 0 ? (offset + data.count) * 100 / totalSize : 0
                if pct % 10 < 2 || offset + data.count >= totalSize {
                    NSLog("[FurikanaExt] read_dictionary_chunk: %d/%d (%d%%)", offset + data.count, totalSize, pct)
                }

            default:
                responseData["success"] = false
                responseData["error"] = "Unknown action"
            }

            // レスポンスを返す
            let response = NSExtensionItem()
            if #available(iOS 15.0, macOS 11.0, *) {
                response.userInfo = [SFExtensionMessageKey: responseData]
            } else {
                response.userInfo = ["message": responseData]
            }

            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    // メッセージの抽出
    private func extractMessage(from request: NSExtensionItem?) -> Any? {
        if #available(iOS 15.0, macOS 11.0, *) {
            return request?.userInfo?[SFExtensionMessageKey]
        } else {
            return request?.userInfo?["message"]
        }
    }

    // トークン配列を辞書配列に変換（reading の妥当性チェック付き）
    private func mapTokensToDict(_ tokens: [TokenInfo]) -> [[String: Any]] {
        return tokens.map { token -> [String: Any] in
            let reading = token.reading ?? token.surface
            let isValidReading = reading.range(of: "[\\p{Hiragana}\\p{Katakana}a-zA-Z]+", options: .regularExpression) != nil

            if !isValidReading && reading != token.surface {
                return [
                    "surface": token.surface,
                    "reading": token.surface,
                    "pos": token.pos ?? "",
                    "range": token.range
                ]
            }

            return [
                "surface": token.surface,
                "reading": reading,
                "pos": token.pos ?? "",
                "range": token.range
            ]
        }
    }

    // テキストをトークン化
    // 3段階処理: NLTagger→CFStringTokenizer→マッチング
    private func tokenizeText(_ text: String) -> [TokenInfo] {
        // === Phase 1: NLTaggerですべてのトークンを収集（品詞+範囲のみ）===
        struct RawToken {
            let surface: String
            let pos: String
            let startOffset: Int   // Character offset
            let endOffset: Int     // Character offset
            let utf16Start: Int    // UTF-16 offset
            let utf16End: Int      // UTF-16 offset
        }

        var rawTokens: [RawToken] = []

        // Phase 1をautoreleasepoolで囲み、NLTaggerとその内部オブジェクトを
        // Phase 2のCFStringTokenizer作成前に確実に解放する
        autoreleasepool {
            let tagger = NLTagger(tagSchemes: [.lexicalClass])
            tagger.string = text
            tagger.setLanguage(.japanese, range: text.startIndex..<text.endIndex)
            let options: NLTagger.Options = [.omitWhitespace]

            tagger.enumerateTags(in: text.startIndex..<text.endIndex,
                                unit: .word,
                                scheme: .lexicalClass,
                                options: options) { tag, tokenRange in
                let surface = String(text[tokenRange])
                let pos = tag?.rawValue ?? "Other"
                let startOffset = text.distance(from: text.startIndex, to: tokenRange.lowerBound)
                let endOffset = text.distance(from: text.startIndex, to: tokenRange.upperBound)
                let utf16Start = text[text.startIndex..<tokenRange.lowerBound].utf16.count
                let utf16End = utf16Start + text[tokenRange].utf16.count
                rawTokens.append(RawToken(
                    surface: surface, pos: pos,
                    startOffset: startOffset, endOffset: endOffset,
                    utf16Start: utf16Start, utf16End: utf16End
                ))
                return true
            }

            tagger.string = nil
        }

        os_log(.debug, "Phase 1: %d tokens from NLTagger", rawTokens.count)

        // === Phase 2: テキスト全体に対して1つのCFStringTokenizerで全読みを取得 ===
        struct CFReading {
            let utf16Start: Int
            let utf16End: Int
            let reading: String
        }

        var cfReadings: [CFReading] = []

        autoreleasepool {
            let localeId = CFLocaleCreateCanonicalLocaleIdentifierFromString(nil, "ja" as CFString)
            let locale = CFLocaleCreate(nil, localeId)
            let cfRange = CFRangeMake(0, text.utf16.count)

            guard let tokenizer = CFStringTokenizerCreate(
                nil, text as CFString, cfRange,
                kCFStringTokenizerUnitWordBoundary, locale
            ) else {
                os_log(.error, "Phase 2: Failed to create CFStringTokenizer")
                return
            }

            while true {
                let tokenType = CFStringTokenizerAdvanceToNextToken(tokenizer)
                if tokenType == [] { break }

                let tokenRange = CFStringTokenizerGetCurrentTokenRange(tokenizer)

                if let latin = CFStringTokenizerCopyCurrentTokenAttribute(
                    tokenizer, kCFStringTokenizerAttributeLatinTranscription
                ) as? String, !latin.isEmpty {
                    let mutable = NSMutableString(string: latin)
                    if CFStringTransform(mutable, nil, kCFStringTransformLatinHiragana, false) {
                        let reading = mutable as String
                        if !reading.isEmpty {
                            cfReadings.append(CFReading(
                                utf16Start: tokenRange.location,
                                utf16End: tokenRange.location + tokenRange.length,
                                reading: reading
                            ))
                        }
                    }
                }
            }
        }

        os_log(.debug, "Phase 2: %d readings from CFStringTokenizer", cfReadings.count)

        // === Phase 3: CFStringTokenizerの範囲を優先し、NLTaggerトークンを必要に応じて結合 ===
        var tokens: [TokenInfo] = []

        let contentWordTags = ["Noun", "Verb", "Adjective", "Adverb"]
        let functionWordTags = ["Particle", "Auxiliary", "Conjunction"]

        func mergedPos(for slice: ArraySlice<RawToken>) -> String {
            if let tag = slice.first(where: { contentWordTags.contains($0.pos) })?.pos {
                return tag
            }
            if let tag = slice.first(where: { functionWordTags.contains($0.pos) })?.pos {
                return tag
            }
            return slice.first?.pos ?? "Other"
        }

        var i = 0
        var cfIndex = 0
        while i < rawTokens.count {
            let rawToken = rawTokens[i]

            // cfReadingsを現在のrawTokenに近い位置まで進める
            while cfIndex < cfReadings.count && cfReadings[cfIndex].utf16End <= rawToken.utf16Start {
                cfIndex += 1
            }

            if cfIndex < cfReadings.count {
                let cfReading = cfReadings[cfIndex]
                let covered = cfReading.utf16Start <= rawToken.utf16Start && cfReading.utf16End >= rawToken.utf16End

                if covered {
                    // cfReadingの範囲内に入るrawTokenをまとめる（長単位化）
                    var j = i
                    while j < rawTokens.count && rawTokens[j].utf16End <= cfReading.utf16End {
                        j += 1
                    }

                    if j - i > 1 {
                        let nsRange = NSRange(location: cfReading.utf16Start, length: cfReading.utf16End - cfReading.utf16Start)
                        if let range = Range(nsRange, in: text) {
                            let surface = String(text[range])
                            let startOffset = text.distance(from: text.startIndex, to: range.lowerBound)
                            let endOffset = text.distance(from: text.startIndex, to: range.upperBound)

                            // 漢字を含む場合のみ長単位化を適用
                            if surface.range(of: "\\p{Han}", options: .regularExpression) != nil {
                                let pos = mergedPos(for: rawTokens[i..<j])
                                tokens.append(TokenInfo(
                                    surface: surface,
                                    reading: cfReading.reading,
                                    pos: pos,
                                    range: [startOffset, endOffset]
                                ))
                                i = j
                                cfIndex += 1
                                continue
                            }
                        }
                    }
                }
            }

            // ここからは従来の1トークン処理
            var reading: String? = nil

            // 方法1: 完全一致（NLTaggerトークンとCFトークンの範囲が一致）
            for cfReading in cfReadings {
                if cfReading.utf16Start == rawToken.utf16Start && cfReading.utf16End == rawToken.utf16End {
                    reading = cfReading.reading
                    break
                }
            }

            // 方法2: NLTaggerトークンの範囲内に含まれるCFトークンの読みを連結
            if reading == nil {
                var parts: [(start: Int, reading: String)] = []
                for cfReading in cfReadings {
                    if cfReading.utf16Start >= rawToken.utf16Start && cfReading.utf16End <= rawToken.utf16End {
                        parts.append((start: cfReading.utf16Start, reading: cfReading.reading))
                    }
                }
                if !parts.isEmpty {
                    parts.sort { $0.start < $1.start }
                    reading = parts.map { $0.reading }.joined()
                }
            }

            // 方法3: カタカナ→ひらがな変換のフォールバック
            if reading == nil {
                let mutable = NSMutableString(string: rawToken.surface)
                if CFStringTransform(mutable, nil, kCFStringTransformHiraganaKatakana, true) {
                    let converted = mutable as String
                    if converted != rawToken.surface {
                        reading = converted
                    }
                }
            }

            // 方法4: 隣接する漢字トークンを結合して読み取得（熟語対策）
            if reading == nil && rawToken.surface.range(of: "^\\p{Han}+$", options: .regularExpression) != nil {
                var j = i + 1
                while j < rawTokens.count &&
                        rawTokens[j].surface.range(of: "^\\p{Han}+$", options: .regularExpression) != nil {
                    j += 1
                }

                if j - i >= 2 {
                    let start = rawTokens[i].startOffset
                    let end = rawTokens[j - 1].endOffset
                    let startIndex = text.index(text.startIndex, offsetBy: start)
                    let endIndex = text.index(text.startIndex, offsetBy: end)
                    let combinedSurface = String(text[startIndex..<endIndex])

                    if let r = getReading(for: combinedSurface), r != combinedSurface {
                        let pos = mergedPos(for: rawTokens[i..<j])
                        tokens.append(TokenInfo(
                            surface: combinedSurface,
                            reading: r,
                            pos: pos,
                            range: [start, end]
                        ))
                        i = j
                        continue
                    }
                }
            }

            // 方法5: 単漢字トークンに対して個別にCFStringTokenizerで読みを取得
            // NLTaggerとCFStringTokenizerのトークン境界が異なる場合のフォールバック
            if reading == nil && rawToken.surface.range(of: "\\p{Han}", options: .regularExpression) != nil {
                if let r = getReading(for: rawToken.surface), r != rawToken.surface {
                    reading = r
                }
            }

            tokens.append(TokenInfo(
                surface: rawToken.surface,
                reading: reading,
                pos: rawToken.pos,
                range: [rawToken.startOffset, rawToken.endOffset]
            ))
            i += 1
        }

        os_log(.debug, "Phase 3: Tokenized %d tokens from text: %@", tokens.count, String(text.prefix(50)))

        return tokens
    }

    // テキスト全体の読み仮名を取得
    private func getReadingForText(_ text: String) -> String {
        return getReading(for: text) ?? text
    }

    // 読み仮名を取得（漢字をひらがなに変換）
    // 複数トークンを含む文字列に対応（ループ処理）
    private func getReading(for text: String) -> String? {
        // 空文字列チェック
        guard !text.isEmpty else {
            return text
        }

        os_log(.debug, "[getReading] START: Processing text: %@", text)

        // メモリ管理を改善するためにautoreleasepool内で処理
        return autoreleasepool { () -> String? in
            // 日本語ロケールでCFStringTokenizerを作成
            let localeIdentifier = CFLocaleCreateCanonicalLocaleIdentifierFromString(nil, "ja" as CFString)
            let locale = CFLocaleCreate(nil, localeIdentifier)
            let range = CFRangeMake(0, text.utf16.count)

            guard let tokenizer = CFStringTokenizerCreate(
                nil,
                text as CFString,
                range,
                kCFStringTokenizerUnitWordBoundary,
                locale
            ) else {
                os_log(.error, "[getReading] Failed to create tokenizer for: %@", text)
                return text
            }

            var result = ""
            var lastEndIndex = 0
            var tokenCount = 0

            // すべてのトークンをループ処理
            while true {
                let tokenType = CFStringTokenizerAdvanceToNextToken(tokenizer)

                // トークンがなくなったら終了
                if tokenType == [] {
                    os_log(.debug, "[getReading] No more tokens. Processed %d tokens", tokenCount)
                    break
                }

                tokenCount += 1

                // 現在のトークンの範囲を取得
                let tokenRange = CFStringTokenizerGetCurrentTokenRange(tokenizer)

                // トークン前の空白・句読点を保持
                if tokenRange.location > lastEndIndex {
                    let gapStart = text.utf16.index(text.utf16.startIndex, offsetBy: lastEndIndex)
                    let gapEnd = text.utf16.index(text.utf16.startIndex, offsetBy: tokenRange.location)
                    if let gapString = String(text.utf16[gapStart..<gapEnd]) {
                        result += gapString
                    }
                }

                // トークンの表層形を取得
                let tokenStart = text.utf16.index(text.utf16.startIndex, offsetBy: tokenRange.location)
                let tokenEnd = text.utf16.index(text.utf16.startIndex, offsetBy: tokenRange.location + tokenRange.length)
                guard let tokenSurface = String(text.utf16[tokenStart..<tokenEnd]) else {
                    os_log(.error, "[getReading] Failed to extract token surface")
                    continue
                }

                os_log(.debug, "[getReading] Token %d: %@", tokenCount, tokenSurface)

                // ラテン文字転写を取得
                if let latinTranscription = CFStringTokenizerCopyCurrentTokenAttribute(
                    tokenizer,
                    kCFStringTokenizerAttributeLatinTranscription
                ) as? String, !latinTranscription.isEmpty {

                    os_log(.debug, "[getReading] Latin: %@ -> %@", tokenSurface, latinTranscription)

                    // ローマ字をひらがなに変換
                    let mutableString = NSMutableString(string: latinTranscription)
                    if CFStringTransform(mutableString, nil, kCFStringTransformLatinHiragana, false) {
                        let reading = mutableString as String

                        // ひらがなが含まれているか確認
                        if !reading.isEmpty && reading.rangeOfCharacter(from: CharacterSet(charactersIn: "ぁ-ん")) != nil {
                            os_log(.debug, "[getReading] Reading: %@ -> %@", tokenSurface, reading)
                            result += reading
                        } else {
                            os_log(.debug, "[getReading] No hiragana in result, using surface: %@", tokenSurface)
                            result += tokenSurface
                        }
                    } else {
                        os_log(.debug, "[getReading] Transform failed, using surface: %@", tokenSurface)
                        result += tokenSurface
                    }
                } else {
                    // latinTranscriptionが取得できない場合
                    os_log(.debug, "[getReading] No latin transcription for: %@", tokenSurface)

                    // カタカナ→ひらがな変換を試みる
                    let mutableString = NSMutableString(string: tokenSurface)
                    if CFStringTransform(mutableString, nil, kCFStringTransformHiraganaKatakana, true) {
                        let converted = mutableString as String
                        if converted != tokenSurface {
                            os_log(.debug, "[getReading] Katakana converted: %@ -> %@", tokenSurface, converted)
                            result += converted
                        } else {
                            result += tokenSurface
                        }
                    } else {
                        result += tokenSurface
                    }
                }

                lastEndIndex = tokenRange.location + tokenRange.length
            }

            // 最後のトークン以降の残り（句読点や空白）を追加
            if lastEndIndex < text.utf16.count {
                let remainStart = text.utf16.index(text.utf16.startIndex, offsetBy: lastEndIndex)
                if let remainString = String(text.utf16[remainStart...]) {
                    result += remainString
                }
            }

            // トークンが1つも見つからなかった場合のフォールバック
            if tokenCount == 0 {
                os_log(.info, "[getReading] No tokens found, trying katakana conversion")
                let mutableString = NSMutableString(string: text)
                if CFStringTransform(mutableString, nil, kCFStringTransformHiraganaKatakana, true) {
                    let converted = mutableString as String
                    if converted != text {
                        os_log(.info, "[getReading] Katakana converted: %@ -> %@", text, converted)
                        return converted
                    }
                }
                return text
            }

            os_log(.info, "[getReading] SUCCESS: %@ -> %@ (%d tokens)", text, result, tokenCount)
            return result.isEmpty ? text : result
        } // autoreleasepool end
    }
}
