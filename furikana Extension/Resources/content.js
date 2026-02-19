// ふりがな機能のメインスクリプト

let furikanaEnabled = false;
let furikanaGeneration = 0; // 辞書切替え等で増加、インフライトの旧結果を破棄するため
let settings = {
    readingType: 'hiragana',
    unitType: 'long',
    dictType: 'system',
    readingRules: true,
    reverseRuby: false,
    rubySize: 50,
    rubyGap: 1,
    rubyLineHeight: 1.3,
    rubyMinHeight: 12,
    rubyBoxPadding: 0,
    rubyBoxMargin: 0
};

// kuromoji は background.js に集約（全タブで1インスタンスを共有）

function katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ReadingRules は reading-rules.js で定義（manifest.json で先にロード）

// リクエストキューイングシステム
class RequestQueue {
    constructor(maxConcurrent = 3, intervalDelay = 50) {
        this.maxConcurrent = maxConcurrent;  // 同時実行数の上限
        this.running = 0;                     // 現在実行中のリクエスト数
        this.queue = [];                      // 待機中のリクエスト
        this.errorCount = 0;                  // 連続エラー回数
        this.fallbackMode = false;            // フォールバックモードフラグ
        this.errorThreshold = 10;             // エラー閾値（3→10に増加）
        this.totalRequests = 0;               // 総リクエスト数
        this.successfulRequests = 0;          // 成功したリクエスト数
        this.intervalDelay = intervalDelay;   // リクエスト間の遅延（ミリ秒）
    }

    // リクエストをキューに追加
    async enqueue(fn) {
        // フォールバックモードの場合、ネイティブリクエストをスキップ
        if (this.fallbackMode) {
            console.log('[Furikana] Fallback mode active, skipping native request');
            return null;
        }

        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    // キューを処理
    async process() {
        // 実行中のリクエストが上限に達している、またはキューが空の場合
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        // キューから次のリクエストを取得
        const { fn, resolve, reject } = this.queue.shift();
        this.running++;
        this.totalRequests++;

        // デバッグ: リクエスト開始をログ
        if (this.totalRequests % 50 === 1) {
            console.log(`[Furikana] Processing request ${this.totalRequests} (queue: ${this.queue.length}, running: ${this.running})`);
        }

        try {
            const result = await fn();

            // 成功した場合、エラーカウントをリセット
            if (result !== null) {
                this.errorCount = 0;
                this.successfulRequests++;
            } else {
                this.errorCount++;
                console.warn(`[Furikana] Request returned null (error count: ${this.errorCount}/${this.errorThreshold})`);
            }

            resolve(result);
        } catch (error) {
            // エラーが発生した場合
            this.errorCount++;
            console.error(`[Furikana] Request failed (error count: ${this.errorCount}/${this.errorThreshold}):`, error);

            // エラー閾値を超えた場合、フォールバックモードに切り替え
            if (this.errorCount >= this.errorThreshold) {
                console.error(`[Furikana] Error threshold reached! Switching to fallback mode`);
                console.error(`[Furikana] Stats: ${this.successfulRequests}/${this.totalRequests} successful requests`);
                console.error('[Furikana] Remaining queue items will use fallback tokenization:', this.queue.length);
                this.fallbackMode = true;

                // 待機中のすべてのリクエストをキャンセル
                this.queue.forEach(item => item.resolve(null));
                this.queue = [];
            }

            resolve(null); // エラー時もresolveして処理を続行
        } finally {
            this.running--;

            // 次のリクエストを処理（インターバルを入れて）
            if (this.intervalDelay > 0 && this.queue.length > 0) {
                setTimeout(() => this.process(), this.intervalDelay);
            } else {
                this.process();
            }
        }
    }

    // キューとエラーカウントをリセット
    reset() {
        console.log(`[Furikana] Queue reset. Final stats: ${this.successfulRequests}/${this.totalRequests} successful (interval: ${this.intervalDelay}ms)`);
        this.queue = [];
        this.running = 0;
        this.errorCount = 0;
        this.fallbackMode = false;
        this.totalRequests = 0;
        this.successfulRequests = 0;
    }

    // フォールバックモードかどうか
    isFallbackMode() {
        return this.fallbackMode;
    }
}

// グローバルなリクエストキューインスタンス
// maxConcurrent=3, intervalDelay=75ms
const requestQueue = new RequestQueue(3, 75);

// 画面内のテキストのみを順次処理するためのマネージャ
class VisibleTextProcessor {
    constructor({ batchSize = 12, batchDelay = 60, scanDelay = 150, maxPending = 200 } = {}) {
        this.batchSize = batchSize;
        this.batchDelay = batchDelay;
        this.scanDelay = scanDelay;
        this.maxPending = maxPending;
        this.pending = [];
        this.queuedNodes = new WeakSet();
        this.processedNodes = new WeakSet();
        this.processing = false;
        this.scanTimer = null;
        this.running = false;

        this.handleScroll = this.scheduleScan.bind(this);
        this.handleResize = this.scheduleScan.bind(this);
    }

