// Global Error Handler to display error on screen directly
window.onerror = function(message, source, lineno, colno, error) {
    const errorDiv = document.createElement('div');
    errorDiv.style = "position:fixed; top:0; left:0; width:100%; background:red; color:white; padding:16px; z-index:99999; font-family:monospace; font-size:0.9rem; line-height:1.4; box-shadow:0 4px 12px rgba(0,0,0,0.3); word-break:break-all;";
    errorDiv.innerHTML = `<strong>GLOBAL ERROR:</strong> ${message}<br><strong>URL:</strong> ${source}<br><strong>Line:</strong> ${lineno}:${colno}<br><strong>Stack:</strong> ${error ? error.stack : 'N/A'}`;
    document.body.appendChild(errorDiv);
    return false;
};

// ズーム（ピンチイン・ピンチアウト・ダブルタップ等）を禁止して画面サイズを固定する
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
}, { passive: false });

// Supabase Configuration
const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
let supabaseClient = null;

let formData = null;
let currentSlideIndex = 0;
const answers = {};
let slidesCount = 0;

// ============================================================================
// 表示速度の改善(2026-11-06 コージさん指示「すぐ表示されるように」)
// 以前: 外部CDN(アイコン・Supabaseライブラリ)の読み込みが終わってから、はじめてフォームの中身を
//       取りに行っていた。CDNが遅いと、その間ずっと何も表示されなかった(体感10秒)。
// 今回: ① フォームの中身の取得は index.html で画面の読み込みと同時に開始(window.__meoFormPromise)
//       ② CDN は async にして、書き込み(閲覧ログ・回答保存)が必要になった時だけ準備を待つ
//       ③ データが届いたら、待ち時間を入れずにすぐ表示する
// ============================================================================
// Supabaseライブラリ(CDN)の準備を待って、クライアントを返す。maxWaitMs 待っても無ければ null。
function getSupabaseClient(maxWaitMs = 10000) {
    if (supabaseClient) return Promise.resolve(supabaseClient);
    return new Promise(resolve => {
        const t0 = Date.now();
        const tick = () => {
            if (window.supabase) {
                supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
                return resolve(supabaseClient);
            }
            if (Date.now() - t0 >= maxWaitMs) return resolve(null);
            setTimeout(tick, 50);
        };
        tick();
    });
}

// フォームの行を取得する。①index.htmlで先に始めた取得 → ②失敗したら従来の方法(Supabaseライブラリ)で取り直す
async function fetchFormRows() {
    if (window.__meoFormPromise) {
        try {
            const rows = await window.__meoFormPromise;
            if (Array.isArray(rows)) return rows;
        } catch (e) {
            console.warn('先行取得に失敗したため、取り直します:', e);
        }
    }
    const client = await getSupabaseClient(15000);
    if (!client) throw new Error("Supabaseライブラリの読み込みに失敗しました。ネット環境を確認してください。");
    const { data, error } = await client.from('customers').select('*').eq('service_type', 'meo_form');
    if (error) throw error;
    return data;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await fetchFormRows();

        if (!data || data.length === 0) {
            showError("現在利用できるフォームがありません。管理画面で「保存」を実行してください。");
            return;
        }

        formData = data[0].data;
        document.title = formData.title || "分析フォーム";
        
        // テーマ（文字色・サイズ）の適用
        if (formData.theme) {
            const root = document.documentElement;
            if(formData.theme.titleColor) root.style.setProperty('--title-color', formData.theme.titleColor);
            if(formData.theme.descColor) root.style.setProperty('--desc-color', formData.theme.descColor);
            if(formData.theme.titleSize) root.style.setProperty('--title-size', formData.theme.titleSize);
            if(formData.theme.descSize) root.style.setProperty('--desc-size', formData.theme.descSize);
        }

        // 非同期でViewのログ保存（リロード時はカウントしない）
        if (!sessionStorage.getItem('meo_form_view_logged')) {
            logStat('view');
            sessionStorage.setItem('meo_form_view_logged', 'true');
            
            // Chatworkアクセス通知
            const urlParams = new URLSearchParams(window.location.search);
            const ref = urlParams.get('ref') || '';
            fetch('/api/chatwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'access', ref: ref, formData: formData })
            }).catch(e => console.error('Chatwork access notification failed', e));
        }

        renderForm();
        setupCloseConfirm();
        setupViewportFit();

        // カレンダー日程調整設問の初期読み込み
        document.querySelectorAll('.booking-widget-container').forEach(container => {
            const qId = container.id.replace('booking-', '');
            const q = formData.questions.find(x => x.id === qId);
            loadCalendarBookingSlots(q, container);
        });

        // データが届いたらすぐ表示する(以前は 0.1秒 + 0.5秒 の待ちを入れてからフェードインしていた)
        {
            const loader = document.getElementById('loading');
            if (loader) loader.style.display = 'none';
            const container = document.getElementById('form-container');
            if (container) {
                container.style.display = 'block';
                void container.offsetWidth;
                container.style.opacity = '1';
            }
            const nav = document.getElementById('nav-controls');
            if (nav) nav.style.display = 'flex';
            updateView();
        }

    } catch (err) {
        console.error(err);
        showError("フォームの読み込みに失敗しました。<br><small style='font-size:0.8rem;color:#999;'>" + err.message + "</small>");
    }
});

