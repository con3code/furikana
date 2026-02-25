// Sudachi WASM アダプター層
// sudachi-bundle.js (SudachiWasm グローバル) に依存
// background.js より先にロードされる

console.log('[Furikana] sudachi-tokenizer.js loading...');
console.log('[Furikana] SudachiWasm available:', typeof SudachiWasm !== 'undefined');

// ネイティブログ（Console.app 用）: background.js の nativeLog より先にロードされるため自前定義
function _sudachiNativeLog(message, level) {
    try {
        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendNativeMessage) {
            browser.runtime.sendNativeMessage('con3.furikana', {
                action: 'jsLog',
                message: '[Sudachi] ' + String(message),
                level: level || 'info'
            }).catch(() => {});
        }
    } catch (_) {}
}

_sudachiNativeLog('sudachi-tokenizer.js loaded. SudachiWasm=' + (typeof SudachiWasm !== 'undefined') +
                   ', _initWasmLazy=' + (typeof SudachiWasm !== 'undefined' && typeof SudachiWasm._initWasmLazy === 'function'));

// --- Sudachi インスタンス管理 ---
let sudachiTokenizer = null;
let sudachiInitPromise = null;
let sudachiDictMode = null; // 'embedded' | 'core' | 'full' | null
let sudachiCachedDictKey = null; // 辞書キャッシュ識別用
let sudachiFallbackPromise = null; // initSudachiWithFallback の再入防止

// --- Sudachi POS マッピング ---
// Sudachi の poses[0] は日本語品詞名（名詞、動詞 等）
// background.js の POS_MAP と同じマッピングを使用
const SUDACHI_POS_MAP = {
    '\u540D\u8A5E': 'Noun',       // 名詞
    '\u4EE3\u540D\u8A5E': 'Noun', // 代名詞
    '\u52D5\u8A5E': 'Verb',       // 動詞
    '\u5F62\u5BB9\u8A5E': 'Adjective', // 形容詞
    '\u5F62\u72B6\u8A5E': 'Adjective', // 形状詞
    '\u526F\u8A5E': 'Adverb',     // 副詞
    '\u52A9\u8A5E': 'Particle',   // 助詞
    '\u52A9\u52D5\u8A5E': 'Auxiliary', // 助動詞
    '\u63A5\u7D9A\u8A5E': 'Conjunction', // 接続詞
    '\u9023\u4F53\u8A5E': 'Adnominal',  // 連体詞
    '\u611F\u52D5\u8A5E': 'Interjection', // 感動詞
    '\u8A18\u53F7': 'Symbol',     // 記号
    '\u7A7A\u767D': 'Symbol',     // 空白
    '\u88DC\u52A9\u8A18\u53F7': 'Symbol', // 補助記号
    '\u63A5\u5C3E\u8F9E': 'Noun', // 接尾辞 → Noun として扱う
    '\u63A5\u982D\u8F9E': 'Other', // 接頭辞
};

function mapSudachiPos(posFirst) {
    return SUDACHI_POS_MAP[posFirst] || 'Other';
}

// --- Sudachi トークン → Furikana トークン変換 ---
function convertSudachiTokens(morphemes) {
    const tokens = [];
    for (const m of morphemes) {
        const surface = m.surface;
        const reading = katakanaToHiragana(m.reading_form);
        const pos = mapSudachiPos(m.poses?.[0]);
        tokens.push({
            surface: surface,
            reading: reading,
            pos: pos,
            range: [m.begin, m.end]
        });
    }
    return tokens;
}

