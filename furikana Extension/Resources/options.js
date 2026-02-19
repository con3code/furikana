// 設定画面のメインスクリプト

const DEFAULTS = {
    readingType: 'hiragana',
    unitType: 'long',
    autoEnable: false,
    readingRules: true,
    reverseRuby: false,
    dictType: 'system',
    rubySize: 50,
    rubyGap: 1,
    rubyLineHeight: 1.3,
    rubyMinHeight: 12,
    rubyBoxPadding: 0,
    rubyBoxMargin: 0
};

const SLIDERS = ['ruby-size', 'ruby-gap', 'ruby-line-height', 'ruby-min-height', 'ruby-box-padding', 'ruby-box-margin'];
let sliderSaveTimer = null;

// プレビューを更新
function updatePreview() {
    const preview = document.querySelector('.ruby-preview');
    const vals = {};
    for (const id of SLIDERS) {
        vals[id] = document.getElementById(id).value;
    }
    const reverseRuby = document.getElementById('reverse-ruby').checked;

    preview.style.setProperty('--ruby-size', vals['ruby-size'] + '%');
    preview.style.setProperty('--ruby-gap', vals['ruby-gap'] + 'px');
    preview.style.setProperty('--ruby-line-height', vals['ruby-line-height']);
    preview.style.setProperty('--ruby-min-height', vals['ruby-min-height'] + 'px');
    preview.style.setProperty('--ruby-box-padding', vals['ruby-box-padding'] + 'em');
    preview.style.setProperty('--ruby-box-margin', vals['ruby-box-margin'] + 'em');

    document.getElementById('ruby-size-value').textContent = vals['ruby-size'];
    document.getElementById('ruby-gap-value').textContent = vals['ruby-gap'];
    document.getElementById('ruby-line-height-value').textContent = parseFloat(vals['ruby-line-height']).toFixed(2);
    document.getElementById('ruby-min-height-value').textContent = vals['ruby-min-height'];
    document.getElementById('ruby-box-padding-value').textContent = parseFloat(vals['ruby-box-padding']).toFixed(1);
    document.getElementById('ruby-box-margin-value').textContent = parseFloat(vals['ruby-box-margin']).toFixed(1);

    // Safari のネイティブ <ruby> は CSS 変数経由の min-height が効かないため直接設定
    const minH = vals['ruby-min-height'] + 'px';
    const gap = vals['ruby-gap'] + 'px';
    const rubySize = parseInt(vals['ruby-size'], 10);
    const rtSize = reverseRuby ? (100 / rubySize * 100) : rubySize;

    preview.querySelectorAll('ruby').forEach(ruby => {
        ruby.style.minBlockSize = minH;

        const rt = ruby.querySelector('rt');
        if (!rt) return;

        if (reverseRuby) {
            // 逆転モード: 漢字が縮小、rtが下に表示
            ruby.style.display = 'inline-block';
            ruby.style.position = 'relative';
            ruby.style.lineHeight = '1';
            ruby.style.fontSize = rubySize + '%';
            rt.style.display = 'block';
            rt.style.position = 'absolute';
            rt.style.insetBlockStart = '100%';
            rt.style.insetInlineStart = '0';
            rt.style.fontSize = rtSize + '%';
            rt.style.paddingBlockStart = gap;
            rt.style.paddingBlockEnd = '';
        } else {
            // 通常モード: Safariネイティブruby配置（rtが上）
            ruby.style.display = '';
            ruby.style.position = '';
            ruby.style.lineHeight = '';
            ruby.style.fontSize = '';
            rt.style.display = '';
            rt.style.position = '';
            rt.style.insetBlockStart = '';
            rt.style.insetInlineStart = '';
            rt.style.fontSize = '';
            rt.style.paddingBlockEnd = gap;
            rt.style.paddingBlockStart = '';
        }

        // ruby と rt の幅を比較し、大きい方に合わせる
        ruby.style.minInlineSize = '';
        rt.style.minInlineSize = '';
        const rubyW = ruby.getBoundingClientRect().width;
        const rtW = rt.getBoundingClientRect().width;
        if (rtW > rubyW) {
            ruby.style.minInlineSize = rtW + 'px';
        } else if (rubyW > rtW) {
            rt.style.minInlineSize = rubyW + 'px';
        }
    });
}

