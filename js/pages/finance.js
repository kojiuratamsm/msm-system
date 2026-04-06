App.Pages.finance = async function(selectedMonth = 'all') {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3><p style="color:var(--text-secondary); margin-top: 16px;">財務管理は管理者アカウントのみ閲覧・編集可能です。</p></div>');
        return;
    }

    const now = new Date();
    // Helper to determine if a date falls in the selected filter
    const isTargetMonth = (mDate) => {
        if (selectedMonth !== 'all') {
            return (mDate.getMonth() + 1) === parseInt(selectedMonth);
        } else {
            // "all" means the fiscal year: Nov to Oct
            // If now is Nov or Dec, fiscal year is Nov this year to Oct next year.
            // If now is Jan to Oct, fiscal year is Nov last year to Oct this year.
            let startYear = now.getFullYear();
            if (now.getMonth() < 10) startYear -= 1; // getMonth() < 10 is Jan(0) to Oct(9)
            
            const startFY = new Date(startYear, 10, 1); // Nov 1st
            const endFY = new Date(startYear + 1, 10, 0); // Oct 31st end of day
            
            return mDate.getTime() >= startFY.getTime() && mDate.getTime() <= endFY.getTime();
        }
    };

    // Calc Revenues
    const custsPo = await Store.getCustomers('plusOne');
    const poSales = custsPo
        .filter(c => c.status === '納品')
        .reduce((sum, c) => {
            const mStr = c.month || (c.dates && c.dates[0] ? c.dates[0].substring(0,7) : null);
            if (!mStr) return sum;
            const [yyyy, mm] = mStr.split('-');
            const salesMonthD = new Date(parseInt(yyyy), parseInt(mm), 1); // target + 1
            if (isTargetMonth(salesMonthD)) {
                return sum + (c.priceReceipt || c.priceOverride || CONSTANTS.PLUS_ONE_PRICING[c.type]);
            }
            return sum;
        }, 0);

    const custsTc = await Store.getCustomers('telecom');
    const tcSales = custsTc
        .filter(c => c.status === '実行済み')
        .reduce((sum, c) => {
            const mStr = c.month || (c.date ? c.date.substring(0,7) : null);
            if (!mStr) return sum;
            const [yyyy, mm] = mStr.split('-');
            const salesMonthD = new Date(parseInt(yyyy), parseInt(mm), 1); // target + 1
            if (isTargetMonth(salesMonthD)) {
                return sum + Math.floor((c.priceReceipt || c.price) * 1.1);
            }
            return sum;
        }, 0);

    const custsMeo = await Store.getCustomers('meo');
    const meoSales = custsMeo.filter(c => c.tag === '契約中').reduce((sum, c) => {
        if (!c.startMonth) return sum;
        const [yyyy, mm] = c.startMonth.split('-');
        const startD = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
        const nextMonthD = new Date(parseInt(yyyy), parseInt(mm), 1);
        
        const pInfo = CONSTANTS.MEO_PLANS.find(p => p.name === c.plan);
        if (pInfo) {
            const isLump = c.plan.includes('一括');
            if (isLump) {
                if (isTargetMonth(startD)) sum += pInfo.price;
            } else {
                if (selectedMonth !== 'all') {
                    // For a specific month filter, we determine if the subscription is active 
                    // in the selectedMonth OF THIS fiscal year.
                    let targetYear = now.getFullYear();
                    // Align the targetYear to the fiscal year (Nov-Oct)
                    if (now.getMonth() < 10 && parseInt(selectedMonth) >= 11) targetYear -= 1;
                    if (now.getMonth() >= 10 && parseInt(selectedMonth) <= 10) targetYear += 1;
                    
                    const testD = new Date(targetYear, parseInt(selectedMonth) - 1, 1);
                    
                    // The subscription is active if the target month is on or after the nextMonthD
                    // and since the status is "契約中" (active), we assume it's still running.
                    if (testD.getTime() >= nextMonthD.getTime()) sum += pInfo.price;
                } else {
                    // "all" means summing up all months it was active during the Fiscal Year
                    let startYear = now.getFullYear();
                    if (now.getMonth() < 10) startYear -= 1;
                    
                    for (let i = 0; i < 12; i++) {
                        const testD = new Date(startYear, 10 + i, 1); // Starts at Nov
                        if (testD.getTime() >= nextMonthD.getTime()) {
                            sum += pInfo.price;
                        }
                    }
                }
            }
        }
        return sum;
    }, 0);
    
    const totalSales = poSales + tcSales + meoSales;

    // Expenses
    const expenses = await Store.getExpenses();
    const totalExp = expenses.reduce((sum, e) => {
        if (!e.date) return sum;
        const eDate = new Date(e.date);
        
        if (e.type === 'recurring') {
            if (selectedMonth !== 'all') {
                let targetYear = now.getFullYear();
                if (now.getMonth() < 10 && parseInt(selectedMonth) >= 11) targetYear -= 1;
                if (now.getMonth() >= 10 && parseInt(selectedMonth) <= 10) targetYear += 1;
                const testD = new Date(targetYear, parseInt(selectedMonth) - 1, 1);
                
                const startM = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
                if (testD.getTime() >= startM.getTime()) sum += e.amount;
            } else {
                let startYear = now.getFullYear();
                if (now.getMonth() < 10) startYear -= 1;
                const startM = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
                
                for (let i = 0; i < 12; i++) {
                    const testD = new Date(startYear, 10 + i, 1);
                    if (testD.getTime() >= startM.getTime()) sum += e.amount;
                }
            }
        } else {
            // type "shot" or default
            if (isTargetMonth(eDate)) {
                return sum + e.amount;
            }
        }
        return sum;
    }, 0);

    // Profit
    const profit = totalSales - totalExp;

    const html = `
        <div class="card" style="margin-bottom: 24px; padding: 16px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <span class="badge badge-neutral" style="font-size: 0.9rem;">対象範囲 (売上計上月)</span>
                <button class="btn-sm ${selectedMonth === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.finance('all')">年間 (11月〜10月)</button>
                ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
                    <button class="btn-sm ${selectedMonth === m ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.finance(${m})">${m}月</button>
                `).join('')}
            </div>
            <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-secondary);">※「年間」は11月〜翌年10月を1年間として計算します。</div>
        </div>

        <div class="grid grid-3">
            <div class="card" style="border-top: 4px solid var(--success);">
                <div class="card-header"><h3 class="card-title">総売上</h3></div>
                <h2 style="font-size: 2.5rem; color: var(--success);">¥${totalSales.toLocaleString()}</h2>
                <div style="margin-top: 16px; font-size: 0.875rem; color: var(--text-secondary);">
                    <p>Plus One: ¥${poSales.toLocaleString()}</p>
                    <p>MEO (概算): ¥${meoSales.toLocaleString()}</p>
                    <p>通信: ¥${tcSales.toLocaleString()}</p>
                </div>
            </div>
            
            <div class="card" style="border-top: 4px solid var(--danger);">
                <div class="card-header"><h3 class="card-title">総経費</h3></div>
                <h2 style="font-size: 2.5rem; color: var(--danger);">¥${totalExp.toLocaleString()}</h2>
            </div>
            
            <div class="card" style="border-top: 4px solid var(--info);">
                <div class="card-header"><h3 class="card-title">利益 (見込み)</h3></div>
                <h2 style="font-size: 2.5rem; color: var(--info);">¥${profit.toLocaleString()}</h2>
            </div>
        </div>

        <div class="grid grid-2">
            <div class="card">
                <div class="card-header"><h3 class="card-title">全月経費一覧</h3></div>
                <table class="table-container">
                    <thead><tr><th>経費名</th><th>種類</th><th>金額</th><th>発生日</th><th>操作</th></tr></thead>
                    <tbody>
                        ${expenses.map(e => `
                            <tr>
                                <td><a href="#" onclick="openEditExpenseModal(${e.id}); return false;" style="color:var(--info); font-weight:bold; text-decoration:underline;">${e.name}</a></td>
                                <td>${e.type === 'recurring' ? '<span class="badge badge-info">継続</span>' : '<span class="badge badge-neutral">ショット</span>'}</td>
                                <td>¥${e.amount.toLocaleString()}</td>
                                <td>${e.date ? new Date(e.date).toLocaleDateString('ja-JP') : '-'}</td>
                                <td><button class="btn-icon" onclick="removeExpense(${e.id})"><i class="ph ph-trash"></i></button></td>
                            </tr>
                        `).join('')}
                        ${expenses.length === 0 ? '<tr><td colspan="5">経費データがありません。</td></tr>' : ''}
                    </tbody>
                </table>
            </div>

            <div class="card" style="height: fit-content;">
                <div class="card-header"><h3 class="card-title">経費を追加</h3></div>
                <form id="add-expense-form">
                    <div class="form-group">
                        <label>項目名</label>
                        <input type="text" id="exp-name" required placeholder="例: サーバー代">
                    </div>
                    <div class="form-group">
                        <label>金額 (円)</label>
                        <input type="number" id="exp-amount" required placeholder="例: 10000">
                    </div>
                    <div class="form-group">
                        <label>発生日</label>
                        <input type="date" id="exp-date" required value="${new Date().toISOString().slice(0,10)}">
                    </div>
                    <div class="form-group">
                        <label>種類</label>
                        <select id="exp-type">
                            <option value="shot">ショット (単発)</option>
                            <option value="recurring">継続課金 (毎月)</option>
                        </select>
                    </div>
                    <button type="submit" class="btn-primary" style="margin-top: 16px;">経費を登録</button>
                </form>
            </div>
        </div>

        <div class="modal-overlay" id="expense-edit-modal">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3 class="modal-title">経費を編集</h3>
                    <button class="modal-close" onclick="document.getElementById('expense-edit-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="edit-expense-form">
                    <input type="hidden" id="edit-exp-id">
                    <div class="form-group">
                        <label>項目名</label>
                        <input type="text" id="edit-exp-name" required>
                    </div>
                    <div class="form-group">
                        <label>金額 (円)</label>
                        <input type="number" id="edit-exp-amount" required>
                    </div>
                    <div class="form-group">
                        <label>発生日</label>
                        <input type="date" id="edit-exp-date" required>
                    </div>
                    <div class="form-group">
                        <label>種類</label>
                        <select id="edit-exp-type">
                            <option value="shot">ショット (単発)</option>
                            <option value="recurring">継続課金 (毎月)</option>
                        </select>
                    </div>
                    <button type="submit" class="btn-primary" style="margin-top: 16px;">更新を保存</button>
                </form>
            </div>
        </div>
    `;

    App.mount(html, async () => {
        document.getElementById('add-expense-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const expName = document.getElementById('exp-name').value;
            await Store.addExpense({
                name: expName,
                amount: parseInt(document.getElementById('exp-amount').value),
                date: document.getElementById('exp-date').value,
                type: document.getElementById('exp-type').value
            });
            await Store.logAction(user.email, `財務管理に経費「${expName}」を登録しました`);
            App.navigate('finance', selectedMonth); // re-render
        });

        window.removeExpense = async (id) => {
            if(confirm('経費を削除しますか？')) {
                await Store.deleteExpense(id);
                App.navigate('finance', selectedMonth);
            }
        };

        window.openEditExpenseModal = (id) => {
            const exp = expenses.find(e => e.id === id);
            if (!exp) return;
            document.getElementById('edit-exp-id').value = exp.id;
            document.getElementById('edit-exp-name').value = exp.name;
            document.getElementById('edit-exp-amount').value = exp.amount;
            
            // Reformat date string to YYYY-MM-DD if needed
            let dStr = exp.date;
            if (dStr && dStr.includes('T')) dStr = dStr.split('T')[0];
            
            document.getElementById('edit-exp-date').value = dStr;
            document.getElementById('edit-exp-type').value = exp.type || 'shot';
            document.getElementById('expense-edit-modal').classList.add('active');
        };

        document.getElementById('edit-expense-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = parseInt(document.getElementById('edit-exp-id').value);
            const expName = document.getElementById('edit-exp-name').value;
            const updatedData = {
                name: expName,
                amount: parseInt(document.getElementById('edit-exp-amount').value),
                date: document.getElementById('edit-exp-date').value,
                type: document.getElementById('edit-exp-type').value
            };
            
            try {
                // We need to implement updateExpense in Store, or just update directly via supabase
                await Store.updateExpense(id, updatedData);
                App.navigate('finance', selectedMonth);
            } catch(err) {
                console.error(err);
                alert('エラーが発生しました');
            }
        });
    });
};
