// Sudachi WASM adapter (ext-helper.js)
console.log('[Furikana] ext-helper.js loading...');

function _sudachiNativeLog(message, level) {
    try {
        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendNativeMessage) {
            browser.runtime.sendNativeMessage('con3.furikana', {
                action: 'jsLog',
                message: '[Sudachi] ' + String(message),
                level: level || 'info'
            }).catch(function() {});
        }
    } catch (_) {}
}

var sudachiTokenizer = null;
var sudachiInitPromise = null;
var sudachiDictMode = null;
var sudachiCachedDictKey = null;
var sudachiFallbackPromise = null;
var sudachiInitFailed = false;

var SUDACHI_POS_MAP = {
    '\u540D\u8A5E': 'Noun',
    '\u4EE3\u540D\u8A5E': 'Noun',
    '\u52D5\u8A5E': 'Verb',
    '\u5F62\u5BB9\u8A5E': 'Adjective',
    '\u5F62\u72B6\u8A5E': 'Adjective',
    '\u526F\u8A5E': 'Adverb',
    '\u52A9\u8A5E': 'Particle',
    '\u52A9\u52D5\u8A5E': 'Auxiliary',
    '\u63A5\u7D9A\u8A5E': 'Conjunction',
    '\u9023\u4F53\u8A5E': 'Adnominal',
    '\u611F\u52D5\u8A5E': 'Interjection',
    '\u8A18\u53F7': 'Symbol',
    '\u7A7A\u767D': 'Symbol',
    '\u88DC\u52A9\u8A18\u53F7': 'Symbol',
    '\u63A5\u5C3E\u8F9E': 'Noun',
    '\u63A5\u982D\u8F9E': 'Other'
};

function mapSudachiPos(posFirst) {
    return SUDACHI_POS_MAP[posFirst] || 'Other';
}

function _composeNumberReading(numStr) {
    var half = numStr.replace(/[\uFF10-\uFF19]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30);
    });
    var n = parseInt(half, 10);
    if (isNaN(n) || n < 0 || n > 99999999) return null;
    if (n <= 9) return null;
    var ONES = ['', '\u30A4\u30C1', '\u30CB', '\u30B5\u30F3', '\u30E8\u30F3', '\u30B4', '\u30ED\u30AF', '\u30CA\u30CA', '\u30CF\u30C1', '\u30AD\u30E5\u30A6'];
    function compose(num) {
        if (num === 0) return '';
        var r = '';
        if (num >= 10000000) { var d7 = Math.floor(num / 10000000); r += (d7 === 1 ? '' : ONES[d7]) + '\u30BB\u30F3\u30DE\u30F3'; num %= 10000000; if (num === 0) return r; }
        if (num >= 1000000) { var d6 = Math.floor(num / 1000000); if (d6 === 3) r += '\u30B5\u30F3\u30D3\u30E3\u30AF\u30DE\u30F3'; else if (d6 === 6) r += '\u30ED\u30C3\u30D4\u30E3\u30AF\u30DE\u30F3'; else if (d6 === 8) r += '\u30CF\u30C3\u30D4\u30E3\u30AF\u30DE\u30F3'; else r += (d6 === 1 ? '' : ONES[d6]) + '\u30D2\u30E3\u30AF\u30DE\u30F3'; num %= 1000000; if (num === 0) return r; }
        if (num >= 100000) { var d5 = Math.floor(num / 100000); r += (d5 === 1 ? '' : ONES[d5]) + '\u30B8\u30E5\u30A6\u30DE\u30F3'; num %= 100000; if (num === 0) return r; }
        if (num >= 10000) { var d4 = Math.floor(num / 10000); r += (d4 === 1 ? '' : ONES[d4]) + '\u30DE\u30F3'; num %= 10000; if (num === 0) return r; }
        if (num >= 1000) { var d3 = Math.floor(num / 1000); if (d3 === 3) r += '\u30B5\u30F3\u30BC\u30F3'; else if (d3 === 8) r += '\u30CF\u30C3\u30BB\u30F3'; else r += (d3 === 1 ? '' : ONES[d3]) + '\u30BB\u30F3'; num %= 1000; }
        if (num >= 100) { var d2 = Math.floor(num / 100); if (d2 === 3) r += '\u30B5\u30F3\u30D3\u30E3\u30AF'; else if (d2 === 6) r += '\u30ED\u30C3\u30D4\u30E3\u30AF'; else if (d2 === 8) r += '\u30CF\u30C3\u30D4\u30E3\u30AF'; else r += (d2 === 1 ? '' : ONES[d2]) + '\u30D2\u30E3\u30AF'; num %= 100; }
        if (num >= 10) { var d1 = Math.floor(num / 10); r += (d1 === 1 ? '' : ONES[d1]) + '\u30B8\u30E5\u30A6'; num %= 10; }
        if (num > 0) { r += ONES[num]; }
        return r;
    }
    return compose(n);
}

