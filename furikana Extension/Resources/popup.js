// ポップアップのメインスクリプト

// Chrome は action.setIcon の SVG 非対応のため PNG を使う
const FK_IS_CHROMIUM = typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent || '');
const FK_ICON_EXT = FK_IS_CHROMIUM ? 'png' : 'svg';

let isEnabled = false;

// i18n メッセージ取得（未定義キーや i18n 非対応環境ではフォールバックを返す）
function t(key, fallback, substitutions) {
    if (typeof browser !== 'undefined' && browser.i18n && browser.i18n.getMessage) {
        const msg = browser.i18n.getMessage(key, substitutions);
        if (msg) return msg;
    }
    return fallback;
}

// data-i18n / data-i18n-template 属性のテキストを置換（options.js と同方式）
function applyI18n() {
    if (typeof browser === 'undefined' || !browser.i18n || !browser.i18n.getMessage) return;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = browser.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });

    // スライダーラベル用（値表示の span を保持したまま置換）
    document.querySelectorAll('[data-i18n-template]').forEach(el => {
        const key = el.getAttribute('data-i18n-template');
        const msg = browser.i18n.getMessage(key, ['__PLACEHOLDER__']);
        if (!msg) return;
        const span = el.querySelector('span');
        if (!span) return;
        el.innerHTML = msg.replace('__PLACEHOLDER__', span.outerHTML);
    });
}

// 現在のタブを取得
async function getCurrentTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

// --- サイト別表示スタイルの記憶 ---
// スライダー操作時に、アクティブタブのホスト名単位で6値のスナップショットを保存する。
// 上限100件、超過時は最終更新が古いものから削除（LRU）。
const SITE_STYLE_KEYS = ['rubySize', 'rubyGap', 'rubyLineHeight', 'rubyMinHeight', 'rubyBoxPadding', 'rubyBoxMargin'];
const SITE_STYLE_DEFAULTS = { rubySize: 50, rubyGap: 1, rubyLineHeight: 1.3, rubyMinHeight: 12, rubyBoxPadding: 0.15, rubyBoxMargin: 0 };
const SITE_STYLE_LIMIT = 100;
let activeSiteHost = null; // ポップアップを開いた時点のアクティブタブのホスト名