    start() {
        if (this.running) return;
        this.running = true;

        window.addEventListener('scroll', this.handleScroll, { passive: true });
        window.addEventListener('resize', this.handleResize, { passive: true });

        this.scheduleScan();
    }

    stop() {
        this.running = false;
        this.pending = [];
        this.queuedNodes = new WeakSet();
        this.processedNodes = new WeakSet();
        this.processing = false;

        if (this.scanTimer) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }

        window.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('resize', this.handleResize);
    }

    scheduleScan() {
        if (!this.running || this.scanTimer) return;
        this.scanTimer = setTimeout(() => {
            this.scanTimer = null;
            this.scanVisibleTextNodes();
        }, this.scanDelay);
    }

    scanVisibleTextNodes() {
        if (!this.running) return;

        const textNodes = getTextNodes(document.body);
        let added = 0;

        for (const node of textNodes) {
            if (this.pending.length >= this.maxPending) break;
            if (this.processedNodes.has(node) || this.queuedNodes.has(node)) continue;

            const text = node.nodeValue || '';
            if (!containsKanji(text)) continue;
            if (!isTextNodeVisible(node)) continue;

            this.pending.push(node);
            this.queuedNodes.add(node);
            added++;
        }

        if (added > 0) {
            console.log(`[Furikana] Visible nodes queued: ${added} (pending: ${this.pending.length})`);
        }

        this.processQueue();
    }

    async processQueue() {
        if (this.processing || !this.running) return;
        this.processing = true;

        try {
            while (this.pending.length > 0 && this.running) {
                const batchCount = Math.min(this.batchSize, this.pending.length);
                for (let i = 0; i < batchCount; i++) {
                    const node = this.pending.shift();
                    if (!node || !node.parentElement || !node.isConnected) {
                        continue;
                    }

                    const ok = await addFuriganaToNode(node);
                    this.queuedNodes.delete(node);
                    if (ok) {
                        this.processedNodes.add(node);
                    }
                }

                if (this.pending.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.batchDelay));
                }
            }
        } finally {
            this.processing = false;
        }
    }
}

let visibleProcessor = null;

