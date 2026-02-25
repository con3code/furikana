# コミット 66b31a4 プッシュ前状態記録

## 概要

- **ブランチ**: `opus-sudachi`
- **コミット**: `66b31a42020b6a472714b5d875cee2fce27cc704`
- **日時**: 2026-02-26 00:32:52 +0900
- **バージョン**: 1.0(7)
- **状態**: ローカルコミット済み、GitHub未プッシュ（`system.dic` 117MB がGitHub 100MB制限超過）

## コミット履歴

```
66b31a4 feat: Sudachi WASM統合、Core/Full辞書ダウンロード、UI改善  ← 今回（未プッシュ）
3ad8ec0 feat: 読み補正ルール大幅拡充、バッチトークン化改善、エラー回復強化
fa45a4e feat: バッチトークン化、エラー回復改善、UI調整
0c208e7 Initial commit: Furikana Safari Web Extension
```

## プッシュ失敗の原因

```
remote: error: File furikana Extension/Resources/sudachi-dict/system.dic is 117.25 MB;
this exceeds GitHub's file size limit of 100.00 MB
```

**対処方針**: Git LFS で `system.dic` を管理する

## 変更内容一覧

### 新規ファイル

| ファイル | サイズ | 説明 |
|---------|--------|------|
| `furikana Extension/Resources/sudachi-bundle.js` | 2.2MB | Sudachi WASM バンドル |
| `furikana Extension/Resources/sudachi-tokenizer.js` | 17KB | WASM トークナイザアダプター |
| `furikana Extension/Resources/sudachi-dict/system.dic` | **117MB** | Sudachi Small辞書（**LFS対象**） |
| `furikana/DictionaryManager.swift` | 12KB | S3辞書DL・ZIP展開・AppGroup保存 |
| `FuriFuri.xcodeproj/xcshareddata/xcschemes/FuriFuri.xcscheme` | 3KB | Xcodeスキーム |
| `native/sudachi_bridge/` | **821MB** | Rustビルドキャッシュ（**要除外**） |
| `scripts/patch-sudachi-bundle.js` | 3KB | sudachi-bundle.js パッチスクリプト |
| `package.json` / `package-lock.json` | - | npm依存関係（sudachi-wasm333） |

### 変更ファイル

| ファイル | 変更概要 |
|---------|---------|
| `FuriFuri.xcodeproj/project.pbxproj` | CURRENT_PROJECT_VERSION 6→7 |
| `furikana Extension/SafariWebExtensionHandler.swift` | `dictionary_status`, `read_dictionary_chunk` アクション追加、チャンクデフォルト16MB |
| `furikana Extension/Resources/background.js` | Sudachi dictType ルーティング、`getSudachiStatus` ハンドラ |
| `furikana Extension/Resources/content.js` | デバッグログ追加 |
| `furikana Extension/Resources/manifest.json` | `sudachi-tokenizer.js`, `sudachi-bundle.js` をbackground scriptsに追加 |
| `furikana Extension/Resources/options.html` | 単位設定削除、表示設定レイアウト調整（margin-top:32px）、Sudachi辞書モード表示 |
| `furikana Extension/Resources/options.js` | unit-type参照削除（初期ラジオボタン未反映バグ修正）、`getSudachiStatus` 問い合わせ |
| `furikana Extension/Resources/popup.css` | `.btn-link` font-size 20px→14px |
| `furikana Extension/Resources/reading-rules.js` | 更新日・投稿日・作成日のsurface/sequenceルール追加 |
| `furikana Extension/Resources/_locales/en/messages.json` | 表示名「ふりふり - FuriFuri」 |
| `furikana Extension/Resources/_locales/ja/messages.json` | 表示名「ふりふり - FuriFuri」 |
| `furikana/ViewController.swift` | 辞書管理メッセージハンドラ（downloadDict, cancelDownload, deleteDict, getDictStatus） |
| `furikana/Resources/ja.lproj/Main.html` | 辞書DL UI追加、バージョン/ライセンス位置移動、ver.1.0(7) |
| `furikana/Resources/en.lproj/Main.html` | 同上（英語版） |
| `furikana/Resources/Base.lproj/Main.html` | 同上（Base） |
| `furikana/Resources/Style.css` | 辞書セクション角丸カードデザイン、プログレスバー、ダークモード対応 |
| `furikana/Resources/licenses.html` | Sudachi / sudachi-wasm333 / SudachiDict ライセンス追加 |

## Git LFS 移行前に必要な作業

### 1. `.gitignore` に追加すべきエントリ

```
# Rust build cache
native/sudachi_bridge/target/

# Rust/Cargo toolchain (ローカル環境固有)
.cargo-home/
.rustup-home/
```

`native/sudachi_bridge/target/` は821MBのRustビルドキャッシュで、コミットに含まれている（2600+ファイルの大半）。
Git LFS 移行時にコミットを再作成する際に除外すること。

### 2. Git LFS 対象ファイル

```
furikana Extension/Resources/sudachi-dict/system.dic  (117MB)
```

### 3. 移行手順（想定）

1. `git reset --soft HEAD~1` で最新コミットを取り消し（変更はステージに残る）
2. `.gitignore` に上記エントリ追加
3. `git lfs install` → `git lfs track "furikana Extension/Resources/sudachi-dict/*.dic"`
4. `.gitattributes` をステージに追加
5. `native/sudachi_bridge/target/` をステージから除外
6. `.cargo-home/`, `.rustup-home/` が含まれていないことを確認
7. 再コミット → プッシュ

## 機能的な状態

- **Sudachi WASM**: 内蔵Small辞書（117MB）で動作確認済み
- **Core辞書ダウンロード**: S3からDL→AppGroup保存→16MBチャンクロード成功
- **Full辞書**: 未テスト（~470MB、iOSメモリ制約で動作不確実）
- **フォールバック**: ダウンロード辞書失敗時→内蔵Small辞書に自動フォールバック
- **ホストアプリUI**: 辞書DL/削除、プログレスバー、角丸カードデザイン動作確認済み
- **設定画面**: 辞書ラジオボタン初期状態バグ修正済み
