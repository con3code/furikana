// esbuild 生成の sudachi-bundle.js をパッチ
//
// 問題: IIFE 末尾で initSync({ module: bytes }) が同期実行される
//   → atob(2.3MB) + new WebAssembly.Module(1.66MB) が同期で走る
//   → Safari の背景ページが kill されるか RangeError でクラッシュ
//   → 後続スクリプト (sudachi-tokenizer.js, background.js) がロードされない
//
// 修正: 同期 initSync を除去し、遅延初期化関数 _initWasmLazy() を追加
//   → sudachi-tokenizer.js の initSudachiEmbedded() から非同期で呼び出す

const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '..', 'furikana Extension', 'Resources', 'sudachi-bundle.js');
let code = fs.readFileSync(bundlePath, 'utf8');

// 1. import_meta = {} を修正（get_default_dic_path の TypeError 防止）
code = code.replace(
    'var import_meta = {};',
    "var import_meta = { url: '', dirname: undefined };"
);

// 2. IIFE 末尾の同期初期化ブロックを遅延初期化に差し替え
//    元のコード:
//      var wasmBASE64 = "...";
//      var bytes;
//      if (typeof atob === "function") { ... }
//      initSync({ module: bytes });
//      return __toCommonJS(sudachi_exports);
//
//    差し替え後:
//      var wasmBASE64 = "...";
//      var _wasmBytes = null;
//      function _initWasmLazy() { ... }  // 遅延初期化
//      return __toCommonJS(sudachi_exports);

// base64 デコード + initSync の部分を丸ごと差し替え
code = code.replace(
    /  var bytes;\s*\n  if \(typeof atob === "function"\) \{[\s\S]*?initSync\(\{ module: bytes \}\);\s*\n(\s*console\.log\('\[Furikana\].*?\);\s*\n\s*\} catch \(e\) \{\s*\n\s*console\.error\('\[Furikana\].*?\);\s*\n\s*\})?/,
    `  var _wasmBytes = null;
  var _wasmInitialized = false;
  function _initWasmLazy() {
    if (_wasmInitialized) return;
    if (!_wasmBytes) {
      if (typeof atob === "function") {
        const binary = atob(wasmBASE64);
        _wasmBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          _wasmBytes[i] = binary.charCodeAt(i);
        }
      } else if (typeof Buffer === "function") {
        _wasmBytes = Buffer.from(wasmBASE64, "base64");
      } else {
        throw new Error("Unsupported platform");
      }
    }
    initSync({ module: _wasmBytes });
    _wasmInitialized = true;
    console.log('[Furikana] sudachi-bundle.js: WASM initSync succeeded');
  }`
);

// 3. _initWasmLazy を export に追加
//    sudachi_exports に _initWasmLazy を追加
code = code.replace(
    'main: () => main',
    'main: () => main,\n    _initWasmLazy: () => _initWasmLazy'
);

fs.writeFileSync(bundlePath, code, 'utf8');
console.log('Patched sudachi-bundle.js successfully');

// 検証: 同期 initSync 呼び出しが除去されたことを確認
const patched = fs.readFileSync(bundlePath, 'utf8');
if (patched.includes('initSync({ module: bytes })')) {
    console.error('ERROR: 同期 initSync が残っています！');
    process.exit(1);
}
if (!patched.includes('_initWasmLazy')) {
    console.error('ERROR: _initWasmLazy が見つかりません！');
    process.exit(1);
}
console.log('Verification passed');
