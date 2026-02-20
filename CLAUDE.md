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

Manifest V3 (`manifest_version: 3`). Background scripts: `["kuromoji.js", "background.js"]` with `persistent: false`. Content scripts load `reading-rules.js` before `content.js` (order matters — ReadingRules IIFE must be defined first). Localized with `_locales/en/` and `_locales/ja/`.

## Architecture

### Tokenization Flow

```
content.js → browser.runtime.sendMessage → background.js
                                              ├─ dictType='ipadic' → kuromoji.js (IPA辞書)
                                              └─ dictType='system' → sendNativeMessage → Swift
                                                                      ├─ Phase 1: NLTagger (tokens + POS)
                                                                      ├─ Phase 2: CFStringTokenizer (readings)
                                                                      └─ Phase 3: Match & merge
                                              → fallback: simpleTokenize (character-by-character)

content.js receives tokens → ReadingRules.apply() → splitKanjiReading() → build <ruby> elements
```

Both dict paths return the same token format: `{surface, reading, pos, range:[start,end]}`. ReadingRules and okurigana splitting run in content.js after receiving tokens from either backend.

### Host App Storage Bridge

Host app and extension share data via AppGroup (`group.con3.furikana`). `ViewController.swift` loads `options.html` in a WKWebView and injects a `browser.storage.local` polyfill as WKUserScript. The polyfill communicates via `window.webkit.messageHandlers.controller.postMessage()`, persisting settings to `UserDefaults(suiteName: appGroupId)` under key `"furikanaSettings"`.

### Key Files

- **`furikana Extension/SafariWebExtensionHandler.swift`** — Native tokenization engine. 3-phase pipeline: NLTagger (POS tags) → CFStringTokenizer (Latin→hiragana via CFStringTransform) → UTF-16 range matching with fallback strategies. ReadingRules are NOT applied here (unified to JS side).
- **`furikana Extension/Resources/reading-rules.js`** — ReadingRules IIFE (content.js から分離)。Sequence/surface/regex ルールで読み補正（日付表現、"何を"→"なにを" 等）。manifest.json で content.js より先にロード。ルール追加・編集はこのファイルのみ。
- **`furikana Extension/Resources/content.js`** — Main extension logic. Key components:
  - `applyRubyCSS()` — Generates CSS with reverseRuby/normal mode branching. Normal mode uses Safari native `display: ruby`; reverse mode uses `display: inline-block` + absolute-positioned rt.
  - `splitKanjiReading(surface, reading)` — Separates okurigana so ruby only appears above kanji (regex-based, kuroshiro-style).
  - `RequestQueue` — Rate-limited native messaging (max 3 concurrent, 75ms interval).
  - `VisibleTextProcessor` — Viewport-aware batch processing (12 nodes/batch).
  - `furikanaGeneration` counter — Discards stale in-flight results after settings change or re-render.
  - `storage.onChanged` listener — Handles live updates for CSS sliders, readingType, unitType, readingRules, dictType, reverseRuby.
- **`furikana Extension/Resources/background.js`** — Message router with dict routing: kuromoji (ipadic) → native Swift (system) → simpleTokenize fallback. Also handles kuromoji lifecycle (preload on ipadic selection, unload on system switch).
- **`furikana Extension/Resources/kuromoji.js`** + **`dict/`** — Bundled IPA dictionary tokenizer (~17MB). Loaded as background script alongside background.js.
- **`furikana Extension/Resources/popup.js`** / **`popup.html`** — Toolbar popup (toggle, ruby size slider, auto-enable, reverse ruby toggle).
- **`furikana Extension/Resources/options.js`** / **`options.html`** / **`options.css`** — Settings page (dict type, reading type, unit type, ruby styling sliders, auto-enable, reverse ruby, reading rules toggle). Includes live preview of ruby styling.
- **`furikana/ViewController.swift`** — Host app WKWebView controller. Injects `browser.storage.local` polyfill and back-button script. Bridges settings between web UI and UserDefaults via AppGroup.

### Ruby Display Modes

**通常モード** (`reverseRuby: false`):
- Ruby uses Safari native `display: ruby` (no override). Rt renders above kanji by default.
- `rubySize` controls rt font-size. `rubyGap` applies as `padding-block-end` on rt.
- Do NOT set `display: inline-block` on ruby — it breaks Safari's native `display: ruby-text` on rt, making text invisible.

**ひらがなメインモード** (`reverseRuby: true`):
- Ruby gets `display: inline-block` + `font-size: rubySize%` (kanji shrinks).
- Rt gets `display: block` + `position: absolute` + `inset-block-start: 100%` (appears below kanji).
- Rt font-size is calculated as `100/rubySize*100`% to cancel the parent's shrinkage.
- `rubyGap` applies as `padding-block-start` on rt.

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
3. **Regex rules** — Pattern + context: date expressions (`1月`, `15日`), split-token variants for kuromoji

Rules have priority (higher = runs first). Regex rules support `$1`/`$2` capture groups and context constraints (`prevPattern`, `prevPrevPattern`, `nextPattern`). See `ReadingRules.md` for the full guide.

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
| `rubyGap` | int (0-16) | `1` | Normal: rt padding-block-end / Reverse: rt padding-block-start (px) |
| `rubyLineHeight` | float | `1.3` | Line height multiplier |
| `rubyMinHeight` | int | `12` | Minimum block size (px) |
| `rubyBoxPadding` | float | `0` | Paragraph padding (em) |
| `rubyBoxMargin` | float | `0` | Paragraph margin (em) |

### Settings Change Flow

Settings changed in popup/options → `browser.storage.local.set()` → `storage.onChanged` fires in content.js:
- **CSS-only keys** (rubySize, rubyGap, etc.): `applyRubyCSS()` + `realignAllRubyWidths()`
- **reverseRuby**: CSS update + full ruby rebuild (removeFurigana → re-scan)
- **readingType, unitType, readingRules**: Full ruby rebuild
- **dictType**: Full ruby rebuild + kuromoji preload/unload in background.js

### CSS Convention

Use logical properties (`inset-block-start`, `padding-block-end`, `min-block-size`, `min-inline-size`, `margin-inline-end`) instead of physical properties (`top`, `padding-bottom`, `min-height`, `min-width`, `margin-right`) for ruby-related CSS to support vertical writing modes.

### Critical Constraints

- **Safari rt display**: Do NOT set `display: inline-block` on `<ruby>` in normal mode. Safari's native `display: ruby` + `display: ruby-text` on rt breaks if overridden, making rt content invisible.
- **Memory in Swift extension**: Safari extensions have ~6MB limit. NLTagger and CFStringTokenizer must run in separate `autoreleasepool` blocks — they share linguistic frameworks and interfere if alive simultaneously.
- **Token boundary mismatch**: NLTagger and CFStringTokenizer tokenize differently. Phase 3 handles this with fallback strategies: exact UTF-16 match → sub-range concatenation → katakana conversion → individual getReading() fallback.
- **kuromoji split tokens**: kuromoji tokenizes more finely than NLTagger (e.g., "1月" → ["1", "月"]). ReadingRules includes split-token variants (`gatsu-split`, `nichi-after-gatsu-split`) to handle this.
- **Generation counter**: `furikanaGeneration` increments on settings changes that require re-render. In-flight tokenization results check their generation against the current value and discard if stale.
- **Width alignment**: `getBoundingClientRect()` is used instead of `offsetWidth` for ruby/rt width measurement, since `offsetWidth` is unreliable with `display: ruby`.

## Language

All user-facing text and code comments are in Japanese. Respond in Japanese.