// ============================================================================
// 「今月◯名が診断を受けています」の表示人数を計算する
// コージさんからの直接指示による仕様(2026-08-20)。サーバー保存やcronは使わず、
// 「今日の日付」から毎回その場で計算する完全な計算式にしている(= 自動で
// 日々変わり、1日になれば自動的にリセットされる。データベースの更新処理も
// 手動更新も不要)。同じ月・同じ日であれば、誰がいつ見ても同じ人数になる。
//
// 絶対ルール(コージさん指示、2026-08-20):
//   ・1ヶ月のMAXは32〜45名の範囲におさまる(月末までにその範囲内であればOK)
//   ・日付が変わっているのに人数が変わらないのはNG(必ず毎日変化する)
//   ・翌日が前日より低い数値になるのはNG(必ず増える。減らない)
//   ・1日あたりの振り幅は1〜2名(いきなり大きく増えるのはNG)
//   ・それ以外は自動ランダムでよい
//
// キャンペーン月の固定表示(コージさん指示、2026-09-04・2026-09-04追加指示で確定値に変更):
//   2026年9月のみ、通常のランダム計算式ではなく「日付ごとの確定値」を
//   そのまま表示する。指定内容:9/4=17名, 9/5=22名, 9/6=25名、
//   月末(9/30)着地=86名。9/7以降は9/6(25名)→9/30(86名)を毎日必ず
//   増える(2〜3名/日)なだらかな数列で自動補間した固定値。
//   FIXED_MONTHLY_SEQUENCESに登録されていない月(10月以降含む)は
//   自動的に元の通常ロジック(2〜4名開始/32〜45名着地のランダム式)に
//   戻るため、来月以降は何も操作しなくてよい。
// ============================================================================
const FIXED_MONTHLY_SEQUENCES = {
    // "YYYY-M": [1日目の値, 2日目の値, ... 月末までの値]
    "2026-9": [13, 14, 15, 17, 22, 25, 28, 30, 33, 35, 38, 40, 43, 45, 48, 50, 53, 55, 58, 60, 63, 65, 68, 70, 73, 75, 78, 80, 83, 86],
};

function getMonthlyDiagnosisCount(targetDate) {
    const date = targetDate || new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const dayOfMonth = date.getDate();
    const daysInMonth = new Date(year, month, 0).getDate();

    // 固定シーケンスが設定されている月は、その日の確定値をそのまま返す。
    const fixedSeq = FIXED_MONTHLY_SEQUENCES[`${year}-${month}`];
    if (fixedSeq) {
        const idx = Math.min(dayOfMonth, fixedSeq.length) - 1;
        return fixedSeq[idx];
    }

    // ---- ここから通常月の自動ランダム計算式(2026-08-20仕様) ----
    // 絶対ルール:
    //   ・1ヶ月のMAXは32〜45名の範囲におさまる(月末までにその範囲内であればOK)
    //   ・日付が変わっているのに人数が変わらないのはNG(必ず毎日変化する)
    //   ・翌日が前日より低い数値になるのはNG(必ず増える。減らない)
    //   ・1日あたりの振り幅は1〜2名(いきなり大きく増えるのはNG)
    //   ・それ以外は自動ランダムでよい
    const startMin = 2;
    const startMax = 4;
    const endMin = 32;
    const endMax = 45;

    // 年月ごとに固定されるseed → 同じ月なら常に同じ数列(一貫性のため)。
    // 月が変われば別のseedになるので、結果として毎月自動的にリセット・再生成される。
    const seed = year * 100 + month;

    // シンプルな決定論的擬似乱数生成器(mulberry32)
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const rand = mulberry32(seed);

    // 1日目の人数(2〜4名からランダムに決定。例:1日は2名〜)
    const startRange = startMax - startMin + 1;
    const startVal = startMin + Math.floor(rand() * startRange);

    // 2日目以降、前日より1〜2名ずつ積み上げていく。
    // 「残り日数ぶんを最速(+2/日)で増やしても45名を超えない」
    // 「残り日数ぶんを最遅(+1/日)で増やしても32名を下回らない」
    // という条件を毎日チェックしながら増加数を選ぶことで、月末に必ず
    // 32〜45名の範囲へ着地するようにしている。
    const counts = [null, startVal];
    for (let day = 2; day <= daysInMonth; day++) {
        const remainingAfter = daysInMonth - day;
        const prev = counts[day - 1];
        const candidates = [1, 2].filter(inc => {
            const v = prev + inc;
            return (v + remainingAfter * 1 <= endMax) && (v + remainingAfter * 2 >= endMin);
        });
        let inc;
        if (candidates.length === 2) {
            inc = rand() < 0.6 ? 1 : 2; // なだらかに増えるよう+1をやや優先
        } else if (candidates.length === 1) {
            inc = candidates[0];
        } else {
            // 通常はここに来ないはずの保険(範囲内に収まる側を優先)
            inc = (prev + 1 + remainingAfter * 2 >= endMin) ? 1 : 2;
        }
        counts[day] = prev + inc;
    }

    return counts[Math.min(dayOfMonth, daysInMonth)];
}

