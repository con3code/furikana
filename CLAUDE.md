# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Furikana is an iOS Safari Web Extension that adds furigana (reading annotations) to Japanese kanji on web pages. Two tokenization backends are available: native Swift (NLTagger + CFStringTokenizer) and kuromoji.js (IPA dictionary). Readings are rendered as HTML `<ruby>` tags with okurigana separation.

Two display modes: **通常モード** (Safari native ruby — rt above kanji) and **ひらがなメインモード** (`reverseRuby` — small kanji above, full-size hiragana below via `display: block` + `position: absolute` on rt).

## Build

```bash
xcodebuild -scheme FuriFuri build -destination 'generic/platform=iOS'
```

Two targets: `FuriFuri` (iOS host app) and `FuriFuri Extension` (Safari web extension). Building the scheme builds both. No test suite or linter is configured. Xcode project is `FuriFuri.xcodeproj`.

`furikana Extension/Resources/` uses PBXFileSystemSynchronizedRootGroup — files added to this directory are automatically picked up by Xcode without pbxproj edits.

### Manifest

Manifest V3 (`manifest_version: 3`, requires Safari 15.4+ / iOS 15.4+). Background scripts: `["kuromoji.js", "background.js"]` with `persistent: false`. Content scripts load `reading-rules.js` before `content.js` (order matters — ReadingRules IIFE must be defined first). Localized with `_locales/en/` and `_locales/ja/`.

## Architecture

### Tokenization Flow

```
content.js → sendBatchTokenize (batch of texts)
  → browser.runtime.sendMessage({ action: 'tokenizeBatch' })
    → background.js (handleTokenizeBatchRequest)
      ├─ dictType='ipadic' → kuromoji.js (IPA辞書, sync per text)
      └─ dictType='system' → sendNativeMessage → Swift (tokenizeBatch)
                               ├─ Phase 1: NLTagger (tokens + POS)
                               ├─ Phase 2: CFStringTokenizer (readings)
                               └─ Phase 3: Match & merge
      → fallback: simpleTokenize (character-by-character)

content.js receives batch results
  → applyTokensToNode() per node
    → ReadingRules.apply() → splitKanjiReading() → build <ruby> elements
```

Both dict paths return the same token format: `{surface, reading, pos, range:[start,end]}`. ReadingRules and okurigana splitting run in content.js after receiving tokens from either backend.

**Batch tokenization**: `processQueue` collects up to 12 text nodes per batch and sends all texts in a single `tokenizeBatch` message (reduces IPC from 12 round-trips to 1). Single-node tokenization (`addFuriganaToNode`) is kept as backward-compatible wrapper.

### Host App Storage Bridge

Host app and extension share data via AppGroup (`group.con3.furikana`). `ViewController.swift` loads `options.html` in a WKWebView and injects a `browser.storage.local` polyfill as WKUserScript. The polyfill communicates via `window.webkit.messageHandlers.controller.postMessage()`, persisting settings to `UserDefaults(suiteName: appGroupId)` under key `"furikanaSettings"`.

### Key Files