var _DIGIT_VARIANTS = {
    '0': ['\u30BC\u30ED', '\u30DE\u30EB', '\u30EC\u30A4'], '1': ['\u30A4\u30C1', '\u30D2\u30C8', '\u30D2'], '2': ['\u30D5\u30BF', '\u30CB', '\u30D5'],
    '3': ['\u30B5\u30F3', '\u30DF'], '4': ['\u30E8\u30F3', '\u30B7', '\u30E8'], '5': ['\u30A4\u30C4', '\u30B4'],
    '6': ['\u30E0\u30A4', '\u30ED\u30AF', '\u30E0'], '7': ['\u30B7\u30C1', '\u30CA\u30CE', '\u30CA\u30CA'], '8': ['\u30CF\u30C1', '\u30E4', '\u30E8\u30A6'],
    '9': ['\u30AD\u30E5\u30A6', '\u30AF', '\u30B3\u30B3\u30CE']
};
(function() { for (var i = 0; i <= 9; i++) { _DIGIT_VARIANTS[String.fromCharCode(0xFF10 + i)] = _DIGIT_VARIANTS[String(i)]; } })();

function _findDigitReadingEnd(digitChars, readingStr, pos) {
    if (digitChars.length === 0) return pos;
    var ch = digitChars[0];
    var variants = _DIGIT_VARIANTS[ch];
    if (!variants) return -1;
    for (var vi = 0; vi < variants.length; vi++) {
        if (readingStr.indexOf(variants[vi], pos) === pos) {
            var result = _findDigitReadingEnd(digitChars.slice(1), readingStr, pos + variants[vi].length);
            if (result !== -1) return result;
        }
    }
    return -1;
}

function _fixNumberReading(surface, reading) {
    var segments = [];
    var re = /([0-9\uFF10-\uFF19]+)|([^0-9\uFF10-\uFF19]+)/g;
    var mat;
    while ((mat = re.exec(surface)) !== null) {
        if (mat[1]) segments.push({ type: 'digit', text: mat[1] });
        else segments.push({ type: 'other', text: mat[2] });
    }
    var hasMultiDigit = false;
    for (var si = 0; si < segments.length; si++) { if (segments[si].type === 'digit' && segments[si].text.length >= 2) { hasMultiDigit = true; break; } }
    if (!hasMultiDigit) return reading;
    var readPos = 0;
    var out = '';
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (seg.type === 'digit') {
            var digitChars = seg.text.split('');
            if (seg.text.length >= 2) {
                var endPos = _findDigitReadingEnd(digitChars, reading, readPos);
                var composed = _composeNumberReading(seg.text);
                if (endPos !== -1 && composed) { out += composed; readPos = endPos; }
                else if (endPos !== -1) { out += reading.substring(readPos, endPos); readPos = endPos; }
                else { return reading; }
            } else {
                var endPos2 = _findDigitReadingEnd(digitChars, reading, readPos);
                if (endPos2 !== -1) { out += reading.substring(readPos, endPos2); readPos = endPos2; }
                else { return reading; }
            }
        } else {
            var nextDigitSeg = null;
            for (var j = i + 1; j < segments.length; j++) { if (segments[j].type === 'digit') { nextDigitSeg = segments[j]; break; } }
            if (!nextDigitSeg) { out += reading.substring(readPos); readPos = reading.length; }
            else {
                var nextDigitChars = nextDigitSeg.text.split('');
                var foundPos = -1;
                for (var p = readPos; p < reading.length; p++) { if (_findDigitReadingEnd(nextDigitChars, reading, p) !== -1) { foundPos = p; break; } }
                if (foundPos !== -1) { out += reading.substring(readPos, foundPos); readPos = foundPos; }
                else { return reading; }
            }
        }
    }
    return out;
}