// ============================================================================
// 管理画面(分析フォームエディタ)で編集できる設定の反映用ヘルパー(2026-10 追加)
// ・色/サイズはstyle属性に入るため、形式チェックを通った値だけを使う
// ・テキストは必ずHTMLエスケープしてから挿入する(管理画面の入力値が
//   そのままHTMLとして解釈されないようにする)
// ============================================================================
function escapeHtmlText(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function sanitizeRichHtml(html) {
    // 管理画面のリッチテキスト(補足説明・POP文言)を、許可した要素・書式だけに絞って返す。
    // ホワイトリスト方式: 許可タグ以外は外し(script等は中身ごと破棄)、style は
    // 色・背景色・文字サイズ・太さ・斜体・下線/取消線・配置だけを形式チェックして残す。
    // リンクは http(s)/mailto/tel のみ。出力は createElement で組み立て直すので、
    // 入力に含まれる属性(onclick 等)が出力に混ざることはない。
    // ※ 同じ関数が js/pages/form_editor.js(MEOFormPreview)にもある。変更時は両方そろえること。
    const src = String(html == null ? '' : html).slice(0, 30000);
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + src, 'text/html');
    const out = document.createElement('div');
    const ALLOW = { B:'b', STRONG:'b', I:'i', EM:'i', U:'u', S:'s', STRIKE:'s', DEL:'s', SPAN:'span', DIV:'div', P:'p', BR:'br', UL:'ul', OL:'ol', LI:'li', A:'a', HR:'hr' };
    const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','NOSCRIPT','IMG','VIDEO','AUDIO','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','BASE','HEAD','TITLE','CANVAS','FRAME','FRAMESET','APPLET']);
    const cssColor = (v) => {
        v = String(v == null ? '' : v).trim();
        if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
        if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(v)) return v;
        if (/^[a-zA-Z]{3,20}$/.test(v) && !/^(initial|inherit|unset|revert|revertlayer)$/i.test(v)) return v;
        return '';
    };
    const cleanStyle = (from, to) => {
        const s = from.style;
        if (!s) return;
        const col = cssColor(s.getPropertyValue('color'));
        if (col) to.style.color = col;
        const bg = cssColor(s.getPropertyValue('background-color'));
        if (bg) to.style.backgroundColor = bg;
        const fs = s.getPropertyValue('font-size').trim();
        const m = /^(\d+(?:\.\d+)?)(rem|em|px|%)$/.exec(fs);
        if (m) {
            const n = parseFloat(m[1]);
            const lim = { rem: 6, em: 6, px: 120, '%': 600 }[m[2]];
            if (n > 0 && n <= lim) to.style.fontSize = fs;
        }
        const fw = s.getPropertyValue('font-weight').trim();
        if (/^(normal|bold|bolder|lighter|[1-9]00)$/.test(fw)) to.style.fontWeight = fw;
        const fst = s.getPropertyValue('font-style').trim();
        if (/^(normal|italic)$/.test(fst)) to.style.fontStyle = fst;
        const td = (s.getPropertyValue('text-decoration-line') || s.getPropertyValue('text-decoration')).trim();
        if (td && td.split(/\s+/).every(t => /^(underline|line-through|none)$/.test(t))) to.style.textDecoration = td;
        const ta = s.getPropertyValue('text-align').trim();
        if (/^(left|center|right|justify)$/.test(ta)) to.style.textAlign = ta;
    };
    const walk = (node, parent, depth) => {
        if (depth > 30) return;
        node.childNodes.forEach(ch => {
            if (ch.nodeType === 3) { parent.appendChild(document.createTextNode(ch.nodeValue)); return; }
            if (ch.nodeType !== 1) return;
            const tag = ch.tagName;
            if (DROP.has(tag)) return;
            if (tag === 'FONT') {
                const span = document.createElement('span');
                const c = cssColor(ch.getAttribute('color'));
                if (c) span.style.color = c;
                parent.appendChild(span);
                walk(ch, span, depth + 1);
                return;
            }
            const name = ALLOW[tag];
            if (!name) { walk(ch, parent, depth + 1); return; }
            if (name === 'br' || name === 'hr') { parent.appendChild(document.createElement(name)); return; }
            if (name === 'a') {
                const href = String(ch.getAttribute('href') || '').trim();
                if (!/^(https?:\/\/|mailto:|tel:)/i.test(href) || /[\u0000-\u001f\s]/.test(href)) { walk(ch, parent, depth + 1); return; }
                const a = document.createElement('a');
                a.setAttribute('href', href);
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                walk(ch, a, depth + 1);
                parent.appendChild(a);
                return;
            }
            const el = document.createElement(name);
            cleanStyle(ch, el);
            walk(ch, el, depth + 1);
            parent.appendChild(el);
        });
    };
    walk(doc.body, out, 0);
    return out.innerHTML;
}

// 補足説明の表示用HTML: 管理画面のリッチテキスト(descHtml)があればそれを、
// なければ従来のプレーンテキスト(description)を、どちらもサニタイズして返す。
function richDescHtml(o, fallbackText) {
    o = o || {};
    if (typeof o.descHtml === 'string' && o.descHtml.trim() !== '') return sanitizeRichHtml(o.descHtml);
    const plain = String(o.description || fallbackText || '');
    return sanitizeRichHtml(plain.replace(/\r?\n/g, '<br>'));
}
function hasDescContent(o) {
    return !!(o && ((typeof o.descHtml === 'string' && o.descHtml.trim() !== '') || o.description));
}
function safeCssColor(v) {
    return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : '';
}
function safeCssSize(v) {
    return (typeof v === 'string' && /^[0-9]+(\.[0-9]+)?(rem|em|px)$/.test(v.trim())) ? v.trim() : '';
}

// 申込人数表示(OP画面のスタートボタン下)。
// 既定(設定なし)は従来どおり getMonthlyDiagnosisCount() の自動計算値で、
// 管理画面で「表示ON/OFF・文言({n}が人数)・手動人数・文字色」を変更できる。
//   ※ この関数と同じ表示ロジックが js/pages/form_editor.js のプレビューにもある。
//     変更するときは両方そろえること。
const DEFAULT_COUNT_TEXT = '【今月{n}名が診断を申込しています】';
function resolveDiagnosisCount(op) {
    op = op || {};
    if (op.countMode === 'manual' && op.countManual !== null && op.countManual !== undefined && String(op.countManual).trim() !== '') {
        const n = Math.floor(Number(op.countManual));
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return getMonthlyDiagnosisCount();
}
function renderDiagnosisCountHtml(op) {
    op = op || {};
    if (op.countShow === false) return '';
    const tpl = (typeof op.countText === 'string' && op.countText.trim() !== '') ? op.countText : DEFAULT_COUNT_TEXT;
    const text = escapeHtmlText(tpl).replace(/\{n\}/g, String(resolveDiagnosisCount(op)));
    const color = safeCssColor(op.countColor);
    return `<div class="diagnosis-count-text"${color ? ` style="color: ${color};"` : ''}>${text}</div>`;
}

// ×ボタン離脱確認POPの文言(管理画面で編集可)。未設定なら従来の文言。
const DEFAULT_CLOSE_POPUP = {
    enabled: true,
    icon: '!',
    title: '回答を中断しますか？',
    body: 'ここまで入力した回答内容は保存されず\n**すべて削除されます。**\n本当に終了しますか？',
    continueText: '続ける',
    exitText: '終了する'
};
function getClosePopupConfig() {
    const c = (formData && formData.closePopup) || {};
    const pick = (k) => (typeof c[k] === 'string' ? c[k] : DEFAULT_CLOSE_POPUP[k]);
    return {
        enabled: c.enabled !== false,
        icon: (typeof c.icon === 'string') ? c.icon : DEFAULT_CLOSE_POPUP.icon,
        title: pick('title') || DEFAULT_CLOSE_POPUP.title,
        body: (typeof c.body === 'string') ? c.body : DEFAULT_CLOSE_POPUP.body,
        continueText: pick('continueText') || DEFAULT_CLOSE_POPUP.continueText,
        exitText: pick('exitText') || DEFAULT_CLOSE_POPUP.exitText,
        // 管理画面のリッチテキスト(あればこちらを優先。なければ上の plain 文言)
        titleHtml: (typeof c.titleHtml === 'string') ? c.titleHtml : '',
        bodyHtml: (typeof c.bodyHtml === 'string') ? c.bodyHtml : ''
    };
}
// 本文: 改行はそのまま、**太字** だけ使える簡易記法(それ以外のHTMLは無効化)
function renderPopupBodyHtml(text) {
    return escapeHtmlText(text)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\r?\n/g, '<br>');
}
function applyClosePopupConfig() {
    const cfg = getClosePopupConfig();
    const set = (sel, fn) => { const el = document.querySelector(sel); if (el) fn(el); };
    set('#confirm-overlay .confirm-icon', el => { el.textContent = cfg.icon; el.style.display = cfg.icon ? '' : 'none'; });
    set('#confirm-overlay .confirm-title', el => {
        if (cfg.titleHtml.trim() !== '') el.innerHTML = sanitizeRichHtml(cfg.titleHtml); else el.textContent = cfg.title;
    });
    set('#confirm-overlay .confirm-body', el => {
        el.innerHTML = (cfg.bodyHtml.trim() !== '') ? sanitizeRichHtml(cfg.bodyHtml) : renderPopupBodyHtml(cfg.body);
    });
    set('#confirm-continue-btn', el => { el.textContent = cfg.continueText; });
    set('#confirm-exit-btn', el => { el.textContent = cfg.exitText; });
    return cfg;
}

