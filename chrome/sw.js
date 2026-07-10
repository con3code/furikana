// Chrome MV3 サービスワーカーのエントリポイント
//
// Safari は manifest の background.scripts 配列で複数スクリプトを順番にロードするが、
// Chrome MV3 は単一の service_worker しか指定できないため、
// importScripts で同じ順序（api-shim → kuromoji → ext-helper → sudachi-bundle → background）
// でロードする。順序重要 — ext-helper.js と sudachi-bundle.js は background.js より先。
importScripts(
    'api-shim.js',
    'kuromoji.js',
    'ext-helper.js',
    'sudachi-bundle.js',
    'background.js'
);
