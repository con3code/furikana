# るびポン Chrome 版 — 開発・リリースガイド

Chrome（Chromium 系ブラウザ）向け「るびポン」の開発手順・アーキテクチャ・リリース方法をまとめる。
Safari 版は [safari-development.md](safari-development.md) を参照。

## ディレクトリ構成と共有の原則

```
furikana/
├── furikana Extension/Resources/   ← 共有ソースの正（Safari 版がそのまま使用）
│   ├── api-shim.js                 ← プラットフォーム吸収シム（browser = chrome）
│   ├── content.js, reading-rules.js, background.js, ext-helper.js,
│   │   kuromoji.js, sudachi-bundle.js, popup.*, options.*, _locales/, images/,
│   │   dict/ (IPA辞書 17MB), sudachi-dict/ (Sudachi辞書 117MB)
│   └── manifest.json               ← Safari 専用マニフェスト（Chromeでは使わない）
├── chrome/                         ← Chrome 専用ファイル
│   ├── manifest.json               ← Chrome MV3 マニフェスト（service_worker）
│   └── sw.js                       ← importScripts ローダー
├── scripts/build-chrome.js         ← dist/chrome/ を組み立てるビルドスクリプト
└── dist/chrome/                    ← ビルド出力（gitignore 済み）
```

**原則: 共有コードは必ず `furikana Extension/Resources/` を編集する。**
`dist/chrome/` はビルド出力なので直接編集しない（次のビルドで消える）。
Chrome 固有の挙動が必要な場合は、ファイルを分けるのではなく共有コード内で
`FK_IS_CHROMIUM`（`/Chrome\//.test(navigator.userAgent)`）による実行時分岐を使う。
この UA 判定は Safari・ホストアプリ WKWebView では偽、Chrome/Edge 等では真になる。

Resources を正とする理由: Xcode プロジェクトが PBXFileSystemSynchronizedRootGroup で
このフォルダを直接参照しており、ファイルを動かすと Safari 版のビルドが壊れるため。

## Safari 版との差分（実行時分岐の全リスト）

| 項目 | Safari | Chrome | 分岐箇所 |
|------|--------|--------|----------|
| background | `background.scripts` 配列（ページ型） | `service_worker`（sw.js が importScripts） | chrome/manifest.json, chrome/sw.js |
| `browser` 名前空間 | ネイティブ提供 | api-shim.js が `chrome` を割り当て | api-shim.js |
| kuromoji 辞書ロード | sendNativeMessage → Swift がチャンク読み | `fetch()` で直接読み込み | kuromoji.js `_loadViaFetch` |
| Sudachi 辞書ロード | sendNativeMessage → Swift がチャンク読み | `fetch()` ストリーミング読み込み | ext-helper.js `_loadDictViaFetch` |
| システム辞書 (dictType='system') | NLTagger/CFStringTokenizer（Swift） | **利用不可** — 'ipadic' に正規化、UI から非表示 | background.js `fkNormalizeDictType`, options.js |
| 既定の dictType | `system` | `ipadic` | background.js onInstalled |
| AppGroup 設定同期 | あり（ホストアプリと共有） | なし（storage.local のみで完結） | background.js `FK_HAS_NATIVE` ガード |
| ユーザー辞書 TSV 原文 | AppGroup（saveUserDict/loadUserDict） | `storage.local` の `userDictTSV` キー | background.js |
| ツールバーアイコン | SVG | PNG（Chrome は setIcon の SVG 非対応） | background.js / popup.js |
| os_log へのログ中継 (nativeLog) | あり | no-op | background.js / ext-helper.js |

トークン形式・ReadingRules・content.js のレンダリングロジックは完全共有。

### Chrome MV3 サービスワーカーの注意

- SW はアイドルで停止される。Safari の `persistent: false` と同様、content.js の
  `isConnectionError()` → 2秒リトライがそのまま機能する。
- kuromoji / Sudachi のトークナイザーは SW 停止で消えるため、再起動のたびに
  遅延初期化が走る（初回リクエストが数秒遅れることがある）。
- `sw.js` の importScripts 順序は Safari の background.scripts 配列と同じ:
  api-shim → kuromoji → ext-helper → sudachi-bundle → background。順序を崩さないこと。
- WASM 実行には manifest の CSP `'wasm-unsafe-eval'` が必要（設定済み）。

## ビルド

```bash
npm run build:chrome        # フルビルド → dist/chrome/（Sudachi辞書込み 約138MB）
npm run build:chrome:zip    # ビルド + dist/rubipon-chrome.zip 生成（ストア提出用）
node scripts/build-chrome.js --no-sudachi   # Sudachi辞書を除いた軽量ビルド（約21MB）
```

`--no-sudachi` ビルドでは Sudachi を選択しても辞書 fetch が 404 になり、
simpleTokenize フォールバック（実質ふりがな無し）になる。開発時の軽量確認用であり、
配布には使わないこと（配布するなら options から Sudachi 選択肢を隠す対応が先に必要）。

## 開発フロー

1. 共有コード（Resources/）を編集
2. `npm run build:chrome`
3. Chrome で `chrome://extensions` を開き、右上「デベロッパーモード」を ON
4. 「パッケージ化されていない拡張機能を読み込む」→ `dist/chrome/` を選択
   （2回目以降はカードの更新（⟳）ボタンだけでよい）