async function resolveActiveSiteHost() {
    try {
        const tab = await getCurrentTab();
        if (!tab || !tab.url) return null;
        const url = new URL(tab.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.hostname || null;
    } catch (_) {
        return null;
    }
}

// 現在の6値スナップショットをアクティブタブのホストに記憶する
// partial: 今回変更された値（それ以外は既存のサイト記憶 → グローバル値の順で補完）
async function saveSiteStyleSnapshot(partial) {
    if (!activeSiteHost) return;
    try {
        const stored = await browser.storage.local.get({ siteStyleOverrides: {} });
        const overrides = stored.siteStyleOverrides || {};
        const prev = (overrides[activeSiteHost] && overrides[activeSiteHost].v) || {};
        const v = {};
        for (const key of SITE_STYLE_KEYS) {
            // 補完順: 今回の変更 → 既存のサイト記憶 → リセット初期値
            // （記憶のないサイトはリセット初期値で表示されているため、それをそのまま記憶する）
            v[key] = (partial[key] !== undefined) ? partial[key]
                   : (prev[key] !== undefined) ? prev[key]
                   : SITE_STYLE_DEFAULTS[key];
        }
        overrides[activeSiteHost] = { v: v, t: Date.now() };

        // 上限超過: 最終更新が古いホストから削除
        const hosts = Object.keys(overrides);
        if (hosts.length > SITE_STYLE_LIMIT) {
            hosts.sort((a, b) => ((overrides[a] && overrides[a].t) || 0) - ((overrides[b] && overrides[b].t) || 0));
            for (let i = 0; i < hosts.length - SITE_STYLE_LIMIT; i++) {
                delete overrides[hosts[i]];
            }
        }

        await browser.storage.local.set({ siteStyleOverrides: overrides });
    } catch (e) {
        console.warn('[Furikana] Site style save failed:', e);
    }
}

// ふりがなのトグル
async function toggleFurigana() {
    const tab = await getCurrentTab();

    if (!tab || !tab.id) {
        updateStatus(t('popup_status_no_tab', 'タブが見つかりません'), 'error');
        return;
    }

    updateStatus(t('popup_status_processing', '処理中...'), 'processing');

    try {
        // content.jsにメッセージを送信
        const response = await browser.tabs.sendMessage(tab.id, {
            action: 'toggleFurigana'
        });

        if (response && response.success) {
            isEnabled = response.enabled;
            updateUI();
            // ツールバーアイコンを更新
            browser.action.setIcon({
                tabId: tab.id,
                path: isEnabled ? `images/toolbar-icon_on.${FK_ICON_EXT}` : `images/toolbar-icon_off.${FK_ICON_EXT}`
            }).catch(() => {});
            updateStatus(
                isEnabled
                    ? t('popup_status_shown', 'ふりがなを表示しました')
                    : t('popup_status_hidden', 'ふりがなを非表示にしました'),
                'success'
            );
        } else {
            updateStatus(t('popup_status_failed', '処理に失敗しました'), 'error');
        }
    } catch (error) {
        console.error('Toggle failed:', error);
        updateStatus(t('popup_status_error', 'エラーが発生しました'), 'error');
    }
}

// UIの更新
function updateUI() {
    const toggleButton = document.getElementById('toggle-furigana');
    const toggleText = document.getElementById('toggle-text');

    toggleButton.setAttribute('aria-pressed', String(isEnabled));
    if (isEnabled) {
        toggleButton.classList.add('active');
        toggleText.textContent = t('popup_toggle_hide', 'ふりがなを非表示');
    } else {
        toggleButton.classList.remove('active');
        toggleText.textContent = t('popup_toggle_show', 'ふりがなを表示');
    }
}

// ステータステキストの更新
let statusResetTimer = null;
function updateStatus(message, type = 'info') {
    const statusText = document.getElementById('status-text');
    statusText.textContent = message;

    // 前回のリセットタイマーを解除（連続操作時に古いタイマーが表示を上書きするのを防ぐ）
    if (statusResetTimer) {
        clearTimeout(statusResetTimer);
        statusResetTimer = null;
    }

    // 色を変更
    switch (type) {
        case 'success':
            statusText.style.color = '#34c759';
            break;
        case 'error':
            statusText.style.color = '#ff3b30';
            break;
        case 'processing':
            statusText.style.color = '#ff9500';
            break;
        default:
            statusText.style.color = '';
    }

    // 成功/エラーメッセージは2秒後に消す
    if (type === 'success' || type === 'error') {
        statusResetTimer = setTimeout(() => {
            statusResetTimer = null;
            updateStatus(t('popup_status_ready', '準備完了'), 'info');
        }, 2000);
    }
}

// Sudachi 辞書ロード進捗（popup 表示中のみ 500ms 間隔で background にポーリング。
// storage 書き込みやブロードキャストを使わないため、content.js や AppGroup 同期に影響しない）
let dictProgressTimer = null;
let dictProgressShown = false;

async function pollSudachiProgress() {
    try {
        const res = await browser.runtime.sendMessage({ action: 'getSudachiStatus' });
        const p = res && res.loadProgress;
        if (p && p.loading && p.totalSize > 0) {
            dictProgressShown = true;
            // トグル操作直後の成功/エラー表示（2秒）中は上書きしない
            if (!statusResetTimer) {
                const pct = Math.floor(p.offset * 100 / p.totalSize);
                updateStatus(
                    t('popup_status_dict_loading', `辞書読み込み中… ${pct}%`, [String(pct)]),
                    'processing'
                );
            }
        } else if (dictProgressShown) {
            // ロード中表示 → 完了/失敗に遷移
            dictProgressShown = false;
            if (res && res.ready) {
                updateStatus(t('popup_status_dict_loaded', '辞書の読み込みが完了しました'), 'success');
            } else if (!statusResetTimer) {
                updateStatus(t('popup_status_ready', '準備完了'), 'info');
            }
        }
        // ready になったら以降ロードは発生しないためポーリング停止
        if (res && res.ready && !dictProgressShown) {
            stopSudachiProgressPolling();
        }
    } catch (_) {
        // background 未起動などの応答なしは無視（次のポーリングで再試行）
    }
}

function startSudachiProgressPolling() {
    if (dictProgressTimer) return;
    pollSudachiProgress();
    dictProgressTimer = setInterval(pollSudachiProgress, 500);
}

function stopSudachiProgressPolling() {
    if (dictProgressTimer) {
        clearInterval(dictProgressTimer);
        dictProgressTimer = null;
    }
}

// 設定画面を開く（App Group同期を先行させてから開く）
async function openSettings() {
    try {
        await browser.runtime.sendMessage({ action: 'syncAppGroup' });
    } catch (e) { /* 同期失敗時はそのまま開く */ }
    browser.runtime.openOptionsPage();
}

// 現在の状態を取得
async function fetchCurrentStatus() {
    const tab = await getCurrentTab();

    if (!tab || !tab.id) {
        return;
    }

    try {
        // content.jsに現在の状態を問い合わせる
        const response = await browser.tabs.sendMessage(tab.id, {
            action: 'getStatus'
        });

        if (response && response.success) {
            isEnabled = response.enabled;
            updateUI();
            console.log('[Furikana] Current status:', isEnabled);
        }
    } catch (error) {
        console.error('[Furikana] Failed to fetch status:', error);
        // エラーの場合はデフォルト状態を維持
    }
}

// ルビサイズをストレージに保存し、現在のタブに即時反映
let rubySizeSaveTimer = null;
async function onRubySizeInput() {
    const val = parseInt(document.getElementById('popup-ruby-size').value, 10);
    document.getElementById('popup-ruby-size-value').textContent = val;

    if (rubySizeSaveTimer) clearTimeout(rubySizeSaveTimer);
    rubySizeSaveTimer = setTimeout(async () => {
        rubySizeSaveTimer = null;
        await browser.storage.local.set({ rubySize: val });
        saveSiteStyleSnapshot({ rubySize: val });
    }, 150);
}

// ルビ行間隔をストレージに保存
let rubyGapSaveTimer = null;
async function onRubyGapInput() {
    const val = parseInt(document.getElementById('popup-ruby-gap').value, 10);
    document.getElementById('popup-ruby-gap-value').textContent = val;

    if (rubyGapSaveTimer) clearTimeout(rubyGapSaveTimer);
    rubyGapSaveTimer = setTimeout(async () => {
        rubyGapSaveTimer = null;
        await browser.storage.local.set({ rubyGap: val });
        saveSiteStyleSnapshot({ rubyGap: val });
    }, 150);
}

// 行の高さをストレージに保存
let lineHeightSaveTimer = null;
async function onLineHeightInput() {
    const val = parseFloat(document.getElementById('popup-line-height').value);
    document.getElementById('popup-line-height-value').textContent = val.toFixed(2);

    if (lineHeightSaveTimer) clearTimeout(lineHeightSaveTimer);
    lineHeightSaveTimer = setTimeout(async () => {
        lineHeightSaveTimer = null;
        await browser.storage.local.set({ rubyLineHeight: val });
        saveSiteStyleSnapshot({ rubyLineHeight: val });
    }, 150);
}

// デバウンス中の保存を即時確定する
// （スライダー操作直後にポップアップが閉じると setTimeout が発火せず値が失われるため、
//   change イベント＝ドラッグ確定時と pagehide で必ずフラッシュする）
function flushPendingSaves() {
    const pending = {};
    if (rubySizeSaveTimer) {
        clearTimeout(rubySizeSaveTimer);
        rubySizeSaveTimer = null;
        pending.rubySize = parseInt(document.getElementById('popup-ruby-size').value, 10);
    }
    if (rubyGapSaveTimer) {
        clearTimeout(rubyGapSaveTimer);
        rubyGapSaveTimer = null;
        pending.rubyGap = parseInt(document.getElementById('popup-ruby-gap').value, 10);
    }
    if (lineHeightSaveTimer) {
        clearTimeout(lineHeightSaveTimer);
        lineHeightSaveTimer = null;
        pending.rubyLineHeight = parseFloat(document.getElementById('popup-line-height').value);
    }
    if (Object.keys(pending).length > 0) {
        browser.storage.local.set(pending).catch(() => {});
        saveSiteStyleSnapshot(pending);
    }
}

// 逆転モードチェックボックス変更時
async function onReverseRubyChange() {
    const checked = document.getElementById('popup-reverse-ruby').checked;
    await browser.storage.local.set({ reverseRuby: checked });
}

// 自動ふりがな表示チェックボックス変更時
async function onAutoEnableChange() {
    const checked = document.getElementById('popup-auto-enable').checked;
    await browser.storage.local.set({ autoEnable: checked });

    // チェックされた直後に現在のタブでふりがなを有効化
    if (checked && !isEnabled) {
        await toggleFurigana();
    }
}

// ポップアップ側の設定UIを読み込み（App Group から同期してから読む）
async function loadPopupSettings() {
    try {
        await browser.runtime.sendMessage({ action: 'syncAppGroup' });
    } catch (e) { /* 同期失敗時はスキップ */ }
    const s = await browser.storage.local.get({ autoEnable: false, reverseRuby: false, siteStyleOverrides: null });

    // スライダー初期値: サイト別記憶があればその値、なければリセット初期値
    // （ページ表示と同じ決まり方。グローバル値は使わない）
    activeSiteHost = await resolveActiveSiteHost();
    const siteEntry = activeSiteHost && s.siteStyleOverrides && s.siteStyleOverrides[activeSiteHost];
    const sv = (siteEntry && siteEntry.v) || {};
    s.rubySize = (sv.rubySize !== undefined) ? sv.rubySize : SITE_STYLE_DEFAULTS.rubySize;
    s.rubyGap = (sv.rubyGap !== undefined) ? sv.rubyGap : SITE_STYLE_DEFAULTS.rubyGap;
    s.rubyLineHeight = (sv.rubyLineHeight !== undefined) ? sv.rubyLineHeight : SITE_STYLE_DEFAULTS.rubyLineHeight;

    document.getElementById('popup-ruby-size').value = s.rubySize;
    document.getElementById('popup-ruby-size-value').textContent = s.rubySize;
    document.getElementById('popup-ruby-gap').value = s.rubyGap;
    document.getElementById('popup-ruby-gap-value').textContent = s.rubyGap;
    document.getElementById('popup-line-height').value = s.rubyLineHeight;
    document.getElementById('popup-line-height-value').textContent = parseFloat(s.rubyLineHeight).toFixed(2);
    document.getElementById('popup-reverse-ruby').checked = s.reverseRuby;
    document.getElementById('popup-auto-enable').checked = s.autoEnable;
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', async () => {
    // i18n 適用（ロケールに応じたテキスト置換）
    applyI18n();

    // トグルボタン
    document.getElementById('toggle-furigana').addEventListener('click', toggleFurigana);

    // 設定ボタン
    document.getElementById('open-settings').addEventListener('click', openSettings);

    // ルビサイズスライダー
    const rubySizeSlider = document.getElementById('popup-ruby-size');
    rubySizeSlider.addEventListener('input', onRubySizeInput);
    rubySizeSlider.addEventListener('change', flushPendingSaves);

    // ルビ行間隔スライダー
    const rubyGapSlider = document.getElementById('popup-ruby-gap');
    rubyGapSlider.addEventListener('input', onRubyGapInput);
    rubyGapSlider.addEventListener('change', flushPendingSaves);

    // 行の高さスライダー
    const lineHeightSlider = document.getElementById('popup-line-height');
    lineHeightSlider.addEventListener('input', onLineHeightInput);
    lineHeightSlider.addEventListener('change', flushPendingSaves);

    // ポップアップが閉じる直前に未保存の値をフラッシュ
    window.addEventListener('pagehide', flushPendingSaves);

    // 逆転モードチェックボックス
    document.getElementById('popup-reverse-ruby').addEventListener('change', onReverseRubyChange);

    // 自動ふりがなチェックボックス
    document.getElementById('popup-auto-enable').addEventListener('change', onAutoEnableChange);

    // 設定を読み込み
    await loadPopupSettings();

    // 現在の状態を取得してUIを更新
    await fetchCurrentStatus();

    // Sudachi 辞書選択時のみ、辞書ロード進捗の表示を開始
    try {
        const { dictType } = await browser.storage.local.get({ dictType: 'system' });
        if (dictType === 'sudachi') startSudachiProgressPolling();
    } catch (_) { /* 取得失敗時は進捗表示なしで続行 */ }
});

// ポップアップが閉じるときにポーリングを停止
window.addEventListener('pagehide', stopSudachiProgressPolling);
