const App = {
    Pages: {},
    mount(htmlStr, bindEvents = () => {}) {
        const content = document.getElementById('page-content');
        content.innerHTML = htmlStr;
        // Small delay to allow DOM to update before binding events
        setTimeout(() => bindEvents(), 0);
    },
    async navigate(target, ...args) {
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
        const navItem = document.querySelector(`.sidebar-nav li[data-target="${target}"]`);
        if (navItem) navItem.classList.add('active');

        const titleMap = {
            'dashboard': 'ダッシュボード',
            'services': 'サービス一覧',
            'customers': '顧客管理 / 案件管理',
            'sales': '売上シミュレーション',
            'finance': '財務管理',
            'payroll': '給与計算',
            'tasks': 'タスク表'
        };
        document.getElementById('page-title').textContent = titleMap[target] || '';

        if (target === 'finance' || target === 'payroll') {
            const user = Auth.getCurrentUser();
            if (!user || user.role !== 'admin') {
                alert('管理者以外閲覧できません');
                return;
            }
        }

        if (this.Pages[target]) {
            if (target === 'customers' || target === 'sales') {
                const dept = Auth.getDepartment();
                if (args.length === 0 && dept !== 'all') {
                    args = [dept]; 
                }
            }
            
            const content = document.getElementById('page-content');
            content.innerHTML = '<div style="text-align:center; padding: 60px; color:var(--text-secondary);"><i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 16px;"></i><p>データを読み込み中...</p></div>';

            try {
                await this.Pages[target](...args);
                content.classList.remove('fade-in');
                void content.offsetWidth;
                content.classList.add('fade-in');
            } catch (err) {
                console.error(err);
                content.innerHTML = `<div style="color:var(--danger); padding:40px; text-align:center;">データの読み込みに失敗しました。再試行してください。<br>${err.message}</div>`;
            }
        } else {
            this.mount(`<div class="card"><p>開発中: ${target}</p></div>`);
        }
    },
    updateDate() {
        const now = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
        document.getElementById('current-date').textContent = now.toLocaleDateString('ja-JP', options);
    },
    init() {
        this.updateDate();
        setInterval(() => this.updateDate(), 60000);

        // Sidebar Navigation
        document.getElementById('nav-list').addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li) {
                const target = li.getAttribute('data-target');
                if (target) this.navigate(target);
            }
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            Auth.logout();
            this.checkAuth();
        });

        // Login Submit
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            const errorEl = document.getElementById('login-error');
            
            errorEl.textContent = '認証中...';
            try {
                if (typeof window.supabase === 'undefined') {
                    throw new Error("Supabase CDNが読み込めていません。ネットワーク環境、またはセキュリティソフト等でcdn.jsdelivr.netがブロックされている可能性があります。");
                }
                const success = await Auth.login(email, pass);
                if (success) {
                    errorEl.textContent = '';
                    this.checkAuth();
                } else {
                    errorEl.textContent = 'EmailまたはPasswordが間違っています。';
                }
            } catch (err) {
                console.error("Critical Login Error:", err);
                errorEl.textContent = 'エラー: ' + err.message;
            }
        });

        this.checkAuth();
    },
    checkAuth() {
        const user = Auth.getCurrentUser();
        if (user) {
            document.getElementById('login-view').classList.remove('active');
            document.getElementById('app-view').classList.add('active');
            document.getElementById('current-user-role').textContent = user.name;
            document.getElementById('current-user-email').textContent = user.email;
            
            const adminNavs = ['finance', 'payroll'];
            adminNavs.forEach(nav => {
                const el = document.querySelector(`li[data-target="${nav}"]`);
                if (el) el.style.display = user.role === 'admin' ? 'flex' : 'none';
            });
            
            this.navigate('dashboard');
        } else {
            document.getElementById('app-view').classList.remove('active');
            document.getElementById('login-view').classList.add('active');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Add Mobile overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('mobile-menu-btn');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('active');
        });
    }

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });

    // Close sidebar on link click (mobile)
    document.getElementById('nav-list').addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    });

    App.init();
});

