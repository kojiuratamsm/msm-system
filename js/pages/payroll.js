App.Pages.payroll = async function(activeTab = 'plusOne') {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title" style="color:var(--danger)">【管理者以外閲覧できません】</h3><p style="color:var(--text-secondary); margin-top: 16px;">給与計算は社内メンバーアカウントでは閲覧および操作が制限されています。</p></div>');
        return;
    }

    let payrollData = await Store.getPayroll();
    if (!payrollData || Array.isArray(payrollData)) {
        payrollData = { staffs: [], plusOne: [], meo: [], telecom: [] };
    }
    
    // For selected month
    const currentDate = new Date();
    // Default to a date input month or just "2023-11"
    // Let's keep it simple: month dropdown inside the mount, we'll re-render on change
    if (!window.currentPayrollMonth) {
        window.currentPayrollMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    }
    const selectedMonth = window.currentPayrollMonth;

    window.switchPayrollTab = function(tab) {
        App.navigate('payroll', tab);
    };

    window.changePayrollMonth = function(val) {
        window.currentPayrollMonth = val;
        App.navigate('payroll', activeTab);
    };

    let tabHtml = `
        <div class="tabs" style="margin-bottom: 24px;">
            <div class="tab ${activeTab === 'plusOne' ? 'active' : ''}" onclick="switchPayrollTab('plusOne')">Plus One</div>
            <div class="tab ${activeTab === 'meo' ? 'active' : ''}" onclick="switchPayrollTab('meo')">MEO対策チャンネル</div>
            <div class="tab ${activeTab === 'telecom' ? 'active' : ''}" onclick="switchPayrollTab('telecom')">通信</div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 24px;">
            <div style="display:flex; gap:16px; align-items:center;">
                <div>
                    <h2 style="font-size: 1.5rem; margin-bottom: 8px;">給与計算 / 担当者振込管理</h2>
                    <input type="month" value="${selectedMonth}" class="form-group" style="margin: 0; padding: 4px 8px;" onchange="changePayrollMonth(this.value)">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('staff-add-modal').classList.add('active')" style="height: fit-content;">
                        <i class="ph ph-user-plus"></i> 担当者追加
                    </button>
                    <button class="btn-secondary btn-sm" onclick="document.getElementById('staff-edit-modal').classList.add('active')" style="height: fit-content;">
                        <i class="ph ph-pencil-simple"></i> 担当者編集
                    </button>
                </div>
            </div>
        </div>
    `;

    const getBank = (staffName) => {
        const staff = payrollData.staffs.find(s => s.name === staffName);
        return staff ? staff.bank : '詳細未登録';
    };

    let contentHtml = '';

    if (activeTab === 'plusOne') {
        const poData = payrollData.plusOne.filter(p => p.month === selectedMonth);
        // Calculate totals from Customers ('plusOne') for this month
        // Match sum of priceCost for c.person === staffName
        const poCusts = await Store.getCustomers('plusOne');
        const allPOCustomers = poCusts.filter(c => {
            const mStr = c.month || (c.dates && c.dates[0] ? c.dates[0].substring(0,7) : null);
            return mStr === selectedMonth && c.status === '納品';
        });

        // Unique persons in this month's projects
        const persons = [...new Set(allPOCustomers.map(c => c.person).filter(Boolean))];
        
        let sumsByPerson = {};
        persons.forEach(p => {
            sumsByPerson[p] = allPOCustomers.filter(c => c.person === p).reduce((acc, c) => acc + (c.priceCost || window.getPoBaseCost(c.type)), 0);
        });

        const totalUnpaid = persons.reduce((acc, p) => acc + sumsByPerson[p], 0);

        contentHtml = `
            <div class="card">
                <div class="card-header"><h3 class="card-title">Plus One 担当者別振込一覧 (${selectedMonth})</h3></div>
                <div style="margin-bottom: 16px; font-size: 0.9rem; color: var(--text-secondary);">※案件管理に入力された「対象月」と「担当者」「卸単価」に基づき、ステータスが「納品」の案件のみを合計しています。</div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>担当者</th>
                                <th>振込先</th>
                                <th>合計額 (卸単価計)</th>
                                <th>請求書</th>
                                <th>入金確認</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${persons.map(p => {
                                const rec = poData.find(r => r.person === p) || { invoice: false, paid: false };
                                return `
                                    <tr>
                                        <td style="font-weight:bold;">${p}</td>
                                        <td>${getBank(p)}</td>
                                        <td style="font-weight:bold; color:var(--success);">¥${sumsByPerson[p].toLocaleString()}</td>
                                        <td style="text-align:center;">
                                            <input type="checkbox" ${rec.invoice ? 'checked' : ''} onchange="togglePoCheck('${selectedMonth}', '${p}', 'invoice', this.checked)" style="width:18px;height:18px;">
                                        </td>
                                        <td style="text-align:center;">
                                            <input type="checkbox" ${rec.paid ? 'checked' : ''} onchange="togglePoCheck('${selectedMonth}', '${p}', 'paid', this.checked)" style="width:18px;height:18px;">
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                            ${persons.length === 0 ? '<tr><td colspan="5">該当月のPlus One担当案件はありません。</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } 
    else if (activeTab === 'meo') {
        const mData = payrollData.meo.filter(m => m.month === selectedMonth);
        const staffsInMeo = [...new Set(mData.map(m => m.person))];

        contentHtml = `
            <div class="card" style="margin-bottom: 24px;">
                <div class="card-header" style="justify-content:space-between;">
                    <h3 class="card-title">MEO対策チャンネル 担当者別振込一覧 (${selectedMonth})</h3>
                    <button class="btn-primary btn-sm" onclick="document.getElementById('meo-add-modal').classList.add('active')">
                        <i class="ph ph-plus"></i> 新規記録を追加
                    </button>
                </div>
                
                ${staffsInMeo.map(p => {
                    const records = mData.filter(m => m.person === p);
                    const total = records.reduce((acc, m) => acc + (m.amount || 0), 0);
                    return `
                        <div style="margin-bottom: 24px; border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md);">
                            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                                <h4 style="font-size: 1.1rem; flex:1;">${p} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-secondary); margin-left:16px;">振込先: ${getBank(p)}</span></h4>
                                <h3 style="color:var(--success);">合計: ¥${total.toLocaleString()}</h3>
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                                <thead>
                                    <tr style="border-bottom: 1px solid var(--border-light);"><th style="padding: 4px; text-align:left;">担当クライアント</th><th style="padding: 4px; text-align:left;">タスク名</th><th style="padding: 4px; text-align:left;">金額</th><th style="padding: 4px; text-align:left;">操作</th></tr>
                                </thead>
                                <tbody>
                                    ${records.map(r => `
                                        <tr style="border-bottom: 1px solid var(--bg-hover);">
                                            <td style="padding: 4px;">${r.client}</td>
                                            <td style="padding: 4px;">${r.task}</td>
                                            <td style="padding: 4px;">¥${r.amount.toLocaleString()}</td>
                                            <td style="padding: 4px;"><button class="btn-icon" onclick="deletePayrollRecord('meo', ${r.id})"><i class="ph ph-trash" style="font-size:0.8rem;"></i></button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
                ${staffsInMeo.length === 0 ? '<p style="color:var(--text-secondary);">該当月の記録はありません。</p>' : ''}
            </div>
            
            <!-- MEO Record Add Modal -->
            <div class="modal-overlay" id="meo-add-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">MEO記録を追加</h3>
                        <button class="modal-close" onclick="document.getElementById('meo-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                    </div>
                    <form id="add-meo-record-form">
                        <div class="form-group">
                            <label>担当者</label>
                            <input type="text" id="meo-rec-person" list="staffs-list" required>
                        </div>
                        <div class="form-group">
                            <label>担当クライアント</label>
                            <input type="text" id="meo-rec-client" required>
                        </div>
                        <div class="form-group">
                            <label>タスク名</label>
                            <input type="text" id="meo-rec-task" required>
                        </div>
                        <div class="form-group">
                            <label>金額 (円)</label>
                            <input type="number" id="meo-rec-amount" required>
                        </div>
                        <button type="submit" class="btn-primary w-100">記録する</button>
                    </form>
                </div>
            </div>
        `;
    } 
    else if (activeTab === 'telecom') {
        const tData = payrollData.telecom.filter(t => t.month === selectedMonth);
        const staffsInTelecom = [...new Set(tData.map(t => t.person))];

        contentHtml = `
            <div class="card" style="margin-bottom: 24px;">
                <div class="card-header" style="justify-content:space-between;">
                    <h3 class="card-title">通信 担当稼働・振込一覧 (${selectedMonth})</h3>
                    <button class="btn-primary btn-sm" onclick="document.getElementById('tc-add-modal').classList.add('active')">
                        <i class="ph ph-plus"></i> 新規記録を追加
                    </button>
                </div>
                
                ${staffsInTelecom.map(p => {
                    const records = tData.filter(t => t.person === p);
                    const totalCost = records.reduce((acc, t) => acc + (t.cost || 0), 0);
                    const totalTransport = records.reduce((acc, t) => acc + (t.transport || 0), 0);
                    const grandTotal = totalCost + totalTransport;
                    return `
                        <div style="margin-bottom: 24px; border: 1px solid var(--border-light); padding: 16px; border-radius: var(--radius-md);">
                            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                                <h4 style="font-size: 1.1rem; flex:1;">${p} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-secondary); margin-left:16px;">振込先: ${getBank(p)}</span></h4>
                                <div style="text-align:right;">
                                    <div style="font-size:0.8rem; color:var(--text-secondary);">卸単価計: ¥${totalCost.toLocaleString()} / 交通費計: ¥${totalTransport.toLocaleString()}</div>
                                    <h3 style="color:var(--success);">総合計: ¥${grandTotal.toLocaleString()}</h3>
                                </div>
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                                <thead>
                                    <tr style="border-bottom: 1px solid var(--border-light);"><th style="padding: 4px; text-align:left;">日付</th><th style="padding: 4px; text-align:left;">担当現場</th><th style="padding: 4px; text-align:left;">卸単価</th><th style="padding: 4px; text-align:left;">交通費</th><th style="padding: 4px; text-align:left;">操作</th></tr>
                                </thead>
                                <tbody>
                                    ${records.map(r => `
                                        <tr style="border-bottom: 1px solid var(--bg-hover);">
                                            <td style="padding: 4px;">${r.date}</td>
                                            <td style="padding: 4px;">${r.place}</td>
                                            <td style="padding: 4px;">¥${r.cost.toLocaleString()}</td>
                                            <td style="padding: 4px;">¥${r.transport.toLocaleString()}</td>
                                            <td style="padding: 4px;"><button class="btn-icon" onclick="deletePayrollRecord('telecom', ${r.id})"><i class="ph ph-trash" style="font-size:0.8rem;"></i></button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('')}
                ${staffsInTelecom.length === 0 ? '<p style="color:var(--text-secondary);">該当月の記録はありません。</p>' : ''}
            </div>

            <!-- Telecom Record Add Modal -->
            <div class="modal-overlay" id="tc-add-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">通信記録を追加</h3>
                        <button class="modal-close" onclick="document.getElementById('tc-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                    </div>
                    <form id="add-tc-record-form">
                        <div class="form-group">
                            <label>担当者</label>
                            <input type="text" id="tc-rec-person" list="staffs-list" required>
                        </div>
                        <div class="form-group">
                            <label>担当現場</label>
                            <input type="text" id="tc-rec-place" required>
                        </div>
                        <div class="form-group">
                            <label>日付</label>
                            <input type="date" id="tc-rec-date" required>
                        </div>
                        <div class="grid grid-2">
                            <div class="form-group">
                                <label>卸単価 (円)</label>
                                <input type="number" id="tc-rec-cost" required>
                            </div>
                            <div class="form-group">
                                <label>交通費 (円)</label>
                                <input type="number" id="tc-rec-trans" value="0">
                            </div>
                        </div>
                        <button type="submit" class="btn-primary w-100">記録する</button>
                    </form>
                </div>
            </div>
        `;
    }

    const staffsDatalist = `<datalist id="staffs-list">${payrollData.staffs.map(s => `<option value="${s.name}">`).join('')}</datalist>`;

    const staffModalHtml = `
        <!-- Staffs Add Modal -->
        <div class="modal-overlay" id="staff-add-modal">
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3 class="modal-title">担当者追加</h3>
                    <button class="modal-close" onclick="document.getElementById('staff-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                
                <form id="add-staff-form" style="margin-bottom: 24px;">
                    <div class="grid grid-2">
                        <div class="form-group"><label>氏名</label><input type="text" id="new-staff-name" required></div>
                        <div class="form-group"><label>住所</label><input type="text" id="new-staff-address"></div>
                        <div class="form-group" style="grid-column: span 2;"><label>振込先情報</label><input type="text" id="new-staff-bank" placeholder="〇〇銀行 〇〇支店 (普) 1234567 ヤマダタロウ"></div>
                        <button type="submit" class="btn-primary w-100" style="grid-column: span 2;">追加する</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Staffs Edit Modal -->
        <div class="modal-overlay" id="staff-edit-modal">
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3 class="modal-title">担当者編集</h3>
                    <button class="modal-close" onclick="document.getElementById('staff-edit-modal').classList.remove('active'); cancelEditStaff();"><i class="ph ph-x"></i></button>
                </div>
                
                <div id="staff-list-view">
                    <div style="max-height: 400px; overflow-y:auto; line-height: 1.4;">
                        ${payrollData.staffs.map(s => `
                            <div style="border: 1px solid var(--border-light); padding: 12px; margin-bottom: 8px; border-radius: var(--radius-sm); position:relative; background: #fff;">
                                <button class="btn-icon" style="position:absolute; right:12px; top:12px;" onclick="deleteStaff(${s.id})"><i class="ph ph-trash" style="font-size:1.1rem; color:var(--danger)"></i></button>
                                <div style="font-weight:bold; margin-bottom:8px; color:var(--info); cursor:pointer; font-size: 1.1rem;" onclick="editStaff(${s.id})">
                                    <i class="ph ph-pencil-simple" style="font-size: 1rem; margin-right:4px;"></i>${s.name}
                                </div>
                                <div style="font-size:0.85rem; color:var(--text-secondary);">
                                    <div style="margin-bottom: 4px;"><i class="ph ph-map-pin"></i> ${s.address || '未登録'}</div>
                                    <div><i class="ph ph-bank"></i> ${s.bank || '未登録'}</div>
                                </div>
                            </div>
                        `).join('')}
                        ${payrollData.staffs.length === 0 ? '<p style="font-size:0.85rem; color:var(--text-secondary);">担当者が登録されていません</p>' : ''}
                    </div>
                </div>

                <form id="edit-staff-form" style="display: none; margin-top: 16px;">
                    <div style="padding: 16px; border: 1px solid var(--primary); border-radius: var(--radius-md); background: #fefefe;">
                        <h4 style="margin-bottom: 12px; font-size:1rem; color: var(--primary);">担当者情報を編集</h4>
                        <div class="grid grid-2">
                            <input type="hidden" id="edit-staff-id">
                            <div class="form-group"><label>氏名</label><input type="text" id="edit-staff-name" required></div>
                            <div class="form-group"><label>住所</label><input type="text" id="edit-staff-address"></div>
                            <div class="form-group" style="grid-column: span 2;"><label>振込先情報</label><input type="text" id="edit-staff-bank"></div>
                            <div class="form-group" style="grid-column: span 2; display:flex; gap:8px;">
                                <button type="submit" class="btn-primary w-100">更新する</button>
                                <button type="button" class="btn-secondary w-100" onclick="cancelEditStaff()">キャンセル</button>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;

    App.mount(tabHtml + contentHtml + staffsDatalist + staffModalHtml, () => {
        // Shared 
        window.deleteStaff = async (id) => {
            if(!confirm('担当者を削除してもよろしいですか？')) return;
            const data = await Store.getPayroll();
            data.staffs = (data.staffs || []).filter(s => s.id !== id);
            await Store.updatePayroll(data);
            App.navigate('payroll', activeTab);
        };

        window.editStaff = async (id) => {
            const data = await Store.getPayroll();
            const staff = data.staffs.find(s => s.id === id);
            if (staff) {
                document.getElementById('edit-staff-id').value = staff.id;
                document.getElementById('edit-staff-name').value = staff.name;
                document.getElementById('edit-staff-address').value = staff.address || '';
                document.getElementById('edit-staff-bank').value = staff.bank || '';
                
                document.getElementById('staff-list-view').style.display = 'none';
                document.getElementById('edit-staff-form').style.display = 'block';
            }
        };

        window.cancelEditStaff = () => {
            document.getElementById('edit-staff-id').value = '';
            document.getElementById('edit-staff-name').value = '';
            document.getElementById('edit-staff-address').value = '';
            document.getElementById('edit-staff-bank').value = '';
            
            document.getElementById('staff-list-view').style.display = 'block';
            document.getElementById('edit-staff-form').style.display = 'none';
        };

        const staffAddForm = document.getElementById('add-staff-form');
        if(staffAddForm) {
            staffAddForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = await Store.getPayroll();
                if(!data.staffs) data.staffs = [];

                data.staffs.push({
                    id: Date.now(),
                    name: document.getElementById('new-staff-name').value,
                    address: document.getElementById('new-staff-address').value,
                    bank: document.getElementById('new-staff-bank').value
                });
                
                await Store.updatePayroll(data);
                App.navigate('payroll', activeTab);
            });
        }
        
        const staffEditForm = document.getElementById('edit-staff-form');
        if(staffEditForm) {
            staffEditForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = await Store.getPayroll();
                if(!data.staffs) data.staffs = [];
                const editId = document.getElementById('edit-staff-id').value;

                if (editId) {
                    const staff = data.staffs.find(s => s.id === parseInt(editId));
                    if (staff) {
                        staff.name = document.getElementById('edit-staff-name').value;
                        staff.address = document.getElementById('edit-staff-address').value;
                        staff.bank = document.getElementById('edit-staff-bank').value;
                    }
                }
                
                await Store.updatePayroll(data);
                App.navigate('payroll', activeTab);
            });
        }

        window.deletePayrollRecord = async (type, id) => {
            if(!confirm('記録を削除してもよろしいですか？')) return;
            const data = await Store.getPayroll();
            data[type] = (data[type] || []).filter(r => r.id !== id);
            await Store.updatePayroll(data);
            App.navigate('payroll', activeTab);
        };

        // PlusOne
        window.togglePoCheck = async (month, person, field, checked) => {
            const data = await Store.getPayroll();
            if(!data.plusOne) data.plusOne = [];
            let rec = data.plusOne.find(p => p.month === month && p.person === person);
            if (!rec) {
                rec = { month, person, invoice: false, paid: false };
                data.plusOne.push(rec);
            }
            rec[field] = checked;
            await Store.updatePayroll(data);
        };

        // MEO
        const meoForm = document.getElementById('add-meo-record-form');
        if(meoForm) {
            meoForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = await Store.getPayroll();
                if(!data.meo) data.meo = [];
                data.meo.push({
                    id: Date.now(),
                    month: selectedMonth,
                    person: document.getElementById('meo-rec-person').value,
                    client: document.getElementById('meo-rec-client').value,
                    task: document.getElementById('meo-rec-task').value,
                    amount: parseInt(document.getElementById('meo-rec-amount').value)
                });
                await Store.updatePayroll(data);
                App.navigate('payroll', activeTab);
            });
        }

        // Telecom
        const tcForm = document.getElementById('add-tc-record-form');
        if(tcForm) {
            tcForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = await Store.getPayroll();
                if(!data.telecom) data.telecom = [];
                data.telecom.push({
                    id: Date.now(),
                    month: selectedMonth,
                    person: document.getElementById('tc-rec-person').value,
                    place: document.getElementById('tc-rec-place').value,
                    date: document.getElementById('tc-rec-date').value,
                    cost: parseInt(document.getElementById('tc-rec-cost').value),
                    transport: parseInt(document.getElementById('tc-rec-trans').value) || 0
                });
                await Store.updatePayroll(data);
                App.navigate('payroll', activeTab);
            });
        }
    });
};