function renderForm() {
    const container = document.getElementById('slide-container');
    let html = '';

    // タイトルと説明の個別の配置・フォントスタイルを適用するヘルパー
    const applyThemeStyle = (isTitle, pageObj) => {
        if (!formData.theme) return '';
        const alignVal = isTitle ? (pageObj.align || 'left') : (pageObj.descAlign || 'left');
        // 補足説明(isTitle=false)はページごとの色・太字を優先し、未設定なら全体設定を使う。
        // 値はCSSとして属性に埋め込まれるため、色/サイズは形式を検証して不正値は捨てる。
        const descColor = isTitle ? '' : safeCssColor(pageObj.descColor);
        const descSizeOwn = isTitle ? '' : safeCssSize(pageObj.descSize);
        const colorVal = isTitle ? (formData.theme.titleColor || 'inherit') : (descColor || formData.theme.descColor || 'inherit');
        const sizeVal = isTitle 
            ? (pageObj.titleSize || formData.theme.titleSize || 'inherit') 
            : (descSizeOwn || formData.theme.descSize || 'inherit');
        const boldCss = (!isTitle && (pageObj.descBold === true || pageObj.descBold === 'true')) ? ' font-weight: 700;' : '';
        return `color: ${colorVal}; font-size: ${sizeVal}; text-align: ${alignVal}; width: 100%;${boldCss}`;
    };

    const getAlignClass = (obj) => {
        return obj && obj.align ? `align-${obj.align}` : 'align-left';
    };

    // OP Slide (Index 0)
    html += `
        <div class="slide ${getAlignClass(formData.op)}" id="slide-0" data-type="op">
            ${formData.op.imageUrl ? `<div class="slide-img-container"><img src="${formData.op.imageUrl}" class="slide-img" decoding="async"></div>` : ''}
            <div class="slide-title" style="${applyThemeStyle(true, formData.op)}">${formData.op.title || ''}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.op)}">${richDescHtml(formData.op)}</div>
            <button class="btn-primary" onclick="handleOpStart()">${formData.op.buttonText || 'スタート'}</button>
            ${renderDiagnosisCountHtml(formData.op)}
        </div>
    `;

    // Question Slides
    formData.questions.forEach((q, idx) => {
        const slideIdx = idx + 1;
        const alignClass = getAlignClass(q);
        html += `<div class="slide ${alignClass}" id="slide-${slideIdx}" data-type="question" data-id="${q.id}" data-required="${q.required}">`;
        
        if (q.imageUrl) {
            html += `<div class="slide-img-container"><img src="${q.imageUrl}" class="slide-img" decoding="async"></div>`;
        }
        const reqMark = q.required ? '<span class="required-mark">*</span>' : '';
        html += `<div class="slide-title" style="${applyThemeStyle(true, q)}">${idx + 1}. ${q.title || ''}${reqMark}</div>`;
        if (hasDescContent(q)) {
            html += `<div class="slide-desc" style="${applyThemeStyle(false, q)}">${richDescHtml(q)}</div>`;
        }

        const placeholderText = q.placeholder !== undefined ? q.placeholder : "こちらに回答を入力...";

        if (q.type === 'short_text') {
            html += `<input type="text" class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}">`;
        } else if (q.type === 'long_text') {
            html += `<textarea class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}" rows="1" style="height:48px; min-height:48px; resize:none; overflow-y:hidden;"></textarea>`;
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%; text-align: left;">改行するには Enter ↵ キーを押してください</div>`;
        } else if (q.type === 'dropdown') {
            html += `<select class="dropdown-select q-select" data-id="${q.id}" onchange="handleDropdownSelect('${q.id}', this)">`;
            html += `<option value="">選択してください...</option>`;
            (q.choices || []).forEach(c => {
                html += `<option value="${c}">${c}</option>`;
            });
            html += `</select>`;
        } else if (q.type === 'multiple_choice') {
            html += `<div class="choices-container" style="width:100%;">`;
            (q.choices || []).forEach((c, cIdx) => {
                const alpha = String.fromCharCode(65 + cIdx);
                html += `
                    <div class="choice-box" onclick="selectChoice('${q.id}', '${c}', this, ${q.allowMultiple === true})">
                        <div class="choice-alpha">${alpha}</div> ${c}
                    </div>
                `;
            });
            html += `</div>`;
        } else if (q.type === 'calendar_booking') {
            html += `
                <div class="booking-widget-container" id="booking-${q.id}" style="width:100%;">
                    <div style="display:flex; justify-content:center; align-items:center; padding:32px;">
                        <i class="ph ph-spinner ph-spin" style="font-size:2rem; color:var(--primary-color);"></i>
                        <span style="margin-left:12px; font-weight:500;">空き日程を取得中...</span>
                    </div>
                </div>
            `;
        }
        
        html += `<div class="error-msg" id="err-${q.id}">必須項目です。回答を入力してください。</div>`;
        
        const isMultiple = (q.type === 'multiple_choice' && q.allowMultiple === true);
        if (isMultiple || q.type === 'short_text' || q.type === 'long_text') {
            html += `<div style="margin-top:32px; width: 100%;"><button class="btn-primary" onclick="goNext()">OK <i class="ph ph-check"></i></button></div>`;
        }
        html += `</div>`;
    });

    // Review Slide (Index N+1)
    const reviewIdx = formData.questions.length + 1;
    html += `
        <div class="slide scrollable ${getAlignClass(formData.review)}" id="slide-${reviewIdx}" data-type="review">
            <div class="slide-title" style="${applyThemeStyle(true, formData.review)}">${formData.review.title || '回答内容の確認'}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.review)}">${richDescHtml(formData.review, '以下の内容でよろしいですか？')}</div>
            <div id="review-content" style="margin-bottom:32px; width:100%;"></div>
            <button class="btn-primary" id="submit-btn" onclick="submitForm()">${formData.review.buttonText || 'この内容で提出する'}</button>
        </div>
    `;

    // ED Slide (Index N+2)
    const edIdx = formData.questions.length + 2;
    html += `
        <div class="slide ${getAlignClass(formData.ed)}" id="slide-${edIdx}" data-type="ed">
            ${formData.ed.imageUrl ? `<div class="slide-img-container"><img src="${formData.ed.imageUrl}" class="slide-img" decoding="async"></div>` : ''}
            <div class="slide-title" style="${applyThemeStyle(true, formData.ed)}">${formData.ed.title || ''}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.ed)}">${richDescHtml(formData.ed)}</div>
            <button class="btn-primary" onclick="closeFormWindow()">${formData.ed.buttonText || '終了する'}</button>
            <div id="close-guide" style="font-size:0.8rem; color:var(--text-secondary); margin-top:12px; display:none; width: 100%;">※自動で画面が閉じない場合は、ブラウザのタブを閉じてください。</div>
        </div>
    `;

    container.innerHTML = html;
    slidesCount = formData.questions.length + 3;

    document.querySelectorAll('.q-input').forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
                goNext();
            }
        });
        el.addEventListener('input', (e) => {
            answers[e.target.getAttribute('data-id')] = e.target.value;
            document.getElementById('err-' + e.target.getAttribute('data-id')).classList.remove('visible');
            if (e.target.tagName === 'TEXTAREA') {
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
            }
        });
    });

    document.getElementById('btn-prev').addEventListener('click', goPrev);
    document.getElementById('btn-next').addEventListener('click', () => {
        if (currentSlideIndex === reviewIdx || currentSlideIndex === edIdx) return;
        goNext();
    });
}

