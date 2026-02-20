// --- 読み補正ルール (ReadingRules.swift の JS移植) ---
const ReadingRules = (() => {
    const sequenceRules = [
        { id: 'rei-wa', priority: 100, surfaces: ['令', '和'], reading: 'れいわ' },
        { id: 'mon-ka', priority: 100, surfaces: ['文', '科'], reading: 'もんか' },
        { id: 'chu-kyo-shin', priority: 100, surfaces: ['中', '教', '審'], reading: 'ちゅうきょうしん' },
        { id: 'nani-wo-seq', priority: 100, surfaces: ['何', 'を'], reading: 'なにを' },
        { id: 'nani-no-seq', priority: 100, surfaces: ['何', 'の'], reading: 'なんの' },
        { id: 'cyura-umi', priority: 100, surfaces: ['美ら', '海'], reading: 'ちゅらうみ' },
        { id: 'youbi-seq', priority: 100, surfaces: ['曜', '日'], reading: 'ようび' },
        { id: 'nan-youbi-seq-2a', priority: 110, surfaces: ['何曜', '日'], reading: 'なんようび' },
        { id: 'nan-youbi-seq-2b', priority: 110, surfaces: ['何', '曜日'], reading: 'なんようび' },
        { id: 'nan-youbi-seq-3', priority: 110, surfaces: ['何', '曜', '日'], reading: 'なんようび' },
        { id: 'hizuke-seq', priority: 100, surfaces: ['日', '付'], reading: 'ひづけ' },
        { id: 'shigatsu-seq', priority: 110, surfaces: ['四', '月'], reading: 'しがつ' },
        { id: 'hitori-seq', priority: 100, surfaces: ['1', '人'], reading: 'ひとり' },
        { id: 'hitori-seq-fw', priority: 100, surfaces: ['１', '人'], reading: 'ひとり' },
        { id: 'futari-seq', priority: 100, surfaces: ['2', '人'], reading: 'ふたり' },
        { id: 'futari-seq-fw', priority: 100, surfaces: ['２', '人'], reading: 'ふたり' }
    ];

    const surfaceRules = [
        { id: 'rei-wa-surface', priority: 90, surface: '令和', reading: 'れいわ' },
        { id: 'mon-ka-surface', priority: 90, surface: '文科', reading: 'もんか' },
        { id: 'chu-kyo-shin-surface', priority: 90, surface: '中教審', reading: 'ちゅうきょうしん' },
        { id: 'nani-wo-surface', priority: 90, surface: '何を', reading: 'なにを' },
        { id: 'nani-no-surface', priority: 90, surface: '何の', reading: 'なんの' },
        { id: 'youbi-surface', priority: 90, surface: '曜日', reading: 'ようび' },
        { id: 'nan-youbi-surface', priority: 95, surface: '何曜日', reading: 'なんようび' },
        { id: 'hizuke-surface', priority: 90, surface: '日付', reading: 'ひづけ' },
        { id: 'shigatsu-surface', priority: 95, surface: '四月', reading: 'しがつ' }
    ];

    // 数字パターン（月用・日用・汎用）を定義
    const MONTH_NUM = '1[0-2]|[1-9]|１[０-２]|[１-９]';
    const DAY_NUM = '[1-9]|[12][0-9]|3[01]|[１-９]|[１２][０-９]|３[０-１]';
    const ANY_NUM = '[0-9]+|[０-９]+|何';  // 何か月/何ヶ月 の「何」を含む

    // === 和語日付読み (2日〜10日): 「日」→「か」===
    const WAGO_DAY_NUM = '[2-9２-９]|[1１][0０]';  // 2〜10（半角・全角）

    // === 泊: ぱく(末尾0,1,3,4,6,8) / はく(末尾2,5,7,9) ===
    const PAKU_LAST = '[013468０１３４６８]';
    const HAKU_LAST = '[2579２５７９]';

    const regexRules = [
        // === 泊: ぱく/はく ===
        { id: 'paku-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_LAST + ')泊$'),
          replacement: '$1ぱく' },
        { id: 'haku-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + HAKU_LAST + ')泊$'),
          replacement: '$1はく' },
        { id: 'paku-split', priority: 130,
          pattern: /^泊$/,
          replacement: 'ぱく',
          context: { prevPattern: new RegExp('[0-9０-９]*' + PAKU_LAST + '$') } },
        { id: 'haku-split', priority: 130,
          pattern: /^泊$/,
          replacement: 'はく',
          context: { prevPattern: new RegExp('[0-9０-９]*' + HAKU_LAST + '$') } },

        // === 1人 → ひとり ===
        { id: 'hitori-combined', priority: 130,
          pattern: /^[1１]人$/,
          replacement: 'ひとり' },
        { id: 'futari-combined', priority: 130,
          pattern: /^[2２]人$/,
          replacement: 'ふたり' },

        // === 頃: 「の頃」→ころ、それ以外→ごろ ===
        { id: 'koro-after-no', priority: 131,
          pattern: /^頃$/,
          replacement: 'ころ',
          context: { prevPattern: /の$/ } },
        { id: 'goro-default', priority: 130,
          pattern: /^頃$/,
          replacement: 'ごろ' },

        // === 結合トークン向け（Swift NLTagger等） ===
        { id: 'month-day-combined', priority: 140,
          pattern: /^((1[0-2])|([1-9])|(１[０-２])|([１-９]))月((3[01])|([12][0-9])|([1-9])|(３[０-１])|([１２][０-９])|([１-９]))日$/,
          replacement: '$1がつ$6にち' },
        { id: 'month-number-with-punct', priority: 131,
          pattern: /^(1[0-2]|[1-9]|１[０-２]|[１-９])月([、。,.，．])$/,
          replacement: '$1がつ$2' },
        { id: 'month-number', priority: 130,
          pattern: /^(1[0-2]|[1-9]|１[０-２]|[１-９])月$/,
          replacement: '$1がつ' },
        { id: 'month-day-token', priority: 135,
          pattern: new RegExp('^(' + DAY_NUM + ')日$'),
          replacement: '$1にち',
          context: { prevPattern: new RegExp('^(' + MONTH_NUM + ')月$') } },
        { id: 'month-day-split', priority: 134,
          pattern: /^日$/,
          replacement: 'にち',
          context: {
              prevPattern: new RegExp('^(' + DAY_NUM + ')$'),
              prevPrevPattern: new RegExp('^(' + MONTH_NUM + ')月$')
          } },
        { id: 'nichi-generic', priority: 100,
          pattern: new RegExp('^(' + DAY_NUM + ')日$'),
          replacement: '$1にち' },
        { id: 'nichi-duration', priority: 105,
          pattern: new RegExp('^(' + DAY_NUM + ')日間$'),
          replacement: '$1にちかん' },
        { id: 'nichi-split', priority: 99,
          pattern: /^日$/,
          replacement: 'にち',
          context: { prevPattern: new RegExp('^(' + DAY_NUM + ')$') } },

        // === 曜日 → ようび ===
        // 分割トークン: "月曜"〜"日曜" + "日" → 日 = び
        { id: 'youbi-after-weekday', priority: 140,
          pattern: /^日$/,
          replacement: 'び',
          context: { prevPattern: /^[月火水木金土日何]曜$/ } },

        // === か月/ヶ月 → げつ ===
        // 結合トークン: "3か月" / "何ヶ月" 等
        { id: 'kagetsu-combined', priority: 135,
          pattern: new RegExp('^(' + ANY_NUM + ')([かヶ])月$'),
          replacement: '$1$2げつ' },
        // 分割トークン: "か"/"ヶ" + "月"（前に数字/何）
        { id: 'kagetsu-split', priority: 135,
          pattern: /^月$/,
          replacement: 'げつ',
          context: {
              prevPattern: /^[かヶ]$/,
              prevPrevPattern: new RegExp('^(' + ANY_NUM + ')$')
          } },

        // === 分割トークン向け（kuromoji等: "1" + "月" + "1" + "日"） ===
        // 月: 数字の直後の「月」→「がつ」
        { id: 'gatsu-split', priority: 129,
          pattern: /^月$/,
          replacement: 'がつ',
          context: { prevPattern: new RegExp('^(' + MONTH_NUM + ')$') } },
        // 日: 「月」の直後の数字の直後の「日」→「にち」
        { id: 'nichi-after-gatsu-split', priority: 133,
          pattern: /^日$/,
          replacement: 'にち',
          context: {
              prevPattern: new RegExp('^(' + DAY_NUM + ')$'),
              prevPrevPattern: /^月$/
          } },
        // 日: 数字の直後の「日」→「にち」（月コンテキストなし）
        // nichi-split (priority 99) で既にカバー

        // === 和語日付読み (2日〜10日): 「日」→「か」===
        // 結合トークン: "Y日" → "Yか"（数字はルビなし、日にルビ「か」）
        { id: 'wago-day-combined', priority: 136,
          pattern: new RegExp('^(' + WAGO_DAY_NUM + ')日$'),
          replacement: '$1か' },
        // 分離トークン: "Y" + "日" → 日=か
        { id: 'wago-day-split', priority: 135,
          pattern: /^日$/,
          replacement: 'か',
          context: { prevPattern: new RegExp('^(' + WAGO_DAY_NUM + ')$') } },
    ];

    function contextMatches(ctx, tokens, index) {
        if (!ctx) return true;
        if (ctx.prevPattern) {
            const prev = index > 0 ? tokens[index - 1].surface : '';
            if (!ctx.prevPattern.test(prev)) return false;
        }
        if (ctx.prevPrevPattern) {
            const pp = index > 1 ? tokens[index - 2].surface : '';
            if (!ctx.prevPrevPattern.test(pp)) return false;
        }
        if (ctx.nextPattern) {
            const next = index + 1 < tokens.length ? tokens[index + 1].surface : '';
            if (!ctx.nextPattern.test(next)) return false;
        }
        return true;
    }

    function seqContextMatches(ctx, tokens, index, count) {
        if (!ctx) return true;
        if (ctx.prevPattern) {
            const prev = index > 0 ? tokens[index - 1].surface : '';
            if (!ctx.prevPattern.test(prev)) return false;
        }
        if (ctx.prevPrevPattern) {
            const pp = index > 1 ? tokens[index - 2].surface : '';
            if (!ctx.prevPrevPattern.test(pp)) return false;
        }
        if (ctx.nextPattern) {
            const ni = index + count;
            const next = ni < tokens.length ? tokens[ni].surface : '';
            if (!ctx.nextPattern.test(next)) return false;
        }
        return true;
    }

    function applySequenceRules(tokens) {
        const sorted = [...sequenceRules].sort((a, b) => b.priority - a.priority);
        const output = [];
        let i = 0;
        while (i < tokens.length) {
            let matched = false;
            for (const rule of sorted) {
                const count = rule.surfaces.length;
                if (i + count > tokens.length) continue;
                let ok = true;
                for (let j = 0; j < count; j++) {
                    if (tokens[i + j].surface !== rule.surfaces[j]) { ok = false; break; }
                }
                if (!ok) continue;
                if (!seqContextMatches(rule.context, tokens, i, count)) continue;
                const start = tokens[i].range[0];
                const end = tokens[i + count - 1].range[1];
                output.push({
                    surface: rule.surfaces.join(''),
                    reading: rule.reading,
                    pos: tokens[i].pos,
                    range: [start, end]
                });
                i += count;
                matched = true;
                break;
            }
            if (!matched) { output.push(tokens[i]); i++; }
        }
        return output;
    }

    function applySimpleRules(tokens) {
        const sortedSurface = [...surfaceRules].sort((a, b) => b.priority - a.priority);
        const sortedRegex = [...regexRules].sort((a, b) => b.priority - a.priority);
        const output = [...tokens];
        for (let i = 0; i < output.length; i++) {
            let override = null;
            for (const rule of sortedSurface) {
                if (output[i].surface === rule.surface) { override = rule.reading; break; }
            }
            if (!override) {
                for (const rule of sortedRegex) {
                    if (!rule.pattern.test(output[i].surface)) continue;
                    if (!contextMatches(rule.context, output, i)) continue;
                    override = output[i].surface.replace(rule.pattern, rule.replacement);
                    break;
                }
            }
            if (override) {
                output[i] = { ...output[i], reading: override };
            }
        }
        return output;
    }

    return {
        apply(tokens) {
            if (!tokens || tokens.length === 0) return tokens;
            const after = applySimpleRules(applySequenceRules(tokens));
            // 変更があったトークンをログ出力
            for (let i = 0; i < Math.min(tokens.length, after.length); i++) {
                if (i < after.length && i < tokens.length && after[i].reading !== tokens[i].reading) {
                    console.log(`[Furikana] ReadingRule applied: "${after[i].surface}" ${tokens[i].reading} → ${after[i].reading}`);
                }
            }
            if (after.length !== tokens.length) {
                console.log(`[Furikana] ReadingRule merged: ${tokens.length} → ${after.length} tokens`);
            }
            return after;
        }
    };
})();