function queueSaveSliders() {
    if (sliderSaveTimer) clearTimeout(sliderSaveTimer);
    sliderSaveTimer = setTimeout(async () => {
        try {
            await browser.storage.local.set({
                rubySize: parseInt(document.getElementById('ruby-size').value, 10),
                rubyGap: parseInt(document.getElementById('ruby-gap').value, 10),
                rubyLineHeight: parseFloat(document.getElementById('ruby-line-height').value),
                rubyMinHeight: parseInt(document.getElementById('ruby-min-height').value, 10),
                rubyBoxPadding: parseFloat(document.getElementById('ruby-box-padding').value),
                rubyBoxMargin: parseFloat(document.getElementById('ruby-box-margin').value)
            });
        } catch (error) {
            console.error('Live slider save failed:', error);
        }
    }, 150);
}

// 設定の読み込み（App Group から同期してから読む）
async function loadSettings() {
    // 拡張機能コンテキストの場合、App Group から最新設定を同期
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
        try {
            await browser.runtime.sendMessage({ action: 'syncAppGroup' });
        } catch (e) { /* ホストアプリ内ではスキップ */ }
    }
    const s = await browser.storage.local.get(DEFAULTS);

    document.getElementById('reading-type').value = s.readingType;
    document.getElementById('unit-type').value = s.unitType;
    document.getElementById('auto-enable').checked = s.autoEnable;
    document.getElementById('reverse-ruby').checked = s.reverseRuby;
    document.getElementById('reading-rules').checked = s.readingRules;
    document.getElementById('ruby-size').value = s.rubySize;
    document.getElementById('ruby-gap').value = s.rubyGap;
    document.getElementById('ruby-line-height').value = s.rubyLineHeight;
    document.getElementById('ruby-min-height').value = s.rubyMinHeight;
    document.getElementById('ruby-box-padding').value = s.rubyBoxPadding;
    document.getElementById('ruby-box-margin').value = s.rubyBoxMargin;
    updatePreview();

    const radio = document.querySelector(`input[name="dictType"][value="${s.dictType}"]`);
    if (radio) radio.checked = true;
}

// 設定の保存
async function saveSettings() {
    const dictRadio = document.querySelector('input[name="dictType"]:checked');

    await browser.storage.local.set({
        readingType: document.getElementById('reading-type').value,
        unitType: document.getElementById('unit-type').value,
        autoEnable: document.getElementById('auto-enable').checked,
        reverseRuby: document.getElementById('reverse-ruby').checked,
        readingRules: document.getElementById('reading-rules').checked,
        dictType: dictRadio ? dictRadio.value : 'system',
        rubySize: parseInt(document.getElementById('ruby-size').value, 10),
        rubyGap: parseInt(document.getElementById('ruby-gap').value, 10),
        rubyLineHeight: parseFloat(document.getElementById('ruby-line-height').value),
        rubyMinHeight: parseInt(document.getElementById('ruby-min-height').value, 10),
        rubyBoxPadding: parseFloat(document.getElementById('ruby-box-padding').value),
        rubyBoxMargin: parseFloat(document.getElementById('ruby-box-margin').value)
    });
    // WKWebView（ホストアプリ）内なら goBack、拡張機能内なら window.close()
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.controller) {
        window.webkit.messageHandlers.controller.postMessage({ action: 'goBack' });
    } else {
        window.close();
    }
}

// スライダーIDからDEFAULTSキーへの変換 ('ruby-size' → 'rubySize')
function sliderIdToKey(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// スライダーをデフォルト値にリセット
function resetSliders() {
    for (const id of SLIDERS) {
        const key = sliderIdToKey(id);
        if (key in DEFAULTS) {
            document.getElementById(id).value = DEFAULTS[key];
        }
    }
    updatePreview();
    queueSaveSliders();
}

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadSettings();

        for (const id of SLIDERS) {
            document.getElementById(id).addEventListener('input', () => {
                updatePreview();
                queueSaveSliders();
            });
        }

        document.getElementById('reverse-ruby').addEventListener('change', () => {
            updatePreview();
            browser.storage.local.set({ reverseRuby: document.getElementById('reverse-ruby').checked });
        });

        document.getElementById('reading-rules').addEventListener('change', () => {
            browser.storage.local.set({ readingRules: document.getElementById('reading-rules').checked });
        });

        document.getElementById('save-settings').addEventListener('click', saveSettings);
        document.getElementById('reset-sliders').addEventListener('click', resetSliders);
    } catch (error) {
        console.error('Initialization failed:', error);
    }
});