function handleOpStart() {
    if (!sessionStorage.getItem('meo_form_start_logged')) {
        logStat('start');
        sessionStorage.setItem('meo_form_start_logged', 'true');
    }
    goNext();
}

function handleDropdownSelect(qId, selectEl) {
    const val = selectEl.value;
    if (val) {
        answers[qId] = val;
        document.getElementById('err-' + qId).classList.remove('visible');
        setTimeout(goNext, 300);
    } else {
        answers[qId] = "";
    }
}

function selectChoice(qId, val, el, isMultiple) {
    if (!answers[qId]) answers[qId] = [];
    
    if (isMultiple) {
        const idx = answers[qId].indexOf(val);
        if (idx > -1) {
            answers[qId].splice(idx, 1);
            el.classList.remove('selected');
        } else {
            answers[qId].push(val);
            el.classList.add('selected');
        }
    } else {
        answers[qId] = [val];
        const container = el.parentElement;
        container.querySelectorAll('.choice-box').forEach(box => box.classList.remove('selected'));
        el.classList.add('selected');
        setTimeout(goNext, 300);
    }
    document.getElementById('err-' + qId).classList.remove('visible');
}

function validateCurrentSlide() {
    const slide = document.getElementById(`slide-${currentSlideIndex}`);
    if (slide && slide.getAttribute('data-type') === 'question') {
        const isRequired = slide.getAttribute('data-required') === 'true';
        const qId = slide.getAttribute('data-id');
        
        if (isRequired) {
            const val = answers[qId];
            if (!val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && val.trim() === '')) {
                const errMsg = document.getElementById('err-' + qId);
                if (errMsg) errMsg.classList.add('visible');
                return false;
            }
        }
    }
    return true;
}

function goNext() {
    if (currentSlideIndex >= slidesCount - 1) return;
    if (document.getElementById(`slide-${currentSlideIndex}`).getAttribute('data-type') === 'ed') return;
    if (!validateCurrentSlide()) return;
    
    currentSlideIndex++;
    updateView();
    
    // 進むたびに、回答内容をリアルタイムで一時保存（離脱ステータス 'abandoned'）
    saveResponseProgress('abandoned').catch(e => console.error("Temp save failed:", e));
}

function goPrev() {
    if (currentSlideIndex <= 0) return;
    if (document.getElementById(`slide-${currentSlideIndex}`).getAttribute('data-type') === 'ed') return;
    currentSlideIndex--;
    updateView();
}

