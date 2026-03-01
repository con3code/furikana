// バックグラウンドスクリプト
console.log('[Furikana] Background script starting...');
console.log('[Furikana] kuromoji available:', typeof kuromoji !== 'undefined');
console.log('[Furikana] Sudachi available:', typeof isSudachiReady === 'function');

// --- ネイティブログ（Console.app 用）---
// sendNativeMessage で Swift 側の os_log に出力
// fire-and-forget: レスポンスを待たない
function nativeLog(message, level) {
    try {
        browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'jsLog',
            message: String(message),
            level: level || 'info'
        }).catch(function(e) {
            console.warn('[Furikana] nativeLog sendNativeMessage failed:', e);
        });
    } catch (e) {
        console.warn('[Furikana] nativeLog exception:', e);
    }
}

nativeLog('Background script loaded. kuromoji=' + (typeof kuromoji !== 'undefined') +
          ', SudachiWasm=' + (typeof SudachiWasm !== 'undefined') +
          ', isSudachiReady=' + (typeof isSudachiReady === 'function') +
          ', extHelper=' + (typeof _extHelperLoaded === 'function'));

// --- kuromoji 遅延初期化 ---
let kuromojiTokenizer = null;
let kuromojiInitPromise = null;
let kuromojiInitFailed = false;

function initKuromoji() {
    if (kuromojiTokenizer) return Promise.resolve(kuromojiTokenizer);
    if (kuromojiInitPromise) return kuromojiInitPromise;

    if (typeof kuromoji === 'undefined') {
        console.error('[Furikana] kuromoji library not loaded');
        kuromojiInitFailed = true;
        return Promise.reject(new Error('kuromoji library not loaded'));
    }

    kuromojiInitPromise = new Promise((resolve, reject) => {
        const dicPath = browser.runtime.getURL('dict/');
        console.log('[Furikana] Initializing kuromoji with dicPath:', dicPath);

        kuromoji.builder({ dicPath: dicPath }).build((err, tokenizer) => {
            if (err) {
                console.error('[Furikana] kuromoji init failed:', err);
                kuromojiInitFailed = true;
                kuromojiInitPromise = null;
                reject(err);
            } else {
                console.log('[Furikana] kuromoji initialized successfully');
                kuromojiTokenizer = tokenizer;
                kuromojiInitFailed = false;
                resolve(tokenizer);
            }
        });
    });

    return kuromojiInitPromise;
}

// --- POS タグマッピング (日本語 → 英語) ---
const POS_MAP = {
    '\u540D\u8A5E': 'Noun',       // 名詞
    '\u52D5\u8A5E': 'Verb',       // 動詞
    '\u5F62\u5BB9\u8A5E': 'Adjective', // 形容詞
    '\u526F\u8A5E': 'Adverb',     // 副詞
    '\u52A9\u8A5E': 'Particle',   // 助詞
    '\u52A9\u52D5\u8A5E': 'Auxiliary', // 助動詞
    '\u63A5\u7D9A\u8A5E': 'Conjunction', // 接続詞
    '\u9023\u4F53\u8A5E': 'Adnominal',  // 連体詞
    '\u611F\u52D5\u8A5E': 'Interjection', // 感動詞
    '\u8A18\u53F7': 'Symbol',     // 記号
    '\u30D5\u30A3\u30E9\u30FC': 'Filler', // フィラー
};

function mapPos(japanesePos) {
    return POS_MAP[japanesePos] || 'Other';
}

// --- カタカナ → ひらがな変換 ---
function katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
}

// --- kuromoji トークン → 拡張機能トークン形式変換 ---
function convertKuromojiTokens(kTokens, baseOffset) {
    const tokens = [];
    let pos = baseOffset || 0;

    for (const kt of kTokens) {
        const surface = kt.surface_form;
        const len = surface.length;
        // reading が undefined の場合は surface をそのまま使う
        const rawReading = kt.reading || surface;
        const reading = katakanaToHiragana(rawReading);

        tokens.push({
            surface: surface,
            reading: reading,
            pos: mapPos(kt.pos),
            range: [pos, pos + len]
        });
        pos += len;
    }

    return tokens;
}

// --- kuromoji でトークン化 ---
async function kuromojiTokenize(text) {
    const tokenizer = await initKuromoji();
    const kTokens = tokenizer.tokenize(text);
    return convertKuromojiTokens(kTokens, 0);
}

