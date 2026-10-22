// Fixed data & Constants
const CONSTANTS = {
    ROLES: {
        ADMIN: 'admin',
        MEMBER: 'member'
    },
    SERVICES: {
        PLUS_ONE: 'Plus One',
        MEO: 'MEO対策チャンネル',
        TELECOM: '通信'
    },
    PLUS_ONE_TYPES: ['ショート', 'YouTube'],
    PLUS_ONE_STATUS: [
        '編集中', '初稿提出', '修正1', '修正1提出済み', 
        '修正2', '修正2提出済み', '修正3', '修正3提出済み', '納品'
    ],
    MEO_TAGS: ['契約中', '解約済み'],
    TELECOM_STATUS: ['未実行', '実行済み'],
    // MEOの契約プラン(初期値)。
    // 管理画面の「契約プランの管理」で保存すると、データベース(customers テーブル / service_type='meo_plans')の内容に置き換わる。
    // price: 金額(円) / months: 契約期間(ヶ月。満了予定月の自動計算に使う) / billing: 'monthly'=月額, 'lump'=一括
    // note: サービス内容のメモ / hidden: true だと新規登録のプルダウンに出さない(既存のお客様の売上計算には使い続ける)
    MEO_PLANS: [
        {name: '(旧)Standard Plan', price: 19800, months: 6, billing: 'monthly'},
        {name: '(新)Premiere Plan', price: 24800, months: 6, billing: 'monthly'},
        {name: 'Standard Plan', price: 24800, months: 6, billing: 'monthly'},
        {name: 'Premiere Plan', price: 39800, months: 6, billing: 'monthly'},
        {name: '(一括)Standard Plan', price: 272800, months: 12, billing: 'lump'},
        {name: '(一括)Premiere Plan', price: 437800, months: 12, billing: 'lump'},
        {name: '【モニター】', price: 0, months: 6, billing: 'monthly'}
    ],
    PLUS_ONE_PRICING: {
        'ショート': 4000,
        'YouTube': 20000
    }
};

// ===== MEOの契約プラン(管理画面から追加・変更できるようにしたもの) =====
// 保存先: customers テーブルの service_type='meo_plans' の行(1件)。data = { plans: [...] }
// 読み込んだプランで CONSTANTS.MEO_PLANS の中身を置き換えるので、売上計算(ダッシュボード・財務・売上シミュレーション)にもそのまま反映される。
window.MeoPlans = {
    rowId: null,
    loaded: false,
    normalize(p) {
        const billing = p.billing === 'lump' || p.billing === 'monthly'
            ? p.billing
            : ((p.name || '').includes('一括') ? 'lump' : 'monthly');
        const months = parseInt(p.months, 10);
        const ppm = parseInt(p.postsPerMonth, 10), mpm = parseInt(p.mediaPerMonth, 10);
        return {
            name: String(p.name || '').trim(),
            price: Math.max(0, parseInt(p.price, 10) || 0),
            months: months > 0 ? months : (billing === 'lump' ? 12 : 6),
            billing,
            note: p.note ? String(p.note) : '',
            hidden: !!p.hidden,
            // 月の作業の目標件数(「今月のMEO作業状況」で使う)。チェック欄の数が上限
            postsPerMonth: Number.isFinite(ppm) ? Math.min(12, Math.max(0, ppm)) : 12,
            mediaPerMonth: Number.isFinite(mpm) ? Math.min(6, Math.max(0, mpm)) : 6
        };
    },
    apply(plans) {
        const list = plans.map(p => this.normalize(p)).filter(p => p.name);
        CONSTANTS.MEO_PLANS.splice(0, CONSTANTS.MEO_PLANS.length, ...list);
    },
    async load(force = false) {
        if (this.loaded && !force) return CONSTANTS.MEO_PLANS;
        if (!window.Store) return CONSTANTS.MEO_PLANS;
        try {
            const rows = await Store.getCustomers('meo_plans');
            const row = rows.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
            if (row && Array.isArray(row.plans) && row.plans.length) {
                this.rowId = row.id;
                this.apply(row.plans);
            } else {
                this.rowId = row ? row.id : null;
                this.apply(CONSTANTS.MEO_PLANS);
            }
            this.loaded = true;
        } catch (e) {
            console.error('MEOプランの読み込みに失敗(初期値を使います)', e);
        }
        return CONSTANTS.MEO_PLANS;
    },
    async save(plans) {
        const list = plans.map(p => this.normalize(p)).filter(p => p.name);
        if (this.rowId) {
            await Store.updateCustomer('meo_plans', this.rowId, { plans: list, updatedAt: new Date().toISOString() });
        } else {
            await Store.addCustomer('meo_plans', { plans: list, updatedAt: new Date().toISOString() });
        }
        this.loaded = false;
        await this.load(true);
        // 保存できたかを読み直して確認(Store側は失敗しても例外を出さないため)
        const sig = (arr) => JSON.stringify(arr.map(p => [p.name, p.price, p.months, p.billing, p.note, p.hidden, p.postsPerMonth, p.mediaPerMonth]));
        if (sig(CONSTANTS.MEO_PLANS) !== sig(list)) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください。');
    },
    find(name) {
        return CONSTANTS.MEO_PLANS.find(p => p.name === name);
    }
};
CONSTANTS.MEO_PLANS.splice(0, CONSTANTS.MEO_PLANS.length, ...CONSTANTS.MEO_PLANS.map(p => window.MeoPlans.normalize(p)));

