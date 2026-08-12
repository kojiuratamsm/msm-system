/* ==========================================================
   MSM AI OFFICE - AI社員稼働状況ボード
   各事業部のAI社員(Claude)の稼働ステータスを可視化するページ。
   データはSupabaseの customers テーブル (service_type='ai_office_state') に保存され、
   Claude(このチャット、または日次/週次スケジュールタスク)が更新する。
   ========================================================== */

const AIO_STATUS_LABEL = {
    idle:     { emoji:'⚪', text:'待機中',       cls:'aio-st-idle' },
    active:   { emoji:'🟢', text:'稼働中',       cls:'aio-st-active' },
    research: { emoji:'🔵', text:'リサーチ中',   cls:'aio-st-research' },
    waiting:  { emoji:'🟡', text:'確認待ち',     cls:'aio-st-waiting' },
    error:    { emoji:'🔴', text:'エラー',       cls:'aio-st-error' },
    done:     { emoji:'✅', text:'完了',         cls:'aio-st-done' }
};

const AIO_DEPTS = [
    { key:'marketing', name:'マーケティング事業部', color:'#3b82f6' },
    { key:'sales',      name:'営業事業部',           color:'#22c55e' },
    { key:'design',     name:'デザイン事業部',       color:'#ec4899' },
    { key:'meo',        name:'MEO運用代行事業部',    color:'#14b8a6' }
];

function aioDeptColor(key) {
    if (key === 'secretary') return '#c9a227';
    const d = AIO_DEPTS.find(d => d.key === key);
    return d ? d.color : '#868e96';
}

const AIO_DEFAULT_STATE = {
    updatedAt: null,
    banner: null,
    employees: [
        { id:'kojima', name:'小島', role:'経営補佐', dept:'secretary', status:'idle', flow:[] },

        { id:'takahashi', name:'高橋', role:'統括', dept:'marketing', status:'idle', flow:[] },
        { id:'miura', name:'三浦', role:'YouTube', dept:'marketing', status:'idle', flow:[] },
        { id:'tanaka_m', name:'田中', role:'SNS', dept:'marketing', status:'idle', flow:[] },

        { id:'nakamura_s', name:'中村', role:'統括', dept:'sales', status:'idle', flow:[] },
        { id:'sato', name:'佐藤', role:'営業部長', dept:'sales', status:'idle', flow:[] },
        { id:'yuasa', name:'湯浅', role:'営業', dept:'sales', status:'idle', flow:[] },

        { id:'kunisada', name:'国貞', role:'部長', dept:'design', status:'idle', flow:[] },
        { id:'aoki', name:'青木', role:'デザイン', dept:'design', status:'idle', flow:[] },

        { id:'endo', name:'遠藤', role:'統括', dept:'meo', status:'idle', flow:[] },
        { id:'kubo', name:'久保', role:'部長', dept:'meo', status:'idle', flow:[] },
        { id:'nakamura_meo', name:'中村', role:'社員', dept:'meo', status:'idle', flow:[] }
    ],
    activityLog: [
        { time:'--:--', text:'まだ実績がありません。コマンドを送信するか、スケジュールタスクの実行をお待ちください。' }
    ]
};

function aioRenderFlow(flow) {
    if (!flow || !flow.length) return '';
    const rows = flow.map((s, i) => {
        const mark = s.state === 'done' ? '✓' : (s.state === 'active' ? '▶' : '・');
        return `<div class="aio-step ${s.state}">${mark} ${s.label}</div>` +
               (i < flow.length - 1 ? `<div class="aio-arrow">↓</div>` : '');
    }).join('');
    return `<div class="aio-flow">${rows}</div>`;
}

function aioRenderEmployee(e) {
    const s = AIO_STATUS_LABEL[e.status] || AIO_STATUS_LABEL.idle;
    const initial = (e.name || '?').slice(0, 1);
    return `
    <div class="aio-emp">
      <div class="aio-emprow">
        <div class="aio-avatar" style="background:${aioDeptColor(e.dept)}">${initial}</div>
        <div class="aio-empinfo">
          <div class="aio-n">${e.name}</div>
          <div class="aio-r">${e.role}</div>
        </div>
        <div class="aio-status ${s.cls}">${s.emoji} ${s.text}</div>
      </div>
      ${aioRenderFlow(e.flow)}
    </div>`;
}

