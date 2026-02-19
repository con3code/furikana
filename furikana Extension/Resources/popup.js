// ポップアップのメインスクリプト

let isEnabled = false;

// 現在のタブを取得
async function getCurrentTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

// ふりがなのトグル
async function toggleFurigana() {
    const tab = await getCurrentTab();

    if (!tab || !tab.id) {
        updateStatus('タブが見つかりません', 'error');
        return;
    }

    updateStatus('処理中...', 'processing');

    try {
        // content.jsにメッセージを送信
        const response = await browser.tabs.sendMessage(tab.id, {
            action: 'toggleFurigana'
        });

        if (response && response.success) {
            isEnabled = response.enabled;
            updateUI();
            updateStatus(isEnabled ? 'ふりがなを表示しました' : 'ふりがなを非表示にしました', 'success');
        } else {
            updateStatus('処理に失敗しました', 'error');
        }
    } catch (error) {
        console.error('Toggle failed:', error);
        updateStatus('エラーが発生しました', 'error');
    }
}

// UIの更新
function updateUI() {
    const toggleButton = document.getElementById('toggle-furigana');
    const toggleText = document.getElementById('toggle-text');

    if (isEnabled) {
        toggleButton.classList.add('active');
        toggleText.textContent = 'ふりがなを非表示';
    } else {
        toggleButton.classList.remove('active');
        toggleText.textContent = 'ふりがなを表示';
    }
}

// ステータステキストの更新
function updateStatus(message, type = 'info') {
    const statusText = document.getElementById('status-text');
    statusText.textContent = message;

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
            statusText.style.color = '#6e6e73';
    }

    // 成功/エラーメッセージは2秒後に消す
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            updateStatus('準備完了', 'info');
        }, 2000);
    }
}

// 設定画面を開く
function openSettings() {
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
        await browser.storage.local.set({ rubySize: val });
    }, 150);
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
    const s = await browser.storage.local.get({ rubySize: 50, autoEnable: false, reverseRuby: false });
    document.getElementById('popup-ruby-size').value = s.rubySize;
    document.getElementById('popup-ruby-size-value').textContent = s.rubySize;
    document.getElementById('popup-reverse-ruby').checked = s.reverseRuby;
    document.getElementById('popup-auto-enable').checked = s.autoEnable;
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', async () => {
    // トグルボタン
    document.getElementById('toggle-furigana').addEventListener('click', toggleFurigana);

    // 設定ボタン
    document.getElementById('open-settings').addEventListener('click', openSettings);

    // ルビサイズスライダー
    document.getElementById('popup-ruby-size').addEventListener('input', onRubySizeInput);

    // 逆転モードチェックボックス
    document.getElementById('popup-reverse-ruby').addEventListener('change', onReverseRubyChange);

    // 自動ふりがなチェックボックス
    document.getElementById('popup-auto-enable').addEventListener('change', onAutoEnableChange);

    // 設定を読み込み
    await loadPopupSettings();

    // 現在の状態を取得してUIを更新
    await fetchCurrentStatus();
});