function renderReviewContent() {
    const container = document.getElementById('review-content');
    if (!container) return;
    let html = '';
    
    formData.questions.forEach((q, idx) => {
        let ans = answers[q.id];
        let displayAns = '<span style="color:#aaa;">(未回答)</span>';
        
        if (ans) {
            if (Array.isArray(ans)) {
                if (ans.length > 0) displayAns = ans.join(', ');
            } else if (typeof ans === 'string' && ans.trim() !== '') {
                displayAns = ans.replace(/\n/g, '<br>');
            }
        }
        
        html += `
            <div class="review-item">
                <div class="review-q">${idx + 1}. ${q.title}</div>
                <div class="review-a">${displayAns}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ============================================================================
// スマホでキーボードが出たときに「入力している文字が見えない」問題の対策(2026-11-06 コージさん指示)
// 原因(1): キーボードで画面の見える高さが小さくなり、質問文+説明+入力欄が収まらず、
//          上下中央寄せの副作用で「上側」が画面の外に出てしまい(スクロールもできず)入力欄が隠れていた。
// 原因(2): 長文の入力欄は、フォーカスした瞬間にだけ高さを決めていたので、入力して行が増えても
//          高さが広がらず、2行目以降が見えなかった。
// 対策: ・スライドの中をスクロールできるようにし(CSS)、入力欄を必ず見える位置へスクロールする
//       ・入力のたびに長文欄の高さを広げる(画面の4割まで。それ以上は欄の中でスクロール)
//       ・iPhoneのSafariのようにキーボードで「見える高さ」だけが縮む環境では、その高さに合わせる
// ============================================================================
function autoGrowTextarea(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 600;
    const maxH = Math.max(96, Math.round(vh * 0.4));
    el.style.height = 'auto';
    const full = el.scrollHeight;
    el.style.height = Math.min(full, maxH) + 'px';
    el.style.overflowY = full > maxH ? 'auto' : 'hidden';
    if (full > maxH && document.activeElement === el) el.scrollTop = el.scrollHeight; // 打っている最後の行が見えるように
}

// 入力欄(と、その下の「OK」ボタンまで)が、見える範囲に入るよう、スライドをスクロールする
function ensureInputVisible() {
    const el = document.activeElement;
    if (!el || !el.classList || !el.classList.contains('q-input')) return;
    const slide = el.closest('.slide');
    if (!slide) return;
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const r = el.getBoundingClientRect();
    const margin = 12;
    let delta = 0;
    if (r.bottom > viewBottom - margin) delta = r.bottom - (viewBottom - margin);   // 下に隠れている → 上へ
    if (r.top - delta < viewTop + margin) delta = r.top - (viewTop + margin);       // 上に隠れている → 下へ
    if (delta) slide.scrollTop += delta;
}

function setupViewportFit() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
        if (vv) {
            // キーボードなどで「見えている高さ」が実際の画面より小さいときだけ、その高さに合わせる
            if (window.innerHeight - vv.height > 80) root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
            else root.style.removeProperty('--app-h');
            // iOSはキーボード表示時にページ全体を上へずらすことがあるので戻す
            if (vv.offsetTop > 0) window.scrollTo(0, 0);
        }
        const el = document.activeElement;
        if (el && el.tagName === 'TEXTAREA' && el.classList.contains('q-input')) autoGrowTextarea(el);
        ensureInputVisible();
    };
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    window.addEventListener('resize', apply);
    document.addEventListener('focusin', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('q-input')) {
            // キーボードが出きるのを待ってから、見える位置へ
            setTimeout(apply, 120); setTimeout(apply, 400);
        }
    });
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('q-input')) {
            if (t.tagName === 'TEXTAREA') autoGrowTextarea(t);
            ensureInputVisible();
        }
    });
    apply();
}

function updateView() {
    for (let i = 0; i < slidesCount; i++) {
        const slide = document.getElementById(`slide-${i}`);
        if (!slide) continue;
        if (i < currentSlideIndex) {
            slide.className = slide.className.replace('active', '').trim() + ' prev';
        } else if (i === currentSlideIndex) {
            slide.className = slide.className.replace('prev', '').trim() + ' active';
            
            const type = slide.getAttribute('data-type');
            if (type === 'question') {
                const qId = slide.getAttribute('data-id');
                const reachKey = 'meo_form_reach_' + qId;
                if (!sessionStorage.getItem(reachKey)) {
                    logStat('reach', qId);
                    sessionStorage.setItem(reachKey, 'true');
                }
            } else if (type === 'review') {
                // 確認画面に着いたことを記録(1セッション1回。記録に失敗してもフォームの動きには影響させない)
                try {
                    if (!sessionStorage.getItem('meo_form_review_logged')) {
                        logStat('review');
                        sessionStorage.setItem('meo_form_review_logged', 'true');
                    }
                } catch (e) { /* 記録だけの処理なので無視 */ }
                renderReviewContent();
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'none';
            } else if (type === 'ed') {
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'none';
            } else {
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'flex';
            }

            const input = slide.querySelector('.q-input');
            if (input) {
                setTimeout(() => {
                    input.focus();
                    if (input.tagName === 'TEXTAREA') autoGrowTextarea(input);
                    ensureInputVisible();
                }, 600);
            }
        } else {
            slide.className = slide.className.replace('active', '').replace('prev', '').trim();
        }
    }

    const progress = ((currentSlideIndex) / (slidesCount - 2)) * 100;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = `${Math.min(progress, 100)}%`;

    const navControls = document.getElementById('nav-controls');
    if(navControls && navControls.style.display !== 'none') {
        const prevBtn = document.getElementById('btn-prev');
        if (prevBtn) prevBtn.style.opacity = currentSlideIndex === 0 ? '0.5' : '1';
        const nextBtn = document.getElementById('btn-next');
        if (nextBtn) nextBtn.style.opacity = '1';
    }
}

async function submitForm() {
    const btn = document.getElementById('submit-btn');
    if (!btn) return;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 送信中...';
    btn.disabled = true;
    const submitT0 = Date.now();
    let submitPath = 'form';

    try {
        const bookingQuestion = (formData.questions || []).find(q => q.type === 'calendar_booking');
        const responseId = sessionStorage.getItem('meo_form_response_id');
        
        if (bookingQuestion) {
            submitPath = 'booking';
            // カレンダー連携＋UTAGE連携用APIを呼び出す
            const res = await fetch('/api/booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    formId: formData.id || 'default',
                    qId: bookingQuestion.id,
                    answers: answers,
                    responseId: responseId
                })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || '予約処理に失敗しました。');
            }
        } else {
            // 通常のフォーム提出処理
            const savedOk = await saveResponseProgress('completed');
            const loggedOk = await logStat('submission');
            // 保存や記録に失敗しても、従来どおり完了画面へ進む(見える化のため、失敗した内容だけ記録する)
            const failedParts = [savedOk === false ? 'save' : null, loggedOk === false ? 'stat' : null].filter(Boolean);
            if (failedParts.length) { recordSubmitResult('error', submitPath, Date.now() - submitT0, failedParts.join('+')); }
            else { recordSubmitResult('ok', submitPath, Date.now() - submitT0); }
        }
        if (submitPath === 'booking') recordSubmitResult('ok', submitPath, Date.now() - submitT0);

        // Chatwork送信完了通知
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get('ref') || '';
        fetch('/api/chatwork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'submit', ref: ref, answers: answers, formData: formData })
        }).catch(e => console.error('Chatwork submit notification failed', e));

        currentSlideIndex++;
        updateView();
    } catch (e) {
        console.error("submitForm error:", e);
        recordSubmitResult('error', submitPath, Date.now() - submitT0, (e && e.message) || 'unknown');
        alert(e.message || "送信中にエラーが発生しました。もう一度お試しください。");
        btn.innerHTML = 'この内容で提出する';
        btn.disabled = false;
    }
}

// 途中経過または完了時の回答データをリアルタイムで上書き保存・更新するメソッド
async function saveResponseProgress(status = 'abandoned') {
    try {
        // 離脱時(abandoned)は閉じるのを待たせないよう短く、それ以外は最大10秒ライブラリを待つ
        const client = await getSupabaseClient(status === 'abandoned' ? 3000 : 10000);
        if (!client) return false;

        // セッションごとのユニークIDの永続化
        let responseId = sessionStorage.getItem('meo_form_response_id');
        if (!responseId) {
            responseId = String(Date.now() + Math.floor(Math.random() * 1000));
            sessionStorage.setItem('meo_form_response_id', responseId);
        }

        const responseData = {
            id: responseId,
            formId: formData.id || 'default',
            answers: answers,
            submittedAt: new Date().toISOString(),
            status: status, // 'abandoned' or 'completed'
            device: navigator.userAgent
        };

        // UPSERT (idをキーにして上書き)
        const { error } = await client.from('customers').upsert([{ 
            id: parseInt(responseId), 
            service_type: 'meo_form_response', 
            data: responseData 
        }]);
        if (error) { console.error("saveResponseProgress error:", error); return false; }
        return true;

    } catch (e) {
        console.error("saveResponseProgress error:", e);
        return false;
    }
}

async function logStat(type, detailId = null) {
    try {
        const client = await getSupabaseClient(10000);
        if (!client) return false;
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const statData = { type: type, detail: detailId, timestamp: new Date().toISOString(), session: getSessionId() };
        const { error } = await client.from('customers').insert([{ id, service_type: 'meo_form_stats', data: statData }]);
        if (error) { console.error("logStat error:", error); return false; }
        return true;
    } catch (e) {
        console.error("logStat error:", e);
        return false;
    }
}

// 送信の結果(成功/失敗・経路・所要ミリ秒・失敗の内容)を1件記録する。待たずに送り、失敗してもフォームには影響させない。
// detail の形式: 「結果|経路|所要ms」、失敗のときは末尾に「|内容」(例: error|form|8400|save)
function recordSubmitResult(result, path, ms, reason) {
    try {
        let detail = `${result}|${path}|${Math.round(ms)}`;
        if (reason) detail += '|' + String(reason).replace(/\s+/g, ' ').slice(0, 100);
        logStat('submit_result', detail);
    } catch (e) { /* 記録だけの処理なので無視 */ }
}

function getSessionId() {
    let sid = sessionStorage.getItem('meo_form_sid');
    if (!sid) {
        sid = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('meo_form_sid', sid);
    }
    return sid;
}

function showError(msg) {
    const loader = document.getElementById('loading');
    if (loader) {
        loader.innerHTML = `
            <div style="background:white; padding:32px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1); max-width:90%; width:400px; text-align:center;">
                <i class="ph ph-warning-circle" style="font-size:3rem; color:#dc3545; margin-bottom:16px; display:block;"></i>
                <div style="font-size:1.1rem; font-weight:600; color:#333; margin-bottom:12px; line-height:1.4;">${msg}</div>
            </div>
        `;
        loader.style.opacity = '1';
    }
}

function closeFormWindow() {
    if (formData && formData.ed && formData.ed.redirectUrl && formData.ed.redirectUrl.trim() !== '') {
        window.location.href = formData.ed.redirectUrl.trim();
    } else {
        window.close();
        const guide = document.getElementById('close-guide');
        if (guide) guide.style.display = 'block';
    }
}

// ============================================================================
// 離脱確認POPの「終了する」・×ボタン単独クリック時に使うタブクローズ処理
// (コージさん指示、2026-08-22)
// closeFormWindow() はED画面(診断完了後)の「終了する」ボタン専用として、
// formData.ed.redirectUrl (LINE誘導など) がある場合はそちらへリダイレクトする
// 仕様のまま残す。一方こちらは「回答を完了せずに自主的に離脱する」ケースなので、
// ED画面の誘導設定は使わず、必ずタブを閉じるだけにする。
// ============================================================================
function closeTabOnly() {
    // 「終了する」ポップアップを閉じてからタブを閉じる。
    // ブラウザの仕様上、スクリプトで開いたタブでない場合は window.close() が
    // 効かないことがあるが、その場合の代替メッセージ(手動で閉じてくださいの案内)は
    // 表示しない仕様(コージさん指示、2026-09-09)。
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) overlay.classList.remove('show');
    window.close();
}

// ============================================================================
// 回答途中で×ボタンを押した際の離脱確認POP(コージさん指示、2026-08-22)
// ・OP画面(まだ何も回答していない)や、既に送信済みのED画面ではまだ/もう
//   削除されるデータが無いため、確認なしでそのまま閉じる。
// ・質問中(question)・確認画面(review)の間に×を押した場合のみ、
//   「ここまでの回答が削除されます」という確認POPを表示する。
// ============================================================================
function setupCloseConfirm() {
    const closeBtn = document.getElementById('form-close-btn');
    const overlay = document.getElementById('confirm-overlay');
    const continueBtn = document.getElementById('confirm-continue-btn');
    const exitBtn = document.getElementById('confirm-exit-btn');
    if (!closeBtn || !overlay || !continueBtn || !exitBtn) return;

    const hasUnsavedAnswer = () => {
        const slide = document.getElementById(`slide-${currentSlideIndex}`);
        if (!slide) return false;
        const type = slide.getAttribute('data-type');
        return type === 'question' || type === 'review';
    };

    // 管理画面で編集されたPOP文言を反映(未設定なら従来の文言のまま)
    const popupCfg = applyClosePopupConfig();

    // 離脱処理: 入力途中の回答を最終保存してからタブを閉じる(従来の「終了する」と同じ)
    const exitNow = async () => {
        try {
            await saveResponseProgress('abandoned');
        } catch (e) {
            console.error('final saveResponseProgress before exit failed:', e);
        }
        closeTabOnly();
    };

    closeBtn.addEventListener('click', () => {
        if (hasUnsavedAnswer()) {
            if (popupCfg.enabled) {
                overlay.classList.add('show');
            } else {
                // 管理画面でPOPをOFFにした場合: 確認なしで離脱(進捗保存は従来どおり行う)
                exitNow();
            }
        } else {
            closeTabOnly();
        }
    });

    continueBtn.addEventListener('click', () => {
        overlay.classList.remove('show');
    });

    exitBtn.addEventListener('click', async () => {
        // 「終了する」を押した時点で、まだgoNext()を通っていない(＝Supabaseに
        // 保存される前の)入力中の回答が answers オブジェクトには残っているため、
        // 管理画面の「回答データ一覧」で最後まで正確に反映されるよう、閉じる前に
        // 最終状態を一度だけ保存してから閉じる。
        await exitNow();
    });
}

// カレンダー日程調整関連の関数
async function loadCalendarBookingSlots(q, container) {
    try {
        // カレンダーの空き時間スロットをバックエンドAPI経由で取得
        const formId = formData.id || 'default';
        const res = await fetch(`/api/calendar?formId=${encodeURIComponent(formId)}&qId=${encodeURIComponent(q.id)}`);
        const data = await res.json();
        
        if (data.error) {
            container.innerHTML = `<div style="color:#dc3545; font-weight:600; padding:16px;">日程の取得に失敗しました: ${data.error}</div>`;
            return;
        }

        container.dataset.slots = JSON.stringify(data.availableSlots || {});
        renderBookingUI(q, container, data.availableSlots || {});
    } catch (e) {
        console.error("loadCalendarBookingSlots error:", e);
        container.innerHTML = `<div style="color:#dc3545; font-weight:600; padding:16px;">エラーが発生しました。</div>`;
    }
}

function renderBookingUI(q, container, availableSlots) {
    const dates = Object.keys(availableSlots).sort();
    if (dates.length === 0) {
        container.innerHTML = `<div style="padding:24px; color:#666; font-weight:500;">選択可能な空き日程がありません。別の手段でお問い合わせください。</div>`;
        return;
    }

    let selectedDate = dates[0];
    
    const updateTimeSlots = (date) => {
        const slots = availableSlots[date] || [];
        const slotsGrid = container.querySelector('.booking-slots-grid');
        if (slots.length === 0) {
            slotsGrid.innerHTML = `<div style="color:#888; font-size:0.9rem; padding:12px; grid-column: 1/-1;">この日は空き時間がありません</div>`;
            return;
        }
        slotsGrid.innerHTML = slots.map(time => {
            const isSelected = (answers[q.id] === `${date} ${time}`);
            return `<div class="booking-slot-btn ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${q.id}', '${date}', '${time}', this)">${time}</div>`;
        }).join('');
    };

    container.innerHTML = `
        <div class="booking-widget">
            <div class="booking-days-container">
                ${dates.map((d, idx) => {
                    const dateObj = new Date(d);
                    const dayOfWeek = ['日','月','火','水','木','金','土'][dateObj.getDay()];
                    const dateLabel = `${dateObj.getMonth()+1}/${dateObj.getDate()}`;
                    return `
                        <div class="booking-day-card ${d === selectedDate ? 'active' : ''}" data-date="${d}" onclick="selectBookingDate('${q.id}', '${d}', this)">
                            <div class="day-name">${dayOfWeek}</div>
                            <div class="day-val">${dateLabel}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="booking-slots-title" style="font-weight:600; margin-top:20px; margin-bottom:12px; font-size:0.95rem; color:#333; text-align:left;">時間を選択してください</div>
            <div class="booking-slots-grid">
            </div>
        </div>
    `;

    updateTimeSlots(selectedDate);
}

window.selectBookingDate = function(qId, date, cardEl) {
    const container = document.getElementById(`booking-${qId}`);
    container.querySelectorAll('.booking-day-card').forEach(el => el.classList.remove('active'));
    cardEl.classList.add('active');
    
    const slotsGrid = container.querySelector('.booking-slots-grid');
    const slots = JSON.parse(container.dataset.slots)[date] || [];
    if (slots.length === 0) {
        slotsGrid.innerHTML = `<div style="color:#888; font-size:0.9rem; padding:12px; grid-column: 1/-1;">この日は空き時間がありません</div>`;
        return;
    }
    slotsGrid.innerHTML = slots.map(time => {
        const isSelected = (answers[qId] === `${date} ${time}`);
        return `<div class="booking-slot-btn ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${qId}', '${date}', '${time}', this)">${time}</div>`;
    }).join('');
};

window.selectBookingTime = function(qId, date, time, btnEl) {
    const container = document.getElementById(`booking-${qId}`);
    container.querySelectorAll('.booking-slot-btn').forEach(el => el.classList.remove('selected'));
    btnEl.classList.add('selected');
    
    answers[qId] = `${date} ${time}`;
    document.getElementById('err-' + qId).classList.remove('visible');
    
    // 選択されたら少し遅延させて自動で次のスライドへ
    setTimeout(goNext, 300);
};

