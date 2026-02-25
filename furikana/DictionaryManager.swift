//
//  DictionaryManager.swift
//  furikana
//
//  S3から Sudachi Core/Full 辞書をダウンロードし、AppGroup に保存する

import Foundation
import Compression

class DictionaryManager: NSObject, URLSessionDownloadDelegate {

    static let shared = DictionaryManager()

    enum DictSize: String {
        case core, full
    }

    enum Status: Equatable {
        case idle
        case downloading(progress: Double)
        case extracting
        case complete(type: String, size: Int)
        case error(String)
    }

    var onStatusChanged: ((Status) -> Void)?

    private let appGroupId = "group.con3.furikana"
    // HTTPS 直接 S3 エンドポイント（ATS 準拠）
    private let s3BaseURL = "https://sudachi.s3-ap-northeast-1.amazonaws.com/sudachidict/"

    private var downloadTask: URLSessionDownloadTask?
    private var currentDictSize: DictSize?
    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.default
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    // MARK: - 公開API

    /// "latest" URL から実際のダウンロード URL を解決してダウンロード開始
    /// S3 直接エンドポイントでは latest URL が x-amz-website-redirect-location ヘッダーで
    /// リダイレクト先を返す（HTTP 301 にならない）ため、HEAD リクエストで解決する
    func startDownload(size: DictSize) {
        guard downloadTask == nil else { return }
        currentDictSize = size

        updateStatus(.downloading(progress: 0))

        let latestFilename = size == .full
            ? "sudachi-dictionary-latest-full.zip"
            : "sudachi-dictionary-latest-core.zip"
        let latestURL = URL(string: s3BaseURL + latestFilename)!

        NSLog("[DictManager] Resolving latest URL: %@", latestURL.absoluteString)

        // HEAD リクエストで x-amz-website-redirect-location を取得
        var headRequest = URLRequest(url: latestURL)
        headRequest.httpMethod = "HEAD"

        URLSession.shared.dataTask(with: headRequest) { [weak self] _, response, error in
            guard let self = self else { return }

            if let error = error {
                NSLog("[DictManager] HEAD request failed: %@", error.localizedDescription)
                DispatchQueue.main.async {
                    self.downloadTask = nil
                    self.currentDictSize = nil
                    self.updateStatus(.error(error.localizedDescription))
                }
                return
            }

            var resolvedURL: URL?
            if let httpResponse = response as? HTTPURLResponse,
               let redirect = httpResponse.value(forHTTPHeaderField: "x-amz-website-redirect-location") {
                // リダイレクト先は相対パス（例: /sudachidict/sudachi-dictionary-20260116-core.zip）
                resolvedURL = URL(string: "https://sudachi.s3-ap-northeast-1.amazonaws.com" + redirect)
                NSLog("[DictManager] Resolved to: %@", resolvedURL?.absoluteString ?? "nil")
            }

            let finalURL = resolvedURL ?? latestURL

            DispatchQueue.main.async {
                NSLog("[DictManager] Starting download: %@", finalURL.absoluteString)
                self.downloadTask = self.urlSession.downloadTask(with: finalURL)
                self.downloadTask?.resume()
            }
        }.resume()
    }

    /// ダウンロードキャンセル
    func cancelDownload() {
        downloadTask?.cancel()
        downloadTask = nil
        currentDictSize = nil
        updateStatus(.idle)
    }

    /// ダウンロード済み辞書を削除
    func deleteDictionary() {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else { return }

        for name in ["sudachi_core.dic", "sudachi_full.dic"] {
            let fileURL = containerURL.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: fileURL)
        }

        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.removeObject(forKey: "sudachiDictType")
        defaults?.removeObject(forKey: "sudachiDictStatus")
        defaults?.removeObject(forKey: "sudachiDictSize")
        defaults?.removeObject(forKey: "sudachiDictDate")
        defaults?.removeObject(forKey: "sudachiDictError")

