// ポップアップのメインスクリプト

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
                path: isEnabled ? 'images/toolbar-icon_on.svg' : 'images/toolbar-icon_off.svg'
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
    }, 150);
}

// デバウンス中の保存を即時確定する
// （スライダー操作直後にポップアップが閉じると setTimeout が発火せず値が失われるため、
//   change イベント＝ドラッグ確定時と pagehide で必ずフラッシュする）
function flushPendingSaves() {
    if (rubySizeSaveTimer) {
        clearTimeout(rubySizeSaveTimer);
        rubySizeSaveTimer = null;
        const val = parseInt(document.getElementById('popup-ruby-size').value, 10);
        browser.storage.local.set({ rubySize: val }).catch(() => {});
    }
    if (rubyGapSaveTimer) {
        clearTimeout(rubyGapSaveTimer);
        rubyGapSaveTimer = null;
        const val = parseInt(document.getElementById('popup-ruby-gap').value, 10);
        browser.storage.local.set({ rubyGap: val }).catch(() => {});
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
    const s = await browser.storage.local.get({ rubySize: 50, rubyGap: 1, autoEnable: false, reverseRuby: false });
    document.getElementById('popup-ruby-size').value = s.rubySize;
    document.getElementById('popup-ruby-size-value').textContent = s.rubySize;
    document.getElementById('popup-ruby-gap').value = s.rubyGap;
    document.getElementById('popup-ruby-gap-value').textContent = s.rubyGap;
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
});
