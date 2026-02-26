// --- 読み補正ルール (ReadingRules.swift の JS移植) ---
const ReadingRules = (() => {
    const KANJI_NUM_READINGS = [
        { kanji: '一', reading: 'いっ' },
        { kanji: '二', reading: 'に' },
        { kanji: '三', reading: 'さん' },
        { kanji: '四', reading: 'よん' },
        { kanji: '五', reading: 'ご' },
        { kanji: '六', reading: 'ろっ' },
        { kanji: '七', reading: 'なな' },
        { kanji: '八', reading: 'はっ' },
        { kanji: '九', reading: 'きゅう' },
        { kanji: '十', reading: 'じゅっ' }
    ];
    const KAGETSU_VARIANTS = ['か', 'ヶ', 'ケ', 'ヵ', 'カ'];

    const kanjiKagetsuSeqRules = [];
    const kanjiKagetsuSurfaceRules = [];
    for (let i = 0; i < KANJI_NUM_READINGS.length; i++) {
        const { kanji, reading } = KANJI_NUM_READINGS[i];
        const numId = i + 1;
        for (const v of KAGETSU_VARIANTS) {
            const vId = v === 'か' ? 'ka' : (v === 'ヶ' ? 'ga' : 'ke');
            kanjiKagetsuSeqRules.push(
                { id: `kagetsu-kanji-${numId}-seq-3-${vId}`, priority: 110, surfaces: [kanji, v, '月'], reading: `${reading}かげつ` }
            );
            kanjiKagetsuSeqRules.push(
                { id: `kagetsu-kanji-${numId}-seq-2-${vId}`, priority: 105, surfaces: [kanji, `${v}月`], reading: `${reading}かげつ` }
            );
            kanjiKagetsuSurfaceRules.push(
                { id: `kagetsu-kanji-${numId}-surface-${vId}`, priority: 90, surface: `${kanji}${v}月`, reading: `${reading}かげつ` }
            );
        }
    }

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
        { id: 'futari-seq-fw', priority: 100, surfaces: ['２', '人'], reading: 'ふたり' },
        { id: 'muen-seq', priority: 100, surfaces: ['無', '塩'], reading: 'むえん' },
        { id: 'komugiko-seq-2', priority: 100, surfaces: ['小麦', '粉'], reading: 'こむぎこ' },
        { id: 'komugiko-seq-3', priority: 110, surfaces: ['小', '麦', '粉'], reading: 'こむぎこ' },
        { id: 'hakurikiko-seq-2', priority: 100, surfaces: ['薄力', '粉'], reading: 'はくりきこ' },
        { id: 'hakurikiko-seq-3', priority: 110, surfaces: ['薄', '力', '粉'], reading: 'はくりきこ' },
        { id: 'gokuatsu-seq', priority: 100, surfaces: ['極', '厚'], reading: 'ごくあつ' },
        { id: 'nijuumaru-seq', priority: 100, surfaces: ['二', '重', '丸'], reading: 'にじゅうまる' },

        // === 「日」の読み分け ===
        // 「にち」: 縁日、日曜日（最初の日）
        { id: 'ennichi-seq', priority: 100, surfaces: ['縁', '日'], reading: 'えんにち' },
        { id: 'nichiyoubi-seq-2', priority: 110, surfaces: ['日曜', '日'], reading: 'にちようび' },
        { id: 'nichiyoubi-seq-3', priority: 120, surfaces: ['日', '曜', '日'], reading: 'にちようび' },
        // 「び」: 〜日（行事・期日）
        { id: 'tanjoubi-seq', priority: 100, surfaces: ['誕生', '日'], reading: 'たんじょうび' },
        { id: 'kinenbi-seq', priority: 100, surfaces: ['記念', '日'], reading: 'きねんび' },
        { id: 'koukaib-seq', priority: 100, surfaces: ['公開', '日'], reading: 'こうかいび' },
        { id: 'hatsubaib-seq', priority: 100, surfaces: ['発売', '日'], reading: 'はつばいび' },
        { id: 'kaisaib-seq', priority: 100, surfaces: ['開催', '日'], reading: 'かいさいび' },
        { id: 'kyuuryoub-seq', priority: 100, surfaces: ['給料', '日'], reading: 'きゅうりょうび' },
        { id: 'teikyuubi-seq', priority: 100, surfaces: ['定休', '日'], reading: 'ていきゅうび' },
        { id: 'koushinbi-seq', priority: 100, surfaces: ['更新', '日'], reading: 'こうしんび' },
        { id: 'toukoubi2-seq', priority: 100, surfaces: ['投稿', '日'], reading: 'とうこうび' },
        { id: 'sakuseibi-seq', priority: 100, surfaces: ['作成', '日'], reading: 'さくせいび' },
        { id: 'eigyoubi-seq', priority: 100, surfaces: ['営業', '日'], reading: 'えいぎょうび' },
        { id: 'gyoumubi-seq', priority: 100, surfaces: ['業務', '日'], reading: 'ぎょうむび' },
        { id: 'roudoubi-seq', priority: 100, surfaces: ['労働', '日'], reading: 'ろうどうび' },
        { id: 'tsuukinbi-seq', priority: 100, surfaces: ['通勤', '日'], reading: 'つうきんび' },
        { id: 'tsuugakubi-seq', priority: 100, surfaces: ['通学', '日'], reading: 'つうがくび' },
        { id: 'kaikanbi-seq', priority: 100, surfaces: ['開館', '日'], reading: 'かいかんび' },
        { id: 'heikanbi-seq', priority: 100, surfaces: ['閉館', '日'], reading: 'へいかんび' },
        { id: 'ryokoubi-seq', priority: 100, surfaces: ['旅行', '日'], reading: 'りょこうび' },
        { id: 'yoteibi-seq', priority: 100, surfaces: ['予定', '日'], reading: 'よていび' },
        { id: 'jissibi-seq', priority: 100, surfaces: ['実施', '日'], reading: 'じっしび' },
        { id: 'shikenbi-seq', priority: 100, surfaces: ['試験', '日'], reading: 'しけんび' },
        { id: 'jugyoubi-seq', priority: 100, surfaces: ['授業', '日'], reading: 'じゅぎょうび' },
        { id: 'sankanbi-seq', priority: 100, surfaces: ['参観', '日'], reading: 'さんかんび' },
        { id: 'shussanbi-seq', priority: 100, surfaces: ['出産', '日'], reading: 'しゅっさんび' },
        { id: 'kijunbi-seq', priority: 100, surfaces: ['基準', '日'], reading: 'きじゅんび' },
        { id: 'shimekiribi-seq', priority: 100, surfaces: ['締切', '日'], reading: 'しめきりび' },
        { id: 'henkyakubi-seq', priority: 100, surfaces: ['返却', '日'], reading: 'へんきゃくび' },
        { id: 'happyoubi-seq', priority: 100, surfaces: ['発表', '日'], reading: 'はっぴょうび' },
        { id: 'kaishibi-seq', priority: 100, surfaces: ['開始', '日'], reading: 'かいしび' },
        { id: 'shuuryoubi-seq', priority: 100, surfaces: ['終了', '日'], reading: 'しゅうりょうび' },
        { id: 'keiyakubi-seq', priority: 100, surfaces: ['契約', '日'], reading: 'けいやくび' },
        { id: 'nyuugakubi-seq', priority: 100, surfaces: ['入学', '日'], reading: 'にゅうがくび' },
        { id: 'sotsugyoubi-seq', priority: 100, surfaces: ['卒業', '日'], reading: 'そつぎょうび' },
        { id: 'daitaibi-seq', priority: 100, surfaces: ['代替', '日'], reading: 'だいたいび' },
        { id: 'kouhobi-seq', priority: 100, surfaces: ['候補', '日'], reading: 'こうほび' },
        { id: 'shinseibi-seq', priority: 100, surfaces: ['申請', '日'], reading: 'しんせいび' },
        { id: 'hassoubi-seq', priority: 100, surfaces: ['発送', '日'], reading: 'はっそうび' },
        { id: 'haitatubi-seq', priority: 100, surfaces: ['配達', '日'], reading: 'はいたつび' },
        { id: 'soufubi-seq', priority: 100, surfaces: ['送付', '日'], reading: 'そうふび' },
        { id: 'kinyuubi-seq', priority: 100, surfaces: ['記入', '日'], reading: 'きにゅうび' },
        { id: 'toukanbi-seq', priority: 100, surfaces: ['投函', '日'], reading: 'とうかんび' },
        { id: 'shuppatubi-seq', priority: 100, surfaces: ['出発', '日'], reading: 'しゅっぱつび' },
        { id: 'touchakubi-seq', priority: 100, surfaces: ['到着', '日'], reading: 'とうちゃくび' },
        { id: 'shukkokubi-seq', priority: 100, surfaces: ['出国', '日'], reading: 'しゅっこくび' },
        { id: 'kikokubi-seq', priority: 100, surfaces: ['帰国', '日'], reading: 'きこくび' },
        { id: 'saishuubi-seq', priority: 100, surfaces: ['最終', '日'], reading: 'さいしゅうび' },
        { id: 'teishutsubi-seq', priority: 100, surfaces: ['提出', '日'], reading: 'ていしゅつび' },
        { id: 'soushinbi-seq', priority: 100, surfaces: ['送信', '日'], reading: 'そうしんび' },
        { id: 'jushinbi-seq', priority: 100, surfaces: ['受信', '日'], reading: 'じゅしんび' },
        { id: 'toutatubi-seq', priority: 100, surfaces: ['到達', '日'], reading: 'とうたつび' },
        { id: 'tasseib-seq', priority: 100, surfaces: ['達成', '日'], reading: 'たっせいび' },
        { id: 'keshiinbi-seq', priority: 100, surfaces: ['消印', '日'], reading: 'けしいんび' },
        { id: 'katsudoubi-seq', priority: 100, surfaces: ['活動', '日'], reading: 'かつどうび' },
        { id: 'haishinbi-seq', priority: 100, surfaces: ['配信', '日'], reading: 'はいしんび' },
        { id: 'toukoubi-seq', priority: 100, surfaces: ['登校', '日'], reading: 'とうこうび' },
        { id: 'shukkoubi-seq', priority: 100, surfaces: ['出校', '日'], reading: 'しゅっこうび' },
        { id: 'meinichibi-seq', priority: 100, surfaces: ['命', '日'], reading: 'めいにち' },
        { id: 'saijitsub-seq', priority: 100, surfaces: ['祭', '日'], reading: 'さいじつ' },
        { id: 'noukib-seq', priority: 100, surfaces: ['納', '期日'], reading: 'のうきび' },
        { id: 'noukibi-seq-2', priority: 100, surfaces: ['納期', '日'], reading: 'のうきび' },
        { id: 'kijitsub-seq', priority: 100, surfaces: ['期', '日'], reading: 'きじつ' },
        { id: 'genjitsub-seq', priority: 100, surfaces: ['元', '日'], reading: 'がんじつ' },
        // 「ひ」: この日、あの日、その日、ある日
        { id: 'konohi-seq', priority: 100, surfaces: ['この', '日'], reading: 'このひ' },
        { id: 'anohi-seq', priority: 100, surfaces: ['あの', '日'], reading: 'あのひ' },
        { id: 'sonohi-seq', priority: 100, surfaces: ['その', '日'], reading: 'そのひ' },
        { id: 'aruhi-seq', priority: 100, surfaces: ['ある', '日'], reading: 'あるひ' },

        // === か/ヶ/ケ/ヵ/カ月（漢数字）===
        ...kanjiKagetsuSeqRules
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
        { id: 'shigatsu-surface', priority: 95, surface: '四月', reading: 'しがつ' },
        { id: 'muen-surface', priority: 90, surface: '無塩', reading: 'むえん' },
        { id: 'komugiko-surface', priority: 90, surface: '小麦粉', reading: 'こむぎこ' },
        { id: 'hakurikiko-surface', priority: 90, surface: '薄力粉', reading: 'はくりきこ' },
        { id: 'gokuatsu-surface', priority: 90, surface: '極厚', reading: 'ごくあつ' },
        // === 「日」の読み分け（単一トークン）===
        { id: 'ennichi-surface', priority: 90, surface: '縁日', reading: 'えんにち' },
        { id: 'nichiyoubi-surface', priority: 90, surface: '日曜日', reading: 'にちようび' },
        { id: 'tanjoubi-surface', priority: 90, surface: '誕生日', reading: 'たんじょうび' },
        { id: 'kinenbi-surface', priority: 90, surface: '記念日', reading: 'きねんび' },
        { id: 'koukaib-surface', priority: 90, surface: '公開日', reading: 'こうかいび' },
        { id: 'hatsubaib-surface', priority: 90, surface: '発売日', reading: 'はつばいび' },
        { id: 'kaisaib-surface', priority: 90, surface: '開催日', reading: 'かいさいび' },
        { id: 'kyuuryoub-surface', priority: 90, surface: '給料日', reading: 'きゅうりょうび' },
        { id: 'teikyuubi-surface', priority: 90, surface: '定休日', reading: 'ていきゅうび' },
        { id: 'koushinbi-surface', priority: 90, surface: '更新日', reading: 'こうしんび' },
        { id: 'toukoubi-surface', priority: 90, surface: '投稿日', reading: 'とうこうび' },
        { id: 'sakuseibi-surface', priority: 90, surface: '作成日', reading: 'さくせいび' },
        { id: 'eigyoubi-surface', priority: 90, surface: '営業日', reading: 'えいぎょうび' },
        { id: 'gyoumubi-surface', priority: 90, surface: '業務日', reading: 'ぎょうむび' },
        { id: 'roudoubi-surface', priority: 90, surface: '労働日', reading: 'ろうどうび' },
        { id: 'tsuukinbi-surface', priority: 90, surface: '通勤日', reading: 'つうきんび' },
        { id: 'tsuugakubi-surface', priority: 90, surface: '通学日', reading: 'つうがくび' },
        { id: 'kaikanbi-surface', priority: 90, surface: '開館日', reading: 'かいかんび' },
        { id: 'heikanbi-surface', priority: 90, surface: '閉館日', reading: 'へいかんび' },
        { id: 'ryokoubi-surface', priority: 90, surface: '旅行日', reading: 'りょこうび' },
        { id: 'yoteibi-surface', priority: 90, surface: '予定日', reading: 'よていび' },
        { id: 'jissibi-surface', priority: 90, surface: '実施日', reading: 'じっしび' },
        { id: 'shikenbi-surface', priority: 90, surface: '試験日', reading: 'しけんび' },
        { id: 'jugyoubi-surface', priority: 90, surface: '授業日', reading: 'じゅぎょうび' },
        { id: 'sankanbi-surface', priority: 90, surface: '参観日', reading: 'さんかんび' },
        { id: 'shussanbi-surface', priority: 90, surface: '出産日', reading: 'しゅっさんび' },
        { id: 'kijunbi-surface', priority: 90, surface: '基準日', reading: 'きじゅんび' },
        { id: 'shimekiribi-surface', priority: 90, surface: '締切日', reading: 'しめきりび' },
        { id: 'henkyakubi-surface', priority: 90, surface: '返却日', reading: 'へんきゃくび' },
        { id: 'happyoubi-surface', priority: 90, surface: '発表日', reading: 'はっぴょうび' },
        { id: 'kaishibi-surface', priority: 90, surface: '開始日', reading: 'かいしび' },
        { id: 'shuuryoubi-surface', priority: 90, surface: '終了日', reading: 'しゅうりょうび' },
        { id: 'keiyakubi-surface', priority: 90, surface: '契約日', reading: 'けいやくび' },
        { id: 'nyuugakubi-surface', priority: 90, surface: '入学日', reading: 'にゅうがくび' },
        { id: 'sotsugyoubi-surface', priority: 90, surface: '卒業日', reading: 'そつぎょうび' },
        { id: 'daitaibi-surface', priority: 90, surface: '代替日', reading: 'だいたいび' },
        { id: 'kouhobi-surface', priority: 90, surface: '候補日', reading: 'こうほび' },
        { id: 'shinseibi-surface', priority: 90, surface: '申請日', reading: 'しんせいび' },
        { id: 'soufubi-surface', priority: 90, surface: '送付日', reading: 'そうふび' },
        { id: 'hassoubi-surface', priority: 90, surface: '発送日', reading: 'はっそうび' },
        { id: 'haitatubi-surface', priority: 90, surface: '配達日', reading: 'はいたつび' },
        { id: 'kinyuubi-surface', priority: 90, surface: '記入日', reading: 'きにゅうび' },
        { id: 'toukanbi-surface', priority: 90, surface: '投函日', reading: 'とうかんび' },
        { id: 'shuppatubi-surface', priority: 90, surface: '出発日', reading: 'しゅっぱつび' },
        { id: 'touchakubi-surface', priority: 90, surface: '到着日', reading: 'とうちゃくび' },
        { id: 'shukkokubi-surface', priority: 90, surface: '出国日', reading: 'しゅっこくび' },
        { id: 'kikokubi-surface', priority: 90, surface: '帰国日', reading: 'きこくび' },
        { id: 'saishuubi-surface', priority: 90, surface: '最終日', reading: 'さいしゅうび' },
        { id: 'teishutsubi-surface', priority: 90, surface: '提出日', reading: 'ていしゅつび' },
        { id: 'soushinbi-surface', priority: 90, surface: '送信日', reading: 'そうしんび' },
        { id: 'jushinbi-surface', priority: 90, surface: '受信日', reading: 'じゅしんび' },
        { id: 'toutatubi-surface', priority: 90, surface: '到達日', reading: 'とうたつび' },
        { id: 'tasseibi-surface', priority: 90, surface: '達成日', reading: 'たっせいび' },
        { id: 'keshiinbi-surface', priority: 90, surface: '消印日', reading: 'けしいんび' },
        { id: 'katsudoubi-surface', priority: 90, surface: '活動日', reading: 'かつどうび' },
        { id: 'haishinbi-surface', priority: 90, surface: '配信日', reading: 'はいしんび' },
        { id: 'toukoubi-surface', priority: 90, surface: '登校日', reading: 'とうこうび' },
        { id: 'shukkoubi-surface', priority: 90, surface: '出校日', reading: 'しゅっこうび' },
        { id: 'meinichi-surface', priority: 90, surface: '命日', reading: 'めいにち' },
        { id: 'saijitsu-surface', priority: 90, surface: '祭日', reading: 'さいじつ' },
        { id: 'noukibi-surface', priority: 90, surface: '納期日', reading: 'のうきび' },
        { id: 'kijitsu-surface', priority: 90, surface: '期日', reading: 'きじつ' },
        { id: 'ganjitsu-surface', priority: 90, surface: '元日', reading: 'がんじつ' },
        // === か/ヶ/ケ/ヵ/カ月（漢数字・単一トークン）===
        ...kanjiKagetsuSurfaceRules
    ];

    // 数字パターン（月用・日用・汎用）を定義
    const MONTH_NUM = '0[1-9]|1[0-2]|[1-9]|０[１-９]|１[０-２]|[１-９]';
    const DAY_NUM = '0[1-9]|[1-9]|[12][0-9]|3[01]|０[１-９]|[１-９]|[１２][０-９]|３[０-１]';
    const ANY_NUM = '[0-9]+|[０-９]+|何';  // 何か月/何ヶ月/何ケ月/何ヵ月/何カ月 の「何」を含む

    // === 和語日付読み (2日〜10日): 「日」→「か」===
    const WAGO_DAY_NUM = '[2-9２-９]|[1１][0０]';  // 2〜10（半角・全角）

    // === 泊: ぱく(末尾1,3,4,6,8 + 2桁以上で末尾0) / はく(末尾2,5,7,9 + 単独0) ===
    // 10泊=じゅっぱく, 100泊=ひゃっぱく（2桁以上+末尾0は促音でぱく）
    // 0泊=れいはく（単独0のみはく）
    const PAKU_LAST = '[13468１３４６８]';
    const PAKU_TENS = '[0-9０-９][0０]';  // 10,20,30...（2桁以上で末尾0）
    const HAKU_LAST = '[2579２５７９]';

    const regexRules = [
        // === 泊: ぱく/はく ===
        // 2桁以上+末尾0 → ぱく（10泊, 20泊, 100泊 等）
        { id: 'paku-tens-combined', priority: 135,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_TENS + ')泊$'),
          replacement: '$1ぱく' },
        { id: 'paku-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_LAST + ')泊$'),
          replacement: '$1ぱく' },
        // 単独0 → はく（0泊）
        { id: 'haku-zero-combined', priority: 135,
          pattern: /^([0０])泊$/,
          replacement: '$1はく' },
        { id: 'haku-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + HAKU_LAST + ')泊$'),
          replacement: '$1はく' },
        // split: 2桁以上+末尾0 → ぱく
        { id: 'paku-tens-split', priority: 135,
          pattern: /^泊$/,
          replacement: 'ぱく',
          context: { prevPattern: new RegExp('[0-9０-９]' + '[0０]$') } },
        { id: 'paku-split', priority: 130,
          pattern: /^泊$/,
          replacement: 'ぱく',
          context: { prevPattern: new RegExp('[0-9０-９]*' + PAKU_LAST + '$') } },
        // split: 単独0 → はく
        { id: 'haku-zero-split', priority: 135,
          pattern: /^泊$/,
          replacement: 'はく',
          context: { prevPattern: /^[0０]$/ } },
        { id: 'haku-split', priority: 130,
          pattern: /^泊$/,
          replacement: 'はく',
          context: { prevPattern: new RegExp('[0-9０-９]*' + HAKU_LAST + '$') } },

        // === 分: ぷん/ふん（泊と同じ末尾桁パターン）===
        // 1分=いっぷん, 3分=さんぷん, 10分=じゅっぷん / 2分=にふん, 5分=ごふん, 0分=れいふん
        // 2桁以上+末尾0 → ぷん
        { id: 'pun-tens-combined', priority: 135,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_TENS + ')分$'),
          replacement: '$1ぷん' },
        { id: 'pun-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_LAST + ')分$'),
          replacement: '$1ぷん' },
        // 単独0 → ふん
        { id: 'fun-zero-combined', priority: 135,
          pattern: /^([0０])分$/,
          replacement: '$1ふん' },
        { id: 'fun-combined', priority: 130,
          pattern: new RegExp('^([0-9０-９]*' + HAKU_LAST + ')分$'),
          replacement: '$1ふん' },
        // split: 2桁以上+末尾0 → ぷん
        { id: 'pun-tens-split', priority: 135,
          pattern: /^分$/,
          replacement: 'ぷん',
          context: { prevPattern: new RegExp('[0-9０-９]' + '[0０]$') } },
        { id: 'pun-split', priority: 130,
          pattern: /^分$/,
          replacement: 'ぷん',
          context: { prevPattern: new RegExp('[0-9０-９]*' + PAKU_LAST + '$') } },
        // split: 単独0 → ふん
        { id: 'fun-zero-split', priority: 135,
          pattern: /^分$/,
          replacement: 'ふん',
          context: { prevPattern: /^[0０]$/ } },
        { id: 'fun-split', priority: 130,
          pattern: /^分$/,
          replacement: 'ふん',
          context: { prevPattern: new RegExp('[0-9０-９]*' + HAKU_LAST + '$') } },

        // === 杯: ぱい(末尾1,6,8 + 2桁以上で末尾0) / ばい(末尾3) / はい(末尾2,4,5,7,9 + 単独0) ===
        // 1杯=いっぱい, 3杯=さんばい, 5杯=ごはい, 10杯=じゅっぱい
        { id: 'pai-tens-combined', priority: 135,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_TENS + ')杯$'),
          replacement: '$1ぱい' },
        { id: 'pai-combined', priority: 130,
          pattern: /^([0-9０-９]*[168１６８])杯$/,
          replacement: '$1ぱい' },
        { id: 'bai-combined', priority: 130,
          pattern: /^([0-9０-９]*[3３])杯$/,
          replacement: '$1ばい' },
        { id: 'hai-zero-combined', priority: 135,
          pattern: /^([0０])杯$/,
          replacement: '$1はい' },
        { id: 'hai-combined', priority: 130,
          pattern: /^([0-9０-９]*[24579２４５７９])杯$/,
          replacement: '$1はい' },
        // split: 2桁以上+末尾0 → ぱい
        { id: 'pai-tens-split', priority: 135,
          pattern: /^杯$/,
          replacement: 'ぱい',
          context: { prevPattern: new RegExp('[0-9０-９]' + '[0０]$') } },
        { id: 'pai-split', priority: 130,
          pattern: /^杯$/,
          replacement: 'ぱい',
          context: { prevPattern: /[168１６８]$/ } },
        { id: 'bai-split', priority: 130,
          pattern: /^杯$/,
          replacement: 'ばい',
          context: { prevPattern: /[3３]$/ } },
        { id: 'hai-zero-split', priority: 135,
          pattern: /^杯$/,
          replacement: 'はい',
          context: { prevPattern: /^[0０]$/ } },
        { id: 'hai-split', priority: 130,
          pattern: /^杯$/,
          replacement: 'はい',
          context: { prevPattern: /[24579２４５７９]$/ } },

        // === 本: ぽん(末尾1,6,8 + 2桁以上で末尾0) / ぼん(末尾3) / ほん(末尾2,4,5,7,9 + 単独0) ===
        { id: 'pon-tens-combined', priority: 135,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_TENS + ')本$'),
          replacement: '$1ぽん' },
        { id: 'pon-combined', priority: 130,
          pattern: /^([0-9０-９]*[168１６８])本$/,
          replacement: '$1ぽん' },
        { id: 'bon-combined', priority: 130,
          pattern: /^([0-9０-９]*[3３])本$/,
          replacement: '$1ぼん' },
        { id: 'hon-zero-combined', priority: 135,
          pattern: /^([0０])本$/,
          replacement: '$1ほん' },
        { id: 'hon-combined', priority: 130,
          pattern: /^([0-9０-９]*[24579２４５７９])本$/,
          replacement: '$1ほん' },
        { id: 'pon-tens-split', priority: 135,
          pattern: /^本$/,
          replacement: 'ぽん',
          context: { prevPattern: new RegExp('[0-9０-９]' + '[0０]$') } },
        { id: 'pon-split', priority: 130,
          pattern: /^本$/,
          replacement: 'ぽん',
          context: { prevPattern: /[168１６８]$/ } },
        { id: 'bon-split', priority: 130,
          pattern: /^本$/,
          replacement: 'ぼん',
          context: { prevPattern: /[3３]$/ } },
        { id: 'hon-zero-split', priority: 135,
          pattern: /^本$/,
          replacement: 'ほん',
          context: { prevPattern: /^[0０]$/ } },
        { id: 'hon-split', priority: 130,
          pattern: /^本$/,
          replacement: 'ほん',
          context: { prevPattern: /[24579２４５７９]$/ } },

        // === 匹: ぴき(末尾1,6,8 + 2桁以上で末尾0) / びき(末尾3) / ひき(末尾2,4,5,7,9 + 単独0) ===
        { id: 'piki-tens-combined', priority: 135,
          pattern: new RegExp('^([0-9０-９]*' + PAKU_TENS + ')匹$'),
          replacement: '$1ぴき' },
        { id: 'piki-combined', priority: 130,
          pattern: /^([0-9０-９]*[168１６８])匹$/,
          replacement: '$1ぴき' },
        { id: 'biki-combined', priority: 130,
          pattern: /^([0-9０-９]*[3３])匹$/,
          replacement: '$1びき' },
        { id: 'hiki-zero-combined', priority: 135,
          pattern: /^([0０])匹$/,
          replacement: '$1ひき' },
        { id: 'hiki-combined', priority: 130,
          pattern: /^([0-9０-９]*[24579２４５７９])匹$/,
          replacement: '$1ひき' },
        { id: 'piki-tens-split', priority: 135,
          pattern: /^匹$/,
          replacement: 'ぴき',
          context: { prevPattern: new RegExp('[0-9０-９]' + '[0０]$') } },
        { id: 'piki-split', priority: 130,
          pattern: /^匹$/,
          replacement: 'ぴき',
          context: { prevPattern: /[168１６８]$/ } },
        { id: 'biki-split', priority: 130,
          pattern: /^匹$/,
          replacement: 'びき',
          context: { prevPattern: /[3３]$/ } },
        { id: 'hiki-zero-split', priority: 135,
          pattern: /^匹$/,
          replacement: 'ひき',
          context: { prevPattern: /^[0０]$/ } },
        { id: 'hiki-split', priority: 130,
          pattern: /^匹$/,
          replacement: 'ひき',
          context: { prevPattern: /[24579２４５７９]$/ } },

        // === 階: がい(単独3のみ) / かい(その他) ===
        { id: 'gai-combined', priority: 130,
          pattern: /^([3３])階$/,
          replacement: '$1がい' },
        { id: 'kai-combined', priority: 129,
          pattern: /^([0-9０-９]+)階$/,
          replacement: '$1かい' },
        { id: 'gai-split', priority: 130,
          pattern: /^階$/,
          replacement: 'がい',
          context: { prevPattern: /^[3３]$/ } },
        { id: 'kai-split', priority: 129,
          pattern: /^階$/,
          replacement: 'かい',
          context: { prevPattern: /[0-9０-９]$/ } },

        // === 軒: げん(単独3のみ) / けん(その他) ===
        { id: 'gen-combined', priority: 130,
          pattern: /^([3３])軒$/,
          replacement: '$1げん' },
        { id: 'ken-combined', priority: 129,
          pattern: /^([0-9０-９]+)軒$/,
          replacement: '$1けん' },
        { id: 'gen-split', priority: 130,
          pattern: /^軒$/,
          replacement: 'げん',
          context: { prevPattern: /^[3３]$/ } },
        { id: 'ken-split', priority: 129,
          pattern: /^軒$/,
          replacement: 'けん',
          context: { prevPattern: /[0-9０-９]$/ } },

        // === 百: ぴゃく(単独6,8) / びゃく(単独3) / ひゃく(その他) ===
        { id: 'pyaku-combined', priority: 130,
          pattern: /^([68６８])百$/,
          replacement: '$1ぴゃく' },
        { id: 'byaku-combined', priority: 130,
          pattern: /^([3３])百$/,
          replacement: '$1びゃく' },
        { id: 'hyaku-combined', priority: 129,
          pattern: /^([0-9０-９]+)百$/,
          replacement: '$1ひゃく' },
        { id: 'pyaku-split', priority: 130,
          pattern: /^百$/,
          replacement: 'ぴゃく',
          context: { prevPattern: /^[68６８]$/ } },
        { id: 'byaku-split', priority: 130,
          pattern: /^百$/,
          replacement: 'びゃく',
          context: { prevPattern: /^[3３]$/ } },
        { id: 'hyaku-split', priority: 129,
          pattern: /^百$/,
          replacement: 'ひゃく',
          context: { prevPattern: /[0-9０-９]$/ } },

        // === 千: ぜん(単独3のみ) / せん(その他) ===
        { id: 'zen-combined', priority: 130,
          pattern: /^([3３])千$/,
          replacement: '$1ぜん' },
        { id: 'sen-combined', priority: 129,
          pattern: /^([0-9０-９]+)千$/,
          replacement: '$1せん' },
        { id: 'zen-split', priority: 130,
          pattern: /^千$/,
          replacement: 'ぜん',
          context: { prevPattern: /^[3３]$/ } },
        { id: 'sen-split', priority: 129,
          pattern: /^千$/,
          replacement: 'せん',
          context: { prevPattern: /[0-9０-９]$/ } },

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
          pattern: /^((0[1-9]|1[0-2])|([1-9])|(０[１-９]|１[０-２])|([１-９]))月((0[1-9]|[12][0-9]|3[01])|([1-9])|(０[１-９]|[１２][０-９]|３[０-１])|([１-９]))日$/,
          replacement: '$1がつ$6にち' },
        { id: 'month-number-with-punct', priority: 131,
          pattern: /^(0[1-9]|1[0-2]|[1-9]|０[１-９]|１[０-２]|[１-９])月([、。,.，．])$/,
          replacement: '$1がつ$2' },
        { id: 'month-number', priority: 130,
          pattern: /^(0[1-9]|1[0-2]|[1-9]|０[１-９]|１[０-２]|[１-９])月$/,
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

        // === か/ヶ/ケ/ヵ/カ月 → げつ ===
        // 結合トークン: "3か月" / "何ヶ月" / "3ケ月" / "3ヵ月" / "3カ月" 等
        { id: 'kagetsu-combined', priority: 135,
          pattern: new RegExp('^(' + ANY_NUM + ')([かヶケヵカ])月$'),
          replacement: '$1$2げつ' },
        // 分割トークン: "か"/"ヶ"/"ケ"/"ヵ"/"カ" + "月"（前に数字/何）
        { id: 'kagetsu-split', priority: 135,
          pattern: /^月$/,
          replacement: 'げつ',
          context: {
              prevPattern: /^[かヶケヵカ]$/,
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

    // B: ソートキャッシュ — 毎回ソートせず事前に1回だけソート
    const sortedSequenceRules = [...sequenceRules].sort((a, b) => b.priority - a.priority);
    const sortedSurfaceRules = [...surfaceRules].sort((a, b) => b.priority - a.priority);
    const sortedRegexRules = [...regexRules].sort((a, b) => b.priority - a.priority);
    // C: 数字不要ルールを分離（数字を含まないsurfaceはdigitルールをスキップ）
    const regexOtherRules = sortedRegexRules.filter(r => !/\d/.test(r.pattern.source));
    const HAS_DIGIT = /[0-9０-９]/;

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
        const output = [];
        let i = 0;
        while (i < tokens.length) {
            let matched = false;
            for (const rule of sortedSequenceRules) {
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
        const output = [...tokens];
        for (let i = 0; i < output.length; i++) {
            let override = null;
            for (const rule of sortedSurfaceRules) {
                if (output[i].surface === rule.surface) { override = rule.reading; break; }
            }
            if (!override) {
                // C: surfaceに数字があるかで適用するregexルールを選択
                const surface = output[i].surface;
                const hasDigit = HAS_DIGIT.test(surface);
                const rules = hasDigit ? sortedRegexRules : regexOtherRules;
                for (const rule of rules) {
                    if (!rule.pattern.test(surface)) continue;
                    if (!contextMatches(rule.context, output, i)) continue;
                    override = surface.replace(rule.pattern, rule.replacement);
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
