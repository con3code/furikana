// バックグラウンドスクリプト
console.log('[Furikana] Background script starting...');
console.log('[Furikana] kuromoji available:', typeof kuromoji !== 'undefined');

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

        // App Group から設定を同期（content.js の visibilitychange から呼ばれる）
        if (request.action === 'syncAppGroup') {
            syncFromAppGroup()
                .then(() => sendResponse({ success: true }))
                .catch(() => sendResponse({ success: false }));
            return true;
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

        if (dictType === 'ipadic') {
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
            } else if (newDictType === 'system' && kuromojiTokenizer) {
                kuromojiTokenizer = null;
                kuromojiInitPromise = null;
                kuromojiInitFailed = false;
                console.log('[Furikana] kuromoji unloaded');
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