function convertSudachiTokens(morphemes) {
    var tokens = [];
    for (var mi = 0; mi < morphemes.length; mi++) {
        var m = morphemes[mi];
        var surface = m.surface;
        var rawReading = m.reading_form;
        var fixedReading = /[0-9\uFF10-\uFF19]{2,}/.test(surface) ? _fixNumberReading(surface, rawReading) : rawReading;
        var reading = katakanaToHiragana(fixedReading);
        var poses = m.poses;
        var pos = mapSudachiPos(poses && poses.length > 0 ? poses[0] : '');
        tokens.push({ surface: surface, reading: reading, pos: pos, range: [m.begin, m.end] });
    }
    return tokens;
}

function _errToString(e) {
    if (!e) return '(null)';
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try { return JSON.stringify(e); } catch (_) {}
    return String(e);
}

function _loadDictFromNative(filename) {
    var CHUNK_SIZE = 16 * 1024 * 1024;
    var offset = 0;
    var totalSize = 0;
    var chunks = [];
    function loadNext() {
        return browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'loadDictFile', filename: filename, offset: offset, chunkSize: CHUNK_SIZE
        }).then(function(response) {
            if (!response || !response.success) {
                throw new Error('loadDictFile failed: ' + (response ? response.error : 'unknown'));
            }
            totalSize = response.totalSize;
            var binStr = atob(response.data);
            var bytes = new Uint8Array(binStr.length);
            for (var i = 0; i < binStr.length; i++) { bytes[i] = binStr.charCodeAt(i); }
            chunks.push(bytes);
            offset += bytes.length;
            _sudachiNativeLog('Dict chunk: ' + offset + '/' + totalSize);
            if (offset >= totalSize) {
                var result = new Uint8Array(totalSize);
                var pos = 0;
                for (var ci = 0; ci < chunks.length; ci++) { result.set(chunks[ci], pos); pos += chunks[ci].length; }
                return result;
            }
            return loadNext();
        });
    }
    return loadNext();
}

function initSudachiEmbedded() {
    if (sudachiTokenizer && sudachiDictMode) return Promise.resolve();
    if (sudachiInitFailed) return Promise.reject(new Error('Sudachi init previously failed'));
    if (sudachiInitPromise) return sudachiInitPromise;
    sudachiInitPromise = Promise.resolve().then(function() {
        _sudachiNativeLog('initSudachiEmbedded: start');
        if (typeof SudachiWasm === 'undefined') { throw new Error('SudachiWasm not loaded'); }
        if (typeof SudachiWasm._initWasmLazy === 'function') { SudachiWasm._initWasmLazy(); }
        _sudachiNativeLog('Loading dict via native messaging...');
        return _loadDictFromNative('sudachi-dict/system.dic');
    }).then(function(dictBytes) {
        _sudachiNativeLog('Dict loaded: ' + dictBytes.byteLength + ' bytes');
        var tokenizer = new SudachiWasm.SudachiStateless();
        var initResult = tokenizer.initialize_from_bytes(dictBytes);
        if (initResult && initResult.error) throw initResult;
        if (!tokenizer.is_initialized()) throw new Error('not initialized');
        sudachiTokenizer = tokenizer;
        sudachiDictMode = 'embedded';
        _sudachiNativeLog('initSudachiEmbedded: SUCCESS');
    }).catch(function(e) {
        _sudachiNativeLog('initSudachiEmbedded FAILED: ' + _errToString(e), 'error');
        sudachiTokenizer = null;
        sudachiDictMode = null;
        sudachiInitFailed = true;
        throw e;
    });
    return sudachiInitPromise;
}

function initSudachiFromBytes(dictBytes, key) {
    if (sudachiTokenizer && sudachiCachedDictKey === key) return Promise.resolve();
    return Promise.resolve().then(function() {
        if (sudachiTokenizer) { try { sudachiTokenizer.free(); } catch (_) {} sudachiTokenizer = null; sudachiDictMode = null; }
        if (typeof SudachiWasm._initWasmLazy === 'function') SudachiWasm._initWasmLazy();
        var tokenizer = new SudachiWasm.SudachiStateless();
        var initResult = tokenizer.initialize_from_bytes(dictBytes);
        if (initResult && initResult.error) throw new Error(initResult.error);
        if (!tokenizer.is_initialized()) throw new Error('not initialized');
        sudachiTokenizer = tokenizer;
        sudachiCachedDictKey = key;
    }).catch(function(e) {
        sudachiTokenizer = null;
        sudachiDictMode = null;
        sudachiCachedDictKey = null;
        throw e;
    });
}

function isRecoverableError(errMsg) {
    if (!errMsg) return false;
    return errMsg.indexOf('recursive use') !== -1 || errMsg.indexOf('unsafe aliasing') !== -1;
}

