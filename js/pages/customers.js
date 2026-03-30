App.Pages.customers = async function(activeTab = 'plusOne', selectedMonth = 'all') {
    const user = Auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';
    const dept = Auth.getDepartment();

    const renderTableHead = (cols) => `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}<th>操作</th></tr></thead>`;
    
    window.switchCustomerTab = function(tab) {
        if (dept !== 'all' && dept !== tab) {
            alert('閲覧権限がありません。');
            return;
        }
        App.navigate('customers', tab, 'all');
    };

    if (dept !== 'all' && dept !== activeTab) {
        activeTab = dept; 
    }

    const meoData = await Store.getCustomers('meo');
    let plusOneData = await Store.getCustomers('plusOne');
    let telecomData = await Store.getCustomers('telecom');

    if (selectedMonth !== 'all') {
        plusOneData = plusOneData.filter(c => {
            const mStr = c.month || (c.dates && c.dates[0] ? c.dates[0].substring(0,7) : null);
            if (!mStr) return false;
            return parseInt(mStr.split('-')[1]) === parseInt(selectedMonth);
        });
        telecomData = telecomData.filter(c => {
            const mStr = c.month || (c.date ? c.date.substring(0,7) : null);
            if (!mStr) return false;
            return parseInt(mStr.split('-')[1]) === parseInt(selectedMonth);
        });
    }

    // MEO Contract end month calculation
    window.calcMeoEndMonth = (startMonthStr) => {
        if (!startMonthStr) return '';
        const [yyyy, mm] = startMonthStr.split('-');
        let date = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
        date.setMonth(date.getMonth() + 11); // 12 months duration means +11 months from start month (inclusive)
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    // Listeners for MEO Date calculation on add form
    window.onAddMeoMonthChange = (e) => {
        document.getElementById('meo-end-month').value = window.calcMeoEndMonth(e.target.value);
    };

    const checkAdmin = () => {
        const u = Auth.getCurrentUser();
        if (!u || u.role !== 'admin') {
            alert('管理者以外操作できません。');
            return false;
        }
        return true;
    };

    const html = `
        <div class="tabs">
            <div class="tab ${activeTab === 'plusOne' ? 'active' : ''}" onclick="switchCustomerTab('plusOne')">Plus One (映像制作)</div>
            <div class="tab ${activeTab === 'meo' ? 'active' : ''}" onclick="switchCustomerTab('meo')">MEO対策チャンネル (MEO)</div>
            <div class="tab ${activeTab === 'telecom' ? 'active' : ''}" onclick="switchCustomerTab('telecom')">通信 (人材派遣)</div>
        </div>
        
        ${['plusOne', 'telecom'].includes(activeTab) ? `
        <div class="card" style="margin-bottom: 24px; padding: 16px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <span class="badge badge-neutral" style="font-size: 0.9rem;">対象月フィルター</span>
                <button class="btn-sm ${selectedMonth === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.customers('${activeTab}', 'all')">すべて表示</button>
                ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
                    <button class="btn-sm ${selectedMonth === m ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.customers('${activeTab}', ${m})">${m}月</button>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <div class="card" style="margin-bottom: 32px">
            <div class="card-header">
                <h3 class="card-title">新規追加</h3>
                <button class="btn-primary btn-sm" onclick="toggleAddForm()"><i class="ph ph-plus"></i> 新規追加</button>
            </div>
            <div id="add-form-container" style="display: none;">
                ${activeTab === 'plusOne' ? `
                    <form id="add-plusone-form">
                        <div class="grid grid-2">
                            <div class="form-group"><label>クライアント名</label><input type="text" id="po-client" required></div>
                            <div class="form-group"><label>タイトル</label><input type="text" id="po-title"></div>
                            <div class="form-group"><label>対象月</label><input type="month" id="po-month" required></div>
                            <div class="form-group"><label>担当者</label><input type="text" id="po-person"></div>
                            <div class="form-group"><label>案件タイプ</label>
                                <select id="po-type">
                                    ${CONSTANTS.PLUS_ONE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>初稿提出日</label><input type="date" id="po-date-0"></div>
                            <div class="form-group"><label>修正1提出日</label><input type="date" id="po-date-1"></div>
                            <div class="form-group"><label>修正2提出日</label><input type="date" id="po-date-2"></div>
                            <div class="form-group"><label>修正3提出日</label><input type="date" id="po-date-3"></div>
                            <div class="form-group"><label>ステータス</label>
                                <select id="po-status" onclick="if(!checkAdmin()) return false;">
                                    ${CONSTANTS.PLUS_ONE_STATUS.map(s => `<option value="${s}">${s}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>動画データURL</label><input type="url" id="po-video"></div>
                            <div class="form-group"><label>プロマネURL</label><input type="url" id="po-pm"></div>
                            ${isAdmin ? `
                            <div class="form-group"><label>受単価 (円)</label><input type="number" id="po-price-receipt" placeholder="自動計算にする場合は空欄"></div>
                            <div class="form-group"><label>卸単価 (円)</label><input type="number" id="po-price-cost" placeholder="0"></div>
                            ` : ''}
                            <div class="form-group"><button type="submit" class="btn-primary" style="margin-top: 24px;">登 録</button></div>
                        </div>
                    </form>
                ` : ''}

                ${activeTab === 'meo' ? `
                    <form id="add-meo-form">
                        <div class="grid grid-2">
                            <div class="form-group"><label>顧客名</label><input type="text" id="meo-client" required></div>
                            <div class="form-group">
                                <label>契約プラン</label>
                                <select id="meo-plan">
                                    ${CONSTANTS.MEO_PLANS.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>契約月</label><input type="month" id="meo-month" required onchange="onAddMeoMonthChange(event)"></div>
                            <div class="form-group"><label>契約満了予定 (12ヶ月後)</label><input type="text" id="meo-end-month" disabled></div>
                            <div class="form-group"><label>ステータス</label>
                                <select id="meo-tag" onclick="if(!checkAdmin()) return false;">
                                    <option value="契約中">契約中</option>
                                    <option value="解約済み">解約済み</option>
                                </select>
                            </div>
                            <!-- GBP -->
                            <div class="form-group"><label>予約リンク</label><input type="url" id="meo-reserve-link" placeholder="https://..."></div>
                            <div class="form-group"><label>ビジネスカテゴリー (GBP)</label><input type="text" id="meo-gbp-cat"></div>
                            <div class="form-group"><label>その他 (GBP)</label><input type="text" id="meo-gbp-other"></div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label>ビジネス説明欄 (GBP/750文字)</label>
                                <textarea id="meo-gbp-desc" maxlength="750" rows="3"></textarea>
                            </div>
                            <div class="form-group"><button type="submit" class="btn-primary">登 録</button></div>
                        </div>
                    </form>
                ` : ''}

                ${activeTab === 'telecom' ? `
                    <form id="add-telecom-form">
                        <div class="grid grid-2">
                            <div class="form-group"><label>担当者</label><input type="text" id="tc-person" required></div>
                            <div class="form-group"><label>対象月</label><input type="month" id="tc-month" required></div>
                            <div class="form-group"><label>現場場所</label><input type="text" id="tc-place" required></div>
                            <div class="form-group"><label>クライアント会社</label><input type="text" id="tc-client" required></div>
                            ${isAdmin ? `
                            <div class="form-group"><label>受単価 (円)</label><input type="number" id="tc-price-receipt" required placeholder="0"></div>
                            <div class="form-group"><label>卸単価 (円)</label><input type="number" id="tc-price-cost" placeholder="0"></div>
                            ` : `<input type="hidden" id="tc-price-receipt" value="0"><input type="hidden" id="tc-price-cost" value="0">`}
                            <div class="form-group"><label>日付</label><input type="date" id="tc-date" required></div>
                            <div class="form-group"><label>ステータス</label>
                                <select id="tc-status" onclick="if(!checkAdmin()) return false;">
                                    <option value="未実行">未実行</option>
                                    <option value="実行済み">実行済み</option>
                                </select>
                            </div>
                            <div class="form-group"><button type="submit" class="btn-primary" style="margin-top: 24px;">登 録</button></div>
                        </div>
                    </form>
                ` : ''}
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div>
                    <h3 class="card-title">${activeTab === 'meo' ? '顧客リスト' : '案件管理'} ${selectedMonth !== 'all' ? `(${selectedMonth}月)` : ''}</h3>
                    <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">※顧客名をクリックすると編集できます</p>
                </div>
                <div style="position:relative; width:250px;">
                    <i class="ph ph-magnifying-glass" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--text-secondary);"></i>
                    <input type="text" id="customer-search" placeholder="顧客名で検索..." onkeyup="filterCustomers()" style="width:100%; border:1px solid var(--border-light); padding:8px 8px 8px 32px; border-radius:var(--radius-sm); font-size:0.9rem;">
                </div>
            </div>
            <div class="table-container">
                <table id="customer-table">
                    ${activeTab === 'plusOne' ? `
                        ${renderTableHead(['顧客名', '案件', '担当者', 'ステータス', '受単価', '卸単価', 'Links'])}
                        <tbody>
                            ${plusOneData.map(d => `
                                <tr>
                                    <td><a href="#" onclick="openEditModal('plusOne', ${d.id}); return false;" style="font-weight:bold; color:var(--info); text-decoration:none;">${d.client}</a><br><small class="text-secondary">${d.title || ''}</small></td>
                                    <td><span class="badge badge-neutral">${d.type}</span></td>
                                    <td>${d.person || ''}</td>
                                    <td>
                                        <select onchange="updateStatus('plusOne', ${d.id}, this.value, '${d.status}')" style="padding:4px; font-size:0.75rem;">
                                            ${CONSTANTS.PLUS_ONE_STATUS.map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td>${isAdmin ? `¥${(d.priceReceipt || d.priceOverride || CONSTANTS.PLUS_ONE_PRICING[d.type]).toLocaleString()}` : '非公開'}</td>
                                    <td>${isAdmin ? `¥${(d.priceCost || 0).toLocaleString()}` : '非公開'}</td>
                                    <td>
                                        ${d.videoUrl ? `<a href="${d.videoUrl}" target="_blank" title="動画データ"><i class="ph ph-video-camera"></i></a>` : ''}
                                        ${d.pmUrl ? `<a href="${d.pmUrl}" target="_blank" title="プロマネ"><i class="ph ph-folder"></i></a>` : ''}
                                    </td>
                                    <td><button class="btn-icon" onclick="deleteCustomer('plusOne', ${d.id})"><i class="ph ph-trash"></i></button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    ` : ''}

                    ${activeTab === 'meo' ? `
                        ${renderTableHead(['顧客名', '契約情報', '投稿状況', 'ブログ履歴', 'GBP情報', 'ステータス'])}
                        <tbody>
                            ${meoData.map(d => `
                                <tr>
                                    <td><a href="#" onclick="openEditModal('meo', ${d.id}); return false;" style="font-weight:bold; color:var(--info); text-decoration:none;">${d.client}</a></td>
                                    <td>
                                        <div style="font-size:0.8rem; line-height:1.4;">
                                            <div><strong>プラン:</strong> ${d.plan || '未設定'}</div>
                                            <div><strong>契約月:</strong> ${d.startMonth || '未設定'}</div>
                                            <div><strong>満了予定:</strong> ${d.endMonth || '未設定'}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style="display:flex; flex-direction: column; gap: 4px; max-width: 140px;">
                                            <select onchange="renderMeoPostsUI(${d.id}, this.value)" style="padding: 2px; font-size: 0.8rem; border-radius: 4px;">
                                                ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${new Date().getMonth()+1 === m ? 'selected' : ''}>${m}月</option>`).join('')}
                                            </select>
                                            <div id="posts-container-${d.id}" style="display:flex; gap:2px; flex-wrap:wrap; margin-top: 4px;">
                                                <!-- Dynamic posts rendered here -->
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style="font-size:0.8rem; margin-bottom: 8px; max-height:100px; overflow-y:auto; line-height: 1.4;">
                                            ${(d.blogs || []).map(b => `
                                                <div style="border-bottom: 1px solid var(--border-light); padding-bottom:4px; margin-bottom:4px;">
                                                    <div><strong>${b.date}</strong> <span class="badge badge-success" style="font-size:0.6rem;">${b.person || '未担当'}</span></div>
                                                    <div><a href="${b.url || '#'}" target="_blank" style="color:var(--info); font-weight:bold;">${b.name || '-'}</a></div>
                                                </div>
                                            `).join('')}
                                            ${!(d.blogs && d.blogs.length) ? '<div style="color:var(--text-secondary); margin-bottom:4px;">履歴なし</div>' : ''}
                                        </div>
                                        <button class="btn-primary btn-sm p-1" style="font-size:0.75rem; padding: 4px 8px; width: 100%;" onclick="openBlogModal(${d.id})"><i class="ph ph-plus"></i> ブログ追加</button>
                                    </td>
                                    <td>
                                        <div style="font-size:0.8rem; line-height:1.4;">
                                            <div><strong>予約:</strong> ${d.reserveUrl ? `<a href="${d.reserveUrl}" target="_blank" style="color:var(--info);">リンク</a>` : '-'}</div>
                                            <div><strong>カテゴリ:</strong> ${d.gbpCategory || '-'}</div>
                                            <div><strong>その他:</strong> ${d.gbpOther || '-'}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <select onchange="updateStatus('meo', ${d.id}, this.value, '${d.tag}')" style="padding:4px; font-size:0.75rem;">
                                            <option value="契約中" ${d.tag === '契約中' ? 'selected' : ''}>契約中</option>
                                            <option value="解約済み" ${d.tag === '解約済み' ? 'selected' : ''}>解約済み</option>
                                        </select>
                                    </td>
                                    <td><button class="btn-icon" onclick="deleteCustomer('meo', ${d.id})"><i class="ph ph-trash"></i></button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    ` : ''}

                    ${activeTab === 'telecom' ? `
                        ${renderTableHead(['担当者', '現場場所', 'クライアント', '受単価', '卸単価', '日付', 'ステータス'])}
                        <tbody>
                            ${telecomData.map(d => `
                                <tr>
                                    <td>${d.person || '-'}</td>
                                    <td><a href="#" onclick="openEditModal('telecom', ${d.id}); return false;" style="font-weight:bold; color:var(--info); text-decoration:none;">${d.place}</a></td>
                                    <td>${d.client}</td>
                                    <td>${isAdmin ? `¥${(d.priceReceipt || d.price || 0).toLocaleString()}` : '非公開'}</td>
                                    <td>${isAdmin ? `¥${(d.priceCost || 0).toLocaleString()}` : '非公開'}</td>
                                    <td>${d.date}</td>
                                    <td>
                                        <select onchange="updateStatus('telecom', ${d.id}, this.value, '${d.status}')" style="padding:4px; font-size:0.75rem;">
                                            <option value="未実行" ${d.status === '未実行' ? 'selected' : ''}>未実行</option>
                                            <option value="実行済み" ${d.status === '実行済み' ? 'selected' : ''}>実行済み</option>
                                        </select>
                                    </td>
                                    <td><button class="btn-icon" onclick="deleteCustomer('telecom', ${d.id})"><i class="ph ph-trash"></i></button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    ` : ''}
                </table>
            </div>
        </div>

        <!-- Blog Modal -->
        <div class="modal-overlay" id="blog-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">ブログ投稿完了</h3>
                    <button class="modal-close" onclick="closeBlogModal()"><i class="ph ph-x"></i></button>
                </div>
                <div class="form-group"><label>ブログ名 (必須)</label><input type="text" id="blog-name"></div>
                <div class="form-group"><label>投稿日 (必須)</label><input type="date" id="blog-date"></div>
                <div class="form-group"><label>URL</label><input type="url" id="blog-url" placeholder="https://..."></div>
                <div class="form-group"><label>担当者名</label><input type="text" id="blog-person"></div>
                <input type="hidden" id="blog-customer-id">
                <div class="modal-footer">
                    <button class="btn-primary" onclick="submitBlogModal()">保存して完了とする</button>
                </div>
            </div>
        </div>

        <!-- Edit Modal -->
        <div class="modal-overlay" id="edit-modal">
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3 class="modal-title">顧客情報の編集</h3>
                    <button class="modal-close" onclick="document.getElementById('edit-modal').classList.remove('active')"><i class="ph ph-x"></i></button>
                </div>
                <div id="edit-form-container"></div>
            </div>
        </div>
    `;

    App.mount(html, () => {
        window.toggleAddForm = () => {
            const el = document.getElementById('add-form-container');
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }

        window.filterCustomers = () => {
            const q = document.getElementById('customer-search').value.toLowerCase();
            const rows = document.querySelectorAll('#customer-table tbody tr');
            rows.forEach(row => {
                const nameCol = row.querySelector('td:first-child');
                const secondCol = row.querySelector('td:nth-child(2)'); // To also catch Telecom place or PlusOne titles
                if (nameCol) {
                    const txt = (nameCol.textContent + (secondCol ? secondCol.textContent : '')).toLowerCase();
                    row.style.display = txt.includes(q) ? '' : 'none';
                }
            });
        };

        window.deleteCustomer = async (type, id) => {
            if(!checkAdmin()) return;
            if(confirm('削除しますか？')){ await Store.deleteCustomer(type, id); switchCustomerTab(activeTab); }
        }

        window.updateStatus = async (type, id, newVal, oldVal) => {
            if(!checkAdmin()) {
                switchCustomerTab(activeTab); // Re-render to revert
                return;
            }
            if (type === 'plusOne') await Store.updateCustomer('plusOne', id, { status: newVal });
            if (type === 'meo') await Store.updateCustomer('meo', id, { tag: newVal });
            if (type === 'telecom') await Store.updateCustomer('telecom', id, { status: newVal });
        };

        // Adding logic
        if (activeTab === 'plusOne') {
            document.getElementById('add-plusone-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const pr = document.getElementById('po-price-receipt') ? document.getElementById('po-price-receipt').value : '';
                const pc = document.getElementById('po-price-cost') ? document.getElementById('po-price-cost').value : '';
                await Store.addCustomer('plusOne', {
                    client: document.getElementById('po-client').value,
                    title: document.getElementById('po-title').value,
                    month: document.getElementById('po-month').value,
                    person: document.getElementById('po-person').value,
                    type: document.getElementById('po-type').value,
                    dates: [
                        document.getElementById('po-date-0').value,
                        document.getElementById('po-date-1').value,
                        document.getElementById('po-date-2').value,
                        document.getElementById('po-date-3').value
                    ],
                    status: document.getElementById('po-status').value,
                    videoUrl: document.getElementById('po-video').value,
                    pmUrl: document.getElementById('po-pm').value,
                    priceReceipt: pr ? parseInt(pr) : null,
                    priceCost: pc ? parseInt(pc) : 0
                });
                await Store.logAction(user.email, `Plus Oneの案件管理に「${document.getElementById('po-client').value}」を新規追加しました`);
                switchCustomerTab('plusOne');
            });
        }
        else if (activeTab === 'meo') {
            document.getElementById('add-meo-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                await Store.addCustomer('meo', {
                    client: document.getElementById('meo-client').value,
                    plan: document.getElementById('meo-plan').value,
                    startMonth: document.getElementById('meo-month').value,
                    endMonth: document.getElementById('meo-end-month').value,
                    tag: document.getElementById('meo-tag').value,
                    reserveUrl: document.getElementById('meo-reserve-link').value,
                    gbpCategory: document.getElementById('meo-gbp-cat').value,
                    gbpOther: document.getElementById('meo-gbp-other').value,
                    gbpDesc: document.getElementById('meo-gbp-desc').value,
                    posts: {}, // Month-indexed object instead of array
                    blogs: []
                });
                await Store.logAction(user.email, `MEO対策チャンネルの案件管理に「${document.getElementById('meo-client').value}」を新規追加しました`);
                switchCustomerTab('meo');
            });

            window.updateMeoPost = async (id, month, idx, checked) => {
                const c = meoData.find(x => x.id === id);
                if (!c.posts || Array.isArray(c.posts)) c.posts = {}; 
                if (!c.posts[month]) c.posts[month] = Array(12).fill(false);
                c.posts[month][idx] = checked;
                await Store.updateCustomer('meo', id, { posts: c.posts });
            };

            window.renderMeoPostsUI = (id, month) => {
                const el = document.getElementById(`posts-container-${id}`);
                if (!el) return;
                const d = meoData.find(c => c.id === id);
                if (!d) return;
                
                let monthPosts = Array(12).fill(false);
                if (d.posts && !Array.isArray(d.posts) && d.posts[month]) {
                    monthPosts = d.posts[month];
                }
                
                el.innerHTML = monthPosts.map((checked, i) => `
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="updateMeoPost(${id}, '${month}', ${i}, this.checked)">
                `).join('');
            };

            // Initial render for MEO posts
            setTimeout(() => {
                const currentM = new Date().getMonth() + 1;
                meoData.forEach(d => {
                    renderMeoPostsUI(d.id, currentM.toString());
                });
            }, 0);

            window.openBlogModal = (id) => {
                document.getElementById('blog-name').value = '';
                document.getElementById('blog-date').value = new Date().toISOString().slice(0, 10);
                document.getElementById('blog-url').value = '';
                document.getElementById('blog-person').value = '';
                document.getElementById('blog-customer-id').value = id;
                document.getElementById('blog-modal').classList.add('active');
            }
            window.closeBlogModal = () => document.getElementById('blog-modal').classList.remove('active');
            window.submitBlogModal = async () => {
                const id = parseInt(document.getElementById('blog-customer-id').value);
                const blogName = document.getElementById('blog-name').value;
                const blogDate = document.getElementById('blog-date').value;
                const blogUrl = document.getElementById('blog-url').value;
                const blogPerson = document.getElementById('blog-person').value;
                
                if(!blogName || !blogDate) { alert('ブログ名と投稿日を入力してください'); return; }
                
                const c = meoData.find(x => x.id === id);
                if (!c) return;
                if (!c.blogs) c.blogs = [];
                c.blogs.push({ name: blogName, date: blogDate, url: blogUrl, person: blogPerson });
                await Store.updateCustomer('meo', id, { blogs: c.blogs });
                
                closeBlogModal();
                switchCustomerTab('meo');
            }
        }
        else if (activeTab === 'telecom') {
            document.getElementById('add-telecom-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const pr = document.getElementById('tc-price-receipt') ? document.getElementById('tc-price-receipt').value : '';
                const pc = document.getElementById('tc-price-cost') ? document.getElementById('tc-price-cost').value : '';
                await Store.addCustomer('telecom', {
                    person: document.getElementById('tc-person').value,
                    month: document.getElementById('tc-month').value,
                    place: document.getElementById('tc-place').value,
                    client: document.getElementById('tc-client').value,
                    priceReceipt: pr ? parseInt(pr) : 0,
                    priceCost: pc ? parseInt(pc) : 0,
                    date: document.getElementById('tc-date').value,
                    status: document.getElementById('tc-status').value
                });
                await Store.logAction(user.email, `通信の案件管理に「${document.getElementById('tc-client').value}」を新規追加しました`);
                switchCustomerTab('telecom');
            });
        }

        // Edit functionality
        window.openEditModal = async (type, id) => {
            const list = await Store.getCustomers(type);
            const data = list.find(c => c.id === id);
            if (!data) return;

            const container = document.getElementById('edit-form-container');
            
            if (type === 'plusOne') {
                container.innerHTML = `
                    <form id="edit-form" onsubmit="submitEdit(event, '${type}', ${id})">
                        <div class="grid grid-2">
                            <div class="form-group"><label>クライアント名</label><input type="text" id="e-po-client" value="${data.client || ''}" required></div>
                            <div class="form-group"><label>タイトル</label><input type="text" id="e-po-title" value="${data.title || ''}"></div>
                            <div class="form-group"><label>対象月</label><input type="month" id="e-po-month" value="${data.month || (data.dates && data.dates[0] ? data.dates[0].substring(0,7) : '')}" required></div>
                            <div class="form-group"><label>担当者</label><input type="text" id="e-po-person" value="${data.person || ''}"></div>
                            <div class="form-group"><label>案件タイプ</label>
                                <select id="e-po-type">
                                    ${CONSTANTS.PLUS_ONE_TYPES.map(t => `<option value="${t}" ${data.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>ステータス</label>
                                <select id="e-po-status">
                                    ${CONSTANTS.PLUS_ONE_STATUS.map(s => `<option value="${s}" ${data.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>動画データURL</label><input type="url" id="e-po-video" value="${data.videoUrl || ''}"></div>
                            <div class="form-group"><label>プロマネURL</label><input type="url" id="e-po-pm" value="${data.pmUrl || ''}"></div>
                            ${isAdmin ? `
                            <div class="form-group"><label>受単価 (円)</label><input type="number" id="e-po-price-receipt" value="${data.priceReceipt !== undefined ? (data.priceReceipt === null ? '' : data.priceReceipt) : ''}"></div>
                            <div class="form-group"><label>卸単価 (円)</label><input type="number" id="e-po-price-cost" value="${data.priceCost || 0}"></div>
                            ` : `<input type="hidden" id="e-po-price-receipt" value="${data.priceReceipt || ''}"><input type="hidden" id="e-po-price-cost" value="${data.priceCost || 0}">`}
                            <div class="form-group" style="grid-column:span 2;"><button type="submit" class="btn-primary w-100">更新を保存</button></div>
                        </div>
                    </form>
                `;
            } else if (type === 'meo') {
                container.innerHTML = `
                    <form id="edit-form" onsubmit="submitEdit(event, '${type}', ${id})">
                        <div class="grid grid-2">
                            <div class="form-group"><label>顧客名</label><input type="text" id="e-meo-client" value="${data.client || ''}" required></div>
                            <div class="form-group">
                                <label>契約プラン</label>
                                <select id="e-meo-plan">
                                    ${CONSTANTS.MEO_PLANS.map(p => `<option value="${p.name}" ${data.plan === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group"><label>契約月</label><input type="month" id="e-meo-month" value="${data.startMonth || ''}" required onchange="document.getElementById('e-meo-end-month').value = calcMeoEndMonth(this.value)"></div>
                            <div class="form-group"><label>契約満了予定</label><input type="text" id="e-meo-end-month" value="${data.endMonth || ''}" disabled></div>
                            
                            <div class="form-group"><label>予約リンク</label><input type="url" id="e-meo-reserve-link" value="${data.reserveUrl || ''}"></div>
                            <div class="form-group"><label>ビジネスカテゴリー</label><input type="text" id="e-meo-gbp-cat" value="${data.gbpCategory || ''}"></div>
                            <div class="form-group"><label>その他</label><input type="text" id="e-meo-gbp-other" value="${data.gbpOther || ''}"></div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label>ビジネス説明欄</label>
                                <textarea id="e-meo-gbp-desc" maxlength="750" rows="3">${data.gbpDesc || ''}</textarea>
                            </div>
                            <div class="form-group" style="grid-column: span 2;"><button type="submit" class="btn-primary w-100">更新を保存</button></div>
                        </div>
                    </form>
                `;
            } else if (type === 'telecom') {
                container.innerHTML = `
                    <form id="edit-form" onsubmit="submitEdit(event, '${type}', ${id})">
                        <div class="grid grid-2">
                            <div class="form-group"><label>担当者</label><input type="text" id="e-tc-person" value="${data.person || ''}" required></div>
                            <div class="form-group"><label>対象月</label><input type="month" id="e-tc-month" value="${data.month || (data.date ? data.date.substring(0,7) : '')}" required></div>
                            <div class="form-group"><label>現場場所</label><input type="text" id="e-tc-place" value="${data.place || ''}" required></div>
                            <div class="form-group"><label>クライアント会社</label><input type="text" id="e-tc-client" value="${data.client || ''}" required></div>
                            ${isAdmin ? `
                            <div class="form-group"><label>受単価 (円)</label><input type="number" id="e-tc-price-receipt" value="${data.priceReceipt || data.price || 0}" required></div>
                            <div class="form-group"><label>卸単価 (円)</label><input type="number" id="e-tc-price-cost" value="${data.priceCost || 0}"></div>
                            ` : `<input type="hidden" id="e-tc-price-receipt" value="${data.priceReceipt || data.price || 0}"><input type="hidden" id="e-tc-price-cost" value="${data.priceCost || 0}">`}
                            <div class="form-group"><label>日付</label><input type="date" id="e-tc-date" value="${data.date || ''}" required></div>
                            <div class="form-group" style="grid-column: span 2;"><button type="submit" class="btn-primary w-100">更新を保存</button></div>
                        </div>
                    </form>
                `;
            }

            document.getElementById('edit-modal').classList.add('active');
        };

        window.submitEdit = async (e, type, id) => {
            e.preventDefault();
            if(!checkAdmin()) return; // Extra layer of protection for saving edits

            if (type === 'plusOne') {
                const pr = document.getElementById('e-po-price-receipt') ? document.getElementById('e-po-price-receipt').value : '';
                await Store.updateCustomer('plusOne', id, {
                    client: document.getElementById('e-po-client').value,
                    title: document.getElementById('e-po-title').value,
                    month: document.getElementById('e-po-month').value,
                    person: document.getElementById('e-po-person').value,
                    type: document.getElementById('e-po-type').value,
                    status: document.getElementById('e-po-status').value,
                    videoUrl: document.getElementById('e-po-video').value,
                    pmUrl: document.getElementById('e-po-pm').value,
                    priceReceipt: pr ? parseInt(pr) : null,
                    priceCost: document.getElementById('e-po-price-cost') ? parseInt(document.getElementById('e-po-price-cost').value) : 0
                });
                await Store.logAction(user.email, `Plus Oneの案件「${document.getElementById('e-po-client').value}」を編集しました`);
            } else if (type === 'meo') {
                await Store.updateCustomer('meo', id, {
                    client: document.getElementById('e-meo-client').value,
                    plan: document.getElementById('e-meo-plan').value,
                    startMonth: document.getElementById('e-meo-month').value,
                    endMonth: document.getElementById('e-meo-end-month').value,
                    reserveUrl: document.getElementById('e-meo-reserve-link').value,
                    gbpCategory: document.getElementById('e-meo-gbp-cat').value,
                    gbpOther: document.getElementById('e-meo-gbp-other').value,
                    gbpDesc: document.getElementById('e-meo-gbp-desc').value
                });
                await Store.logAction(user.email, `MEO案件「${document.getElementById('e-meo-client').value}」を編集しました`);
            } else if (type === 'telecom') {
                await Store.updateCustomer('telecom', id, {
                    person: document.getElementById('e-tc-person').value,
                    month: document.getElementById('e-tc-month').value,
                    place: document.getElementById('e-tc-place').value,
                    client: document.getElementById('e-tc-client').value,
                    priceReceipt: parseInt(document.getElementById('e-tc-price-receipt').value),
                    priceCost: parseInt(document.getElementById('e-tc-price-cost').value),
                    date: document.getElementById('e-tc-date').value
                });
                await Store.logAction(user.email, `通信の案件「${document.getElementById('e-tc-client').value}」を編集しました`);
            }

            document.getElementById('edit-modal').classList.remove('active');
            switchCustomerTab(activeTab);
        };
    });
};