// --- 辞書バイト列を native messaging でチャンク読み込み ---
// Safari 拡張の background script では fetch() が safari-web-extension:// URL で失敗するため、
// Swift 側の loadDictFile アクション経由でバンドル内の辞書を読む
async function _loadDictFromNative(filename) {
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB per chunk (reduce round-trips to avoid iOS killing extension)
    let offset = 0;
    let totalSize = 0;
    let chunks = [];

    while (true) {
        const response = await browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'loadDictFile',
            filename: filename,
            offset: offset,
            chunkSize: CHUNK_SIZE
        });

        if (!response || !response.success) {
            throw new Error('loadDictFile failed: ' + (response && response.error || 'unknown'));
        }

        totalSize = response.totalSize;
        const b64 = response.data;
        // base64 デコード
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        chunks.push(bytes);
        offset += bytes.length;

        _sudachiNativeLog('Dict chunk: ' + offset + '/' + totalSize + ' (' + Math.round(offset / totalSize * 100) + '%)');

        if (offset >= totalSize) break;
    }

    // チャンクを結合
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }
    return result;
}

// --- エラーを文字列化するヘルパー ---
function _errToString(e) {
    if (!e) return '(null)';
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try { return JSON.stringify(e); } catch (_) {}
    return String(e);
}

// --- 内蔵辞書で初期化 ---
let sudachiInitFailed = false; // 初期化失敗フラグ（無限リトライ防止）

async function initSudachiEmbedded() {
    if (sudachiTokenizer && sudachiDictMode) {
        return; // 既に初期化済み
    }
    if (sudachiInitFailed) {
        throw new Error('Sudachi init previously failed');
    }
    if (sudachiInitPromise) {
        return sudachiInitPromise;
    }

    sudachiInitPromise = (async () => {
        try {
            _sudachiNativeLog('initSudachiEmbedded: start');

            if (typeof SudachiWasm === 'undefined') {
                _sudachiNativeLog('FAIL: SudachiWasm is undefined', 'error');
                throw new Error('SudachiWasm not loaded');
            }

            // WASM バイナリの遅延初期化（同期コンパイルを初回呼び出しまで延期）
            if (typeof SudachiWasm._initWasmLazy === 'function') {
                _sudachiNativeLog('_initWasmLazy: calling...');
                SudachiWasm._initWasmLazy();
                _sudachiNativeLog('_initWasmLazy: done');
            } else {
                _sudachiNativeLog('_initWasmLazy not found', 'warn');
            }

            // 辞書バイト列を取得（native messaging 経由でチャンク読み込み）
            _sudachiNativeLog('Loading dict via native messaging...');
            const dictBytes = await _loadDictFromNative('sudachi-dict/system.dic');
            _sudachiNativeLog('Dict loaded: ' + dictBytes.byteLength + ' bytes');

            _sudachiNativeLog('Creating SudachiStateless...');
            const tokenizer = new SudachiWasm.SudachiStateless();
            _sudachiNativeLog('SudachiStateless created');

            _sudachiNativeLog('initialize_from_bytes: calling...');
            const initResult = tokenizer.initialize_from_bytes(dictBytes);
            if (initResult && initResult.error) {
                throw initResult;
            }
            _sudachiNativeLog('initialize_from_bytes: done, is_initialized=' + tokenizer.is_initialized());

            if (!tokenizer.is_initialized()) {
                _sudachiNativeLog('FAIL: not initialized after initialize_from_bytes', 'error');
                throw new Error('Sudachi initialization returned but not initialized');
            }

            sudachiTokenizer = tokenizer;
            sudachiDictMode = 'embedded';
            _sudachiNativeLog('initSudachiEmbedded: SUCCESS');
        } catch (e) {
            _sudachiNativeLog('initSudachiEmbedded FAILED: ' + _errToString(e), 'error');
            console.error('[Furikana] Sudachi embedded init failed:', e);
            sudachiTokenizer = null;
            sudachiDictMode = null;
            sudachiInitFailed = true; // 無限リトライ防止
            throw e;
        }
        // 注意: finally で sudachiInitPromise = null にしない
        // 成功時: promise は resolve 済みで、次の呼び出しは先頭の sudachiDictMode チェックで return
        // 失敗時: sudachiInitFailed フラグで即座に reject
    })();

    return sudachiInitPromise;
}

