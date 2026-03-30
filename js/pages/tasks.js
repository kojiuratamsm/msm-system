App.Pages.tasks = async function() {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();

    let tasks = await Store.getTasks();
    if (!isAdmin && dept !== 'all') {
        const mapping = { 'plusOne': 'Plus One', 'meo': 'MEO対策チャンネル', 'telecom': '通信' };
        tasks = tasks.filter(t => t.service === mapping[dept]);
    }
    const today = new Date().toISOString().split('T')[0];
    
    // Sort tasks: today's incomplete first, then others
    const sortedTasks = tasks.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.date === today && b.date !== today) return -1;
        if (a.date !== today && b.date === today) return 1;
        return new Date(a.date) - new Date(b.date);
    });

    const html = `
        <div class="grid grid-2">
            <div class="card" style="grid-column: span 2;">
                <div class="card-header"><h3 class="card-title">タスク一覧</h3></div>
                <table class="table-container">
                    <thead>
                        <tr><th>ステータス</th><th>日付</th><th>サービス</th><th>顧客</th><th>タスク内容</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                        ${sortedTasks.map(t => `
                            <tr style="${t.done ? 'opacity: 0.6; text-decoration: line-through;' : ''}">
                                <td>
                                    <input type="checkbox" ${t.done ? 'checked' : ''} 
                                        style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--success);"
                                        onchange="toggleTaskStatus(${t.id})" />
                                </td>
                                <td>${t.date === today ? '<span class="badge badge-warning">本日</span>' : t.date}</td>
                                <td><span class="badge badge-neutral">${t.service}</span></td>
                                <td>${t.customer}</td>
                                <td>${t.text}</td>
                                <td><button class="btn-icon" onclick="removeTask(${t.id})"><i class="ph ph-trash"></i></button></td>
                            </tr>
                        `).join('')}
                        ${sortedTasks.length === 0 ? '<tr><td colspan="6">タスクがありません。</td></tr>' : ''}
                    </tbody>
                </table>
            </div>

            <div class="card">
                <div class="card-header"><h3 class="card-title">タスクを追加</h3></div>
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
                        <input type="date" id="task-date" required value="${today}">
                    </div>
                    <button type="submit" class="btn-primary" style="margin-top: 16px;">タスクを登録</button>
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
