# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Furikana is a browser extension that adds furigana (reading annotations) to Japanese kanji on web pages. **Safari（iOS）版と Chrome 版の2プラットフォーム**があり、`furikana Extension/Resources/` を共有ソースの正として、Chrome 版は `scripts/build-chrome.js` が `dist/chrome/` に組み立てる（詳細は `docs/safari-development.md` / `docs/chrome-development.md`）。

**製品名は「るびポン」(RubiPon)**（旧称 FuriFuri — App Store で名前衝突のため改名）。表示名（CFBundleDisplayName、_locales の extension_name、LaunchScreen、Main.html）とターゲット/スキーム/プロジェクト名・生成物名（`RubiPon.app` / `RubiPon Extension.appex`）は RubiPon に変更済み。**bundle ID `con3.furikana` と AppGroup `group.con3.furikana` は据え置き** — 変更すると証明書・AppGroupデータ・native messaging が壊れるため、今後も変更しないこと。 Two tokenization backends are available: native Swift (NLTagger + CFStringTokenizer) and kuromoji.js (IPA dictionary). Readings are rendered as HTML `<ruby>` tags with okurigana separation.

Two display modes: **通常モード** (Safari native ruby — rt above kanji) and **ひらがなメインモード** (`reverseRuby` — small kanji above, full-size hiragana below; rt はフロー内の `display: block`。inline-block のベースライン＝最後のフロー内行＝ひらがな行になり周囲のテキストと揃う).

## Build

```bash
# Safari版
xcodebuild -scheme RubiPon build -destination 'generic/platform=iOS'

# Chrome版（dist/chrome/ に組み立て。--zip でストア用zip、--no-sudachi で軽量ビルド）
npm run build:chrome
```

Two targets: `RubiPon` (iOS host app) and `RubiPon Extension` (Safari web extension). Building the scheme builds both. No test suite or linter is configured. Xcode project is `RubiPon.xcodeproj`.

`furikana Extension/Resources/` uses PBXFileSystemSynchronizedRootGroup — files added to this directory are automatically picked up by Xcode without pbxproj edits.

### プラットフォーム構成（Safari / Chrome）

- **`furikana Extension/Resources/` が共有ソースの正**。Chrome 版のためにファイルを動かさないこと（Xcode の synchronized group が壊れる）。`dist/chrome/` はビルド出力なので編集禁止。
- Chrome 固有の挙動は共有コード内の実行時分岐で扱う: `FK_IS_CHROMIUM = /Chrome\//.test(navigator.userAgent)`（Safari・ホストアプリWKWebViewでは偽）。ネイティブメッセージング（AppGroup同期・os_log・辞書チャンク読み込み）は `FK_HAS_NATIVE` でガード。
- **api-shim.js** — 全コンテキストの先頭でロード。Chrome に `browser = chrome` を提供（Safariでは no-op）。popup.html / options.html からも読み込まれる。
- **辞書ロードの分岐**: Safari は background から fetch で拡張リソースを読めないため sendNativeMessage → Swift チャンク読み込み。Chrome は `fetch()` 直読み（kuromoji.js `_loadViaFetch`、ext-helper.js `_loadDictViaFetch`）。
- **dictType 'system' は Safari 専用**。Chrome では `fkNormalizeDictType()` が 'ipadic' に正規化し、options.js が選択肢を非表示にする。Chrome の既定 dictType は 'ipadic'。
- **ユーザー辞書TSV原文**: Safari は AppGroup、Chrome は `storage.local` の `userDictTSV` キーに永続化。
- **ツールバーアイコン**: Chrome は setIcon の SVG 非対応のため PNG に切り替え（background.js / popup.js）。
- **`chrome/`** — Chrome 専用ファイル: `manifest.json`（MV3 service_worker）と `sw.js`（importScripts ローダー。順序は Safari の background scripts 配列と同一: api-shim → kuromoji → ext-helper → sudachi-bundle → background）。

### Manifest

**Safari** (`furikana Extension/Resources/manifest.json`): Manifest V3 (`manifest_version: 3`, requires Safari 15.4+ / iOS 15.4+). Background scripts: `["kuromoji.js", "ext-helper.js", "sudachi-bundle.js", "background.js"]` with `persistent: false`（順序重要 — ext-helper.js と sudachi-bundle.js は background.js より先にロード）. Content scripts load `reading-rules.js` before `content.js` (order matters — ReadingRules IIFE must be defined first). Localized with `_locales/en/` and `_locales/ja/`.