try {
    // 拡張機能のインストール時
    browser.runtime.onInstalled.addListener(async (details) => {
        console.log('[Furikana] Extension installed:', details.reason);

        if (details.reason === 'install') {
            // 初回インストール時のデフォルト設定
            await browser.storage.local.set({
                readingType: 'hiragana',
                unitType: 'long',
                autoEnable: false,
                readingRules: true,
                reverseRuby: false,
                dictType: 'system'
            });

            // 設定画面を開く
            browser.runtime.openOptionsPage();
        }
    });

    // メッセージハンドリング
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("[Furikana] Background received message:", request.action);
        nativeLog('onMessage: action=' + request.action);

        // content.jsからのリクエストを処理
        if (request.action === 'tokenize' || request.action === 'getReading') {
            console.log("[Furikana] Processing action:", request.action);

            handleTokenizeRequest(request)
                .then(result => sendResponse(result))
                .catch(error => {
                    console.error("[Furikana] Tokenization error:", error);
                    if (request.action === 'tokenize' && request.text) {
                        sendResponse({ success: true, tokens: simpleTokenize(request.text) });
                    } else {
                        sendResponse({ success: false, error: error.message });
                    }
                });

            return true; // 非同期レスポンスを許可
        }

        // バッチトークン化: 複数テキストを一括処理
        if (request.action === 'tokenizeBatch') {
            handleTokenizeBatchRequest(request)
                .then(result => sendResponse(result))
                .catch(error => {
                    console.error("[Furikana] Batch tokenization error:", error);
                    sendResponse({ success: false, error: error.message });
                });

            return true;
        }

        // App Group から設定を同期（content.js の visibilitychange から呼ばれる）
        if (request.action === 'syncAppGroup') {
            syncFromAppGroup()
                .then(() => sendResponse({ success: true }))
                .catch(() => sendResponse({ success: false }));
            return true;
        }

        // 設定を即座に App Group へ同期（options.js の saveSettings から呼ばれる）
        // デバウンスをバイパスして確実に同期完了を待つ
        if (request.action === 'forceSyncToAppGroup') {
            (async () => {
                try {
                    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
                    const allSettings = await browser.storage.local.get(null);
                    await browser.runtime.sendNativeMessage('con3.furikana', {
                        action: 'syncSettings',
                        settings: allSettings
                    });
                    console.log('[Furikana] Force synced settings to App Group');
                    sendResponse({ success: true });
                } catch (e) {
                    console.warn('[Furikana] Force sync to App Group failed:', e);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }

        // Sudachi 辞書ステータス問い合わせ（options.js から）
        if (request.action === 'getSudachiStatus') {
            sendResponse({
                ready: (typeof isSudachiReady === 'function' && isSudachiReady()),
                dictMode: (typeof getSudachiDictMode === 'function' ? getSudachiDictMode() : null)
            });
            return false;
        }

        // ツールバーアイコン切り替え
        if (request.action === 'updateIcon') {
            const icon = request.enabled ? 'images/toolbar-icon_on.svg' : 'images/toolbar-icon_off.svg';
            if (sender.tab && sender.tab.id != null) {
                browser.action.setIcon({ tabId: sender.tab.id, path: icon });
            }
            return false;
        }

        // 辞書ファイル読み込み: content.js(kuromoji) → ここ → Swift
        if (request.action === 'loadDictFile') {
            handleLoadDictFile(request)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        }

        return false;
    });

    // --- 辞書ルーティング ---
    async function handleTokenizeRequest(request) {
        const settings = await browser.storage.local.get({ dictType: 'system' });
        const dictType = settings.dictType;

        console.log('[Furikana] Dict type:', dictType);

        if (dictType === 'sudachi') {
            // Sudachi WASM → ネイティブフォールバック → simpleTokenize
            return await trySudachiTokenization(request)
                || await tryNativeTokenization(request)
                || fallbackTokenize(request);
        } else if (dictType === 'ipadic') {
            // IPA辞書 (kuromoji) → ネイティブフォールバック → simpleTokenize
            return await tryKuromojiTokenization(request)
                || await tryNativeTokenization(request)
                || fallbackTokenize(request);
        } else {
            // system: ネイティブ Swift → simpleTokenize
            return await tryNativeTokenization(request)
                || fallbackTokenize(request);
        }
    }

    // --- バッチトークン化 ---
    async function handleTokenizeBatchRequest(request) {
        const texts = request.texts;
        if (!texts || !Array.isArray(texts) || texts.length === 0) {
            return { success: false, error: 'No texts provided' };
        }

        const settings = await browser.storage.local.get({ dictType: 'system' });
        const dictType = settings.dictType;

        console.log(`[Furikana] Batch tokenize: ${texts.length} texts, dict: ${dictType}`);

        if (dictType === 'sudachi') {
            // Sudachi WASM バッチ → native バッチフォールバック
            try {
                if (typeof isSudachiReady !== 'function') throw new Error('sudachi-tokenizer.js not loaded');
                nativeLog('Batch sudachi: isSudachiReady=' + isSudachiReady());
                if (!isSudachiReady()) {
                    nativeLog('Batch sudachi: initializing...');
                    await initSudachiWithFallback();
                    nativeLog('Batch sudachi: initialized, ready=' + isSudachiReady());
                }
                const results = sudachiTokenizeBatch(texts);
                nativeLog('Batch sudachi: success, ' + texts.length + ' texts');
                return { success: true, results };
            } catch (sudachiError) {
                nativeLog('Batch sudachi FAILED: ' + (sudachiError && sudachiError.message || sudachiError), 'error');
                console.warn('[Furikana] Sudachi batch failed, trying native:', sudachiError);
            }
        } else if (dictType === 'ipadic') {
            // kuromoji バッチ → native バッチフォールバック
            try {
                const tokenizer = await initKuromoji();
                const results = texts.map(text => {
                    try {
                        const kTokens = tokenizer.tokenize(text);
                        const tokens = convertKuromojiTokens(kTokens, 0);
                        return { tokens, dictSource: 'ipadic' };
                    } catch (e) {
                        return { tokens: null, dictSource: null };
                    }
                });
                return { success: true, results };
            } catch (kuromojiError) {
                console.warn('[Furikana] kuromoji batch failed, trying native:', kuromojiError);
            }
        }

        // native バッチ (system または kuromoji フォールバック)
        try {
            await Promise.resolve(); // onMessage の同期処理を抜ける
            const response = await browser.runtime.sendNativeMessage('con3.furikana', {
                action: 'tokenizeBatch',
                texts: texts
            });

            if (response && response.success && response.results) {
                const results = response.results.map(r => ({
                    tokens: r.success ? r.tokens : null,
                    dictSource: r.success ? 'system' : null
                }));
                return { success: true, results };
            }
        } catch (nativeError) {
            console.error('[Furikana] Native batch tokenize failed:', nativeError);
        }

        // 全体失敗
        return { success: false, error: 'Batch tokenization failed' };
    }

    // Sudachi WASM でトークン化を試みる
    async function trySudachiTokenization(request) {
        if (request.action !== 'tokenize' || !request.text) return null;
        try {
            if (typeof isSudachiReady !== 'function') throw new Error('sudachi-tokenizer.js not loaded');
            nativeLog('trySudachiTokenization: isSudachiReady=' + isSudachiReady());
            if (!isSudachiReady()) {
                nativeLog('trySudachiTokenization: initializing...');
                await initSudachiWithFallback();
                nativeLog('trySudachiTokenization: initialized, ready=' + isSudachiReady());
            }
            const tokens = sudachiTokenize(request.text);
            nativeLog('trySudachiTokenization: success, tokens=' + tokens.length);
            return { success: true, tokens: tokens, dictSource: 'sudachi' };
        } catch (error) {
            nativeLog('trySudachiTokenization FAILED: ' + (error && error.message || error), 'error');
            console.error('[Furikana] Sudachi tokenization failed:', error);
            return null;
        }
    }

    // kuromoji でトークン化を試みる
    async function tryKuromojiTokenization(request) {
        if (request.action !== 'tokenize' || !request.text) return null;
        try {
            const tokens = await kuromojiTokenize(request.text);
            console.log('[Furikana] kuromoji tokenization success, tokens:', tokens.length);
            return { success: true, tokens: tokens, dictSource: 'ipadic' };
        } catch (error) {
            console.error('[Furikana] kuromoji tokenization failed:', error);
            return null;
        }
    }

    // ネイティブハンドラーでトークン化を試みる
    async function tryNativeTokenization(request) {
        try {
            console.log('[Furikana] Attempting native tokenization...');

            // Safari ExtensionHandlerにメッセージを送信
            const response = await browser.runtime.sendNativeMessage(
                'con3.furikana',
                request
            );

            console.log('[Furikana] Native response received:', response);

            if (response && response.success) {
                response.dictSource = 'system';
                return response;
            }

            return null;
        } catch (error) {
            console.error('[Furikana] Native messaging failed:', error);
            return null;
        }
    }

    // 辞書ファイル読み込みを Swift に中継（async で呼ぶことで onMessage 完了後に実行）
    async function handleLoadDictFile(request) {
        // onMessage ハンドラーの同期処理を抜けてから sendNativeMessage を呼ぶ
        await Promise.resolve();
        return await browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'loadDictFile',
            filename: request.filename,
            offset: request.offset || 0
        });
    }

    // 最終フォールバック
    function fallbackTokenize(request) {
        if (request.action === 'tokenize' && request.text) {
            return { success: true, tokens: simpleTokenize(request.text), dictSource: 'fallback' };
        }
        return { success: false, error: 'Not implemented' };
    }

    // 簡易的なトークン化（フォールバック）
    function simpleTokenize(text) {
        const tokens = [];
        let currentPos = 0;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const isKanji = /[\u4E00-\u9FAF]/.test(char);
            const isHiragana = /[\u3040-\u309F]/.test(char);
            const isKatakana = /[\u30A0-\u30FF]/.test(char);

            let pos = 'Other';
            if (isKanji) {
                pos = 'Noun';
            } else if (isHiragana) {
                pos = 'Particle';
            } else if (isKatakana) {
                pos = 'Noun';
            }

            let reading = char;

            tokens.push({
                surface: char,
                reading: reading,
                pos: pos,
                range: [currentPos, currentPos + 1]
            });

            currentPos++;
        }

        return tokens;
    }

    // --- App Group からの設定同期（起動時）---
    async function syncFromAppGroup() {
        try {
            await Promise.resolve(); // onMessage ハンドラー外で実行
            const response = await browser.runtime.sendNativeMessage('con3.furikana', {
                action: 'loadSettings'
            });
            if (response && response.success && response.settings && Object.keys(response.settings).length > 0) {
                await browser.storage.local.set(response.settings);
                console.log('[Furikana] Synced settings from App Group');
            }
        } catch (e) {
            console.warn('[Furikana] App Group sync failed:', e);
        }
    }
    syncFromAppGroup();

    // --- 設定変更リスナー ---
    let syncTimer = null;
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        // dictType 変更時の kuromoji ライフサイクル管理
        if (changes.dictType) {
            const newDictType = changes.dictType.newValue;
            console.log('[Furikana] Dict type changed to:', newDictType);

            if (newDictType === 'ipadic' && !kuromojiTokenizer && !kuromojiInitPromise) {
                initKuromoji().catch(err => {
                    console.warn('[Furikana] kuromoji preload failed:', err);
                });
            } else if (newDictType === 'sudachi' && typeof isSudachiReady === 'function' && !isSudachiReady()) {
                nativeLog('Dict changed to sudachi, preloading...');
                initSudachiWithFallback().catch(err => {
                    nativeLog('Sudachi preload FAILED: ' + (err && err.message || err), 'error');
                    console.warn('[Furikana] Sudachi preload failed:', err);
                });
            }

            // 不要なバックエンドをアンロード
            if (newDictType !== 'ipadic' && kuromojiTokenizer) {
                kuromojiTokenizer = null;
                kuromojiInitPromise = null;
                kuromojiInitFailed = false;
                console.log('[Furikana] kuromoji unloaded');
            }
            if (newDictType !== 'sudachi' && typeof unloadSudachi === 'function') {
                unloadSudachi();
            }
        }

        // App Group に同期（デバウンス 300ms）
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            try {
                const allSettings = await browser.storage.local.get(null);
                await browser.runtime.sendNativeMessage('con3.furikana', {
                    action: 'syncSettings',
                    settings: allSettings
                });
                console.log('[Furikana] Settings synced to App Group');
            } catch (e) {
                console.warn('[Furikana] App Group sync failed:', e);
            }
        }, 300);
    });

    console.log('[Furikana] Background script loaded successfully');

} catch (error) {
    console.error('[Furikana] Background script error:', error);
}
