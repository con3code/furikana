# トークン化アーキテクチャ

Furikana 拡張機能におけるトークン化（テキスト→読み仮名付きトークン）の全体像、エラー要因、および現在の対処方法をまとめたドキュメント。

---

## 1. 全体フロー

```
ユーザーがふりがなを有効化
    ↓
toggleFurigana()
    ↓
VisibleTextProcessor.start()
    ↓
[scroll/resize イベント] → scheduleScan() → scanVisibleTextNodes()
    ↓
画面内の漢字を含むテキストノードを pending キューに追加
    ↓
processQueue() → バッチ単位で addFuriganaToNode() を呼び出し
    ↓
addFuriganaToNode(textNode)
    ├─ sendNativeMessage('tokenize', { text })
    │      ↓
    │  RequestQueue.enqueue(fn)  ← 同時実行数制限・クールダウン管理
    │      ↓
    │  browser.runtime.sendMessage({ action: 'tokenize', text })
    │      ↓
    │  background.js: handleTokenizeRequest()
    │      ├─ dictType='ipadic' → kuromoji → native → fallback
    │      └─ dictType='system' → native → fallback
    │              ↓
    │  [native 経路] browser.runtime.sendNativeMessage('con3.furikana', msg)
    │      ↓
    │  SafariWebExtensionHandler.swift: tokenizeText()
    │      ├─ Phase 1: NLTagger (トークン境界 + 品詞)
    │      ├─ Phase 2: CFStringTokenizer (読み仮名)
    │      └─ Phase 3: マッチング + フォールバック
    │      ↓
    │  { success: true, tokens: [...], dictSource: 'system' }
    ↓
ReadingRules.apply(tokens)  ← 読み補正ルール適用
    ↓
groupToLongUnits(tokens) or 短単位マッピング
    ↓
splitKanjiReading() → <ruby> 要素を構築 → DOM 置換
```

---

## 2. 各コンポーネントの役割

### 2.1 VisibleTextProcessor（content.js）

画面に表示されているテキストノードのみを段階的に処理するスケジューラ。

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `batchSize` | 12 | 1バッチあたりの処理ノード数 |
| `batchDelay` | 60ms | バッチ間の待機時間 |
| `scanDelay` | 150ms | スクロール後のスキャン遅延（デバウンス） |
| `maxPending` | 200 | 待機キューの最大サイズ |

**状態管理:**
- `queuedNodes` (WeakSet) — 現在キューに入っているノード（重複防止）
- `processedNodes` (WeakSet) — 処理済みノード（再処理防止）
- `processing` (bool) — バッチ処理中フラグ

**動作:**
1. `scroll`/`resize` イベント → `scheduleScan()` でデバウンス付きスキャン予約
2. `scanVisibleTextNodes()` で `getTextNodes()` + `isTextNodeVisible()` により画面内の漢字テキストを検出
3. `processQueue()` でバッチ単位に `addFuriganaToNode()` を呼び出し
4. 成功したノードは `processedNodes` に追加、失敗したノードはどちらの Set にも入らず次回スキャンで再取得される

### 2.2 RequestQueue（content.js）

`sendNativeMessage` の同時実行数を制限し、エラー発生時にクールダウンを管理するキュー。

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `maxConcurrent` | 3 | 同時実行数の上限 |
| `intervalDelay` | 75ms | リクエスト間の遅延 |
| `errorThreshold` | 10 | クールダウン発動までの連続エラー回数 |
| `baseCooldownMs` | 3,000ms | 初回クールダウン時間 |
| `maxCooldownMs` | 30,000ms | 最大クールダウン時間 |

**クールダウン方式（指数バックオフ）:**
- 連続エラーが `errorThreshold` (10回) に達すると、クールダウンに入る
- クールダウン時間: 3秒 → 6秒 → 12秒 → 24秒 → 30秒（上限）
- クールダウン中の `enqueue()` は即座に `null` を返す
- クールダウン明けに `errorCount` をリセットし、リトライを許可
- 1回でも成功すれば `cooldownMs` と `errorCount` を完全リセット

