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

        // Apply visual settings
        Store.getSettings().then(settings => {
            if (settings && settings.logoUrl) {
                document.querySelectorAll('.logo').forEach(el => {
                    el.innerHTML = `<img src="${settings.logoUrl}" style="height: 48px; object-fit: contain;">`;
                });
            }
            if (settings && settings.bgUrl) {
                const viewEl = document.getElementById('login-view');
                if (viewEl) {
                    viewEl.style.backgroundImage = `url('${settings.bgUrl}')`;
                    viewEl.style.backgroundSize = 'cover';
                    viewEl.style.backgroundPosition = 'center';
                    // ensure overlay has a slight dark shade so login box stands out
                    const overlay = viewEl.querySelector('.login-container');
                    if(overlay) overlay.style.background = 'rgba(255, 255, 255, 0.9)';
                }
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
            
            // Sidebar will explicitly show all items to all users now.
            // When clicked, non-admins will see a rejection screen for restricted pages.
            const allNavs = ['dashboard', 'services', 'customers', 'sales', 'finance', 'payroll', 'tasks', 'research', 'youtube', 'meo_users', 'settings'];
            allNavs.forEach(nav => {
                const el = document.querySelector(`li[data-target="${nav}"]`);
                if (el) el.style.display = 'flex';
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
App.Pages.dashboard = async function(selectedYearText = null) {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();
    
    // Default to current year
    const currentYear = new Date().getFullYear();
    const selectedYear = selectedYearText ? parseInt(selectedYearText) : currentYear;

    const activeKpiMonth = window.dashKpiMonth || new Date().toISOString().slice(0, 7);
    const targetsDataList = await Store.getTargetsKpis();
    const targetsData = targetsDataList.find(t => t.month === activeKpiMonth) || {
        month: activeKpiMonth,
        meo: { rev: '', count: '', kpi: [] },
        po: { yt: '', short: '', kpi: [] },
        telecom: { count: '', kpi: [] }
    };
    targetsData.meo = targetsData.meo || { rev: '', count: '', kpi: [] };
    targetsData.po = targetsData.po || { yt: '', short: '', kpi: [] };
    targetsData.telecom = targetsData.telecom || { count: '', kpi: [] };
    targetsData.meo.kpi = targetsData.meo.kpi || [];
    targetsData.po.kpi = targetsData.po.kpi || [];
    targetsData.telecom.kpi = targetsData.telecom.kpi || [];

    // KPI Helper
    const renderKpiList = (list, deptKey) => list.map((k, idx) => `
        <div style="font-size:0.8rem; background:var(--bg-hover); padding:4px 8px; border-radius:4px; margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
            <span><span style="color:var(--text-secondary); margin-right:8px;">${k.date}</span> ${k.text}</span>
            ${isAdmin ? `<button class="btn-icon" style="padding:2px;" onclick="removeKpi('${activeKpiMonth}', '${deptKey}', ${idx})"><i class="ph ph-trash"></i></button>` : ''}
        </div>
    `).join('');
    
    // Filter tasks if member
    let allTasks = await Store.getTasks();
    const todayStr = new Date().toISOString().split('T')[0];
    let tasks = allTasks.filter(t => !t.done || t.date === todayStr); // Display incomplete OR today's
    if (!isAdmin && dept !== 'all') {
        const mapping = { 'plusOne': 'Plus One', 'meo': 'MEO対策チャンネル', 'telecom': '通信' };
        tasks = tasks.filter(t => t.service === mapping[dept]);
    }

    // Sort tasks: today first, then others
    tasks.sort((a,b) => {
        if (a.date === todayStr && b.date !== todayStr) return -1;
        if (a.date !== todayStr && b.date === todayStr) return 1;
        return new Date(a.date) - new Date(b.date);
    });
    
    const colors = {
        'Plus One': 'rgba(235, 177, 203, 0.5)',
        'MEO対策チャンネル': 'rgba(177, 235, 194, 0.5)',
        '通信': 'rgba(177, 214, 235, 0.5)'
    };
    
    let html = `
        <div class="grid grid-2" style="margin-bottom: 24px; gap: 24px;">
            <div class="card" style="box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <div class="card-header" style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 16px;">
                    <h3 class="card-title" style="font-size: 1.2rem; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-check-square-offset"></i> 本日・未完了のタスク
                    </h3>
                </div>
                ${tasks.length === 0 ? '<p style="color:var(--text-secondary); text-align:center; padding: 20px 0;">表示するタスクはありません 🎉</p>' : `
                <div style="max-height: 250px; overflow-y: auto; padding-right: 8px;">
                    ${tasks.slice(0, 10).map(t => `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; background: ${t.done ? '#f8f9fa' : 'var(--bg-color)'}; margin-bottom: 8px; border-left: 4px solid ${colors[t.service] || 'var(--border)'}; opacity: ${t.done ? '0.6' : '1'};">
                            <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTaskStatus(${t.id})" style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--success);" />
                            <div style="flex: 1;">
                                <div style="font-weight: 600; margin-bottom: 4px; text-decoration: ${t.done ? 'line-through' : 'none'};">${t.text}</div>
                                <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 8px;">
                                    <span><i class="ph ph-buildings"></i> ${t.customer}</span>
                                    ${t.date === todayStr ? '<span style="color:var(--error); font-weight:bold;">本日</span>' : `<span>${t.date ? new Date(t.date).toLocaleDateString('ja-JP', {month:'short', day:'numeric'}) : ''}</span>`}
                                </div>
                            </div>
                            <span class="badge" style="background: ${colors[t.service] || '#ccc'}; color: #fff;">${t.service}</span>
                        </div>
                    `).join('')}
                </div>
                `}
                <div style="text-align: right; margin-top: 16px;">
                    <button class="btn-primary" onclick="App.navigate('tasks')" style="width: 100%;">タスク詳細画面へ <i class="ph ph-arrow-right"></i></button>
                </div>
            </div>
            
            <div class="card" style="box-shadow: 0 4px 12px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
                <div class="card-header" style="border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 16px;">
                    <h3 class="card-title" style="font-size: 1.2rem; color: var(--success-dark); display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-lightning"></i> クイックアクセス
                    </h3>
                </div>
                <div class="grid grid-2" style="gap: 16px; flex: 1; align-content: start;">
                    <button class="btn-secondary" onclick="App.navigate('customers')" style="height: 100px; display: flex; flex-direction: column; justify-content: center; gap: 8px; font-size: 1.1rem; border: 2px solid var(--border-light); background: #fff; transition: all 0.2s;">
                        <i class="ph ph-users" style="font-size: 2rem; color: var(--primary);"></i> 顧客/案件管理
                    </button>
                    ${isAdmin ? `
                    <button class="btn-secondary" onclick="App.navigate('finance')" style="height: 100px; display: flex; flex-direction: column; justify-content: center; gap: 8px; font-size: 1.1rem; border: 2px solid var(--border-light); background: #fff; transition: all 0.2s;">
                        <i class="ph ph-wallet" style="font-size: 2rem; color: var(--success);"></i> 財務管理
                    </button>
                    <button class="btn-secondary" onclick="App.navigate('payroll')" style="height: 100px; display: flex; flex-direction: column; justify-content: center; gap: 8px; font-size: 1.1rem; border: 2px solid var(--border-light); background: #fff; transition: all 0.2s;">
                        <i class="ph ph-calculator" style="font-size: 2rem; color: var(--warning);"></i> 給与計算
                    </button>
                    <button class="btn-secondary" onclick="App.navigate('services')" style="height: 100px; display: flex; flex-direction: column; justify-content: center; gap: 8px; font-size: 1.1rem; border: 2px solid var(--border-light); background: #fff; transition: all 0.2s;">
                        <i class="ph ph-briefcase" style="font-size: 2rem; color: var(--info);"></i> サービス一覧
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // KPI & Target Section (Admin only)
    if (isAdmin) {
        html += `
        <div class="card" style="margin-bottom:24px;">
            <div class="card-header" style="justify-content:space-between; align-items:center;">
                <h3 class="card-title"><i class="ph ph-target"></i> 今月の目標・KPI設定</h3>
                <input type="month" value="${activeKpiMonth}" onchange="window.dashKpiMonth=this.value; App.navigate('dashboard', ${selectedYear})" class="input-field" style="width: auto;">
            </div>
            
            <div class="grid grid-3">
                <!-- MEO -->
                <div style="border:1px solid var(--border-light); padding:16px; border-radius:var(--radius-md);">
                    <h4 style="margin-bottom:12px; color:var(--primary-dark);">MEO対策チャンネル</h4>
                    <div class="form-group" style="margin-bottom:8px;">
                        <label style="font-size:0.8rem;">目標売上 (円)</label>
                        <input type="number" id="kpi-meo-rev" value="${targetsData.meo.rev}" onchange="saveTargetData()" class="input-field" ${isAdmin ? '' : 'readonly'}>
                    </div>
                    <div class="form-group" style="margin-bottom:16px;">
                        <label style="font-size:0.8rem;">目標獲得件数</label>
                        <input type="number" id="kpi-meo-count" value="${targetsData.meo.count}" onchange="saveTargetData()" class="input-field" ${isAdmin ? '' : 'readonly'}>
                    </div>
                    <div style="font-size:0.85rem; font-weight:bold; margin-bottom:8px; display:flex; justify-content:space-between;">行動指針 (KPI) ${isAdmin ? `<button class="btn-sm btn-secondary p-1" onclick="openKpiModal('meo')"><i class="ph ph-plus"></i> 追加</button>` : ''}</div>
                    <div style="max-height:100px; overflow-y:auto;">${renderKpiList(targetsData.meo.kpi, 'meo')}</div>
                </div>

                <!-- Plus One -->
                <div style="border:1px solid var(--border-light); padding:16px; border-radius:var(--radius-md);">
                    <h4 style="margin-bottom:12px; color:var(--primary-dark);">Plus One</h4>
                    <div class="form-group" style="margin-bottom:8px;">
                        <label style="font-size:0.8rem;">YouTube 目標本数</label>
                        <input type="number" id="kpi-po-yt" value="${targetsData.po.yt}" onchange="saveTargetData()" class="input-field" ${isAdmin ? '' : 'readonly'}>
                    </div>
                    <div class="form-group" style="margin-bottom:16px;">
                        <label style="font-size:0.8rem;">ショート 目標本数</label>
                        <input type="number" id="kpi-po-short" value="${targetsData.po.short}" onchange="saveTargetData()" class="input-field" ${isAdmin ? '' : 'readonly'}>
                    </div>
                    <div style="font-size:0.85rem; font-weight:bold; margin-bottom:8px; display:flex; justify-content:space-between;">行動指針 (KPI) ${isAdmin ? `<button class="btn-sm btn-secondary p-1" onclick="openKpiModal('po')"><i class="ph ph-plus"></i> 追加</button>` : ''}</div>
                    <div style="max-height:100px; overflow-y:auto;">${renderKpiList(targetsData.po.kpi, 'po')}</div>
                </div>

                <!-- Telecom -->
                <div style="border:1px solid var(--border-light); padding:16px; border-radius:var(--radius-md);">
                    <h4 style="margin-bottom:12px; color:var(--primary-dark);">通信</h4>
                    <div class="form-group" style="margin-bottom:16px;">
                        <label style="font-size:0.8rem;">目標現場数</label>
                        <input type="number" id="kpi-telecom-count" value="${targetsData.telecom.count}" onchange="saveTargetData()" class="input-field" ${isAdmin ? '' : 'readonly'}>
                    </div>
                    <div style="font-size:0.85rem; font-weight:bold; margin-bottom:8px; display:flex; justify-content:space-between;">行動指針 (KPI) ${isAdmin ? `<button class="btn-sm btn-secondary p-1" onclick="openKpiModal('telecom')"><i class="ph ph-plus"></i> 追加</button>` : ''}</div>
                    <div style="max-height:150px; overflow-y:auto;">${renderKpiList(targetsData.telecom.kpi, 'telecom')}</div>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kpi-add-modal">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3 class="modal-title">行動指針 (KPI) 追加</h3>
                    <button class="modal-close" onclick="document.getElementById('kpi-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="kpi-add-form">
                    <input type="hidden" id="kpi-deptKey">
                    <div class="form-group"><label>日付 (Dead LINE)</label><input type="date" id="kpi-date" required value="${new Date().toISOString().slice(0,10)}"></div>
                    <div class="form-group"><label>ToDo / 指針内容</label><input type="text" id="kpi-text" required placeholder="例: リストを30件作成する"></div>
                    <button type="submit" class="btn-primary w-100">追加</button>
                </form>
            </div>
        </div>
    `;
    }

    if (isAdmin) {
        let yearOptions = '';
        for (let y = currentYear - 2; y <= currentYear + 1; y++) {
            yearOptions += `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}年度</option>`;
        }

        html += `
            <div class="card" style="margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 16px; margin-bottom: 16px;">
                    <h3 class="card-title" style="font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-chart-bar"></i> 月間 売上・経費・利益推移
                    </h3>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 0.9rem; color: var(--text-secondary);">表示年:</label>
                        <select class="input-field" style="width: 120px; font-weight: bold;" onchange="App.navigate('dashboard', this.value)">
                            ${yearOptions}
                        </select>
                    </div>
                </div>
                <div style="height: 400px; width: 100%;">
                    <canvas id="dashboardChart"></canvas>
                </div>
            </div>
        `;
    }

    App.mount(html, async () => {
        window.toggleTaskStatus = async (id) => {
            await Store.toggleTask(id);
            App.navigate('dashboard', selectedYear);
        };

        window.saveTargetData = async () => {
            const newData = {
                meo: { ...targetsData.meo, rev: document.getElementById('kpi-meo-rev').value, count: document.getElementById('kpi-meo-count').value },
                po: { ...targetsData.po, yt: document.getElementById('kpi-po-yt').value, short: document.getElementById('kpi-po-short').value },
                telecom: { ...targetsData.telecom, count: document.getElementById('kpi-telecom-count').value }
            };
            await Store.saveTargetsKpi(activeKpiMonth, newData);
            targetsData.meo = newData.meo;
            targetsData.po = newData.po;
            targetsData.telecom = newData.telecom;
        };

        window.openKpiModal = (deptKey) => {
            document.getElementById('kpi-deptKey').value = deptKey;
            document.getElementById('kpi-text').value = '';
            document.getElementById('kpi-add-modal').classList.add('active');
        };

        window.removeKpi = async (monthStr, deptKey, idx) => {
            if(!confirm('このKPIを削除しますか？')) return;
            targetsData[deptKey].kpi.splice(idx, 1);
            await Store.saveTargetsKpi(activeKpiMonth, targetsData);
            App.navigate('dashboard', selectedYear);
        };

        const kpiForm = document.getElementById('kpi-add-form');
        if (kpiForm) kpiForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const deptKey = document.getElementById('kpi-deptKey').value;
            const newKpi = {
                date: document.getElementById('kpi-date').value,
                text: document.getElementById('kpi-text').value
            };
            targetsData[deptKey].kpi.push(newKpi);
            targetsData[deptKey].kpi.sort((a,b) => new Date(a.date) - new Date(b.date));
            await Store.saveTargetsKpi(activeKpiMonth, targetsData);
            App.navigate('dashboard', selectedYear);
        });

        if (!isAdmin) return;
        
        const ctx = document.getElementById('dashboardChart');
        if (!ctx) return;
        
        // 1月〜12月のラベルを作成 (指定年の1月〜12月)
        const months = [];
        const monthDates = [];
        for (let i = 1; i <= 12; i++) {
            months.push(`${selectedYear}年${i}月`);
            monthDates.push(new Date(selectedYear, i - 1, 1));
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
                        if (mDate.getTime() >= nextMonthD.getTime() && (!c.endMonth || mDate.getTime() < new Date(c.endMonth + '-01').getTime())) {
                            sum += pInfo.price;
                        }
                    }
                }
            });
            return sum;
        });
        
        const expenses = await Store.getExpenses();
        const eData = monthDates.map((mDate) => {
            let sum = 0;
            expenses.forEach(e => {
                if (!e.date) return;
                const ed = new Date(e.date);
                if (ed.getFullYear() === mDate.getFullYear() && ed.getMonth() === mDate.getMonth()) {
                    sum += e.amount;
                }
            });
            return sum;
        });
        
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
                        label: '月間入力済経費',
                        data: eData,
                        backgroundColor: 'rgba(240, 62, 62, 0.8)',
                        stack: 'Stack 1'
                    },
                    {
                        type: 'line',
                        label: '利益実績',
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
                plugins: { 
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: { 
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true } 
                }
            }
        });
    });
};