**Chrome** (`chrome/manifest.json`): MV3 `service_worker: "sw.js"`。content scripts は `["api-shim.js", "reading-rules.js", "content.js"]`。`nativeMessaging` 権限なし。CSP に `'wasm-unsafe-eval'`（Sudachi WASM 用）。

## Architecture

### Tokenization Flow

```
content.js → sendBatchTokenize (batch of texts, leading whitespace trimmed)
  → browser.runtime.sendMessage({ action: 'tokenizeBatch' })
    → background.js (handleTokenizeBatchRequest)
      ├─ dictType='ipadic' → kuromoji.js (IPA辞書, sync per text)
      ├─ dictType='sudachi' → ext-helper.js (Sudachi WASM adapter)
      └─ dictType='system' → sendNativeMessage → Swift (tokenizeBatch)
                               ├─ Phase 1: NLTagger (tokens + POS)
                               ├─ Phase 2: CFStringTokenizer (readings)
                               └─ Phase 3: Match & merge
      → fallback: simpleTokenize (character-by-character)

content.js receives batch results
  → token range adjusted for trimmed leading whitespace
  → splitParenReadingTokens() → ReadingRules.apply() → splitKanjiReading() → build <ruby> elements
```

All dict paths return the same token format: `{surface, reading, pos, range:[start,end]}`. ReadingRules and okurigana splitting run in content.js after receiving tokens from either backend.

**Leading whitespace trimming**: `processQueue` trims leading/trailing whitespace before sending to tokenizer (NLTagger returns empty tokens for text starting with `\n`). Token ranges are adjusted by adding `leadingWhitespace` offset after tokenization.

**Batch tokenization**: `processQueue` collects up to 12 text nodes per batch and sends all texts in a single `tokenizeBatch` message (reduces IPC from 12 round-trips to 1). Single-node tokenization (`addFuriganaToNode`) is kept as backward-compatible wrapper.

### Host App Storage Bridge

Host app and extension share data via AppGroup (`group.con3.furikana`). `ViewController.swift` loads `options.html` in a WKWebView and injects a `browser.storage.local` polyfill as WKUserScript. The polyfill communicates via `window.webkit.messageHandlers.controller.postMessage()`, persisting settings to `UserDefaults(suiteName: appGroupId)` under key `"furikanaSettings"`.

### Key Files

- **`furikana Extension/SafariWebExtensionHandler.swift`** — Native tokenization engine. 3-phase pipeline: NLTagger (POS tags) → CFStringTokenizer (Latin→hiragana via CFStringTransform) → UTF-16 range matching with fallback strategies. Supports both `tokenize` (single) and `tokenizeBatch` (multiple texts with autoreleasepool per text). ReadingRules are NOT applied here (unified to JS side).
- **`furikana Extension/Resources/reading-rules.js`** — ReadingRules IIFE (content.js から分離)。Sequence/surface/regex ルールで読み補正（~247ルール、ヶ月等はプログラム生成）。日付表現、泊/分の連濁、「日」の読み分け（び/にち/じつ/ひ）、ヶ月の読み等。manifest.json で content.js より先にロード。ルール追加・編集はこのファイルのみ。
- **`furikana Extension/Resources/content.js`** — Main extension logic. Key components:
  - `applyRubyCSS()` — Generates CSS with reverseRuby/normal mode branching. Normal mode uses Safari native `display: ruby`; reverse mode uses `display: inline-block` + absolute-positioned rt.
  - `splitKanjiReading(surface, reading)` — Separates okurigana so ruby only appears above kanji (regex-based, kuroshiro-style).
  - `splitParenReadingTokens(tokens)` — Sudachi等が括弧付き読み注釈（"黎明（れいめい）期"）をsurfaceに含めて返す場合に分割処理。ReadingRules適用前に実行。
  - `RequestQueue` — Rate-limited native messaging (max 3 concurrent, 75ms interval). Distinguishes connection errors (background.js stopped) from tokenization errors — connection errors trigger 2s retry instead of cooldown.
  - `isConnectionError()` — Detects background.js unavailability ("Could not establish connection", "Receiving end does not exist" etc.).
  - `VisibleTextProcessor` — Viewport-aware batch processing (12 nodes/batch). `processQueue` trims leading whitespace, sends batch via `sendBatchTokenize`, adjusts token ranges, applies results via `applyTokensToNode`. MutationObserver（childList/characterData）でSPA遷移・動的コンテンツを検知して再スキャン。自前のruby挿入レコードはバッチ適用直後の `takeRecords()` で破棄（自己トリガー防止）。非表示タブではスキャンを保留し visibilitychange で再開。**翻訳ループガード**: Safari翻訳等の外部DOM書き換えエージェントがruby挿入に反応して書き換え続ける往復ループ対策として、①同一親要素が30秒内に3回超再処理されたら `blockedElements`（WeakSet）で除外（`recordElementProcess`、スキャン世代で同一バッチ内の重複カウント防止）、②mutation起因スキャンが10秒に5回超続いたら再スキャン遅延を指数バックオフ（最大30秒、静穏期間で解除）。
  - `applyTokensToNode()` — `rubyCount === 0` の場合はDOM置換を行わない（テキストノードをそのまま保持）。
  - `rebuildFurigana()` — Common rebuild logic (removeFurigana → reset queue → restart processor).
  - `scheduleRebuild()` — Defers rebuild on hidden tabs; executes on `visibilitychange` when tab becomes visible.
  - `furikanaGeneration` counter — Discards stale in-flight results after settings change or re-render.
  - `storage.onChanged` listener — Handles live updates for CSS sliders, readingType, unitType, readingRules, dictType, reverseRuby, userDictRules.
  - `getTextNodes()` — Excludes SCRIPT, STYLE, RUBY, RT, RB, TEXTAREA/INPUT/SELECT/OPTION tags, contenteditable (`isContentEditable`), and any text inside existing `<ruby>` ancestors (prevents double-ruby on sites using `<rb>` tags). ruby祖先・広告セレクタの `closest()` 判定は `ancestorExclusionCache`（WeakMap）でキャッシュ。