// --- 外部辞書バイト列で初期化 ---
async function initSudachiFromBytes(dictBytes, key) {
    // 既に同じ辞書で初期化済みならスキップ
    if (sudachiTokenizer && sudachiCachedDictKey === key) {
        _sudachiNativeLog('initSudachiFromBytes: already initialized with key=' + key);
        return;
    }

    try {
        _sudachiNativeLog('initSudachiFromBytes: start, bytes=' + dictBytes.byteLength);

        // 既存インスタンスをクリーンアップ
        if (sudachiTokenizer) {
            try { sudachiTokenizer.free(); } catch (_) {}
            sudachiTokenizer = null;
            sudachiDictMode = null;
        }

        // WASM バイナリの遅延初期化
        if (typeof SudachiWasm._initWasmLazy === 'function') {
            SudachiWasm._initWasmLazy();
        }

        const tokenizer = new SudachiWasm.SudachiStateless();
        _sudachiNativeLog('initSudachiFromBytes: initialize_from_bytes calling...');
        const initResult = tokenizer.initialize_from_bytes(dictBytes);
        if (initResult && initResult.error) {
            throw new Error(initResult.error + (initResult.details ? ': ' + initResult.details : ''));
        }

        if (!tokenizer.is_initialized()) {
            throw new Error('Sudachi initialization with downloaded dict failed');
        }

        sudachiTokenizer = tokenizer;
        sudachiCachedDictKey = key;
        _sudachiNativeLog('initSudachiFromBytes: SUCCESS');
    } catch (e) {
        _sudachiNativeLog('initSudachiFromBytes FAILED: ' + _errToString(e), 'error');
        sudachiTokenizer = null;
        sudachiDictMode = null;
        sudachiCachedDictKey = null;
        throw e;
    }
}

// --- 単一テキスト解析 ---
function sudachiTokenize(text) {
    if (!sudachiTokenizer || !sudachiTokenizer.is_initialized()) {
        throw new Error('Sudachi not initialized');
    }

    // TokenizeMode.C = 長単位（固有名詞等を結合）
    const result = sudachiTokenizer.tokenize_raw(text, SudachiWasm.TokenizeMode.C);

    // エラーオブジェクトが返された場合
    if (result && result.error) {
        const errMsg = result.error + (result.details ? ': ' + result.details : '');
        if (isRecoverableError(errMsg)) {
            console.warn('[Furikana] Sudachi recoverable error, reinitializing:', errMsg);
            reinitializeSudachi();
            // リトライ1回
            const retry = sudachiTokenizer.tokenize_raw(text, SudachiWasm.TokenizeMode.C);
            if (retry && retry.error) {
                throw new Error(retry.error);
            }
            return convertSudachiTokens(retry);
        }
        throw new Error(errMsg);
    }

    return convertSudachiTokens(result);
}

// --- バッチ解析 ---
function sudachiTokenizeBatch(texts) {
    if (!sudachiTokenizer || !sudachiTokenizer.is_initialized()) {
        throw new Error('Sudachi not initialized');
    }

    return texts.map(text => {
        try {
            const tokens = sudachiTokenize(text);
            return { tokens, dictSource: 'sudachi' };
        } catch (e) {
            console.warn('[Furikana] Sudachi tokenize failed for text:', e);
            return { tokens: null, dictSource: null };
        }
    });
}

// --- リソース解放 ---
function unloadSudachi() {
    if (sudachiTokenizer) {
        try { sudachiTokenizer.free(); } catch (_) {}
        sudachiTokenizer = null;
    }
    sudachiDictMode = null;
    sudachiCachedDictKey = null;
    sudachiInitPromise = null;
    sudachiFallbackPromise = null;
    sudachiInitFailed = false; // 再試行を許可
    console.log('[Furikana] Sudachi unloaded');
}

// --- 初期化状態確認 ---
function isSudachiReady() {
    return sudachiTokenizer != null && sudachiTokenizer.is_initialized();
}

// --- エラー回復 ---
function isRecoverableError(errMsg) {
    if (!errMsg) return false;
    return errMsg.includes('recursive use') || errMsg.includes('unsafe aliasing');
}