// ルビ表示CSSを注入/更新
function applyRubyCSS() {
    const { rubySize, rubyGap, rubyLineHeight, rubyMinHeight, rubyBoxPadding, rubyBoxMargin, reverseRuby } = settings;
    const id = 'furikana-ruby-style';
    let style = document.getElementById(id);
    if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.appendChild(style);
    }

    // 逆転モード時: rtのfont-sizeは親の縮小を打ち消して100%相当にする
    const rtSize = reverseRuby ? (100 / rubySize * 100) : rubySize;

    const rubyCSS = reverseRuby ? `
    .furikana-ruby {
      position: relative !important;
      display: inline-block !important;
      vertical-align: baseline !important;
      line-height: 1 !important;
      font-size: ${rubySize}% !important;
      min-block-size: var(--furikana-ruby-min-height) !important;
      white-space: nowrap;
    }

    .furikana-ruby > .furikana-rt {
      display: block !important;
      position: absolute !important;
      inset-block-start: 100% !important;
      inset-inline-start: 0 !important;
      white-space: nowrap !important;
      line-height: 1 !important;
      font-size: ${rtSize}% !important;
      padding-block-start: ${rubyGap}px !important;
      pointer-events: none;
    }` : `
    .furikana-ruby {
      vertical-align: baseline !important;
      align-items: start !important;
      min-block-size: var(--furikana-ruby-min-height) !important;
      white-space: nowrap;
    }

    .furikana-ruby > .furikana-rt {
      font-size: var(--furikana-ruby-size) !important;
      padding-block-end: ${rubyGap}px !important;
      pointer-events: none;
    }`;

    style.textContent = `
    :root {
      --furikana-ruby-size: ${rubySize}%;
      --furikana-ruby-gap: ${rubyGap}px;
      --furikana-ruby-min-height: ${rubyMinHeight}px;
      --furikana-line-height: ${rubyLineHeight};
      --furikana-line-padding: ${rubyBoxPadding}em;
      --furikana-line-margin: ${rubyBoxMargin}em;
    }

    .furikana-line {
      line-height: calc(var(--furikana-line-height) * 1em + var(--furikana-ruby-gap)) !important;
    }
    ${rubyCSS}`;
}

// writing-mode が縦書きかどうかを判定
function isVerticalWriting(el) {
    const wm = getComputedStyle(el).writingMode;
    return wm === 'vertical-rl' || wm === 'vertical-lr';
}

// 要素の inline 方向サイズを取得（display: ruby 等でも動作するよう getBoundingClientRect を使用）
function getInlineSize(el, vertical) {
    const rect = el.getBoundingClientRect();
    return vertical ? rect.height : rect.width;
}

// ruby と rt の inline サイズを比較し、大きい方に合わせる
function alignRubyWidths(container) {
    const vertical = isVerticalWriting(container);
    const rubies = container.querySelectorAll('.furikana-ruby');
    rubies.forEach(ruby => {
        const rt = ruby.querySelector('.furikana-rt');
        if (!rt) return;
        ruby.style.minInlineSize = '';
        rt.style.minInlineSize = '';
        const rubyS = getInlineSize(ruby, vertical);
        const rtS = getInlineSize(rt, vertical);
        if (rtS > rubyS) {
            ruby.style.minInlineSize = rtS + 'px';
        } else if (rubyS > rtS) {
            rt.style.minInlineSize = rubyS + 'px';
        }
    });
}

// 既存の全 ruby 要素の inline サイズを再調整
function realignAllRubyWidths() {
    // furikana-line 親ごとにグルーピングして writing-mode 判定を最小化
    const lines = document.querySelectorAll('.furikana-line');
    lines.forEach(line => {
        const vertical = isVerticalWriting(line);
        const rubies = line.querySelectorAll('.furikana-ruby');
        rubies.forEach(ruby => {
            const rt = ruby.querySelector('.furikana-rt');
            if (!rt) return;
            ruby.style.minInlineSize = '';
            rt.style.minInlineSize = '';
            const rubyS = getInlineSize(ruby, vertical);
            const rtS = getInlineSize(rt, vertical);
            if (rtS > rubyS) {
                ruby.style.minInlineSize = rtS + 'px';
            } else if (rubyS > rtS) {
                rt.style.minInlineSize = rubyS + 'px';
            }
        });
    });
}


function captureLinePaddingBase(element) {
    if (!element || element.dataset.furikanaPaddingBlockStart) return;
    const style = window.getComputedStyle(element);
    element.dataset.furikanaPaddingBlockStart = style.paddingBlockStart || '0px';
    element.dataset.furikanaPaddingBlockEnd = style.paddingBlockEnd || '0px';
    element.dataset.furikanaPaddingBlockStartInline = element.style.paddingBlockStart || '';
    element.dataset.furikanaPaddingBlockEndInline = element.style.paddingBlockEnd || '';
}