// ===== MEOの月ごとの作業(投稿状況・写真/動画アップロード)の共通部品 =====
// 保存先: 顧客データの posts = { 'YYYY-MM': [true/false ×12] } / media = { 'YYYY-MM': [true/false ×6] }
// 写真/動画のチェックを付けた日: mediaDates = { 'YYYY-MM': ['YYYY-MM-DD' または null ×6] }(media とは別に保存。日付の記録を始める前のチェックは null)
window.MeoWork = {
    POSTS_MAX: 12,
    MEDIA_MAX: 6,
    ymOf(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; },
    // 今月から過去 count ヶ月分のプルダウン用の一覧
    monthOptions(count = 12, now = new Date()) {
        const list = [];
        for (let i = 0; i < count; i++) {
            const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const label = dt.getFullYear() === now.getFullYear() ? `${dt.getMonth() + 1}月` : `${dt.getFullYear()}年${dt.getMonth() + 1}月`;
            list.push({ key: this.ymOf(dt), label: i === 0 ? `${label}(今月)` : label });
        }
        return list;
    },
    // その月のチェック(true/false の配列)
    checks(customer, type, ym) {
        const max = type === 'media' ? this.MEDIA_MAX : this.POSTS_MAX;
        const obj = customer && customer[type];
        const saved = obj && typeof obj === 'object' && !Array.isArray(obj) && Array.isArray(obj[ym]) ? obj[ym] : [];
        return Array.from({ length: max }, (_, i) => !!saved[i]);
    },
    // 今日の日付('YYYY-MM-DD')。この端末の日付(日本で使うので日本時間)で作る
    dayKey(dt = new Date()) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; },
    // 写真/動画のその月の「チェックを付けた日」(日付の配列。記録がないものは null)
    mediaDates(customer, ym) {
        const obj = customer && customer.mediaDates;
        const saved = obj && typeof obj === 'object' && !Array.isArray(obj) && Array.isArray(obj[ym]) ? obj[ym] : [];
        return Array.from({ length: this.MEDIA_MAX }, (_, i) => (typeof saved[i] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved[i])) ? saved[i] : null);
    },
    // チェックを付けた/外したときの日付を customer.mediaDates に反映する(付けたら今日、外したら消す)。保存する mediaDates を返す
    setMediaDate(customer, ym, idx, checked, now = new Date()) {
        if (!customer.mediaDates || typeof customer.mediaDates !== 'object' || Array.isArray(customer.mediaDates)) customer.mediaDates = {};
        const arr = this.mediaDates(customer, ym);
        arr[idx] = checked ? this.dayKey(now) : null;
        customer.mediaDates[ym] = arr;
        return customer.mediaDates;
    },
    // 今週(月曜〜日曜)の範囲('YYYY-MM-DD')
    weekRange(now = new Date()) {
        const dow = (now.getDay() + 6) % 7; // 月曜=0
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
        const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 6);
        return { start: this.dayKey(mon), end: this.dayKey(sun) };
    },
    // 日付の表示用: 「10/22」と、ホバーで見える「2026年10月22日(水)」
    dayLabel(key) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
        if (!m) return null;
        const dt = new Date(+m[1], +m[2] - 1, +m[3]);
        return { short: `${+m[2]}/${+m[3]}`, full: `${+m[1]}年${+m[2]}月${+m[3]}日(${'日月火水木金土'[dt.getDay()]})` };
    },
    // 投稿状況の古い保存形式('1'〜'12' の月だけ)を、年+月('YYYY-MM')に1回だけ移し替えてデータベースにも保存する。
    // 古い形式には年がないため「移し替える日から見て一番最近のその月」とみなす
    // (例: 2026年10月に移し替えると '1'〜'10' は2026年、'11'・'12' は2025年)。
    async migrateLegacyPosts(customers, now = new Date()) {
        const legacyToYm = (k) => {
            const m = parseInt(k, 10);
            const y = m <= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() - 1;
            return `${y}-${String(m).padStart(2, '0')}`;
        };
        for (const d of customers) {
            if (!d.posts || typeof d.posts !== 'object' || Array.isArray(d.posts)) continue;
            const legacyKeys = Object.keys(d.posts).filter(k => /^\d{1,2}$/.test(k) && +k >= 1 && +k <= 12);
            if (!legacyKeys.length) continue;
            const next = {};
            Object.keys(d.posts).filter(k => !legacyKeys.includes(k)).forEach(k => { next[k] = d.posts[k]; });
            legacyKeys.forEach(k => {
                const ym = legacyToYm(k);
                const old = Array.isArray(d.posts[k]) ? d.posts[k] : [];
                const cur = Array.isArray(next[ym]) ? next[ym] : [];
                next[ym] = Array.from({ length: Math.max(12, old.length, cur.length) }, (_, i) => !!(old[i] || cur[i]));
            });
            d.posts = next;
            try { await Store.updateCustomer('meo', d.id, { posts: next }); } catch (e) { console.error('投稿状況の移し替えに失敗', d.id, e); }
        }
    }
};