function reinitializeSudachi() {
    try { sudachiTokenizer.free(); } catch (_) {}
    sudachiTokenizer = null;
    sudachiDictMode = null;
}

function sudachiTokenize(text) {
    if (!sudachiTokenizer || !sudachiTokenizer.is_initialized()) throw new Error('Sudachi not initialized');
    var result = sudachiTokenizer.tokenize_raw(text, SudachiWasm.TokenizeMode.C);
    if (result && result.error) {
        var errMsg = result.error + (result.details ? ': ' + result.details : '');
        if (isRecoverableError(errMsg)) {
            reinitializeSudachi();
            var retry = sudachiTokenizer.tokenize_raw(text, SudachiWasm.TokenizeMode.C);
            if (retry && retry.error) throw new Error(retry.error);
            return convertSudachiTokens(retry);
        }
        throw new Error(errMsg);
    }
    return convertSudachiTokens(result);
}

function sudachiTokenizeBatch(texts) {
    if (!sudachiTokenizer || !sudachiTokenizer.is_initialized()) throw new Error('Sudachi not initialized');
    var results = [];
    for (var i = 0; i < texts.length; i++) {
        try { results.push({ tokens: sudachiTokenize(texts[i]), dictSource: 'sudachi' }); }
        catch (e) { results.push({ tokens: null, dictSource: null }); }
    }
    return results;
}

function unloadSudachi() {
    if (sudachiTokenizer) { try { sudachiTokenizer.free(); } catch (_) {} sudachiTokenizer = null; }
    sudachiDictMode = null;
    sudachiCachedDictKey = null;
    sudachiInitPromise = null;
    sudachiFallbackPromise = null;
    sudachiInitFailed = false;
    console.log('[Furikana] Sudachi unloaded');
}

function isSudachiReady() { return sudachiTokenizer != null && sudachiTokenizer.is_initialized(); }
function getSudachiDictMode() { return sudachiDictMode; }

function _checkFullDictStatus() {
    return browser.runtime.sendNativeMessage('con3.furikana', {
        action: 'dictionary_status'
    }).then(function(r) { return (r && r.success) ? r : null; });
}

function _loadDownloadedDict(dictType, totalSize) {
    var CHUNK_SIZE = 16 * 1024 * 1024;
    var offset = 0;
    var chunks = [];
    function loadNext() {
        return browser.runtime.sendNativeMessage('con3.furikana', {
            action: 'read_dictionary_chunk', dictType: dictType, offset: offset, chunkSize: CHUNK_SIZE
        }).then(function(response) {
            if (!response || !response.success) throw new Error('read_dictionary_chunk failed');
            var binStr = atob(response.data);
            var bytes = new Uint8Array(binStr.length);
            for (var i = 0; i < binStr.length; i++) { bytes[i] = binStr.charCodeAt(i); }
            chunks.push(bytes);
            offset += bytes.length;
            if (offset >= totalSize) {
                var result = new Uint8Array(totalSize);
                var pos = 0;
                for (var ci = 0; ci < chunks.length; ci++) { result.set(chunks[ci], pos); pos += chunks[ci].length; }
                return result;
            }
            return loadNext();
        });
    }
    return loadNext();
}

function initSudachiWithFallback() {
    if (sudachiTokenizer && sudachiDictMode) return Promise.resolve();
    if (sudachiFallbackPromise) return sudachiFallbackPromise;
    sudachiFallbackPromise = _checkFullDictStatus().then(function(status) {
        if (status && status.available) {
            _sudachiNativeLog('Downloaded dict: type=' + status.dictType);
            return _loadDownloadedDict(status.dictType, status.totalSize).then(function(dictBytes) {
                var key = status.dictType + '|' + status.totalSize;
                return initSudachiFromBytes(dictBytes, key).then(function() {
                    sudachiDictMode = status.dictType;
                    _sudachiNativeLog('initSudachiWithFallback: ' + status.dictType + ' SUCCESS');
                });
            });
        }
        return Promise.reject(new Error('no downloaded dict'));
    }).catch(function(e) {
        _sudachiNativeLog('Fallback to embedded: ' + _errToString(e), 'warn');
        sudachiInitFailed = false;
        sudachiInitPromise = null;
        return initSudachiEmbedded();
    }).then(function() {
        sudachiFallbackPromise = null;
    }, function(e) {
        sudachiFallbackPromise = null;
        throw e;
    });
    return sudachiFallbackPromise;
}

function _extHelperLoaded() { return true; }
console.log('[Furikana] ext-helper.js fully loaded');
