# るびポン Safari 版（iOS）— 開発・リリースガイド

iOS Safari Web Extension 版「るびポン」の開発手順・リリース方法をまとめる。
Chrome 版は [chrome-development.md](chrome-development.md) を参照。
トークン化パイプラインの詳細は [tokenization-architecture.md](tokenization-architecture.md) を参照。

## 構成

- **Xcode プロジェクト**: `RubiPon.xcodeproj`（スキーム `RubiPon`）
- **ターゲット**: `RubiPon`（ホストアプリ）+ `RubiPon Extension`（Safari 拡張 appex）
- **拡張リソース**: `furikana Extension/Resources/` — PBXFileSystemSynchronizedRootGroup
  なので、このフォルダにファイルを置くだけで Xcode が自動的に取り込む（pbxproj 編集不要）
- **共有ソースの正**: このフォルダは Chrome 版とも共有される。Chrome 固有の分岐は
  `FK_IS_CHROMIUM`（UA 判定）で行い、Safari の挙動を変えないこと

### 変更してはいけないもの

| 項目 | 値 | 理由 |
|------|-----|------|
| bundle ID | `con3.furikana` | 変更すると証明書・App Store の実績・native messaging が壊れる |
| AppGroup | `group.con3.furikana` | 変更すると既存ユーザーの設定・ユーザー辞書データが消える |
| 製品表示名 | るびポン (RubiPon) | App Store の名前衝突で FuriFuri から改名済み（2026-07） |

## ビルド

```bash
xcodebuild -scheme RubiPon build -destination 'generic/platform=iOS'
```

スキームをビルドすると両ターゲット（app + appex）がビルドされる。
テストスイート・リンターは未設定。JS の一次切り分けは:

```bash
node -c "furikana Extension/Resources/content.js"
```

### Sudachi WASM バンドルの再生成（sudachi-bundle.js を更新する場合のみ）

```bash
npm run build:sudachi
```

## 実機での動作確認

1. Xcode で実機（iPhone/iPad）を選択して Run
2. iOS の設定 → アプリ → Safari → 機能拡張 → るびポン → 有効化 +「すべてのWebサイト」を許可
3. Safari で日本語ページを開き、アドレスバーの拡張アイコン → るびポン → ふりがな表示

### ログ確認場所

- **content.js / background.js**: Mac の Safari → 開発 → (デバイス名) → 対象ページの Web インスペクタ
  （iOS 側で 設定 → Safari → 詳細 → Web インスペクタ を ON にしておく）
- **background.js のみ**: Safari → 開発 → Web Extension Background Content
- **Swift（SafariWebExtensionHandler）**: Xcode コンソール（`os_log`）。
  JS からは `nativeLog()` で os_log に中継される（Console.app でも確認可能）

### Safari 固有の制約（コード変更時に必ず意識する）

- 拡張の background から fetch/XHR で拡張リソースを読めない
  → 辞書ファイルは sendNativeMessage → Swift のチャンク読み込み（16MB）で取得
- appex のメモリ上限 ~6MB → NLTagger と CFStringTokenizer は別々の autoreleasepool で実行
- 通常モードの `<ruby>` に `display: inline-block` を設定すると rt が不可視になる
- background は `persistent: false` — アイドルで kill され、content.js 側の
  接続エラーリトライ（2秒）で復帰する

## リリース（App Store）

### 前提

- Apple Developer Program（年 $99）に加入済みであること
- App Store Connect にアプリ「るびポン」が登録済みであること

### バージョン番号の上げ方

Xcode で **両ターゲット**（RubiPon / RubiPon Extension）の値を揃えて上げる:

- `MARKETING_VERSION`（例: 1.0 → 1.1）— App Store に表示されるバージョン
- `CURRENT_PROJECT_VERSION`（ビルド番号。例: 11 → 12）— 同一バージョンの再提出ごとに +1

アプリとappexでバージョンが食い違うと App Store Connect のアップロードで弾かれる。

### 提出手順

1. Xcode: 実機ではなく「Any iOS Device (arm64)」を選択
2. Product → Archive
3. Organizer → Distribute App → App Store Connect → Upload
4. [App Store Connect](https://appstoreconnect.apple.com/) → TestFlight タブに
   ビルドが現れる（処理に数分〜1時間）
5. **TestFlight で実機確認**（内部テスター）— 特に辞書切り替え・ユーザー辞書・
   Sudachi 辞書ロード進捗など、開発ビルドと挙動が変わりやすい箇所
6. App Store タブ → 新しいバージョンを作成 → ビルドを選択 → 審査に提出

### 審査メモ

- 拡張はページ内容を読む（`<all_urls>`）ため、App Review 向けメモに
  「日本語テキストのふりがな表示のためにローカルで解析するのみ、外部送信なし」を明記
- スクリーンショットはふりがな表示前/後の比較が伝わりやすい
- 却下されやすいポイント: 拡張の有効化手順がアプリ内で案内されていないと
  「機能しない」と誤解される — ホストアプリの説明画面を維持すること

## 動作確認チェックリスト（リリース前）

- [ ] 3辞書（システム/IPA/Sudachi）それぞれで正しく読みが付く
- [ ] Sudachi 選択時、popup に辞書ロード進捗が表示され、完了後にふりがなが付く
- [ ] ユーザー辞書: ホストアプリ・拡張 options 双方で保存 → 再起動後も復元される
- [ ] ひらがなメインモード・通常モードの切替、スライダーのリアルタイム反映
- [ ] ホストアプリの設定変更が拡張に反映される（AppGroup 同期）
- [ ] Safari 翻訳と併用してもループしない（翻訳ループガード）
- [ ] 低メモリ端末（古い iPhone）で Sudachi 初期化がクラッシュしない

## 開発記録（主要マイルストーン）

- **2026-02**: 初期開発。ネイティブ（NLTagger + CFStringTokenizer）3フェーズ
  トークン化、kuromoji.js 同梱、ReadingRules 導入
- **2026-06 頃**: Sudachi WASM バックエンド追加（`sudachi-bundle.js` +
  `ext-helper.js`、辞書はネイティブチャンク読み込み。チャンクサイズは 16MB が実績値 —
  1MB に縮小したところ初期化が完了しない退行が実機で発生した経緯あり）
- **2026-07-06**: コードレビュー3弾の修正 + ユーザー辞書改善 + 辞書ロード進捗表示
  （1.0(11)）。アプリ名を FuriFuri → るびポン (RubiPon) に改名（App Store 名前衝突対応）
- **2026-07-10**: Safari 翻訳との往復ループ対策（要素単位ループガード +
  mutation バックオフ）。Chrome 版移植（ブランチ `chrome-port`、共有コードに
  プラットフォーム分岐導入 — Safari 側の挙動変更なし）

過去の詳細な調査記録: [tokenization-architecture.md](tokenization-architecture.md),
[commit-66b31a4-pre-push.md](commit-66b31a4-pre-push.md)