function aioBuildOfficeHTML(state) {
    const employees = (state && state.employees) || AIO_DEFAULT_STATE.employees;
    const activityLog = (state && state.activityLog) || AIO_DEFAULT_STATE.activityLog;
    const banner = state ? state.banner : null;
    const updatedAt = (state && state.updatedAt) || '未取得';

    const secretary = employees.find(e => e.dept === 'secretary') || AIO_DEFAULT_STATE.employees[0];
    const counts = { idle:0, active:0, research:0, waiting:0, error:0, done:0 };
    employees.forEach(e => { if (counts[e.status] === undefined) counts[e.status] = 0; counts[e.status]++; });

    let html = `
    <div class="aio-wrap">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:8px;">
        <h2 style="font-size:1.5rem; display:flex; align-items:center; gap:10px;">🏢 MSM AI OFFICE</h2>
        <div style="font-size:12px; color:var(--text-tertiary);">最終更新: ${updatedAt}</div>
      </div>

      <div class="aio-summary">
        <div class="aio-chip">🟢 稼働中 <b>${counts.active}</b></div>
        <div class="aio-chip">🔵 リサーチ中 <b>${counts.research}</b></div>
        <div class="aio-chip">🟡 確認待ち <b>${counts.waiting}</b></div>
        <div class="aio-chip">🔴 エラー <b>${counts.error}</b></div>
        <div class="aio-chip">✅ 完了 <b>${counts.done}</b></div>
        <div class="aio-chip">⚪ 待機中 <b>${counts.idle}</b></div>
      </div>

      <div class="aio-banner ${banner ? 'show ' + (banner.type || '') : ''}">
        ${banner ? `<div class="aio-btitle">${banner.title || ''}</div><div>${banner.text || ''}</div>` : ''}
      </div>

      <div class="aio-secretary">
        <div class="aio-avatar" style="background:${aioDeptColor('secretary')}">${(secretary.name||'?').slice(0,1)}</div>
        <div class="aio-empinfo">
          <div class="aio-roomtag">秘書室</div>
          <div class="aio-n">${secretary.name} <span class="aio-r">/ ${secretary.role}</span></div>
        </div>
        <div class="aio-status ${(AIO_STATUS_LABEL[secretary.status]||AIO_STATUS_LABEL.idle).cls}">${(AIO_STATUS_LABEL[secretary.status]||AIO_STATUS_LABEL.idle).emoji} ${(AIO_STATUS_LABEL[secretary.status]||AIO_STATUS_LABEL.idle).text}</div>
      </div>

      <div class="aio-grid">`;

    AIO_DEPTS.forEach(d => {
        const members = employees.filter(e => e.dept === d.key);
        html += `
        <div class="aio-room">
          <div class="aio-roomhead">
            <div class="aio-rname"><span class="aio-dot" style="background:${d.color}"></span>${d.name}</div>
            <div class="aio-rcount">${members.length}名</div>
          </div>
          ${members.map(aioRenderEmployee).join('')}
        </div>`;
    });

    html += `</div>

      <div class="aio-log">
        <h3>📋 業務ログ</h3>
        <ul>
          ${activityLog.map(l => `<li><time>${l.time}</time><span>${l.text}</span></li>`).join('')}
        </ul>
      </div>

      <div class="aio-cmd">
        <h3>💬 コマンド送信</h3>
        <div class="aio-cmdrow">
          <input type="text" id="aio-cmd-input" class="input-field" placeholder="例: 〇〇 投稿">
          <button class="btn-primary" id="aio-cmd-send" style="margin-top:0; white-space:nowrap;">送信</button>
        </div>
        <p>送信したコマンドはSupabaseに記録され、Claude(チャット、または該当のスケジュールタスク)が確認して実行します。即時実行されるとは限りません。</p>
      </div>
    </div>`;

    return html;
}

App.Pages.ai_office = async function() {
    if (window._aioTimer) { clearInterval(window._aioTimer); window._aioTimer = null; }

    async function tick() {
        const root = document.getElementById('aio-root');
        if (!root) { if (window._aioTimer) { clearInterval(window._aioTimer); window._aioTimer = null; } return; }
        let state = null;
        try { state = await Store.getAiOfficeState(); } catch (e) { console.error(e); }
        root.innerHTML = aioBuildOfficeHTML(state || AIO_DEFAULT_STATE);

        const sendBtn = document.getElementById('aio-cmd-send');
        const input = document.getElementById('aio-cmd-input');
        if (sendBtn && input) {
            sendBtn.addEventListener('click', async () => {
                const text = input.value.trim();
                if (!text) return;
                sendBtn.disabled = true;
                try {
                    const user = Auth.getCurrentUser();
                    await Store.postAiOfficeCommand(text, user ? user.email : 'unknown');
                    input.value = '';
                    alert('コマンドを送信しました。処理状況はこの画面と業務ログに反映されます。');
                } catch (e) {
                    console.error(e);
                    alert('コマンドの送信に失敗しました。');
                } finally {
                    sendBtn.disabled = false;
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') sendBtn.click();
            });
        }
    }

    App.mount('<div id="aio-root"></div>', () => {
        tick();
        window._aioTimer = setInterval(tick, 6000);
    });
};
