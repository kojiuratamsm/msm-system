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
        return {
            name: String(p.name || '').trim(),
            price: Math.max(0, parseInt(p.price, 10) || 0),
            months: months > 0 ? months : (billing === 'lump' ? 12 : 6),
            billing,
            note: p.note ? String(p.note) : '',
            hidden: !!p.hidden
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
        const sig = (arr) => JSON.stringify(arr.map(p => [p.name, p.price, p.months, p.billing, p.note, p.hidden]));
        if (sig(CONSTANTS.MEO_PLANS) !== sig(list)) throw new Error('保存した内容を確認できませんでした。通信状態を確認してください。');
    },
    find(name) {
        return CONSTANTS.MEO_PLANS.find(p => p.name === name);
    }
};
CONSTANTS.MEO_PLANS.splice(0, CONSTANTS.MEO_PLANS.length, ...CONSTANTS.MEO_PLANS.map(p => window.MeoPlans.normalize(p)));

// 一括払いのプランかどうか(プランの設定を優先。設定がなければ名前に「一括」が入っているかで判断)
window.isMeoLumpPlan = (planName) => {
    const p = window.MeoPlans.find(planName);
    if (p && p.billing) return p.billing === 'lump';
    return !!planName && String(planName).includes('一括');
};

// 契約満了の状態を判定する。endMonth は 'YYYY-MM'(その月の末日で満了とみなす)
// 戻り値: null(判定なし) / { level: 'soon'|'expired', daysLeft, endDate }
// 'soon' = 満了日の1ヶ月前(前月の末日)〜満了日、'expired' = 満了日を過ぎた
window.getMeoExpiryInfo = (customer, today = new Date()) => {
    if (!customer || customer.tag !== '契約中' || !customer.endMonth) return null;
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
