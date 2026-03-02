// ふりがな機能のメインスクリプト
console.log('[Furikana] content.js loading on', location.hostname);

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
    rubyBoxPadding: 0.15,
    rubyBoxMargin: 0
};

// kuromoji は background.js に集約（全タブで1インスタンスを共有）

function katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ReadingRules は reading-rules.js で定義（manifest.json で先にロード）

// 接続エラー（background.js停止）かどうかを判定
function isConnectionError(error) {
    if (!error) return false;
    const msg = (error.message || error.toString()).toLowerCase();
    return msg.includes('could not establish connection')
        || msg.includes('receiving end does not exist')
        || msg.includes('extension context invalidated')
        || msg.includes('message port closed');
}

// リクエストキューイングシステム
class RequestQueue {
    constructor(maxConcurrent = 3, intervalDelay = 50) {
        this.maxConcurrent = maxConcurrent;  // 同時実行数の上限
        this.running = 0;                     // 現在実行中のリクエスト数
        this.queue = [];                      // 待機中のリクエスト
        this.errorCount = 0;                  // 連続エラー回数（トークン化エラー）
        this.errorThreshold = 10;             // エラー閾値
        this.totalRequests = 0;               // 総リクエスト数
        this.successfulRequests = 0;          // 成功したリクエスト数
        this.intervalDelay = intervalDelay;   // リクエスト間の遅延（ミリ秒）

        // クールダウン方式（永続フォールバックの代替）
        this.cooldownUntil = 0;               // クールダウン終了タイムスタンプ
        this.cooldownMs = 0;                  // 現在のクールダウン時間
        this.baseCooldownMs = 3000;           // 初回クールダウン（3秒）
        this.maxCooldownMs = 30000;           // 最大クールダウン（30秒）

        // 接続エラー（background.js停止）用の別管理
        this.connectionRetrying = false;      // 接続リトライ中フラグ
    }