function restoreLinePadding(element) {
    if (!element || !element.dataset.furikanaPaddingBlockStart) return;
    if (element.dataset.furikanaPaddingBlockStartInline) {
        element.style.paddingBlockStart = element.dataset.furikanaPaddingBlockStartInline;
    } else {
        element.style.removeProperty('padding-block-start');
    }
    if (element.dataset.furikanaPaddingBlockEndInline) {
        element.style.paddingBlockEnd = element.dataset.furikanaPaddingBlockEndInline;
    } else {
        element.style.removeProperty('padding-block-end');
    }
    delete element.dataset.furikanaPaddingBlockStart;
    delete element.dataset.furikanaPaddingBlockEnd;
    delete element.dataset.furikanaPaddingBlockStartInline;
    delete element.dataset.furikanaPaddingBlockEndInline;
}

function captureLineMarginBase(element) {
    if (!element || element.dataset.furikanaMarginBlockStart) return;
    const style = window.getComputedStyle(element);
    element.dataset.furikanaMarginBlockStart = style.marginBlockStart || '0px';
    element.dataset.furikanaMarginBlockEnd = style.marginBlockEnd || '0px';
    element.dataset.furikanaMarginBlockStartInline = element.style.marginBlockStart || '';
    element.dataset.furikanaMarginBlockEndInline = element.style.marginBlockEnd || '';
}

function restoreLineMargin(element) {
    if (!element || !element.dataset.furikanaMarginBlockStart) return;
    if (element.dataset.furikanaMarginBlockStartInline) {
        element.style.marginBlockStart = element.dataset.furikanaMarginBlockStartInline;
    } else {
        element.style.removeProperty('margin-block-start');
    }
    if (element.dataset.furikanaMarginBlockEndInline) {
        element.style.marginBlockEnd = element.dataset.furikanaMarginBlockEndInline;
    } else {
        element.style.removeProperty('margin-block-end');
    }
    delete element.dataset.furikanaMarginBlockStart;
    delete element.dataset.furikanaMarginBlockEnd;
    delete element.dataset.furikanaMarginBlockStartInline;
    delete element.dataset.furikanaMarginBlockEndInline;
}

function applyLinePadding(element) {
    if (!element) return;
    const extraEm = Number(settings.rubyBoxPadding) || 0;
    if (extraEm === 0) {
        restoreLinePadding(element);
        return;
    }
    captureLinePaddingBase(element);
    const computed = window.getComputedStyle(element);
    const fontSize = parseFloat(computed.fontSize) || 16;
    const extraPx = extraEm * fontSize;
    const baseStart = parseFloat(element.dataset.furikanaPaddingBlockStart) || 0;
    const baseEnd = parseFloat(element.dataset.furikanaPaddingBlockEnd) || 0;
    element.style.paddingBlockStart = `${baseStart}px`;
    element.style.paddingBlockEnd = `${baseEnd + extraPx}px`;
}

function applyLineMargin(element) {
    if (!element) return;
    const extraEm = Number(settings.rubyBoxMargin) || 0;
    if (extraEm === 0) {
        restoreLineMargin(element);
        return;
    }
    captureLineMarginBase(element);
    const computed = window.getComputedStyle(element);
    const fontSize = parseFloat(computed.fontSize) || 16;
    const extraPx = extraEm * fontSize;
    const baseStart = parseFloat(element.dataset.furikanaMarginBlockStart) || 0;
    const baseEnd = parseFloat(element.dataset.furikanaMarginBlockEnd) || 0;
    element.style.marginBlockStart = `${baseStart + extraPx}px`;
    element.style.marginBlockEnd = `${baseEnd + extraPx}px`;
}

function updateLineSpacingForAll() {
    const targets = document.querySelectorAll('.furikana-line');
    targets.forEach(el => {
        applyLinePadding(el);
        applyLineMargin(el);
    });
}

function markLineContainer(startElement) {
    if (!startElement) return;
    let el = startElement;
    let fallback = null;
    let candidate = null;
    while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if (!fallback && style.display !== 'inline' && style.display !== 'contents') {
            fallback = el;
        }

        const hasLineClamp = style.webkitLineClamp && style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '0';
        if (hasLineClamp) {
            el.classList.add('furikana-line');
            applyLinePadding(el);
            applyLineMargin(el);
            return;
        }
        if (!candidate && (el.tagName === 'A' || el.tagName === 'P')) {
            candidate = el;
        }

        el = el.parentElement;
    }

    const target = candidate || fallback;
    if (target) {
        target.classList.add('furikana-line');
        applyLinePadding(target);
        applyLineMargin(target);
    }
}

