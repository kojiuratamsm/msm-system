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
    MEO_PLANS: [
        {name: '(旧)Standard Plan', price: 19800},
        {name: '(新)Premiere Plan', price: 24800},
        {name: 'Standard Plan', price: 24800},
        {name: 'Premiere Plan', price: 39800},
        {name: '(一括)Standard Plan', price: 272800},
        {name: '(一括)Premiere Plan', price: 437800},
        {name: '【モニター】', price: 0}
    ],
    PLUS_ONE_PRICING: {
        'ショート': 4000,
        'YouTube': 18000
    }
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
