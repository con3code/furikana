// プラットフォーム吸収シム（Chrome/Safari 共通で最初にロードする）
//
// Chrome には browser 名前空間が存在しないため chrome を割り当てる。
// Chrome MV3 の chrome.* API はコールバック省略時に Promise を返すので、
// browser.* を Promise 前提で書いている共有コードがそのまま動く。
// Safari は browser / chrome の両方を定義済みなので何もしない。
(function() {
    if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
        globalThis.browser = globalThis.chrome;
    }
})();