- **`furikana Extension/SafariWebExtensionHandler.swift`** — Native tokenization engine. 3-phase pipeline: NLTagger (POS tags) → CFStringTokenizer (Latin→hiragana via CFStringTransform) → UTF-16 range matching with fallback strategies. Supports both `tokenize` (single) and `tokenizeBatch` (multiple texts with autoreleasepool per text). ReadingRules are NOT applied here (unified to JS side).
- **`furikana Extension/Resources/reading-rules.js`** — ReadingRules IIFE (content.js から分離)。Sequence/surface/regex ルールで読み補正（~247ルール、ヶ月等はプログラム生成）。日付表現、泊/分の連濁、「日」の読み分け（び/にち/じつ/ひ）、ヶ月の読み等。manifest.json で content.js より先にロード。ルール追加・編集はこのファイルのみ。
- **`furikana Extension/Resources/content.js`** — Main extension logic. Key components:
  - `applyRubyCSS()` — Generates CSS with reverseRuby/normal mode branching. Normal mode uses Safari native `display: ruby`; reverse mode uses `display: inline-block` + absolute-positioned rt.
  - `splitKanjiReading(surface, reading)` — Separates okurigana so ruby only appears above kanji (regex-based, kuroshiro-style).
  - `RequestQueue` — Rate-limited native messaging (max 3 concurrent, 75ms interval). Distinguishes connection errors (background.js stopped) from tokenization errors — connection errors trigger 2s retry instead of cooldown.
  - `isConnectionError()` — Detects background.js unavailability ("Could not establish connection", "Receiving end does not exist" etc.).
  - `VisibleTextProcessor` — Viewport-aware batch processing (12 nodes/batch). `processQueue` sends batch via `sendBatchTokenize`, applies results via `applyTokensToNode`.
  - `rebuildFurigana()` — Common rebuild logic (removeFurigana → reset queue → restart processor).
  - `scheduleRebuild()` — Defers rebuild on hidden tabs; executes on `visibilitychange` when tab becomes visible.
  - `furikanaGeneration` counter — Discards stale in-flight results after settings change or re-render.
  - `storage.onChanged` listener — Handles live updates for CSS sliders, readingType, unitType, readingRules, dictType, reverseRuby.
  - `getTextNodes()` — Excludes SCRIPT, STYLE, RUBY, RT, RB tags and any text inside existing `<ruby>` ancestors (prevents double-ruby on sites using `<rb>` tags).
- **`furikana Extension/Resources/background.js`** — Message router with dict routing: kuromoji (ipadic) → native Swift (system) → simpleTokenize fallback. Handles both `tokenize` (single) and `tokenizeBatch` (batch). Also handles kuromoji lifecycle (preload on ipadic selection, unload on system switch).
- **`furikana Extension/Resources/kuromoji.js`** + **`dict/`** — Bundled IPA dictionary tokenizer (~17MB). Loaded as background script alongside background.js.
- **`furikana Extension/Resources/popup.js`** / **`popup.html`** — Toolbar popup (toggle, ruby size slider, auto-enable, reverse ruby toggle).
- **`furikana Extension/Resources/options.js`** / **`options.html`** / **`options.css`** — Settings page (dict type, reading type, unit type, ruby styling sliders, auto-enable, reverse ruby, reading rules toggle). Includes live preview of ruby styling.
- **`furikana/ViewController.swift`** — Host app WKWebView controller. Injects `browser.storage.local` polyfill and back-button script. Bridges settings between web UI and UserDefaults via AppGroup.

### Ruby Display Modes

**通常モード** (`reverseRuby: false`):
- Ruby uses Safari native `display: ruby` (no override). Rt renders above kanji by default.
- `rubySize` controls rt font-size. `rubyGap` applies as `margin-block-end` on rt.
- Do NOT set `display: inline-block` on ruby — it breaks Safari's native `display: ruby-text` on rt, making text invisible.

**ひらがなメインモード** (`reverseRuby: true`):
- Ruby gets `display: inline-block` + `font-size: rubySize%` (kanji shrinks).
- Rt gets `display: block` + `position: absolute` + `inset-block-start: 100%` (appears below kanji).
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
| `dictType` | `'system'`\|`'ipadic'` | `'system'` | Tokenization backend |
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

### Settings Change Flow

Settings changed in popup/options → `browser.storage.local.set()` → `storage.onChanged` fires in content.js:
- **CSS-only keys** (rubySize, rubyGap, etc.): `applyRubyCSS()` + `realignAllRubyWidths()`
- **reverseRuby, readingType, unitType, readingRules, dictType**: `scheduleRebuild()` → defers to `rebuildFurigana()` (hidden tabs wait until visible)

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
- **Double-ruby prevention**: `getTextNodes()` excludes text inside any `<ruby>` ancestor (including `<rb>`, `<rt>`) to avoid adding furigana to sites that already use ruby markup.
- **Background tab optimization**: `scheduleRebuild()` defers ruby rebuild on hidden tabs via `document.hidden` + `visibilitychange` listener, preventing unnecessary processing across all open tabs when settings change.

## Debugging

JS ファイルの構文チェック: `node -c "furikana Extension/Resources/content.js"` — Safari 上でスクリプトが読み込まれない場合、まずこれで SyntaxError を確認する。

## Language

All user-facing text and code comments are in Japanese. Respond in Japanese.