// 設定を読み込み
async function loadSettings() {
    const stored = await browser.storage.local.get({
        readingType: 'hiragana',
        unitType: 'long',
        autoEnable: false,
        dictType: 'system',
        readingRules: true,
        reverseRuby: false,
        rubySize: 50,
        rubyGap: 1,
        rubyLineHeight: 1.3,
        rubyMinHeight: 12,
        rubyBoxPadding: 0,
        rubyBoxMargin: 0
    });

    settings = stored;
    applyRubyCSS();

    // 自動有効化
    if (stored.autoEnable) {
        await toggleFurigana();
    }
}

// ネイティブメッセージング（Swift側と通信）
async function sendNativeMessage(action, data = {}) {
    // フォールバックモードの場合、すぐにnullを返す
    if (requestQueue.isFallbackMode()) {
        console.log('[Furikana] Fallback mode active, skipping native message');
        return null;
    }

    // リクエストキューに追加
    try {
        return await requestQueue.enqueue(async () => {
            const message = { action, ...data };

            // Safari Web Extensionでは、browser.runtime.sendMessageで送信し、
            // background.jsが受け取る。background.jsは処理せずにパススルーする必要がある。
            // SafariWebExtensionHandlerは自動的に呼び出される。
            const response = await browser.runtime.sendMessage(message);

            if (response && response.success) {
                return response;
            } else {
                console.warn('[Furikana] Native message returned unsuccessful response:', response);
                throw new Error('Native message unsuccessful');
            }
        });
    } catch (error) {
        console.error('[Furikana] Native message enqueue failed:', error);
        return null;
    }
}