// App Dashboard Page
App.Pages.dashboard = async function() {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();
    
    // Filter tasks if member
    let allTasks = await Store.getTasks();
    let tasks = allTasks.filter(t => !t.done);
    if (!isAdmin && dept !== 'all') {
        const mapping = { 'plusOne': 'Plus One', 'meo': 'MEO対策チャンネル', 'telecom': '通信' };
        tasks = tasks.filter(t => t.service === mapping[dept]);
    }
    
    const colors = {
        'Plus One': 'rgba(235, 177, 203, 0.5)',
        'MEO対策チャンネル': 'rgba(177, 235, 194, 0.5)',
        '通信': 'rgba(177, 214, 235, 0.5)'
    };
    
    let html = `
        <div class="grid grid-2">
            <div class="card">
                <div class="card-header"><h3 class="card-title">本日のタスク (未完了)</h3></div>
                ${tasks.length === 0 ? '<p>未完了のタスクはありません。</p>' : `
                <table class="table-container">
                    <tbody>
                        ${tasks.slice(0, 5).map(t => `
                            <tr style="background-color: ${colors[t.service] || 'transparent'}">
                                <td style="width: 40px; text-align: center;">
                                    <input type="checkbox" onchange="toggleTaskStatus(${t.id})" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--success);" />
                                </td>
                                <td><span class="badge badge-neutral" style="background:#fff">${t.service}</span></td>
                                <td>${t.customer}</td>
                                <td>${t.text}</td>
                                <td>${t.date ? new Date(t.date).toLocaleDateString('ja-JP', {month:'short', day:'numeric'}) : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                `}
                <button class="btn-primary btn-sm" style="margin-top: 16px;" onclick="App.navigate('tasks')">タスク表へ</button>
            </div>
            <div class="card">
                <div class="card-header"><h3 class="card-title">ショートカット</h3></div>
                <div class="grid grid-2">
                    <button class="btn-secondary" onclick="App.navigate('customers')">
                        <i class="ph ph-users"></i> 顧客 / 案件を追加
                    </button>
                    ${isAdmin ? `
                    <button class="btn-secondary" onclick="App.navigate('finance')">
                        <i class="ph ph-wallet"></i> 経費を入力
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    if (isAdmin) {
        const fullLogs = await Store.getLogs();
        const logs = fullLogs.slice(0, 5);
        
        html = `
            <div class="grid grid-2" style="margin-bottom: 24px;">
                <div class="card">
                    <div class="card-header"><h3 class="card-title">システム通知 (最新5件)</h3></div>
                    ${logs.length === 0 ? '<p style="color:var(--text-secondary)">通知はありません</p>' : `
                    <div style="font-size: 0.85rem;">
                        ${logs.map(l => `
                            <div style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                                <div style="color:var(--text-secondary); margin-bottom: 4px;">${new Date(l.date).toLocaleString('ja-JP')}</div>
                                <div>${l.desc}</div>
                            </div>
                        `).join('')}
                    </div>
                    `}
                </div>
            </div>
            <div class="card" style="margin-bottom: 24px;">
                <div class="card-header"><h3 class="card-title">月間売上・経費・利益 推移</h3></div>
                <div style="height: 300px;">
                    <canvas id="dashboardChart"></canvas>
                </div>
            </div>
        ` + html;
    }

    App.mount(html, async () => {
        window.toggleTaskStatus = async (id) => {
            await Store.toggleTask(id);
            App.navigate('dashboard');
        };

        if (!isAdmin) return;
        
        const ctx = document.getElementById('dashboardChart');
        if (!ctx) return;
        
        // 直近6ヶ月の月ラベルを作成
        const months = [];
        const monthDates = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            months.push((d.getMonth() + 1) + '月');
            monthDates.push(new Date(d.getFullYear(), d.getMonth(), 1));
        }
        
        const poCusts = await Store.getCustomers('plusOne');
        const poDataChart = monthDates.map(mDate => {
            let sum = 0;
            poCusts.forEach(c => {
                if (c.status !== '納品') return;
                const mStr = c.month || (c.dates && c.dates[0] ? c.dates[0].substring(0,7) : null);
                if (!mStr) return;
                const [yyyy, mm] = mStr.split('-');
                const salesMonthD = new Date(parseInt(yyyy), parseInt(mm), 1); // Next month
                if (mDate.getTime() === salesMonthD.getTime()) {
                    sum += (c.priceReceipt || c.priceOverride || CONSTANTS.PLUS_ONE_PRICING[c.type]); // Using 受単価 or fallback
                }
            });
            return sum;
        });
        
        const tcCusts = await Store.getCustomers('telecom');
        const tcDataChart = monthDates.map(mDate => {
            let sum = 0;
            tcCusts.forEach(c => {
                if (c.status !== '実行済み') return;
                const mStr = c.month || (c.date ? c.date.substring(0,7) : null);
                if (!mStr) return;
                const [yyyy, mm] = mStr.split('-');
                const salesMonthD = new Date(parseInt(yyyy), parseInt(mm), 1); // Next month
                if (mDate.getTime() === salesMonthD.getTime()) {
                    // Telecom uses priceReceipt too. And 10% tax added? User previously wanted * 1.1 for telecom. Let's add it.
                    sum += Math.floor((c.priceReceipt || c.price) * 1.1); 
                }
            });
            return sum;
        });
        
        const meoCusts = await Store.getCustomers('meo');
        const meoDataChart = monthDates.map(mDate => {
            let sum = 0;
            meoCusts.forEach(c => {
                if (c.tag === '解約済み') return;
                if (!c.startMonth) return;
                const [yyyy, mm] = c.startMonth.split('-');
                const startD = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
                const nextMonthD = new Date(parseInt(yyyy), parseInt(mm), 1);
                
                const pInfo = CONSTANTS.MEO_PLANS.find(p => p.name === c.plan);
                if (pInfo) {
                    const isLump = c.plan.includes('一括');
                    if (isLump) {
                        if (mDate.getTime() === startD.getTime()) sum += pInfo.price;
                    } else {
                        if (mDate.getTime() >= nextMonthD.getTime()) {
                            sum += pInfo.price;
                        }
                    }
                }
            });
            return sum;
        });
        
        const expenses = await Store.getExpenses();
        const totalExp = expenses.reduce((sum, e) => sum + e.amount, 0);
        const eData = monthDates.map(() => Math.floor(totalExp / 6)); // Rough approx of monthly exp
        
        const pData = poDataChart.map((_, i) => (poDataChart[i] + meoDataChart[i] + tcDataChart[i]) - eData[i]);

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    {
                        label: '売上(Plus One)',
                        data: poDataChart,
                        backgroundColor: 'rgba(55, 178, 77, 0.8)',
                        stack: 'Stack 0'
                    },
                    {
                        label: '売上(MEO対策)',
                        data: meoDataChart,
                        backgroundColor: 'rgba(28, 126, 214, 0.8)',
                        stack: 'Stack 0'
                    },
                    {
                        label: '売上(通信)',
                        data: tcDataChart,
                        backgroundColor: 'rgba(245, 159, 0, 0.8)',
                        stack: 'Stack 0'
                    },
                    {
                        label: '経費',
                        data: eData,
                        backgroundColor: 'rgba(240, 62, 62, 0.8)',
                        stack: 'Stack 1'
                    },
                    {
                        type: 'line',
                        label: '利益',
                        data: pData,
                        borderColor: 'rgba(28, 126, 214, 1)',
                        backgroundColor: 'rgba(28, 126, 214, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' } },
                scales: { 
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true } 
                }
            }
        });
    });
};