### 2.3 sendNativeMessage（content.js）

content.js から background.js 経由でネイティブハンドラーに通信する関数。

```
content.js: sendNativeMessage(action, data)
    → RequestQueue でレート制限
    → browser.runtime.sendMessage(message)
    → background.js: onMessage ハンドラー
    → handleTokenizeRequest()
```

クールダウン中は呼び出し自体をスキップし `null` を返す。

### 2.4 background.js — 辞書ルーティング

`handleTokenizeRequest()` が設定に応じて辞書バックエンドを選択する。

**dictType='system'（デフォルト）:**
```
tryNativeTokenization() → fallbackTokenize()
```

**dictType='ipadic':**
```
tryKuromojiTokenization() → tryNativeTokenization() → fallbackTokenize()
```

各関数が `null` を返した場合、次の関数にフォールバックする（`||` チェイン）。最終的に `fallbackTokenize()` は1文字ずつの `simpleTokenize` を返す（`dictSource: 'fallback'`）。

### 2.5 SafariWebExtensionHandler.swift — ネイティブトークン化

3段階パイプラインでテキストをトークン化する。

**Phase 1: NLTagger**
- `.lexicalClass` スキームでトークン境界と品詞タグを取得
- `.omitWhitespace` オプションにより空白はトークンとして返されない
- Character offset と UTF-16 offset の両方を記録
- `autoreleasepool` 内で実行し、Phase 2 の前にメモリ解放

**Phase 2: CFStringTokenizer**
- `kCFStringTokenizerUnitWordBoundary` でテキスト全体をトークン化
- `kCFStringTokenizerAttributeLatinTranscription` でラテン文字転写を取得
- `kCFStringTransformLatinHiragana` でひらがなに変換
- `autoreleasepool` 内で実行

**Phase 3: マッチングとフォールバック**

NLTagger と CFStringTokenizer はトークン境界が異なるため、5段階のフォールバックで読みを取得する。

| 優先度 | 方法 | 説明 |
|--------|------|------|
| 0 | CF範囲包含（長単位化） | CFの読み範囲がNLトークン複数個をカバーする場合、漢字を含むなら結合 |
| 1 | 完全一致 | NLトークンとCFトークンのUTF-16範囲が完全に一致 |
| 2 | 部分範囲連結 | NLトークン内に含まれる複数CFトークンの読みを連結 |
| 3 | カタカナ→ひらがな | `CFStringTransformHiraganaKatakana` の逆変換 |
| 4 | 隣接漢字結合 | 連続する漢字のみのトークンを結合して `getReading()` |
| 5 | 個別 getReading | 単一トークンに対して新規 `CFStringTokenizer` で読みを取得 |

### 2.6 content.js — 後処理

トークンを受信した後の処理チェイン:

```
tokens
  → ReadingRules.apply()          // 読み補正（日付表現、"何を"→"なにを" 等）
  → groupToLongUnits() / 短単位   // unitType 設定に応じてグルーピング
  → addFuriganaToNode()           // range に基づくギャップ補完 + <ruby> 構築
      → splitKanjiReading()       // 送り仮名分離（"食べる" → "食" + "べる"）
      → DOM 置換
```

**ギャップ補完:** NLTagger の `.omitWhitespace` により空白がトークンから除外されるため、トークンの `range` 情報を使い、トークン間の隙間にある空白・改行をテキストノードとして挿入する。

**世代カウンター:** `furikanaGeneration` により、設定変更中にインフライトだった古い辞書の結果を破棄する。

---

## 3. エラーが発生する要因

### 3.1 Safari 拡張プロセスのメモリ制限

Safari の拡張プロセスには約 **6MB** のメモリ制限がある。NLTagger と CFStringTokenizer は内部で言語リソースを共有しており、同時に存在するとメモリ使用量が急増する。