// テキストノードを取得
function getTextNodes(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // 空白のみのノードやスクリプト/スタイル内のノードを除外
                if (node.nodeValue.trim().length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                const parent = node.parentElement;
                if (parent) {
                    // スクリプト/スタイル/RUBYタグ内は除外
                    if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'RUBY') {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // RUBYタグの親チェックで処理済みテキストを除外
                    // data-furigana-processed属性は使用しない
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    return textNodes;
}

// 日本語を含むかチェック
function containsJapanese(text) {
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

// 漢字を含むかチェック
function containsKanji(text) {
    return /[\u4E00-\u9FAF]/.test(text);
}

// テキストノードが画面内に表示されているか判定
function isTextNodeVisible(textNode) {
    const parent = textNode.parentElement;
    if (!parent || !parent.isConnected) return false;

    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;

    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    for (const rect of rects) {
        if (rect.bottom >= 0 && rect.top <= vh && rect.right >= 0 && rect.left <= vw) {
            return true;
        }
    }

    return false;
}

// ひらがなをローマ字に変換（ヘボン式）
function hiraganaToRomaji(hiragana) {
    const conversionTable = {
        'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
        'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
        'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
        'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
        'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
        'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
        'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
        'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
        'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
        'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
        'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
        'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
        'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
        'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
        'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo', 'ん': 'n',
        'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
        'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
        'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
        'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
        'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
        'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
        'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
        'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
        'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
        'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
        'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
        'っ': ''
    };

    let result = '';
    for (let i = 0; i < hiragana.length; i++) {
        // 2文字の組み合わせをチェック
        const twoChars = hiragana.substring(i, i + 2);
        if (conversionTable[twoChars]) {
            result += conversionTable[twoChars];
            i++; // 次の文字をスキップ
        } else if (conversionTable[hiragana[i]]) {
            result += conversionTable[hiragana[i]];
        } else {
            result += hiragana[i];
        }
    }

    return result;
}

// 短単位を長単位にグループ化（簡易版）
function groupToLongUnits(tokens) {
    if (!tokens || tokens.length === 0) return [];

    const longUnits = [];
    let currentUnit = {
        surface: '',
        reading: '',
        tokens: []
    };

    // 内容語の品詞タグ
    const contentWordTags = ['Noun', 'Verb', 'Adjective', 'Adverb'];
    // 機能語の品詞タグ
    const functionWordTags = ['Particle', 'Auxiliary', 'Conjunction'];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const isContentWord = contentWordTags.includes(token.pos);
        const isFunctionWord = functionWordTags.includes(token.pos);

        if (currentUnit.tokens.length === 0) {
            // 新しい単位を開始
            currentUnit.surface = token.surface;
            currentUnit.reading = token.reading || token.surface;
            currentUnit.tokens.push(token);
        } else {
            const lastToken = currentUnit.tokens[currentUnit.tokens.length - 1];
            const lastIsContentWord = contentWordTags.includes(lastToken.pos);

            // 内容語の後に機能語が続く場合、同じ長単位として結合
            if (lastIsContentWord && isFunctionWord) {
                currentUnit.surface += token.surface;
                currentUnit.reading += token.reading || token.surface;
                currentUnit.tokens.push(token);
            } else {
                // 長単位を確定
                longUnits.push({ ...currentUnit });

                // 新しい長単位を開始
                currentUnit = {
                    surface: token.surface,
                    reading: token.reading || token.surface,
                    tokens: [token]
                };
            }
        }
    }

    // 最後の単位を追加
    if (currentUnit.tokens.length > 0) {
        longUnits.push(currentUnit);
    }

    return longUnits;
}

// 漢字と送り仮名を分離し、漢字部分のみにルビを振るためのセグメント分割
// kuroshiro方式: surface の漢字/非漢字セグメントから正規表現を構築し、reading とマッチ
function splitKanjiReading(surface, reading) {
    const isKanji = ch => /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(ch);

    // surface を漢字セグメントと非漢字セグメントに分割
    const segments = [];
    let curType = null;
    let curText = '';
    for (const ch of surface) {
        const type = isKanji(ch) ? 'kanji' : 'kana';
        if (type !== curType && curText) {
            segments.push({ type: curType, text: curText });
            curText = '';
        }
        curType = type;
        curText += ch;
    }
    if (curText) segments.push({ type: curType, text: curText });

    // 漢字なし → 分割不要
    if (!segments.some(s => s.type === 'kanji')) {
        return [{ text: surface, reading: null }];
    }
    // 全て漢字 → そのまま全体にルビ
    if (segments.length === 1 && segments[0].type === 'kanji') {
        return [{ text: surface, reading }];
    }

    // 正規表現を構築: 漢字→(.+)、非漢字→リテラル（ひらがな化してマッチ）
    let regexStr = '^';
    for (const seg of segments) {
        if (seg.type === 'kanji') {
            regexStr += '(.+)';
        } else {
            // カタカナ送り仮名はひらがなに変換してマッチ
            const hiragana = katakanaToHiragana(seg.text);
            regexStr += hiragana.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    regexStr += '$';

    try {
        const match = reading.match(new RegExp(regexStr));
        if (match) {
            const result = [];
            let groupIdx = 1;
            for (const seg of segments) {
                if (seg.type === 'kanji') {
                    result.push({ text: seg.text, reading: match[groupIdx++] });
                } else {
                    result.push({ text: seg.text, reading: null });
                }
            }
            return result;
        }
    } catch (e) {
        // regex エラー → フォールバック
    }

    // マッチ失敗 → 全体にルビ
    return [{ text: surface, reading }];
}

// テキストノードにふりがなを追加
async function addFuriganaToNode(textNode) {
    const text = textNode.nodeValue;
    const gen = furikanaGeneration; // この時点の世代を記録

    // 漢字を含まない場合はスキップ
    if (!containsKanji(text)) {
        return false;
    }

    try {
        let tokens = null;
        let dictSource = 'unknown';

        // 辞書ルーティングは background.js で一元管理（ipadic/system 自動切替）
        if (!requestQueue.isFallbackMode()) {
            try {
                const response = await sendNativeMessage('tokenize', { text });
                if (response && response.success && response.tokens) {
                    tokens = response.tokens;
                    dictSource = response.dictSource || 'system';
                }
            } catch (err) {
                console.warn('[Furikana] Tokenization failed:', err.message);
            }
        }

        // ReadingRules を両辞書共通で適用（JS側に一元化）
        if (tokens && settings.readingRules) {
            tokens = ReadingRules.apply(tokens);
        }

        let units;
        if (tokens) {
            console.log(`[Furikana] Tokenization successful (${dictSource}), tokens:`, tokens.length);
            if (settings.unitType === 'long') {
                units = groupToLongUnits(tokens);
            } else {
                units = tokens.map(t => ({
                    surface: t.surface,
                    reading: t.reading || t.surface,
                    tokens: [t]
                }));
            }
        } else {
            // 最終フォールバック: 読み仮名なし
            units = [];
            for (const char of text) {
                units.push({ surface: char, reading: char, tokens: [] });
            }
        }

        // rubyタグを生成
        const fragment = document.createDocumentFragment();
        let rubyCount = 0;

        for (const unit of units) {
            // 漢字を含む場合のみrubyタグを追加
            if (containsKanji(unit.surface)) {
                // readingが表面形と同じ場合、または無効な場合はルビを表示しない
                if (!unit.reading || unit.reading === unit.surface) {
                    fragment.appendChild(document.createTextNode(unit.surface));
                    continue;
                }

                // 漢字と送り仮名を分離
                const parts = splitKanjiReading(unit.surface, unit.reading);

                for (const part of parts) {
                    if (part.reading) {
                        // 漢字部分 → ルビ付き
                        const ruby = document.createElement('ruby');
                        ruby.classList.add('furikana-ruby');
                        ruby.appendChild(document.createTextNode(part.text));

                        const rt = document.createElement('rt');
                        rt.classList.add('furikana-rt');
                        let reading = part.reading;
                        if (settings.readingType === 'romaji') {
                            reading = hiraganaToRomaji(reading);
                        }
                        rt.textContent = reading;
                        ruby.appendChild(rt);
                        fragment.appendChild(ruby);
                        rubyCount++;
                    } else {
                        // 送り仮名部分 → プレーンテキスト
                        fragment.appendChild(document.createTextNode(part.text));
                    }
                }
            } else {
                // 漢字を含まない場合はそのまま追加
                fragment.appendChild(document.createTextNode(unit.surface));
            }
        }

        // 世代が変わっていたら旧辞書の結果なので破棄
        if (gen !== furikanaGeneration) {
            console.log('[Furikana] Discarding stale result (generation changed)');
            return false;
        }

        // 元のテキストノードを置き換え
        const parent = textNode.parentNode;
        if (parent) {
            parent.replaceChild(fragment, textNode);
            markLineContainer(parent);
            alignRubyWidths(parent);
        }
        return true;
    } catch (error) {
        console.error('[Furikana] Error adding furigana:', error);
        return false;
    }
}

// ふりがなを削除
function removeFurigana() {
    const rubyTags = document.querySelectorAll('ruby.furikana-ruby');
    console.log(`[Furikana] Removing ${rubyTags.length} ruby tags`);

    // 親要素を収集（後でnormalizeするため）
    const parents = new Set();

    rubyTags.forEach(ruby => {
        let surfaceText = '';
        for (let child of ruby.childNodes) {
            if (child.nodeName !== 'RT' && child.nodeName !== 'RP') {
                surfaceText += child.textContent || '';
            }
        }
        const parent = ruby.parentNode;
        if (parent) parents.add(parent);

        const textNode = document.createTextNode(surfaceText);
        ruby.replaceWith(textNode);
    });

    // 隣接テキストノードを結合して元の一つのテキストノードに戻す
    parents.forEach(parent => {
        if (parent.isConnected) parent.normalize();
    });

    const lineContainers = document.querySelectorAll('.furikana-line');
    lineContainers.forEach(el => {
        el.classList.remove('furikana-line');
        restoreLinePadding(el);
        restoreLineMargin(el);
    });

    console.log('[Furikana] All ruby tags removed');
}

// ふりがなの表示/非表示をトグル
async function toggleFurigana() {
    if (furikanaEnabled) {
        // ふりがなを削除
        removeFurigana();
        furikanaEnabled = false;

        // キューをリセット
        requestQueue.reset();

        if (visibleProcessor) {
            visibleProcessor.stop();
            visibleProcessor = null;
        }
    } else {
        // キューをリセット
        requestQueue.reset();

        // 画面内のみを順次処理
        visibleProcessor = new VisibleTextProcessor();
        visibleProcessor.start();
        furikanaEnabled = true;
    }

    return furikanaEnabled;
}

// popup等からのメッセージを受信
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleFurigana') {
        toggleFurigana().then(enabled => {
            sendResponse({ success: true, enabled });
        });
        return true; // 非同期レスポンス
    } else if (request.action === 'getStatus') {
        sendResponse({ success: true, enabled: furikanaEnabled });
        return false;
    }
    // 未処理のメッセージは無視（trueを返さない）
    return false;
});

// ページが再表示された時に App Group から設定を同期
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        browser.runtime.sendMessage({ action: 'syncAppGroup' }).catch(() => {});
    }
});

