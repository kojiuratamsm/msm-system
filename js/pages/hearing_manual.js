// js/pages/hearing_manual.js
// ヒアリングシート(js/pages/sales_hub.js)の左側に表示する「商談マニュアル」。
//
// 【本文の書き方】 下の RAW に、マニュアルの本文をそのまま貼る(書き換え・省略はしない)。
//   行の先頭の目印で、見た目が自動で決まる(目印のあとに続く行も、次の目印までは同じカードに入る):
//     （浦）（質問） … 質問すること(オレンジの太字・薄いオレンジの背景。いちばん目立つ)
//     （浦）        … 営業担当が話すこと(青の太字・薄い青の背景)
//     （回答）      … お客様の回答の例(グレーの文字・薄いグレーの背景)
//     （回答例）    … 回答の例(薄いグレー。補足として折りたためる)
//     回答例：      … （回答例）と同じ扱い
//     質問の参考例： … 質問の言い回しの参考(薄いオレンジの補足カード)
//     ※            … 注意書き
//     （〜場合）    … 分岐の見出し(例:（している場合）（していない場合）)。
//                     「（浦）（〜場合）」のように（浦）が付いた分岐のあとの文章は、（浦）が話すこととして青で表示する
//                     (同じセクションの続く分岐「（〜場合）」も同じ)
//   セクションの見出しは、次の7つのどれかと同じ文字の行(前後の【】・番号・記号は無視する)。
//     導入 / 申し込みのきっかけ / 現在の集客状況 / 集客を増やしたい理由・本音 / 理想と危機感 / 現在のMEO運用状況 / 分析診断への移行
//   丸かっこは全角・半角どちらでもよい。
(function () {
    // ▼ マニュアル本文(ここに原文を貼る)
    const RAW = `
【導入】

（浦）
初めまして！！浦田です！

今回はMEO分析診断ということで、これから始めていきたいと思うのですが、まず簡単に今の状況などを把握させていただきたいので、いくつか質問をさせてください！

【申し込みのきっかけ】

（浦）（質問）
どうして今回、MEO分析診断を申し込んでくれた？

（回答）
YouTubeを見て無料でしてくれるって書いてあったから。
SNSでたまたま見たから！

（浦）（質問）
YouTubeはいつ頃から見てくれているんですか？

（回答例）
ここ一週間以内です。

（浦）
なるほど、YouTubeで見つけていただきありがとうございます！

（浦）（質問）
YouTubeでMEOについての発信を見ようと思ったきっかけってあったんですか？

（回答）
たまたま流れてきて、勉強がてら見ました。

（浦）
なるほど！ありがとうございます！

（浦）（質問）
ちなみに、今回MEO分析診断に申し込んでみたいと思った背景って理由が様々あると思うのですが、どのようなきっかけがあったんですか？

（回答）
売上をもっと伸ばしたいなとか、
最近近くに競合のお店ができたなとか、
お店の売上を上げるためにMEOが良いって聞いて、そこから検索するようになりました。

（浦）
そうだったんですね。ありがとうございます！

【現在の集客状況】

（浦）（質問）
ここからは現在の状況について聞いていくのですが、現在の集客方法ってどのような形でされているんですか？

（回答）
〇〇
〇〇
〇〇

（浦）
なるほど！ありがとうございます！

※SNSだけの場合は次の質問へ進む。

（浦）
ありがとうございます！

（浦）（質問）
それぞれの媒体にいくらくらいかけていますか？

（回答）
〇〇 ××円
〇〇 ××円
〇〇 ××円

（浦）（質問）
それぞれの媒体で月間でどのくらい集客出来ているんですか？

（回答）
〇〇 ××人
〇〇 ××人
〇〇 ××人

（浦）
そうだったんですね。詳しく教えていただきありがとうございます。

（浦）（質問）
お客様一人の単価って大体いくらくらいですか？

（回答）
〇〇円くらいですかね！

（浦）
〇〇円なんですね！ありがとうございます！

【集客を増やしたい理由・本音】

（浦）（質問）
月間で約〇〇名くらい集客出来ているのに診断を受けているという事は、今よりもさらに集客数を増やしていかないといけないなって感じていると言うことですか？

（回答）
そうですね...
集客数を増やしていきたいですね...

（浦）（質問）
率直な質問で、それはどうしてですか？

質問の参考例：

・前の方は、自分たちと同じジャンルのお店が半径500m以内に出来たみたいで、そこには絶対に集客で負けたくないと言っていたのですが、、、

・前の方は、暇な日が続いたりして、このままで大丈夫なのか？って不安になってきてと言っていたのですが、理由とかあります？

・お金を稼ぎたいから。

（回答）
〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇〇
※ここが本当の本音。

（浦）
そう言う事があったんですね！
とても納得です！

【理想と危機感】

（浦）（質問）
もし集客がうまくいったら、新規のお客様は月に何人くらい増えたら理想ですか？

（回答）
増えたら増えるだけ嬉しいですけどねぇ。

（浦）（質問）
逆に、今のまま集客数のまま半年たったら、どうなっていそうですか？

（回答）
ちょっと困ります...
流石に何か手を打たないとまずいです。

（浦）
そうですよね。でも大丈夫です。
Googleマップから集客はめちゃめちゃ増やせます。

【現在のMEO運用状況】

（浦）（質問）
ちなみに今回MEOの分析を行ってきたのですが、こちらはご自身で運用などはされているんですか？

回答例：

・はい。しています。
・いえ、特に何もしていないです。

（浦）（している場合）

そうだったんですね！
すごいですね！

（していない場合）

そうだったんですね！でもすごいですね！

触ったことのないものへの関心を持つって相当な勇気が必要だと思います。

このMEO対策で集客数は圧倒的に増やせると思いますので、一緒にみていきましょう！

（浦）（質問）
SNSとかで勉強とかされているんですか？

（回答）
YouTubeとかをみているだけです。
（その他）いえ、特に何もないです。

（浦）（質問）
何を意識して運用されているんですか？

（回答）
〇〇というキーワードを入れて投稿をすることとか。
毎週写真をアップロードするとか。

（浦）
素晴らしいですね！

僕もかれこれ100店舗以上の方と面談をしていますが、ここまで考えてやっている方本当に少ないですよ。

（浦）（質問）
前回の方もそうだったのですが、自分で運用はしているけれど、いまいち集客・売上に繋がっていないって悩んでいる方がめっちゃ多いのですが、〇〇さんも同じように感じますか？

（回答）
はい。感じます。

（浦）
やっているのに結果が出ないのは一番もどかしいですよね。
今日はその理由を一緒に見ていきましょう。

（浦）（質問）
今の運用のままで、今後集客増えていきそうだなって思いますか？

（回答）
まあちょっとずつ増えたらいいなって思っています...

【分析診断への移行】

（浦）
ありがとうございます。

それでは早速分析診断に移っていこうと思うのですが、この時間はただの分析診断ではなくて、〇〇店舗が〇〇の地域でNo.1を取りに行く為の時間です。

集客数を伸ばして、今よりもさらに売上を上げるためにはどうすればいいのか。

なぜ自分でMEO対策をしていたのに集客・売上に繋がらなかったのかなどについて話をしていきます。

それでは、進めてもいいですか？
`;
    // ▲ ここまで

    const SECTIONS = [
        { id: 'intro', title: '導入' },
        { id: 'trigger', title: '申し込みのきっかけ' },
        { id: 'current', title: '現在の集客状況' },
        { id: 'reason', title: '集客を増やしたい理由・本音' },
        { id: 'ideal', title: '理想と危機感' },
        { id: 'meo', title: '現在のMEO運用状況' },
        { id: 'transition', title: '分析診断への移行' }
    ];
    // 右側の入力欄(質問 → どの欄に書くか)。セクションごとに、質問文の言葉 → 既定 の順で決める(null = 対応する欄なし)
    //   method=現在の集客方法 / price=一人当たりの単価感 / ideal=一番理想的な姿 / worry=何に悩んでいるのか？ / issue=何が課題なのか？
    const FIELD_RULES = {
        intro: { def: null },
        trigger: { def: null, words: [[/背景/, 'worry']] },
        current: { def: 'method', words: [[/単価/, 'price']] },
        reason: { def: 'worry' },
        ideal: { def: 'worry', words: [[/理想/, 'ideal']] },
        meo: { def: 'issue' },
        transition: { def: null }
    };

    const norm = (s) => {
        let t = String(s || '');
        try { t = t.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
        return t.replace(/[\s・･]/g, '').toLowerCase();
    };
    const headingOf = (line) => {
        let t = String(line || '');
        try { t = t.normalize('NFKC'); } catch (e) { /* 古い環境 */ }
        t = t.trim()
            .replace(/^[#■□●○◆◇▼▽▶►\-*【\[〈《]+/, '')
            .replace(/^(step\s*\d+|第?\d+章?|[①-⑳])\s*[.、:)\]】-]?\s*/i, '')
            .replace(/[】\]〉》:：]+$/, '').trim();
        const n = norm(t);
        return SECTIONS.find(s => norm(s.title) === n) || null;
    };
    const P = '[（(]', Q = '[）)]';
    const MARKS = [
        { type: 'q', re: new RegExp(`^\\s*${P}浦${Q}\\s*${P}質問${Q}\\s*`), label: '（浦）（質問）' },
        { type: 'branch', re: new RegExp(`^\\s*(${P}浦${Q}\\s*)?${P}[^（()）]{1,20}場合${Q}\\s*`), label: null },
        { type: 'ura', re: new RegExp(`^\\s*${P}浦${Q}\\s*`), label: '（浦）' },
        { type: 'ex', re: new RegExp(`^\\s*${P}回答例${Q}\\s*`), label: '（回答例）' },
        { type: 'ans', re: new RegExp(`^\\s*${P}回答${Q}\\s*`), label: '（回答）' },
        { type: 'ex', re: /^\s*回答例\s*[：:]\s*/, label: null },
        { type: 'ref', re: /^\s*質問の参考例\s*[：:]\s*/, label: null },
        { type: 'note', re: /^\s*※\s*/, label: '※' }
    ];

    // 本文 → [{ id, title, blocks: [{ type, label, lines: [] }] }]
    function parse(raw) {
        const out = SECTIONS.map(s => ({ id: s.id, title: s.title, blocks: [] }));
        let sec = null, block = null, speaker = null;   // speaker: （浦）付きの分岐のあとは 'ura'
        const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
        for (const line of lines) {
            const h = headingOf(line);
            if (h && !MARKS.some(m => m.re.test(line))) { sec = out.find(s => s.id === h.id); block = null; speaker = null; continue; }
            if (!sec) { if (!line.trim()) continue; sec = out[0]; }
            if (!line.trim()) { if (block) block.gap = true; continue; }
            const m = MARKS.find(mk => mk.re.test(line));
            if (m) {
                const rest = line.replace(m.re, '');
                const label = m.label || line.trim().slice(0, line.trim().length - rest.trim().length).trim();
                if (m.type === 'branch') speaker = /浦/.test(label) ? 'ura' : speaker;
                else speaker = null;
                block = { type: m.type, label, lines: rest.trim() ? [rest.trim()] : [] };
                sec.blocks.push(block);
                continue;
            }
            // 目印の無い行: 直前のカードの続き(空行のあとの、注意書き・分岐見出しの後ろは本文として新しく始める)
            if (!block || block.type === 'branch' || (block.type === 'note' && block.gap)) {
                block = { type: block && block.type === 'branch' && speaker ? speaker : 'text', label: '', lines: [] };
                sec.blocks.push(block);
            } else if (block.gap && block.lines.length) block.lines.push('');
            block.gap = false;
            block.lines.push(line.trim());
        }
        // 質問の番号と、対応する右側の入力欄。（回答）には入力欄の番号(セクション内で何番目の（回答）か)を付ける
        out.forEach(s => {
            let n = 0, na = 0;
            s.blocks.forEach(b => {
                delete b.gap;
                if (b.type === 'ans') { na++; b.aid = `${s.id}-${na}`; return; }
                if (b.type !== 'q') return;
                n++;
                b.qid = `hs-q-${s.id}-${n}`;
                const text = b.lines.join('');
                const rule = FIELD_RULES[s.id] || { def: null };
                const w = (rule.words || []).find(([re]) => re.test(text));
                b.field = w ? w[1] : rule.def;
            });
        });
        return out;
    }

    window.HearingManual = {
        SECTIONS,
        parse,
        // 本文が未設定なら null
        get() { const raw = window.HEARING_MANUAL_RAW != null ? window.HEARING_MANUAL_RAW : RAW; return raw ? parse(raw) : null; }
    };
})();