- **`furikana Extension/Resources/background.js`** — Message router with dict routing: kuromoji (ipadic) / Sudachi WASM (sudachi) / native Swift (system) → simpleTokenize fallback. Handles both `tokenize` (single) and `tokenizeBatch` (batch). Handles kuromoji/Sudachi lifecycle. ユーザー辞書の `updateUserDict` / `loadUserDict` メッセージも処理。`parseUserDictTSV()` でTSVをルールに変換し `browser.storage.local.set({ userDictRules })` で全タブに通知。
- **`furikana Extension/Resources/ext-helper.js`** — Sudachi WASM アダプター（background scripts の2番目にロード）。Sudachi 初期化・トークン化・辞書チャンク読み込み（16MBチャンク — 1MBに縮小したところ同梱123MB辞書で往復が激増し初期化が完了せず、Sudachi選択時にふりがなが出なくなる退行が実機で発生。16MBが実績値）・数字読み補正を担当。旧 `sudachi-tokenizer.js`（未ロードの重複ファイル）は削除済み — Sudachi 関連の修正は必ずこのファイルに入れる。
- **`furikana Extension/Resources/sudachi-bundle.js`** — Sudachi WASM 本体。`npm run build:sudachi` で生成（esbuild）、`scripts/patch-sudachi-bundle.js` でパッチ適用。`sudachi-dict/` に辞書ファイル。
- **`furikana Extension/Resources/kuromoji.js`** + **`dict/`** — Bundled IPA dictionary tokenizer (~17MB). Loaded as background script alongside background.js.
- **`furikana Extension/Resources/popup.js`** / **`popup.html`** — Toolbar popup (toggle, ruby size slider, auto-enable, reverse ruby toggle). i18n対応（`data-i18n`/`data-i18n-template` + `t()` ヘルパー、`_locales` の `popup_*` キー）。スライダーは `change`/`pagehide` でデバウンス中の保存をフラッシュ。Sudachi辞書選択時はpopup表示中のみ `getSudachiStatus` を500msポーリングして辞書ロード進捗を status-text に表示（storage書き込み・ブロードキャスト不使用のため content.js / AppGroup同期に影響なし）。
- **`furikana Extension/Resources/options.js`** / **`options.html`** / **`options.css`** — Settings page (dict type, reading type, unit type, ruby styling sliders, auto-enable, reverse ruby, reading rules toggle, user dictionary). Includes live preview of ruby styling. ホストアプリのWKWebViewでも表示される（browser.i18n 非対応環境ではHTMLの日本語がフォールバック）。
- **popup.css / options.css** — `@media (prefers-color-scheme: dark)` でダークモード対応（`color-scheme: light dark` 宣言済み）。
- **`furikana/ViewController.swift`** — Host app WKWebView controller. Injects `browser.storage.local` polyfill and back-button script. Bridges settings between web UI and UserDefaults via AppGroup.
- **`furikana Extension/Resources/api-shim.js`** — プラットフォーム吸収シム。Chrome に `browser = chrome` を提供（Safari では no-op）。Chrome では全コンテキストの先頭、Safari では popup.html / options.html からロード。
- **`chrome/manifest.json`** / **`chrome/sw.js`** — Chrome 専用。MV3 service worker エントリ（sw.js が importScripts で共有スクリプトを Safari と同順にロード）。
- **`scripts/build-chrome.js`** — Chrome 版ビルド。共有リソース + chrome/ を `dist/chrome/` に組み立てる（`npm run build:chrome`、`--zip` / `--no-sudachi` オプション）。