**対処:** Phase 1 と Phase 2 をそれぞれ `autoreleasepool` で囲み、Phase 1 の NLTagger を完全に解放してから Phase 2 の CFStringTokenizer を作成する。

**発生状況:** 長いテキストや大量のリクエストが連続する場合にメモリ不足でクラッシュする可能性がある。

### 3.2 sendNativeMessage の同期呼び出しエラー

`browser.runtime.sendNativeMessage()` を `browser.runtime.onMessage` ハンドラーの**同期処理部分**で呼び出すと、`SFErrorDomain error 3`（"Invalid call"）が発生する。

**対処:** `handleLoadDictFile()` 等では `await Promise.resolve()` で一旦非同期コンテキストに遷移してから `sendNativeMessage` を呼ぶ。

### 3.3 ネイティブメッセージングのタイムアウト・通信エラー

content.js → background.js → Swift の3段階通信で、以下の要因でエラーが発生する:

- **background.js のイベントページ停止:** `persistent: false` のため、一定時間アイドルだと Safari が background.js を停止する。停止中にメッセージを送ると応答がない。
- **Swift プロセスのクラッシュ:** メモリ制限超過や予期しない入力で拡張プロセスがクラッシュ。
- **メッセージシリアライズエラー:** 大きすぎるテキストや特殊文字を含むメッセージの送受信失敗。

**対処:** `RequestQueue` で同時実行数を3に制限し、75msのインターバルを設ける。連続エラー10回でクールダウンに入り、指数バックオフで自動回復を試みる。

### 3.4 スクロール時の大量リクエスト

ユーザーがスクロールすると新しいテキストノードが画面内に入り、一度に大量のトークン化リクエストが発生する。

**発生メカニズム:**
1. スクロール → `scanVisibleTextNodes()` で新規ノードを検出
2. `processQueue()` でバッチ処理開始
3. ネイティブ通信の同時実行数を超過 → エラー多発
4. `errorThreshold` 到達 → クールダウン発動

**対処（現在の実装）:**
- `RequestQueue` で同時実行数3・75msインターバルのレート制限
- クールダウン中は `processQueue()` がバッチ処理を一時停止（`await` で待機）
- クールダウン明けに `pending` をクリアし `scanVisibleTextNodes()` を再実行
- トークン化失敗時は `return false` で未処理として残し、`processedNodes` に入れない → 次回スキャンで再取得・リトライ

### 3.5 background.js の fallbackTokenize（simpleTokenize）

`tryNativeTokenization()` が失敗した場合の最終フォールバックとして、background.js 側の `simpleTokenize()` が1文字ずつのトークンを返す。この場合 `dictSource: 'fallback'` となり `response.success` は `true` であるため、content.js 側ではトークン化成功として扱われる。

**影響:** 読み仮名情報がないため、漢字にルビは付かないが DOM 置換は実行される。ただし content.js の `addFuriganaToNode` では、`reading === surface` のトークンはルビをスキップするため、実質的に元テキストがそのまま再構築される。

**注意:** この経路では `dictSource` が `'fallback'` であるため、ログで区別可能。

### 3.6 NLTagger と CFStringTokenizer のトークン境界不一致

NLTagger は形態素解析に基づくトークン化、CFStringTokenizer は単語境界に基づくトークン化を行うため、同じテキストでもトークン境界が異なる場合がある。

**例:**
- NLTagger: `["東京", "都"]` / CFStringTokenizer: `["東京都"]`
- NLTagger: `["食べ", "る"]` / CFStringTokenizer: `["食べる"]`

**対処:** Phase 3 の5段階フォールバック（§2.5 参照）で網羅的にマッチングを試みる。

### 3.7 世代カウンターの競合

設定変更（辞書切替、unitType変更等）中にインフライトのトークン化リクエストが完了すると、古い設定に基づく結果が新しい設定のテキストノードに適用される可能性がある。

**対処:** `furikanaGeneration` カウンターを設定変更時にインクリメント。`addFuriganaToNode` の冒頭で記録した世代と処理完了時の世代を比較し、不一致なら結果を破棄（`return false`）。

