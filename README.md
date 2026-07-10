# るびポン (RubiPon)

日本語 Web ページの漢字にふりがな（ルビ）を表示するブラウザ拡張機能。
Safari（iOS）版と Chrome 版がある。

- トークン化バックエンド: システム辞書（Safari のみ・Swift ネイティブ）/ IPA 辞書（kuromoji.js）/ Sudachi（WASM）
- 読みは `<ruby>` タグで送り仮名分離レンダリング。読み補正ルール（~247件）とユーザー辞書に対応
- 表示モード: 通常モード（漢字の上にルビ）/ ひらがなメインモード（ひらがな主体・漢字を小さく）

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/safari-development.md](docs/safari-development.md) | Safari 版（iOS）の開発・ビルド・App Store リリース |
| [docs/chrome-development.md](docs/chrome-development.md) | Chrome 版の開発・ビルド・Chrome Web Store リリース |
| [docs/tokenization-architecture.md](docs/tokenization-architecture.md) | トークン化パイプラインの詳細 |
| [docs/reading-rules-manual.md](docs/reading-rules-manual.md) | 読み補正ルールの仕組みと記述マニュアル |
| [CLAUDE.md](CLAUDE.md) | コードベース全体のリファレンス（アーキテクチャ・制約・設定一覧） |

## クイックスタート

```bash
# Safari 版（Xcode）
xcodebuild -scheme RubiPon build -destination 'generic/platform=iOS'

# Chrome 版
npm run build:chrome    # → dist/chrome/ を chrome://extensions で「パッケージ化されていない拡張機能を読み込む」
```

## ディレクトリ構成

```
furikana Extension/Resources/   共有ソースの正（Safari 版がそのまま使用、Chrome 版はここからコピー）
furikana/                       Safari ホストアプリ（Swift）
chrome/                         Chrome 専用（manifest.json / sw.js）
scripts/                        ビルドスクリプト
docs/                           ドキュメント
```