### Ruby Display Modes

**通常モード** (`reverseRuby: false`):
- Ruby uses Safari native `display: ruby` (no override). Rt renders above kanji by default.
- `rubySize` controls rt font-size. `rubyGap` applies as `margin-block-end` on rt.
- Do NOT set `display: inline-block` on ruby — it breaks Safari's native `display: ruby-text` on rt, making text invisible.

**ひらがなメインモード** (`reverseRuby: true`):
- Ruby gets `display: inline-block` + `font-size: rubySize%` (kanji shrinks).
- Rt gets `display: block`（フロー内、appears below kanji）。**`position: absolute` + `inset-block-start: 100%` にしないこと** — Chrome は指定を忠実に適用するためひらがながベースライン下にぶら下がり行がガタガタに崩れる（Safari は rt の display/position 上書きを無視するため差が出ない）。フロー内ブロックなら inline-block のベースライン＝ひらがな行になり両ブラウザで周囲のテキストと揃う。
- Rt font-size is calculated as `100/rubySize*100`% to cancel the parent's shrinkage.
- `rubyGap` applies as `margin-block-start` on rt.

### Token Format

Both backends produce tokens consumed by content.js:
```json
{"surface": "東京", "reading": "とうきょう", "pos": "Noun", "range": [0, 2]}
```
- `reading` is always hiragana (kuromoji converts from katakana in background.js)
- `pos` uses English tags: Noun, Verb, Adjective, Adverb, Particle, Auxiliary, Conjunction, Other
- If `reading === surface` (no kanji), ruby is skipped

### ReadingRules

Defined in `reading-rules.js` as a JS IIFE (content.js から分離済み、manifest.json で先にロード)。Three rule types:
1. **Sequence rules** — Merge adjacent tokens: `["何", "を"]` → `"なにを"`
2. **Surface rules** — Exact match: `"何を"` → `"なにを"`
3. **Regex rules** — Pattern + context: date expressions (`1月`, `15日`), 泊/分の連濁（末尾桁で ぱく/はく, ぷん/ふん を判定）, split-token variants for kuromoji

Rules have priority (higher = runs first). Regex rules support `$1`/`$2` capture groups and context constraints (`prevPattern`, `prevPrevPattern`, `nextPattern`). See `ReadingRules.md` for the full guide.

**Performance optimizations**:
- Sort caching: `sequenceRules`, `surfaceRules`, `regexRules` は IIFE 初期化時にソート済み配列をキャッシュ（`apply()` 毎のソートを排除）
- Regex early skip: `regexOtherRules`（数字を含まないルール）を事前フィルタ。トークンに数字がなければ数字ルールをスキップ。`HAS_DIGIT = /[0-9０-９]/` で全角数字も検出。

**Programmatic rule generation**: `KANJI_NUM_READINGS`（一〜十）× `KAGETSU_VARIANTS`（か/ヶ/ケ/ヵ/カ）のループで sequence/surface ルールを自動生成。

**surfaceRules のキー名**: `surface`（単数形）を使用。`surfaces` は sequenceRules 用（配列）。間違えると無言でマッチしなくなる。

**「日」の読み分け**: 個別の surface/sequence ルールで対応（汎用パターンは誤読が多く不採用）。び（公開日等の行事・期日）、にち（縁日）、じつ（祭日、期日）、ひ（この日、あの日）を語ごとに定義。

