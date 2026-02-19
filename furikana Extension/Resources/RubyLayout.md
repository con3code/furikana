# Safari ルビ表示仕様（Furikana）

## Overview
Safari Web Extension 側で生成する `<ruby>` と `<rt>` の表示仕様を、現行コードから逆算して整理したドキュメントです。特に **ruby/rt の幅を長い方に合わせた場合に、漢字（ベース文字）が行頭寄せにならない理由** を明確にし、`margin-inline-end` を使った拡張の有効性と副作用を検討します。

## DOM Structure
漢字が含まれる場合、以下のような DOM が生成されます。

```html
<ruby class="furikana-ruby">漢字<rt class="furikana-rt">ふりがな</rt></ruby>
```

生成処理の実装:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:1020`

## CSS Injection and Modes
ルビ表示の CSS は content script が動的に注入します。

- **通常モード**: Safari ネイティブの `<ruby>` 配置に依存  
- **逆転モード**: `<ruby>` を `inline-block` 化し、`rt` を `absolute` で下方向に固定配置

CSS 注入・モード分岐の実装:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:422`

逆転モード（absolute 配置）:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:436`

通常モード（ネイティブ ruby）:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:458`

設定画面プレビューも同じ設計を再現します:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/options.js:22`  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/options.css:185`

## Width Matching Algorithm
ruby と rt の inline 方向サイズを比較し、**大きい方に `min-inline-size` を付与**して幅をそろえます。  
計測は `getBoundingClientRect()` を使用し、縦書きにも対応します。

実装:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:499`

設定画面プレビュー側の同等処理:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/options.js:22`

## Line Spacing Handling
ルビ表示に合わせて行間（line-height）や行ボックスの余白を補正します。

- `.furikana-line` に `line-height` を付与  
- 追加余白は `padding-block` / `margin-block` に反映

実装:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:600`

## Constraint: Why Base Text Doesn’t Left-Align
**通常モードは Safari のネイティブ ruby レイアウトに依存**しています。  
このため、ruby 幅を `min-inline-size` で広げても **ベース文字の配置は UA 制御**であり、**左寄せに固定できません**。

特に以下が制約になります。

- `<ruby>` 自体が `display: ruby` の挙動を Safari が内部的に制御する  
- `align-items: start` や `text-align: left` は期待通りに効きにくい  
- ruby 幅が広がっても、ベース文字は中央寄せ相当の配置になる

現行 CSS は `align-items: start` を指定していますが、ネイティブ ruby の制約を超える効果は限定的です。  
該当 CSS:  
`/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:458`

## `margin-inline-end` Evaluation
`margin-inline-end` によって **ruby ボックスの見かけの伸長**は可能ですが、**内部配置（ベース文字の行頭寄せ）は改善しません**。

理由:

- `margin-inline-end` は外側余白であり、**ruby 自体の inline サイズを変えない**
- 幅合わせロジックは `getBoundingClientRect()` を基準にするため、**余白の影響は計測に反映されない**

### 副作用
`margin-inline-end` を用いた場合に起きる副作用は以下の通りです。

- 行内スペースが増大し、改行位置が変わる  
- line-clamp 環境で折り返しや切り詰め位置が変わる  
- リンク内のヒット領域が意図せず拡張される  
- 幅合わせアルゴリズムの前提（計測と表示の一致）が崩れる

## Alternatives and Tradeoffs
ネイティブ ruby 配置を捨て、**逆転モードと同様の absolute 配置方式**を通常モードにも適用すれば、ベース文字の左寄せ制御は可能です。

### 代替案: inline-block + absolute rt
**メリット**
- ベース文字と rt の配置を完全に制御できる  
- 左寄せ、中央寄せなど任意配置が可能

**デメリット**
- line-height 調整が必須  
- 縦書き対応や行送りが複雑化  
- Safari ネイティブ ruby の行分割 / 選択 / 折返し挙動を失う

### 仕様未使用の CSS
`ruby-align` など仕様上の CSS プロパティも存在しますが、**Safari での対応は不確実**で、現行実装では未使用です。

## Implementation References
- CSS注入・モード分岐  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:422`
- 逆転モードの absolute 配置  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:436`
- 通常モード（ネイティブ ruby）  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:458`
- 幅合わせロジック  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:499`
- ルビ生成 DOM  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:1020`
- 行間/余白補正  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/content.js:600`
- 設定画面プレビュー（同等ロジック）  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/options.js:22`
- プレビュー CSS（ruby/rt の見た目）  
  `/Users/rin/Library/Mobile Documents/com~apple~CloudDocs/Dev/furikana/furikana Extension/Resources/options.css:185`