5. 日本語ページ（例: Wikipedia 日本語版）でポップアップから「ふりがなを表示」

### デバッグ

- **サービスワーカーのログ**: `chrome://extensions` → るびポンのカード →
  「Service Worker」リンクをクリックすると DevTools が開く（Safari の
  「Web Extension Background Content」に相当）
- **content.js のログ**: 対象ページで通常の DevTools コンソール
- **popup / options のログ**: ポップアップを右クリック →「検証」
- **構文エラーの一次切り分け**: `node -c "furikana Extension/Resources/content.js"`
  （Safari と共通）

### 動作確認チェックリスト

- [ ] ポップアップのトグルでふりがな表示/非表示、アイコンが on/off PNG に切替わる
- [ ] 辞書設定: IPA辞書（既定）・Sudachi辞書で正しく読みが付く。システム辞書が**表示されない**こと
- [ ] Sudachi 選択時、popup に辞書ロード進捗（%）が表示される
- [ ] options のスライダー変更がリアルタイムでページに反映される
- [ ] ユーザー辞書の保存 → リロード後も options に TSV が復元される
- [ ] ひらがなメインモード（reverseRuby）の表示崩れがない
- [ ] SPA（Twitter/X 等）でのページ内遷移後も自動でふりがなが付く（autoEnable 時）
- [ ] Google 翻訳等のページ翻訳と往復ループしない（翻訳ループガードの動作）

## リリース（Chrome Web Store）

### 初回のみ: デベロッパー登録

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) に Google アカウントでログイン
2. 登録料 **$5（買い切り）** を支払う

### 提出手順

1. `chrome/manifest.json` の `version` を上げる。**規約: `<メジャー>.<マイナー>.<ビルド番号>`**
   （Chrome にはビルド番号の概念がないため第3セグメントで代用。例: 1.1 のビルド1 は
   `"version": "1.1.1"`、`"version_name": "1.1 (1)"`）。Safari 版の
   MARKETING_VERSION / CURRENT_PROJECT_VERSION と揃えて上げること。
   Chrome Web Store は同じ version の再アップロードを拒否するため、再提出時は
   ビルド番号セグメントを +1 する
2. `npm run build:chrome:zip` → `dist/rubipon-chrome.zip` が生成される
   （上限 2GB。Sudachi 込みでも余裕がある）
3. Dashboard →「新しいアイテム」（更新時は既存アイテム →「パッケージ」→「新しいパッケージをアップロード」）で zip をアップロード
4. ストア掲載情報を入力:
   - 名前・説明（_locales の文言と整合させる）
   - スクリーンショット 1280×800（最低1枚）
   - カテゴリ: 「ユーザー補助機能」または「仕事効率化」
5. **プライバシーへの取り組み**タブ（審査で最も見られる。以下は誠実に記述）:
   - 単一用途の説明: 「日本語Webページの漢字にふりがな（ルビ）を表示する」
   - `<all_urls>` ホスト権限の理由: 「任意のページの日本語テキストにルビを挿入するため」
   - `storage` / `unlimitedStorage` の理由: 「設定とユーザー辞書の保存、辞書データの取り扱いのため」
   - データ収集: **一切なし**（テキスト解析はすべて拡張内でローカル処理。外部送信ゼロ）と宣言
6. 審査へ提出。`<all_urls>` を要求する拡張は審査が数日〜数週間かかることがある

### 審査対策メモ

- リモートコード実行なし（全JSを同梱）、外部通信なし、が通りやすさの要。
  将来 Sudachi 辞書をランタイムダウンロードにする場合も「データファイルの取得」であり
  リモートコードには当たらないが、取得先ドメインの明記が必要になる。
- 難読化コード扱いを避けるため、kuromoji.js / sudachi-bundle.js が
  ビルド生成物であることを「審査担当者へのメモ」欄に書いておくとよい
  （元: npm kuromoji ^0.1.2 / sudachi-wasm333 ^1.0.3、`npm run build:sudachi` で再現可能）。

## 既知の制約・今後の課題

- **パッケージサイズ**: Sudachi 辞書同梱で約138MB。インストールサイズ削減のため、
  将来的には辞書をランタイムダウンロード（GitHub Releases 等 → IndexedDB キャッシュ）に
  する選択肢がある。その場合 ext-helper.js の `_loadDictViaFetch` の取得先を差し替え、
  ストアの申告（取得先ドメイン）を更新する。
- **Edge 対応**: Chromium ベースなので `dist/chrome/` がそのまま動く。
  配布には [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) への別途登録が必要（無料）。
- **Firefox 対応**: `browser` 名前空間はネイティブにあるが、MV3 の background 仕様が
  異なる（event page 型、`scripts` 配列可）ため別途マニフェスト調整が必要。未着手。
- **アイコンの見た目**: toolbar-icon_on/off.png は SVG からの書き出し。高DPI向けに
  複数サイズの PNG を用意すると Chrome ツールバーでより鮮明になる。

## 開発記録

- **2026-07-10**: Chrome 移植の初期実装（ブランチ `chrome-port`）。
  共有コードに実行時プラットフォーム分岐を導入し、辞書ロードを fetch 化。
  `chrome/` + `scripts/build-chrome.js` の構成を確立。
  Safari 版のビルド（xcodebuild）が引き続き通ることを確認済み。
  実機 Chrome での動作確認は未実施 → 上の動作確認チェックリストを消化すること。
