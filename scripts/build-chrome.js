// Chrome 版拡張機能のビルドスクリプト
//
// 共有ソース（furikana Extension/Resources/）と Chrome 専用ファイル（chrome/）を
// dist/chrome/ に組み立てる。Safari 版は Xcode がそのまま Resources を使うため、
// Resources が常に「共有ソースの正」であり、このスクリプトはコピーするだけ。
//
// 使い方:
//   node scripts/build-chrome.js               # フルビルド（Sudachi辞書 117MB を含む）
//   node scripts/build-chrome.js --no-sudachi  # Sudachi辞書を除外した軽量ビルド
//   node scripts/build-chrome.js --zip         # ビルド後に dist/rubipon-chrome.zip を生成

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'furikana Extension', 'Resources');
const CHROME_SRC = path.join(ROOT, 'chrome');
const DEST = path.join(ROOT, 'dist', 'chrome');

const withSudachi = !process.argv.includes('--no-sudachi');
const makeZip = process.argv.includes('--zip');

// 共有リソース（Resources からコピーするもの）
// RubyLayout.md / manifest.json (Safari用) は含めない
const SHARED_FILES = [
    'api-shim.js',
    'background.js',
    'content.js',
    'reading-rules.js',
    'ext-helper.js',
    'kuromoji.js',
    'sudachi-bundle.js',
    'popup.html', 'popup.js', 'popup.css',
    'options.html', 'options.js', 'options.css',
];

const SHARED_DIRS = [
    '_locales',
    'images',
    'dict',
];

if (withSudachi) {
    SHARED_DIRS.push('sudachi-dict');
}

// クリーンビルド
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const file of SHARED_FILES) {
    const src = path.join(SRC, file);
    if (!fs.existsSync(src)) {
        console.error(`ERROR: shared file not found: ${src}`);
        process.exit(1);
    }
    fs.copyFileSync(src, path.join(DEST, file));
}

for (const dir of SHARED_DIRS) {
    const src = path.join(SRC, dir);
    if (!fs.existsSync(src)) {
        console.error(`ERROR: shared dir not found: ${src}`);
        process.exit(1);
    }
    fs.cpSync(src, path.join(DEST, dir), { recursive: true });
}

// Chrome 専用ファイル（manifest.json, sw.js）を上書きコピー
for (const file of fs.readdirSync(CHROME_SRC)) {
    fs.cpSync(path.join(CHROME_SRC, file), path.join(DEST, file), { recursive: true });
}

// .DS_Store 等の除去
function removeJunk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) removeJunk(p);
        else if (entry.name === '.DS_Store') fs.rmSync(p);
    }
}
removeJunk(DEST);

// サイズ集計
function dirSize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
    return total;
}
const sizeMB = (dirSize(DEST) / 1024 / 1024).toFixed(1);
console.log(`Built: ${DEST}`);
console.log(`  Sudachi dict: ${withSudachi ? 'included' : 'EXCLUDED (--no-sudachi)'}`);
console.log(`  Total size: ${sizeMB} MB`);

if (makeZip) {
    const zipPath = path.join(ROOT, 'dist', 'rubipon-chrome.zip');
    fs.rmSync(zipPath, { force: true });
    // Chrome Web Store 用: dist/chrome の中身をルートに持つ zip
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: DEST });
    const zipMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    console.log(`  Zip: ${zipPath} (${zipMB} MB)`);
}