// 設定変更をリアルタイム反映
const RUBY_CSS_KEYS = ['rubySize', 'rubyGap', 'rubyLineHeight', 'rubyMinHeight', 'rubyBoxPadding', 'rubyBoxMargin', 'reverseRuby'];
browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    let needUpdate = false;
    let needSpacingUpdate = false;
    for (const key of RUBY_CSS_KEYS) {
        if (changes[key]) {
            settings[key] = changes[key].newValue;
            needUpdate = true;
            if (key === 'rubyBoxPadding' || key === 'rubyBoxMargin') {
                needSpacingUpdate = true;
            }
        }
    }
    if (needUpdate) {
        applyRubyCSS();
        realignAllRubyWidths();
    }
    if (needSpacingUpdate) updateLineSpacingForAll();

    // reverseRuby 切り替え（CSS変更だけでなくルビ再構築が必要）
    if (changes.reverseRuby && furikanaEnabled) {
        furikanaGeneration++;
        removeFurigana();
        requestQueue.reset();
        if (visibleProcessor) {
            visibleProcessor.stop();
            visibleProcessor = null;
        }
        visibleProcessor = new VisibleTextProcessor();
        visibleProcessor.start();
    }

    // readingRules 切り替え
    if (changes.readingRules) {
        settings.readingRules = changes.readingRules.newValue;
        console.log('[Furikana] Reading rules changed to:', settings.readingRules);

        // ふりがな表示中なら再解析
        if (furikanaEnabled) {
            furikanaGeneration++;
            removeFurigana();
            requestQueue.reset();
            if (visibleProcessor) {
                visibleProcessor.stop();
                visibleProcessor = null;
            }
            visibleProcessor = new VisibleTextProcessor();
            visibleProcessor.start();
        }
    }

    // readingType / unitType 切り替え
    if (changes.readingType || changes.unitType) {
        if (changes.readingType) {
            settings.readingType = changes.readingType.newValue;
            console.log('[Furikana] Reading type changed to:', settings.readingType);
        }
        if (changes.unitType) {
            settings.unitType = changes.unitType.newValue;
            console.log('[Furikana] Unit type changed to:', settings.unitType);
        }

        if (furikanaEnabled) {
            furikanaGeneration++;
            removeFurigana();
            requestQueue.reset();
            if (visibleProcessor) {
                visibleProcessor.stop();
                visibleProcessor = null;
            }
            visibleProcessor = new VisibleTextProcessor();
            visibleProcessor.start();
        }
    }

    // 辞書切り替え
    if (changes.dictType) {
        const newDict = changes.dictType.newValue;
        settings.dictType = newDict;
        console.log('[Furikana] Dictionary changed to:', newDict);

        // ふりがな表示中なら削除→再解析
        if (furikanaEnabled) {
            furikanaGeneration++;
            removeFurigana();
            requestQueue.reset();
            if (visibleProcessor) {
                visibleProcessor.stop();
                visibleProcessor = null;
            }
            visibleProcessor = new VisibleTextProcessor();
            visibleProcessor.start();
        }
    }
});

// 初期化
loadSettings();
