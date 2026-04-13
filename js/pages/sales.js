App.Pages.sales = async function(activeTab = 'plusOne', selectedMonth = 'all') {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title" style="color:var(--danger)">これは管理者以外操作できません</h3><p style="color:var(--text-secondary); margin-top: 16px;">売上シミュレーションは社内メンバーアカウントでは閲覧および操作が制限されています。</p></div>');
        return;
    }

    window.switchSalesTab = function(tab) {
        App.navigate('sales', tab, 'all');
    };

    const cPo = await Store.getCustomers('plusOne');
    let plusOneData = cPo.filter(c => c.status === '納品');
    
    const cMeo = await Store.getCustomers('meo');
    let meoData = cMeo.filter(c => c.tag === '契約中');
    
    const cTc = await Store.getCustomers('telecom');
    let telecomData = cTc.filter(c => c.status === '実行済み');

    if (selectedMonth !== 'all') {
        plusOneData = plusOneData.filter(c => {
            const mStr = c.month || (c.dates && c.dates[0] ? c.dates[0].substring(0,7) : null);
            if (!mStr) return false;
            const [yyyy, mm] = mStr.split('-');
            return parseInt(mm) === parseInt(selectedMonth);
        });
            telecomData = telecomData.filter(c => {
            const mStr = c.month || (c.date ? c.date.substring(0,7) : null);
            if (!mStr) return false;
            const [yyyy, mm] = mStr.split('-');
            return parseInt(mm) === parseInt(selectedMonth);
        });
        
        meoData = meoData.filter(c => {
            if (!c.startMonth) return false;
            const isLump = c.plan && c.plan.includes('一括');
            const [sY, sM] = c.startMonth.split('-');
            const startD = new Date(parseInt(sY), parseInt(sM) - 1, 1);
            let targetY = new Date().getFullYear();
            if (new Date().getMonth() < 10 && parseInt(selectedMonth) >= 11) targetY -= 1;
            if (new Date().getMonth() >= 10 && parseInt(selectedMonth) <= 10) targetY += 1;
            const targetMonthD = new Date(targetY, parseInt(selectedMonth) - 1, 1);
            
            if (isLump) {
                // One-time payment, counts in startMonth
                return (startD.getFullYear() === targetY && (startD.getMonth() + 1) === parseInt(selectedMonth));
            } else {
                // Subscription, up to 12 months. E.g. start at month 0 -> expires after 11th step (+12 months - 1day)
                const expD = new Date(startD.getFullYear(), startD.getMonth() + 12, 1);
                // Active if target is >= start && target < expD
                return targetMonthD.getTime() >= startD.getTime() && targetMonthD.getTime() < expD.getTime();
            }
        });
    }

    let html = `
        <div class="tabs">
            <div class="tab ${activeTab === 'plusOne' ? 'active' : ''}" onclick="switchSalesTab('plusOne')">Plus One</div>
            <div class="tab ${activeTab === 'meo' ? 'active' : ''}" onclick="switchSalesTab('meo')">MEO対策チャンネル</div>
            <div class="tab ${activeTab === 'telecom' ? 'active' : ''}" onclick="switchSalesTab('telecom')">通信</div>
        </div>
        
        ${['plusOne', 'meo', 'telecom'].includes(activeTab) ? `
        <div class="card" style="margin-bottom: 24px; padding: 16px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <span class="badge badge-neutral" style="font-size: 0.9rem;">対象月フィルター (売上計上月)</span>
                <button class="btn-sm ${selectedMonth === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.sales('${activeTab}', 'all')">すべて表示</button>
                ${[11,12,1,2,3,4,5,6,7,8,9,10].map(m => `
                    <button class="btn-sm ${selectedMonth === m ? 'btn-primary' : 'btn-secondary'}" onclick="App.Pages.sales('${activeTab}', ${m})">${m}月</button>
                `).join('')}
            </div>
            <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-secondary);">※このフィルターは「契約月の翌月（ダッシュボードで売上に計上される月）」を基準に絞り込みます（MEO一括は当月、残りは月額換算）。</div>
        </div>
        ` : ''}
    `;

    if (activeTab === 'plusOne') {
        const total = plusOneData.reduce((acc, c) => acc + (c.priceReceipt || c.priceOverride || CONSTANTS.PLUS_ONE_PRICING[c.type]), 0);
        html += `
            <div class="card" style="margin-bottom: 24px;">
                <h3 class="card-title">Plus One 売上実績（ステータス：納品）</h3>
                <h2 style="font-size: 2.5rem; margin-top: 16px; color: var(--success);">¥${total.toLocaleString()}</h2>
            </div>
            <div class="card">
                <table class="table-container">
                    <thead>
                        <tr><th>担当者</th><th>クライアント名</th><th>案件</th><th>受単価設定</th></tr>
                    </thead>
                    <tbody>
                        ${plusOneData.length ? plusOneData.map(d => `
                            <tr>
                                <td>${d.person || '-'}</td>
                                <td>${d.client}</td>
                                <td><span class="badge badge-neutral">${d.type}</span></td>
                                <td>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <span>¥</span>
                                        <input type="number" value="${d.priceReceipt !== undefined ? (d.priceReceipt === null ? '' : d.priceReceipt) : d.priceOverride || CONSTANTS.PLUS_ONE_PRICING[d.type]}" 
                                            onchange="updatePlusOnePrice(${d.id}, this.value)" 
                                            style="width: 120px; padding: 6px; font-size: 0.875rem;" placeholder="受単価" />
                                    </div>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="4">納品済みの案件がありません。</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } 
    else if (activeTab === 'meo') {
        let simulationsHtml = '';

        let totalMeoSales = 0;
        if (meoData.length === 0) {
            simulationsHtml = '<p style="color:var(--text-secondary);">現在、該当月に計上される顧客はいません。</p>';
        } else {
            meoData.forEach(c => {
                const pInfo = CONSTANTS.MEO_PLANS.find(p => p.name === c.plan);
                const price = pInfo ? pInfo.price : 0;
                totalMeoSales += (selectedMonth === 'all') ? (price * (c.plan && c.plan.includes('一括') ? 1 : 12)) : price;
                const isLump = c.plan && c.plan.includes('一括');
                const monthsCount = isLump ? 1 : 12;
                const startMonth = c.startMonth || new Date().toISOString().slice(0, 7);
                
                let out = `<div style="padding: 16px; border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: 24px; background: var(--bg-primary);">`;
                out += `<h4>${c.client} <span style="font-weight:normal; font-size:0.9rem; color:var(--text-secondary); margin-left:12px;">プラン: ${c.plan} / 契約開始: ${startMonth}</span></h4>`;
                
                out += `<div class="table-container" style="margin-top:16px;"><table><thead><tr>`;
                for(let i=0; i<monthsCount; i++) {
                    let d = new Date(startMonth + '-01');
                    if (!isLump) d.setMonth(d.getMonth() + 1 + i); // Start from next month for non-lump sum
                    else d.setMonth(d.getMonth() + i);
                    
                    out += `<th>${d.getMonth()+1}月</th>`;
                }
                out += `<th>合計</th></tr></thead><tbody><tr>`;
                
                for(let i=0; i<monthsCount; i++) {
                    out += `<td>¥${price.toLocaleString()}</td>`;
                }
                const total = price * monthsCount;
                out += `<td><strong>¥${total.toLocaleString()}</strong></td></tr></tbody></table></div></div>`;
                
                simulationsHtml += out;
            });
        }

        html += `
            <div class="card" style="margin-bottom: 24px;">
                <h3 class="card-title">MEO 売上シミュレーション ${selectedMonth !== 'all' ? `(${selectedMonth}月)` : ''}</h3>
                <h2 style="font-size: 2.5rem; margin-top: 16px; color: var(--success);">¥${(totalMeoSales || 0).toLocaleString()}</h2>
                <p style="color:var(--text-secondary); margin-top: 16px; margin-bottom: 24px; line-height: 1.6;">
                    顧客管理にて「契約中」の顧客情報（プランと開始月）に基づき、各顧客の売上シミュレーションが自動表示されます。<br>
                </p>
                ${simulationsHtml}
            </div>
        `;
    } 
    else if (activeTab === 'telecom') {
        const total = telecomData.reduce((acc, c) => acc + Math.floor((c.priceReceipt || c.price || 0) * 1.1), 0);
        html += `
            <div class="card" style="margin-bottom: 24px;">
                <h3 class="card-title">通信 売上実績（ステータス：実行済み / <span style="color:var(--danger)">消費税10%込</span>）</h3>
                <h2 style="font-size: 2.5rem; margin-top: 16px; color: var(--success);">¥${total.toLocaleString()}</h2>
            </div>
            <div class="card">
                <table class="table-container">
                    <thead><tr><th>担当者</th><th>現場場所</th><th>クライアント会社</th><th>日付</th><th>受単価(税抜)</th><th>受単価(10%税込)</th></tr></thead>
                    <tbody>
                        ${telecomData.length ? telecomData.map(d => `
                            <tr>
                                <td>${d.person || '-'}</td>
                                <td>${d.place}</td>
                                <td>${d.client}</td>
                                <td>${d.date}</td>
                                <td>¥${(d.priceReceipt || d.price || 0).toLocaleString()}</td>
                                <td><strong>¥${Math.floor((d.priceReceipt || d.price || 0) * 1.1).toLocaleString()}</strong></td>
                            </tr>
                        `).join('') : '<tr><td colspan="5">実行済みの現場がありません。</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    }

    App.mount(html, () => {
        window.changeSalesMonth = (val) => {
            App.navigate('sales', activeTab, val);
        };
        window.updatePlusOnePrice = async (id, val) => {
            const parsed = parseInt(val);
            await Store.updateCustomer('plusOne', id, { priceReceipt: isNaN(parsed) ? null : parsed });
            App.navigate('sales', 'plusOne', selectedMonth);
        };
    });
};