function reinitializeSudachi() {
    console.log('[Furikana] Reinitializing Sudachi...');
    const prevMode = sudachiDictMode;
    try { sudachiTokenizer.free(); } catch (_) {}
    sudachiTokenizer = null;

    // 同期的に再生成（内蔵辞書の場合）
    const tokenizer = new SudachiWasm.SudachiStateless();
    if (prevMode === 'full' && sudachiCachedDictKey) {
        // Full辞書の再読み込みは非同期で重いので、ここでは内蔵にフォールバック
        // バックグラウンドで Full を再読み込みするのは Phase 3
        console.warn('[Furikana] Full dict reinit not supported yet, falling back to embedded');
    }
    // 内蔵辞書で同期的に再初期化はできないので、reset 状態のまま
    // 次回の tokenize 呼び出し時に initSudachiEmbedded が呼ばれる
    sudachiTokenizer = null;
    sudachiDictMode = null;
}

// --- AppGroup 辞書ステータス確認 ---
async function _checkFullDictStatus() {
    const response = await browser.runtime.sendNativeMessage('con3.furikana', {
        action: 'dictionary_status'
    });
    if (response && response.success) {
        return response;
    }
    return null;
}

// --- AppGroup 辞書のチャンク読み込み ---
async function _loadDownloadedDict(dictType, totalSize) {
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB per chunk (reduce round-trips to avoid iOS killing extension)
    let offset = 0;
    let chunks = [];

    while (offset < totalSize) {
        const response = await browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'read_dictionary_chunk',
            dictType: dictType,
            offset: offset,
            chunkSize: CHUNK_SIZE
        });

        if (!response || !response.success) {
            throw new Error('read_dictionary_chunk failed: ' + (response && response.error || 'unknown'));
        }

        const b64 = response.data;
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        chunks.push(bytes);
        offset += bytes.length;

        _sudachiNativeLog('Downloaded dict chunk: ' + offset + '/' + totalSize +
                          ' (' + Math.round(offset / totalSize * 100) + '%)');
    }

    // チャンクを結合
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }
    return result;
}

// --- Full/Core 辞書ストリーミング + 内蔵フォールバック ---
async function initSudachiWithFallback() {
    // 既に初期化済みならスキップ
    if (sudachiTokenizer && sudachiDictMode) {
        return;
    }
    // 再入防止: 同時に複数の初期化が走らないようにする
    if (sudachiFallbackPromise) {
        return sudachiFallbackPromise;
    }

    sudachiFallbackPromise = (async () => {
        try {
            // 1. AppGroup の Core/Full 辞書を試行
            try {
                _sudachiNativeLog('initSudachiWithFallback: checking downloaded dict...');
                const status = await _checkFullDictStatus();
                if (status && status.available) {
                    _sudachiNativeLog('Downloaded dict available: type=' + status.dictType +
                                      ', size=' + status.totalSize);
                    const dictBytes = await _loadDownloadedDict(status.dictType, status.totalSize);
                    const key = status.dictType + '|' + status.totalSize + '|' + (status.updatedAt || '');
                    await initSudachiFromBytes(dictBytes, key);
                    sudachiDictMode = status.dictType;  // 'core' or 'full'
                    _sudachiNativeLog('initSudachiWithFallback: ' + status.dictType + ' dict SUCCESS');
                    return;
                } else {
                    _sudachiNativeLog('No downloaded dict available, using embedded');
                }
            } catch (e) {
                _sudachiNativeLog('Downloaded dict failed: ' + _errToString(e) +
                                  ', falling back to embedded', 'warn');
            }
            // 2. 内蔵 Small 辞書フォールバック
            // 前回の initSudachiEmbedded 失敗フラグをリセット（外部辞書が原因の場合があるため）
            sudachiInitFailed = false;
            sudachiInitPromise = null;
            await initSudachiEmbedded();
        } finally {
            sudachiFallbackPromise = null;
        }
    })();

    return sudachiFallbackPromise;
}

// --- 辞書モード取得 ---
function getSudachiDictMode() {
    return sudachiDictMode;
}

console.log('[Furikana] sudachi-tokenizer.js loaded');