    // リクエストをキューに追加
    async enqueue(fn) {
        // クールダウン中はスキップ
        if (this.cooldownUntil > 0) {
            if (Date.now() < this.cooldownUntil) {
                return null;
            }
            // クールダウン明け: エラーカウントをリセットしてリトライ許可
            console.log('[Furikana] Cooldown expired, resuming native messaging');
            this.errorCount = 0;
            this.cooldownUntil = 0;
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

            // 成功した場合、エラーカウントとクールダウンをリセット
            if (result !== null) {
                this.errorCount = 0;
                this.cooldownMs = 0;
                this.successfulRequests++;
            } else {
                this.errorCount++;
                console.warn(`[Furikana] Request returned null (error count: ${this.errorCount}/${this.errorThreshold})`);
            }

            resolve(result);
        } catch (error) {
            if (isConnectionError(error)) {
                // 接続エラー: background.js が停止中 → クールダウンカウントに入れない
                console.warn('[Furikana] Connection error (background.js may be stopped):', error.message);

                // 待機中のリクエストをキャンセル（リトライ待機後に再スキャン）
                this.queue.forEach(item => item.resolve(null));
                this.queue = [];

                if (!this.connectionRetrying) {
                    this.connectionRetrying = true;
                    console.log('[Furikana] Waiting for background.js to restart...');
                    // 2秒待ってから再スキャンをトリガー（background.js再起動の猶予）
                    setTimeout(() => {
                        this.connectionRetrying = false;
                        console.log('[Furikana] Retrying after connection error wait');
                        if (visibleProcessor && visibleProcessor.running) {
                            visibleProcessor.scheduleScan();
                        }
                    }, 2000);
                }

                resolve(null);
            } else {
                // トークン化エラー（Swift側の問題など）
                this.errorCount++;
                console.error(`[Furikana] Request failed (error count: ${this.errorCount}/${this.errorThreshold}):`, error);

                // エラー閾値到達: クールダウンに入る（指数バックオフ）
                if (this.errorCount >= this.errorThreshold) {
                    this.cooldownMs = this.cooldownMs === 0
                        ? this.baseCooldownMs
                        : Math.min(this.cooldownMs * 2, this.maxCooldownMs);
                    this.cooldownUntil = Date.now() + this.cooldownMs;

                    console.warn(`[Furikana] Error threshold reached, cooldown ${this.cooldownMs}ms (until ${new Date(this.cooldownUntil).toLocaleTimeString()})`);
                    console.warn(`[Furikana] Stats: ${this.successfulRequests}/${this.totalRequests} successful requests`);

                    // 待機中のリクエストをキャンセル（クールダウン明けに再スキャンされる）
                    this.queue.forEach(item => item.resolve(null));
                    this.queue = [];
                }

                resolve(null); // エラー時もresolveして処理を続行
            }
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
        this.cooldownUntil = 0;
        this.cooldownMs = 0;
        this.totalRequests = 0;
        this.successfulRequests = 0;
    }

    // クールダウン中かどうか
    isFallbackMode() {
        return this.cooldownUntil > 0 && Date.now() < this.cooldownUntil;
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
                // クールダウン中はバッチ処理を一時停止し、クールダウン明けに再開
                if (requestQueue.isFallbackMode()) {
                    const remaining = requestQueue.cooldownUntil - Date.now();
                    if (remaining > 0) {
                        console.log(`[Furikana] Pausing batch processing during cooldown (${Math.ceil(remaining / 1000)}s)`);
                        await new Promise(resolve => setTimeout(resolve, remaining + 100));
                    }
                    // クールダウン明け → 未処理ノードを再スキャンで拾い直す
                    console.log('[Furikana] Cooldown ended, scheduling rescan for retry');
                    // pending を一旦クリアして queuedNodes も解除（再スキャンで拾い直す）
                    for (const node of this.pending) {
                        this.queuedNodes.delete(node);
                    }
                    this.pending = [];
                    this.processing = false;
                    this.scanVisibleTextNodes();
                    return;
                }

                // バッチ内のノードを収集
                const batchCount = Math.min(this.batchSize, this.pending.length);
                const batch = [];
                for (let i = 0; i < batchCount; i++) {
                    const node = this.pending.shift();
                    if (!node || !node.parentElement || !node.isConnected) {
                        this.queuedNodes.delete(node);
                        continue;
                    }
                    const text = node.nodeValue;
                    if (!containsKanji(text)) {
                        this.queuedNodes.delete(node);
                        continue;
                    }
                    batch.push({ node, text });
                }

                if (batch.length === 0) continue;

                // バッチトークン化リクエスト（1回の通信で全テキストを送信）
                const gen = furikanaGeneration;
                let batchResults = null;
                if (!requestQueue.isFallbackMode()) {
                    batchResults = await sendBatchTokenize(batch.map(b => b.text));
                }

                // 各ノードにトークンを適用（DOM操作のみ、通信なし）
                for (let i = 0; i < batch.length; i++) {
                    const { node, text } = batch[i];
                    const result = batchResults ? batchResults[i] : null;
                    const tokens = result ? result.tokens : null;
                    const dictSource = result ? result.dictSource : null;
                    const ok = applyTokensToNode(node, text, tokens, dictSource, gen);
                    this.queuedNodes.delete(node);
                    if (ok) {
                        this.processedNodes.add(node);
                    }
                    // 失敗時は processedNodes に入れない → 次のスキャンで再取得
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
      margin-block-start: ${rubyGap}px !important;
      pointer-events: none;
    }` : `
    .furikana-ruby {
      vertical-align: baseline !important;
      align-items: start !important;
      min-block-size: var(--furikana-ruby-min-height) !important;
    }

    .furikana-ruby > .furikana-rt {
      font-size: var(--furikana-ruby-size) !important;
      margin-block-end: ${rubyGap}px !important;
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

    .furikana-overflow-expand {
      overflow: visible !important;
      -webkit-line-clamp: unset !important;
      max-height: none !important;
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
// 逆転モード専用（通常モードでは Safari の native ruby が自動で幅を調整する）
function alignRubyWidths(container) {
    if (!settings.reverseRuby) return;
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
// 逆転モード専用（通常モードでは Safari の native ruby が自動で幅を調整する）
function realignAllRubyWidths() {
    if (!settings.reverseRuby) return;
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
            expandOverflowAncestors(el);
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
        // line-clamp がない場合は overflow 展開不要
        // （テキストは切り詰められていないので祖先の overflow を変更するとレイアウトが崩れる）
    }
}

// overflow: hidden + 高さ制約がある祖先要素を拡張し、ルビによるはみ出しを防ぐ
// 記事カード等の意味的境界要素を超えて走査しない
const OVERFLOW_BOUNDARY_TAGS = new Set([
    'ARTICLE', 'SECTION', 'MAIN', 'NAV', 'ASIDE', 'HEADER', 'FOOTER'
]);

function expandOverflowAncestors(target) {
    // 祖先チェーンに境界タグがあるか事前チェック
    // 境界タグがなければ target 自身のみ展開し、祖先には触れない
    // （境界なしで祖先を展開すると、広告等の非関連コンテナまで影響する）
    let hasBoundary = false;
    let check = target.parentElement;
    while (check && check !== document.body) {
        if (OVERFLOW_BOUNDARY_TAGS.has(check.tagName)) {
            hasBoundary = true;
            break;
        }
        check = check.parentElement;
    }

    let el = target;
    while (el && el !== document.body) {
        const atBoundary = OVERFLOW_BOUNDARY_TAGS.has(el.tagName);

        const style = window.getComputedStyle(el);

        // flex/grid コンテナはスキップ（overflow: hidden がレイアウト制御用）
        const display = style.display;
        if (display === 'flex' || display === 'inline-flex'
            || display === 'grid' || display === 'inline-grid') {
            if (atBoundary) break;
            if (!hasBoundary && el !== target) break;
            el = el.parentElement;
            continue;
        }

        const ov = style.overflow || style.overflowY;
        if (ov === 'hidden' || ov === 'clip') {
            const hasLineClamp = style.webkitLineClamp
                && style.webkitLineClamp !== 'none'
                && style.webkitLineClamp !== '0';
            const hasFixedHeight = style.height !== 'auto'
                && style.height !== '0px'
                && !style.height.includes('%');
            const hasMaxHeight = style.maxHeight
                && style.maxHeight !== 'none';

            if (hasLineClamp || hasFixedHeight || hasMaxHeight) {
                if (!el.dataset.furikanaOverflowOriginal) {
                    el.dataset.furikanaOverflowOriginal = JSON.stringify({
                        overflow: el.style.overflow || '',
                        height: el.style.height || '',
                        maxHeight: el.style.maxHeight || '',
                        webkitLineClamp: el.style.webkitLineClamp || '',
                        webkitBoxOrient: el.style.webkitBoxOrient || '',
                        display: el.style.display || ''
                    });
                }
                el.classList.add('furikana-overflow-expand');
            }
        }

        if (atBoundary) break;
        // 境界タグがない場合は target 自身のみで終了
        if (!hasBoundary && el !== target) break;
        el = el.parentElement;
    }
}

// expandOverflowAncestors で変更した要素を元に戻す
function restoreOverflowAncestors() {
    document.querySelectorAll('.furikana-overflow-expand').forEach(el => {
        el.classList.remove('furikana-overflow-expand');
        if (el.dataset.furikanaOverflowOriginal) {
            const orig = JSON.parse(el.dataset.furikanaOverflowOriginal);
            for (const [prop, val] of Object.entries(orig)) {
                const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                if (val) {
                    el.style[prop] = val;
                } else {
                    el.style.removeProperty(cssProp);
                }
            }
            delete el.dataset.furikanaOverflowOriginal;
        }
    });
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
        rubyBoxPadding: 0.15,
        rubyBoxMargin: 0,
        userDictRules: null
    });

    settings = stored;
    applyRubyCSS();

    // ユーザー辞書ルールを適用
    if (stored.userDictRules && typeof ReadingRules !== 'undefined'
        && typeof ReadingRules.setUserRules === 'function') {
        ReadingRules.setUserRules(stored.userDictRules);
    }

    console.log('[Furikana] Settings loaded: dictType=' + stored.dictType + ', autoEnable=' + stored.autoEnable);

    // 自動有効化
    if (stored.autoEnable) {
        console.log('[Furikana] Auto-enabling furigana');
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
                    // スクリプト/スタイル/RUBY/RT/RB タグ内は除外
                    const tag = parent.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'RUBY' || tag === 'RT' || tag === 'RB') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 祖先に既存の ruby がある場合も除外（rb の孫テキスト等）
                    if (parent.closest('ruby')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // 広告ブロック内は除外（Yahoo等のストリーム広告）
                    if (parent.closest('.yadsStream, [id^="STREAMAD"], [data-ad-region], [data-google-query-id]')) {
                        return NodeFilter.FILTER_REJECT;
                    }
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

// 数字文字列の可能な読みを生成（数字セグメントのルビ省略用）
function _digitToReadings(numStr) {
    // 全角→半角
    const half = numStr.replace(/[０-９]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30));
    const n = parseInt(half, 10);
    if (isNaN(n) || n < 0 || n > 9999) return null;

    // 単一数字の読みバリエーション（促音変化含む）
    const SINGLE = {
        0: ['れい', 'ゼロ', 'まる', 'ぜろ'],
        1: ['いち', 'いっ', 'ひと', 'ひ'],
        2: ['に', 'ふた', 'ふ'],
        3: ['さん', 'み'],
        4: ['よん', 'し', 'よ'],
        5: ['ご', 'いつ'],
        6: ['ろく', 'ろっ', 'む'],
        7: ['なな', 'しち', 'なの'],
        8: ['はち', 'はっ', 'や', 'よう'],
        9: ['きゅう', 'く', 'ここの'],
    };
    if (n <= 9) return SINGLE[n];

    // 10以上: 標準読みを合成
    const ones = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
    function compose(num) {
        if (num === 0) return '';
        let r = '';
        if (num >= 1000) {
            const t = Math.floor(num / 1000);
            r += (t === 1 ? '' : t === 3 ? 'さん' : t === 8 ? 'はっ' : ones[t]) +
                 (t === 3 ? 'ぜん' : t === 8 ? 'せん' : 'せん');
            num %= 1000;
        }
        if (num >= 100) {
            const h = Math.floor(num / 100);
            if (h === 3) r += 'さんびゃく';
            else if (h === 6) r += 'ろっぴゃく';
            else if (h === 8) r += 'はっぴゃく';
            else r += (h === 1 ? '' : ones[h]) + 'ひゃく';
            num %= 100;
        }
        if (num >= 10) {
            const t = Math.floor(num / 10);
            r += (t === 1 ? '' : ones[t]) + 'じゅう';
            num %= 10;
        }
        if (num > 0) r += ones[num];
        return r;
    }

    const standard = compose(n);
    const readings = [standard];
    // 末尾の促音変化バリエーション（いち→いっ、く→っ、う→っ 等）
    if (standard.endsWith('ち')) readings.push(standard.slice(0, -1) + 'っ');
    if (standard.endsWith('く')) readings.push(standard.slice(0, -1) + 'っ');
    if (standard.endsWith('じゅう'))
        readings.push(standard.slice(0, -1) + 'っ');  // じゅう→じゅっ
    if (n === 10) readings.push('じっ');  // じゅう→じっ
    return readings;
}

// 漢字と送り仮名を分離し、漢字部分のみにルビを振るためのセグメント分割
// kuroshiro方式: surface の漢字/非漢字セグメントから正規表現を構築し、reading とマッチ
function splitKanjiReading(surface, reading) {
    const isKanji = ch => /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(ch);
    const isDigit = ch => /[0-9０-９]/.test(ch);

    // surface を漢字/かな/数字セグメントに分割
    const segments = [];
    let curType = null;
    let curText = '';
    for (const ch of surface) {
        const type = isKanji(ch) ? 'kanji' : isDigit(ch) ? 'digit' : 'kana';
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

    // 正規表現を構築: 漢字→(.+)、数字→(?:読み1|読み2|...)、かな→リテラル
    let regexStr = '^';
    let hasDigitSegment = false;
    for (const seg of segments) {
        if (seg.type === 'kanji') {
            regexStr += '(.+)';
        } else if (seg.type === 'digit') {
            const readings = _digitToReadings(seg.text);
            if (readings && readings.length > 0) {
                // 長い読みを先にして部分一致を防ぐ
                const sorted = [...readings].sort((a, b) => b.length - a.length);
                const escaped = sorted.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                regexStr += '(?:' + escaped.join('|') + ')';
                hasDigitSegment = true;
            } else {
                // 読み生成できない数字 → かなとして扱う（リテラルマッチ）
                regexStr += seg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
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
                    // 数字・かな → ルビなし
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

// バッチトークン化リクエスト（複数テキストを1回の通信で送信）
// 接続エラー時は1回だけリトライ（background.js再起動の猶予を与える）
async function sendBatchTokenize(texts, retry = 0) {
    if (requestQueue.isFallbackMode()) {
        console.log('[Furikana] sendBatchTokenize: fallback mode, skipping');
        return null;
    }
    console.log('[Furikana] sendBatchTokenize: sending', texts.length, 'texts, retry=' + retry);
    try {
        return await requestQueue.enqueue(async () => {
            const response = await browser.runtime.sendMessage({
                action: 'tokenizeBatch',
                texts: texts
            });
            console.log('[Furikana] sendBatchTokenize: response success=' + (response && response.success));
            if (response && response.success && response.results) {
                return response.results;
            }
            throw new Error('Batch tokenize unsuccessful');
        });
    } catch (error) {
        // 接続エラーかつリトライ未実施 → 2秒待ってから1回リトライ
        if (isConnectionError(error) && retry < 1) {
            console.warn('[Furikana] Connection error in sendBatchTokenize, retrying in 2s...', error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return sendBatchTokenize(texts, retry + 1);
        }
        console.error('[Furikana] Batch tokenize failed:', error);
        return null;
    }
}

// ユニットのrange（元テキスト中の位置）を取得
function getUnitRange(unit) {
    if (unit.tokens && unit.tokens.length > 0) {
        return [unit.tokens[0].range[0], unit.tokens[unit.tokens.length - 1].range[1]];
    }
    return null;
}

// トークン配列からルビを構築してDOMに適用（通信なし）
function applyTokensToNode(textNode, text, tokens, dictSource, gen) {
    if (!tokens) return false;

    try {
        // ReadingRules を両辞書共通で適用（JS側に一元化）
        if (settings.readingRules && typeof ReadingRules !== 'undefined') {
            tokens = ReadingRules.apply(tokens);
        }

        let units;
        console.log(`[Furikana] Tokenization successful (${dictSource || 'unknown'}), tokens:`, tokens.length);
        if (settings.unitType === 'long') {
            units = groupToLongUnits(tokens);
        } else {
            units = tokens.map(t => ({
                surface: t.surface,
                reading: t.reading || t.surface,
                tokens: [t]
            }));
        }

        // rubyタグを生成
        const fragment = document.createDocumentFragment();
        let rubyCount = 0;
        let textPos = 0; // 元テキスト中の現在位置

        for (const unit of units) {
            // トークン間の隙間（空白・改行等）を補完
            const unitRange = getUnitRange(unit);
            if (unitRange && unitRange[0] > textPos) {
                fragment.appendChild(document.createTextNode(text.substring(textPos, unitRange[0])));
            }

            // 漢字を含む場合のみrubyタグを追加
            if (containsKanji(unit.surface)) {
                // readingが表面形と同じ場合、または無効な場合はルビを表示しない
                if (!unit.reading || unit.reading === unit.surface) {
                    fragment.appendChild(document.createTextNode(unit.surface));
                    if (unitRange) textPos = unitRange[1];
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

            // 位置を更新
            if (unitRange) {
                textPos = unitRange[1];
            }
        }

        // 末尾の残余テキスト（空白・改行等）を補完
        if (textPos > 0 && textPos < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(textPos)));
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
        console.error('[Furikana] Error applying tokens to node:', error);
        return false;
    }
}

// テキストノードにふりがなを追加（単体リクエスト — 後方互換）
async function addFuriganaToNode(textNode) {
    const text = textNode.nodeValue;
    const gen = furikanaGeneration;

    if (!containsKanji(text)) {
        return false;
    }

    let tokens = null;
    let dictSource = 'unknown';

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

    if (!tokens) {
        console.log('[Furikana] Tokenization failed, leaving node for retry');
        return false;
    }

    return applyTokensToNode(textNode, text, tokens, dictSource, gen);
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

    restoreOverflowAncestors();

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
    console.log('[Furikana] toggleFurigana called, currently:', furikanaEnabled, 'dictType:', settings.dictType);
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

    // ツールバーアイコンを更新
    browser.runtime.sendMessage({ action: 'updateIcon', enabled: furikanaEnabled }).catch(() => {});

    return furikanaEnabled;
}

// popup等からのメッセージを受信
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleFurigana') {
        toggleFurigana().then(enabled => {
            sendResponse({ success: true, enabled });
        }).catch(error => {
            console.error('[Furikana] toggleFurigana failed:', error);
            sendResponse({ success: false, error: error.message });
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

// ふりがなを削除して再構築する共通処理
function rebuildFurigana() {
    if (!furikanaEnabled) return;
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

// 背面タブでの再構築を遅延するための仕組み
let pendingRebuild = false;

function scheduleRebuild() {
    if (document.hidden) {
        // 背面タブ: フォアグラウンド復帰時に再構築
        pendingRebuild = true;
        console.log('[Furikana] Tab hidden, deferring rebuild');
    } else {
        rebuildFurigana();
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingRebuild) {
        pendingRebuild = false;
        console.log('[Furikana] Tab visible, executing deferred rebuild');
        rebuildFurigana();
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
        if (!document.hidden) realignAllRubyWidths();
    }
    if (needSpacingUpdate && !document.hidden) updateLineSpacingForAll();

    // reverseRuby 切り替え（CSS変更だけでなくルビ再構築が必要）
    if (changes.reverseRuby) {
        scheduleRebuild();
    }

    // readingRules 切り替え
    if (changes.readingRules) {
        settings.readingRules = changes.readingRules.newValue;
        console.log('[Furikana] Reading rules changed to:', settings.readingRules);
        scheduleRebuild();
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
        scheduleRebuild();
    }

    // 辞書切り替え
    if (changes.dictType) {
        const newDict = changes.dictType.newValue;
        settings.dictType = newDict;
        console.log('[Furikana] Dictionary changed to:', newDict);
        scheduleRebuild();
    }

    // ユーザー辞書ルール変更
    if (changes.userDictRules) {
        const rules = changes.userDictRules.newValue;
        if (rules && typeof ReadingRules !== 'undefined' && typeof ReadingRules.setUserRules === 'function') {
            ReadingRules.setUserRules(rules);
        } else if (typeof ReadingRules !== 'undefined' && typeof ReadingRules.clearUserRules === 'function') {
            ReadingRules.clearUserRules();
        }
        scheduleRebuild();
    }
});

// 初期化
loadSettings();