---

## 4. エラー対処フローの全体図

```
addFuriganaToNode(textNode)
    │
    ├─ [クールダウン中] → return false（未処理）
    │       ↑
    │   processQueue() がクールダウン検出
    │       → await でクールダウン終了まで待機
    │       → pending クリア + 再スキャン
    │       → 未処理ノードが再度キューに入る
    │
    ├─ [sendNativeMessage 成功] → tokens 取得 → ルビ構築 → return true
    │       → errorCount リセット、cooldownMs リセット
    │
    ├─ [sendNativeMessage エラー]
    │       → errorCount++
    │       ├─ [< errorThreshold] → return false（未処理）
    │       │       → 次回スキャンでリトライ
    │       └─ [>= errorThreshold] → クールダウン発動
    │               → 指数バックオフ: 3s → 6s → 12s → 24s → 30s
    │               → 待機中キュー全キャンセル（null resolve）
    │               → processQueue() が待機 → 再スキャン
    │
    ├─ [response が null/unsuccessful]
    │       → tokens = null → return false（未処理）
    │       → 次回スキャンでリトライ
    │
    └─ [世代不一致] → return false（結果破棄）
```

---

## 5. 設定と定数の一覧

### RequestQueue

| 定数 | 値 | 説明 |
|------|-----|------|
| `maxConcurrent` | 3 | 同時実行リクエスト数の上限 |
| `intervalDelay` | 75ms | リクエスト間の最小インターバル |
| `errorThreshold` | 10 | クールダウン発動までの連続エラー回数 |
| `baseCooldownMs` | 3,000ms | 初回クールダウン時間 |
| `maxCooldownMs` | 30,000ms | 最大クールダウン時間（指数バックオフの上限） |

### VisibleTextProcessor

| 定数 | 値 | 説明 |
|------|-----|------|
| `batchSize` | 12 | 1バッチあたりの処理ノード数 |
| `batchDelay` | 60ms | バッチ間の待機時間 |
| `scanDelay` | 150ms | scroll/resize 後のスキャン遅延 |
| `maxPending` | 200 | 待機キューの最大サイズ |

---

## 6. デバッグ方法

### コンソールログの読み方

| ログパターン | 場所 | 意味 |
|-------------|------|------|
| `Processing request N (queue: Q, running: R)` | RequestQueue | 50リクエストごとの進捗 |
| `Request returned null (error count: E/10)` | RequestQueue | リクエスト失敗（エラーカウント増加） |
| `Error threshold reached, cooldown Xms` | RequestQueue | クールダウン発動 |
| `Cooldown expired, resuming native messaging` | RequestQueue | クールダウン明け |
| `Pausing batch processing during cooldown` | VisibleTextProcessor | バッチ処理一時停止 |
| `Cooldown ended, scheduling rescan for retry` | VisibleTextProcessor | 再スキャン開始 |
| `Tokenization failed, leaving node for retry` | addFuriganaToNode | 未処理として保留 |
| `Tokenization successful (SOURCE), tokens: N` | addFuriganaToNode | 正常完了 |
| `Discarding stale result (generation changed)` | addFuriganaToNode | 世代不一致で破棄 |
| `Visible nodes queued: N (pending: P)` | VisibleTextProcessor | スキャンでノード追加 |
| `Dict type: TYPE` | background.js | 辞書ルーティング |
| `kuromoji tokenization success/failed` | background.js | kuromoji の結果 |
| `Native response received` | background.js | Swift からの応答 |
| `Phase 1: N tokens from NLTagger` | Swift | NLTagger のトークン数 |
| `Phase 2: N readings from CFStringTokenizer` | Swift | CFStringTokenizer の読み数 |

### ログの確認場所

- **content.js / background.js のログ:** Safari → 開発 → 対象ページの Web インスペクタ
- **background.js のみのログ:** Safari → 開発 → Web Extension Background Content
- **Swift のログ:** Xcode コンソール（`NSLog` / `os_log`）