        NSLog("[DictManager] Dictionary deleted")
    }

    /// 現在の状態を取得
    func currentStatus() -> Status {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            return .idle
        }

        // ダウンロード中ならその状態を返す
        if downloadTask != nil, currentDictSize != nil {
            return .downloading(progress: 0)
        }

        // Core → Full の優先順で検索
        for dictName in ["sudachi_full.dic", "sudachi_core.dic"] {
            let dictURL = containerURL.appendingPathComponent(dictName)
            if FileManager.default.fileExists(atPath: dictURL.path),
               let attrs = try? FileManager.default.attributesOfItem(atPath: dictURL.path) {
                let type = dictName.contains("full") ? "full" : "core"
                let size = (attrs[.size] as? Int) ?? 0
                return .complete(type: type, size: size)
            }
        }

        return .idle
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        let progress = totalBytesExpectedToWrite > 0
            ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
            : 0
        updateStatus(.downloading(progress: progress))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        NSLog("[DictManager] Download complete, extracting...")
        updateStatus(.extracting)

        guard let size = currentDictSize else {
            updateStatus(.error("内部エラー: dictSize不明"))
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            do {
                let dicData = try self.extractDicFromZip(at: location)

                guard let containerURL = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: self.appGroupId
                ) else {
                    throw NSError(domain: "DictManager", code: 2,
                                  userInfo: [NSLocalizedDescriptionKey: "AppGroup コンテナが見つかりません"])
                }

                let dictName = size == .full ? "sudachi_full.dic" : "sudachi_core.dic"
                let destURL = containerURL.appendingPathComponent(dictName)

                // 既存ファイルがあれば削除
                try? FileManager.default.removeItem(at: destURL)
                try dicData.write(to: destURL)

                let fileSize = dicData.count
                NSLog("[DictManager] Saved %@ (%d bytes)", dictName, fileSize)

                // UserDefaults に記録
                let defaults = UserDefaults(suiteName: self.appGroupId)
                defaults?.set(size.rawValue, forKey: "sudachiDictType")
                defaults?.set("complete", forKey: "sudachiDictStatus")
                defaults?.set(fileSize, forKey: "sudachiDictSize")
                defaults?.set(ISO8601DateFormatter().string(from: Date()), forKey: "sudachiDictDate")

                DispatchQueue.main.async {
                    self.downloadTask = nil
                    self.currentDictSize = nil
                    self.updateStatus(.complete(type: size.rawValue, size: fileSize))
                }
            } catch {
                NSLog("[DictManager] Extraction failed: %@", error.localizedDescription)
                DispatchQueue.main.async {
                    self.downloadTask = nil
                    self.currentDictSize = nil
                    self.updateStatus(.error(error.localizedDescription))
                }
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        if let error = error {
            // キャンセルの場合は無視
            if (error as NSError).code == NSURLErrorCancelled { return }
            NSLog("[DictManager] Download error: %@", error.localizedDescription)
            downloadTask = nil
            currentDictSize = nil
            updateStatus(.error(error.localizedDescription))
        }
    }

    // MARK: - ZIP 展開

    /// ZIP ファイルから .dic ファイルを展開して Data として返す
    private func extractDicFromZip(at zipURL: URL) throws -> Data {
        let zipData = try Data(contentsOf: zipURL)
        let bytes = [UInt8](zipData)
        var offset = 0

        while offset + 30 <= bytes.count {
            // ローカルファイルヘッダー: PK\x03\x04
            guard bytes[offset] == 0x50, bytes[offset + 1] == 0x4B,
                  bytes[offset + 2] == 0x03, bytes[offset + 3] == 0x04 else {
                break
            }

            let compressionMethod = UInt16(bytes[offset + 8]) | (UInt16(bytes[offset + 9]) << 8)
            let compressedSize = Int(UInt32(bytes[offset + 18]) | (UInt32(bytes[offset + 19]) << 8)
                | (UInt32(bytes[offset + 20]) << 16) | (UInt32(bytes[offset + 21]) << 24))
            let uncompressedSize = Int(UInt32(bytes[offset + 22]) | (UInt32(bytes[offset + 23]) << 8)
                | (UInt32(bytes[offset + 24]) << 16) | (UInt32(bytes[offset + 25]) << 24))
            let fileNameLen = Int(UInt16(bytes[offset + 26]) | (UInt16(bytes[offset + 27]) << 8))
            let extraLen = Int(UInt16(bytes[offset + 28]) | (UInt16(bytes[offset + 29]) << 8))

            let fileNameStart = offset + 30
            let fileNameData = Data(bytes[fileNameStart..<(fileNameStart + fileNameLen)])
            let fileName = String(data: fileNameData, encoding: .utf8) ?? ""

            let dataStart = fileNameStart + fileNameLen + extraLen

            if fileName.hasSuffix(".dic") {
                NSLog("[DictManager] Found .dic in ZIP: %@ (compressed=%d, uncompressed=%d, method=%d)",
                      fileName, compressedSize, uncompressedSize, compressionMethod)

                let compressedData = Data(bytes[dataStart..<(dataStart + compressedSize)])

                if compressionMethod == 0 {
                    // STORED
                    return compressedData
                } else if compressionMethod == 8 {
                    // DEFLATE
                    return try decompressDeflate(compressedData, expectedSize: uncompressedSize)
                } else {
                    throw NSError(domain: "DictManager", code: 3,
                                  userInfo: [NSLocalizedDescriptionKey: "未対応の圧縮方式: \(compressionMethod)"])
                }
            }

            // 次のエントリへ
            offset = dataStart + compressedSize
        }

        throw NSError(domain: "DictManager", code: 4,
                      userInfo: [NSLocalizedDescriptionKey: "ZIP内に .dic ファイルが見つかりません"])
    }

    /// DEFLATE データを Compression framework で展開
    private func decompressDeflate(_ data: Data, expectedSize: Int) throws -> Data {
        // Compression framework の ZLIB は raw deflate を受け付ける
        let sourceBuffer = [UInt8](data)
        var destBuffer = [UInt8](repeating: 0, count: expectedSize)

        let decodedSize = compression_decode_buffer(
            &destBuffer, expectedSize,
            sourceBuffer, sourceBuffer.count,
            nil,
            COMPRESSION_ZLIB
        )

        guard decodedSize > 0 else {
            throw NSError(domain: "DictManager", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "DEFLATE展開に失敗しました"])
        }

        NSLog("[DictManager] Decompressed: %d → %d bytes", data.count, decodedSize)
        return Data(destBuffer[0..<decodedSize])
    }

    // MARK: - ステータス通知

    private func updateStatus(_ status: Status) {
        DispatchQueue.main.async {
            self.onStatusChanged?(status)
        }
    }
}