**Counter word sound changes (階/軒/百/千)**: 鼻音化・半濁音化は単一桁の3のみに適用（3階=さんがい、13階=じゅうさんかい）。杯/本/匹は末尾桁で判定（13杯=じゅうさんばい）。

### Settings (browser.storage.local)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dictType` | `'system'`\|`'ipadic'`\|`'sudachi'` | `'system'`（Chrome: `'ipadic'`） | Tokenization backend（`'system'` は Safari 専用） |
| `readingType` | `'hiragana'`\|`'romaji'` | `'hiragana'` | Ruby display format |
| `unitType` | `'long'`\|`'short'` | `'long'` | Token merging granularity |
| `autoEnable` | bool | `false` | Auto-apply on page load |
| `readingRules` | bool | `true` | Apply reading correction rules |
| `reverseRuby` | bool | `false` | ひらがなメインモード (rt below, kanji shrinks) |
| `rubySize` | int (30-100) | `50` | Normal: rt font size / Reverse: kanji font size |
| `rubyGap` | int (-16〜16) | `1` | Normal: rt margin-block-end / Reverse: rt margin-block-start (px) |
| `rubyLineHeight` | float | `1.3` | Line height multiplier |
| `rubyMinHeight` | int | `12` | Minimum block size (px) |
| `rubyBoxPadding` | float | `0.15` | Paragraph padding (em) |
| `rubyBoxMargin` | float | `0` | Paragraph margin (em) |
| `userDictRules` | object\|null | `null` | ユーザー辞書ルール（`parseUserDictTSV`で生成、`{surfaceRules, sequenceRules}`形式） |
| `siteStyleOverrides` | object\|null | `null` | サイト別表示スタイル記憶。`{ホスト名: {v: {6値}, t: 最終更新epoch}}`。上限100件LRU |

### Settings Change Flow

Settings changed in popup/options → `browser.storage.local.set()` → `storage.onChanged` fires in content.js:
- **CSS-only keys** (rubySize, rubyGap, etc.): `applyRubyCSS()` + `realignAllRubyWidths()`
- **reverseRuby, readingType, unitType, readingRules, dictType**: `scheduleRebuild()` → defers to `rebuildFurigana()` (hidden tabs wait until visible)
- **userDictRules**: `ReadingRules.setUserRules(rules)` → `scheduleRebuild()`

**サイト別表示スタイル記憶**: popup のスライダー操作時に `saveSiteStyleSnapshot()` がアクティブタブのホスト名単位で6値（rubySize/rubyGap/rubyLineHeight/rubyMinHeight/rubyBoxPadding/rubyBoxMargin）のスナップショットを `siteStyleOverrides` に保存（上限100件、`t` が古いものからLRU削除）。content.js は `loadSettings()` でこのホストの記憶をグローバル値に上書き適用し、`siteStyleActive` 中はグローバル6値の `onChanged` を無視（ピン留め）。サイト値の変更・消去は `changes.siteStyleOverrides` 経由で反映。options 画面での変更はグローバルのみ（サイト記憶は popup 操作時に現在値一式をスナップショット）。options に全消去ボタンあり。**AppGroup 同期からは userDictRules 同様に除外**（background 再起動時の巻き戻り防止）。

**ユーザー辞書フロー**: options.js がTSVを `updateUserDict` メッセージで background.js に送信 → `parseUserDictTSV()` でルール変換 → `storage.local.set({ userDictRules })` で全タブに通知 → content.js の `storage.onChanged` で `ReadingRules.setUserRules()` を呼び出し。TSV原文は `saveUserDict` アクションで AppGroup にも永続化（`userDictRules`はExpansion後のデータが巨大になるためAppGroup同期から除外）。

### CSS Convention

Use logical properties (`inset-block-start`, `margin-block-end`, `min-block-size`, `min-inline-size`, `margin-inline-end`) instead of physical properties (`top`, `margin-bottom`, `min-height`, `min-width`, `margin-right`) for ruby-related CSS to support vertical writing modes.

### Critical Constraints