// 一括払いのプランかどうか(プランの設定を優先。設定がなければ名前に「一括」が入っているかで判断)
window.isMeoLumpPlan = (planName) => {
    const p = window.MeoPlans.find(planName);
    if (p && p.billing) return p.billing === 'lump';
    return !!planName && String(planName).includes('一括');
};

// 契約満了の状態を判定する。endMonth は 'YYYY-MM'(その月の末日で満了とみなす)
// 戻り値: null(判定なし) / { level: 'soon'|'expired', daysLeft, endDate }
// 'soon' = 満了日の1ヶ月前(前月の末日)〜満了日、'expired' = 満了日を過ぎた
// すでに毎月の自動延長に入っている店舗(autoRenew)は、毎月延長されるだけなので知らせない。
window.getMeoExpiryInfo = (customer, today = new Date()) => {
    if (!customer || customer.tag !== '契約中' || !customer.endMonth || customer.autoRenew) return null;
    const m = String(customer.endMonth).match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    const endDate = new Date(y, mo, 0);          // 満了月の末日
    const alertFrom = new Date(y, mo - 1, 0);    // その1ヶ月前(前月の末日)
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysLeft = Math.round((endDate - t) / 86400000);
    if (t > endDate) return { level: 'expired', daysLeft, endDate };
    if (t >= alertFrom) return { level: 'soon', daysLeft, endDate };
    return null;
};

// ===== MEOの契約の自動延長 =====
// 「契約中」のまま満了予定月を過ぎた店舗は、解約(ステータスを「解約済み」に)していない限り、毎月1ヶ月ずつ自動で延長する。
//   ・満了予定月(endMonth)を今月に進め、autoRenew = true(毎月自動更新中)にする。
//   ・最初に決めていた満了予定月は initialEndMonth に残す(1回目の延長のときだけ)。
//   ・何ヶ月も開いていなかった場合も、今月までまとめて延長する。
// 管理画面のページを開いたとき(App.navigate)に、月に1回だけ確認する。
window.MeoContract = {
    checkedYm: null,
    async autoRenewAll(now = new Date()) {
        const ym = window.MeoWork.ymOf(now);
        if (this.checkedYm === ym || !window.Store) return;
        try {
            const list = await Store.getCustomers('meo');
            const user = window.Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
            for (const c of list) {
                if (c.tag !== '契約中' || !/^\d{4}-\d{2}$/.test(c.endMonth || '') || c.endMonth >= ym) continue;
                const patch = { endMonth: ym, autoRenew: true };
                if (!c.initialEndMonth) patch.initialEndMonth = c.endMonth;
                await Store.updateCustomer('meo', c.id, patch);
                try { await Store.logAction(user && user.email ? user.email : 'system', `MEO「${c.client}」の契約を自動延長しました(満了予定 ${c.endMonth} → ${ym})`); } catch (e) { /* 記録の失敗は無視 */ }
            }
            this.checkedYm = ym;
        } catch (e) {
            console.error('MEO契約の自動延長に失敗しました', e);
        }
    }
};

window.getPoBasePrice = (type, monthStr) => {
    if (type !== 'ショート' && type !== 'YouTube') return 0; // Invalid or empty type returns 0

    if (type === 'ショート') return 4000;
    
    if (type === 'YouTube') {
        if (!monthStr || monthStr === 'all') return 20000; // Default to newest if unknown

        // Split "2026-04" or similar
        const parts = monthStr.split('-');
        if (parts.length < 2) return 20000;
        
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);

        if (isNaN(year) || isNaN(month)) return 20000;

        // 3月までは 18000円、4月以降は 20000円
        if (year < 2026 || (year === 2026 && month <= 3)) {
            return 18000;
        }
        return 20000;
    }
    return 0;
};

window.getPoBaseCost = (type) => {
    if (type === 'ショート') return 2000;
    if (type === 'YouTube') return 11000;
    return 0;
};

const DEFAULT_DATA = {
    users: [
        { email: 'urata@msm-jap.com', password: 'Koji2819', role: CONSTANTS.ROLES.ADMIN, name: '管理者' },
        { email: 'contact@msm-fund.com', password: 'msm1234', role: CONSTANTS.ROLES.MEMBER, name: '社内メンバー (Plus One)' },
        { email: 'info@msm-fund.com', password: 'meo1234', role: CONSTANTS.ROLES.MEMBER, name: '社内メンバー (MEO)' },
        { email: 'jinzai@msm-fund.com', password: 'jinzai1234', role: CONSTANTS.ROLES.MEMBER, name: '社内メンバー (通信)' }
    ],
    customers: {
        plusOne: [],
        meo: [],
        telecom: []
    },
    expenses: [
        { id: 1, name: 'サーバー代', amount: 5000, date: new Date().toISOString(), type: 'shot' }
    ],
    tasks: [],
    payroll: {
        staffs: [],
        meo: [],
        telecom: []
    },
    logs: []
};
