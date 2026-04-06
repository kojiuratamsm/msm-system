App.Pages.tasks = async function() {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();

    let tasks = await Store.getTasks();
    if (!isAdmin && dept !== 'all') {
        const mapping = { 'plusOne': 'Plus One', 'meo': 'MEO対策チャンネル', 'telecom': '通信' };
        tasks = tasks.filter(t => t.service === mapping[dept]);
    }
    let selectedDate = window.taskSelectedDate || new Date().toISOString().split('T')[0];
    
    // Categorize tasks
    const incompleteTasks = tasks.filter(t => !t.done && t.date > selectedDate);
    // If selectedDate is strictly today, we might want to include past incomplete tasks so they aren't lost? 
    // User requested: "今日やるものも入力した日付のものだけを表示するようにしてください"
    // So we strictly use t.date === selectedDate
    const todayTasks = tasks.filter(t => !t.done && t.date === selectedDate);
    const doneTasks = tasks.filter(t => t.done && t.date === selectedDate);
    
    incompleteTasks.sort((a,b) => new Date(a.date) - new Date(b.date));
    todayTasks.sort((a,b) => new Date(a.date) - new Date(b.date));
    doneTasks.sort((a,b) => new Date(b.date) - new Date(a.date));

    // Global toggle function
    window.toggleTaskDetails = (id) => {
        const el = document.getElementById(`task-details-${id}`);
        if(el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    };

    window.changeTaskDate = (newDate) => {
        window.taskSelectedDate = newDate;
        App.navigate('tasks');
    };

    const renderTaskCard = (t, showCheckbox = false) => `
        <div style="background: var(--bg-color); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); position:relative;">
            <div style="display:flex; gap:12px; align-items:flex-start;">
                ${showCheckbox ? `<input type="checkbox" ${t.done?'checked':''} onchange="toggleTaskStatus(${t.id})" style="margin-top:4px; width:18px; height:18px; cursor:pointer;">` : ''}
                <div style="flex:1;">
                    <div style="font-weight:bold; cursor:pointer; color: ${t.done ? 'var(--text-secondary)' : 'var(--primary-dark)'}; text-decoration: ${t.done ? 'line-through' : 'none'};" onclick="toggleTaskDetails(${t.id})">
                        ${t.text}
                    </div>
                    <div id="task-details-${t.id}" style="display:none; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); font-size:0.85rem; color:var(--text-secondary);">
                        <div style="margin-bottom:4px;"><strong>期日:</strong> ${t.date}</div>
                        <div style="margin-bottom:4px;"><strong>サービス:</strong> ${t.service}</div>
                        <div style="margin-bottom:4px;"><strong>案件・顧客名:</strong> ${t.customer || '指定なし'}</div>
                        <div style="margin-top:8px;">
                            ${!t.done && !showCheckbox ? `<button class="btn-primary btn-sm p-1" onclick="toggleTaskStatus(${t.id})">完了にする</button>` : ''}
                            ${t.done ? `<button class="btn-secondary btn-sm p-1" onclick="toggleTaskStatus(${t.id})">未完了に戻す</button>` : ''}
                            <button class="btn-icon p-1" style="color:var(--danger);" onclick="removeTask(${t.id})"><i class="ph ph-trash"></i> 削除</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
            <h2 style="font-size:1.5rem; display:flex; align-items:center; gap:12px;">
                タスク表
                <input type="date" value="${selectedDate}" onchange="changeTaskDate(this.value)" style="font-size:1rem; padding:4px 8px; border:1px solid var(--border); border-radius:4px;">
            </h2>
            <button class="btn-primary" onclick="document.getElementById('task-add-modal').classList.add('active')"><i class="ph ph-plus"></i> 新規タスク</button>
        </div>

        <div class="grid grid-3" style="align-items:start; overflow-x:auto; padding-bottom:16px;">
            <div style="background:#f8f9fa; border-radius:var(--radius-md); padding:16px;">
                <h3 style="margin-bottom:16px; font-size:1.1rem; border-bottom:2px solid var(--border); padding-bottom:8px; display:flex; justify-content:space-between;">
                    <span>未完了 <small style="font-size:0.8rem; font-weight:normal;">(後日)</small></span>
                    <span class="badge badge-neutral">${incompleteTasks.length}</span>
                </h3>
                <div style="max-height: 60vh; overflow-y:auto; padding-right:4px;">
                    ${incompleteTasks.map(t => renderTaskCard(t, false)).join('')}
                    ${incompleteTasks.length === 0 ? '<div style="color:var(--text-secondary);text-align:center;padding:16px;">タスクなし</div>' : ''}
                </div>
            </div>
            
            <div style="background:#fff3cd; border-radius:var(--radius-md); padding:16px; border: 1px solid #ffe69c;">
                <h3 style="margin-bottom:16px; font-size:1.1rem; border-bottom:2px solid #ffc107; padding-bottom:8px; display:flex; justify-content:space-between;">
                    <span>選択日のタスク</span>
                    <span class="badge badge-warning">${todayTasks.length}</span>
                </h3>
                <div style="max-height: 60vh; overflow-y:auto; padding-right:4px;">
                    ${todayTasks.map(t => renderTaskCard(t, true)).join('')}
                    ${todayTasks.length === 0 ? '<div style="color:var(--text-secondary);text-align:center;padding:16px;">タスクなし</div>' : ''}
                </div>
            </div>
            
            <div style="background:#d1e7dd; border-radius:var(--radius-md); padding:16px; border: 1px solid #a3cfbb;">
                <h3 style="margin-bottom:16px; font-size:1.1rem; border-bottom:2px solid #198754; padding-bottom:8px; display:flex; justify-content:space-between;">
                    <span>終わったもの</span>
                    <span class="badge badge-success">${doneTasks.length}</span>
                </h3>
                <div style="max-height: 60vh; overflow-y:auto; padding-right:4px; opacity:0.8;">
                    ${doneTasks.map(t => renderTaskCard(t, true)).join('')}
                    ${doneTasks.length === 0 ? '<div style="color:var(--text-secondary);text-align:center;padding:16px;">タスクなし</div>' : ''}
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="task-add-modal">
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3 class="modal-title">タスクを追加</h3>
                    <button class="modal-close" onclick="document.getElementById('task-add-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <form id="add-task-form">
                    <div class="form-group">
                        <label>タスク内容</label>
                        <input type="text" id="task-text" required placeholder="例: サムネイル作成">
                    </div>
                    <div class="form-group">
                        <label>対象サービス</label>
                        <select id="task-service">
                            ${(isAdmin || dept === 'plusOne' || dept === 'all') ? '<option value="Plus One">Plus One</option>' : ''}
                            ${(isAdmin || dept === 'meo' || dept === 'all') ? '<option value="MEO対策チャンネル">MEO対策チャンネル</option>' : ''}
                            ${(isAdmin || dept === 'telecom' || dept === 'all') ? '<option value="通信">通信</option>' : ''}
                            ${(isAdmin || dept === 'all') ? '<option value="その他">その他</option>' : ''}
                        </select>
                    </div>
                    <div class="form-group" id="task-customer-container">
                        <label id="task-customer-label">顧客名</label>
                        <input type="text" id="task-customer" placeholder="顧客名を入力">
                    </div>
                    <div class="form-group">
                        <label>期日</label>
                        <input type="date" id="task-date" required value="${selectedDate}">
                    </div>
                    <button type="submit" class="btn-primary w-100" style="margin-top: 16px;">タスクを登録</button>
                </form>
            </div>
        </div>
    `;

    App.mount(html, async () => {
        
        const meoData = await Store.getCustomers('meo');
        const meoClients = meoData.map(c => c.client).filter(Boolean);
        const serviceSelect = document.getElementById('task-service');
        const customerContainer = document.getElementById('task-customer-container');

        const updateCustomerField = () => {
            const svc = serviceSelect.value;
            if (svc === 'Plus One') {
                customerContainer.innerHTML = `
                    <label id="task-customer-label">顧客名</label>
                    <input type="text" id="task-customer" placeholder="顧客名を入力" required>
                `;
            } else if (svc === 'MEO対策チャンネル') {
                const options = meoClients.length ? meoClients.map(c => `<option value="${c}">${c}</option>`).join('') : '<option value="">顧客リストなし</option>';
                customerContainer.innerHTML = `
                    <label id="task-customer-label">顧客名</label>
                    <select id="task-customer" required>
                        ${options}
                    </select>
                `;
            } else if (svc === '通信') {
                customerContainer.innerHTML = `
                    <label id="task-customer-label">クライアント名</label>
                    <input type="text" id="task-customer" placeholder="クライアント名を入力" required>
                `;
            } else {
                customerContainer.innerHTML = `
                    <label id="task-customer-label">顧客名 (任意)</label>
                    <input type="text" id="task-customer" placeholder="入力なしで可">
                `;
            }
        };

        serviceSelect.addEventListener('change', updateCustomerField);
        updateCustomerField(); // Initial check

        document.getElementById('add-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const customerVal = document.getElementById('task-customer') ? document.getElementById('task-customer').value : '指定なし';
            await Store.addTask({
                text: document.getElementById('task-text').value,
                service: serviceSelect.value,
                customer: customerVal || '指定なし',
                date: document.getElementById('task-date').value
            });
            await Store.logAction(user.email, `タスク表に新しいタスクを追加しました`);
            App.navigate('tasks'); // re-render
        });

        window.toggleTaskStatus = async (id) => {
            await Store.toggleTask(id);
            App.navigate('tasks');
        };

        window.removeTask = async (id) => {
            if(confirm('タスクを削除しますか？')) {
                await Store.deleteTask(id);
                App.navigate('tasks');
            }
        };
    });
};