- **Safari rt display**: Do NOT set `display: inline-block` on `<ruby>` in normal mode. Safari's native `display: ruby` + `display: ruby-text` on rt breaks if overridden, making rt content invisible.
- **Memory in Swift extension**: Safari extensions have ~6MB limit. NLTagger and CFStringTokenizer must run in separate `autoreleasepool` blocks — they share linguistic frameworks and interfere if alive simultaneously. `tokenizeBatch` wraps each text's `tokenizeText` in an additional `autoreleasepool`.
- **Token boundary mismatch**: NLTagger and CFStringTokenizer tokenize differently. Phase 3 handles this with fallback strategies: exact UTF-16 match → sub-range concatenation → katakana conversion → individual getReading() fallback.
- **kuromoji split tokens**: kuromoji tokenizes more finely than NLTagger (e.g., "1月" → ["1", "月"]). ReadingRules includes split-token variants (`gatsu-split`, `nichi-after-gatsu-split`) to handle this.
- **Generation counter**: `furikanaGeneration` increments on settings changes that require re-render. In-flight tokenization results check their generation against the current value and discard if stale.
- **Width alignment**: `getBoundingClientRect()` is used instead of `offsetWidth` for ruby/rt width measurement, since `offsetWidth` is unreliable with `display: ruby`.
- **background.js lifecycle**: `persistent: false` means Safari can terminate background.js after idle. `isConnectionError()` detects this and triggers retry with 2s wait instead of entering cooldown. `sendBatchTokenize` retries once on connection error.
- **Extension context invalidated（回復不能）**: 拡張のリロード/更新で既存タブの content.js が孤児化すると `browser.runtime` が恒久的に無効になる（Chrome の開発時に頻発）。これは一時的な接続エラーとは別物で、`isContextInvalidated()` → `handleContextInvalidated()` がプロセッサ・MutationObserver を完全停止する（リトライしない）。ページ再読み込みで新しい content script が動く。孤児化後の `sendMessage` は同期 throw になるため `.catch()` だけでなく try/catch が必要。
- **Double-ruby prevention**: `getTextNodes()` excludes text inside any `<ruby>` ancestor (including `<rb>`, `<rt>`) to avoid adding furigana to sites that already use ruby markup.
- **Background tab optimization**: `scheduleRebuild()` defers ruby rebuild on hidden tabs via `document.hidden` + `visibilitychange` listener, preventing unnecessary processing across all open tabs when settings change.
- **NLTagger + 改行テキスト**: NLTagger は改行文字で始まるテキストに対して空のトークン配列を返す。`processQueue` でテキストをトリムしてからトークン化し、`leadingWhitespace` オフセットをトークンの `range` に加算して補正する。
- **rubyCount === 0 のDOM置換スキップ**: `applyTokensToNode` でルビが1つも生成されなかった場合（漢字なし）、DOM置換を行わずそのまま `true` を返す。置換すると新テキストノードが `processedNodes` に未登録のまま残り、次のスキャンで再検出されて無限ループになる。
- **userDictRules のAppGroup同期除外**: `allPartitions` 展開後のデータが巨大になるため、`userDictRules` は AppGroup の `syncSettings` / `forceSyncToAppGroup` から `delete` して除外。TSV原文は別途 `saveUserDict` アクションで AppGroup に保存。
- **WKWebView 表示ページの font-family は日本語フォント先頭**: iOSシミュレーターのアプリ内 WKWebView は `-apple-system` / `system-ui` 経由の CJK フォールバックが壊れて日本語が豆腐になる（実機・Safariは正常）。Style.css / licenses.html / options.css / popup.css は `"Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, ...` の順を維持すること。
- **xcodebuild の `-derivedDataPath` を Dropbox 配下にしない**: Dropbox が生成物に拡張属性を付けて CodeSign が detritus エラーで失敗する。デフォルト（~/Library/...）か Dropbox 外を使う。

## Build Notes

**Sudachi WASM バンドルの再生成**（`sudachi-bundle.js` を更新する場合）:
```bash
npm run build:sudachi
```
esbuild で `sudachi-wasm333` をバンドルし、`scripts/patch-sudachi-bundle.js` でパッチを適用。生成ファイルは `furikana Extension/Resources/sudachi-bundle.js`。

## Debugging

JS ファイルの構文チェック: `node -c "furikana Extension/Resources/content.js"` — Safari 上でスクリプトが読み込まれない場合、まずこれで SyntaxError を確認する。

**ログ確認場所**:
- content.js / background.js: Safari → 開発 → 対象ページの Web インスペクタ
- background.js のみ: Safari → 開発 → Web Extension Background Content
- Swift ログ: Xcode コンソール（`os_log`）
- Chrome 版: `chrome://extensions` → るびポンのカード → 「Service Worker」リンク（background）、対象ページの DevTools（content.js）

## Language

All user-facing text and code comments are in Japanese. Respond in Japanese.
