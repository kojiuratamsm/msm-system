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

function aioEsc(s) {
    return (s === undefined || s === null) ? '' : String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// コマンド(ai_office_command)の status/category から、社員カードと同じ6段階のバッジ表示に変換する
function aioCmdStatusInfo(cmd) {
    const status = (cmd && cmd.status) || 'pending';
    if (status === 'pending') return AIO_STATUS_LABEL.idle;           // 待機中(まだ着手前)
    if (status === 'in_progress') return (cmd.category === 'research') ? AIO_STATUS_LABEL.research : AIO_STATUS_LABEL.active;
    if (status === 'waiting') return AIO_STATUS_LABEL.waiting;        // 確認待ち(代表確認 or サイト修正のためチャット依頼へ誘導)
    if (status === 'error') return AIO_STATUS_LABEL.error;
    if (status === 'done') return AIO_STATUS_LABEL.done;
    return AIO_STATUS_LABEL.idle;
}

function aioFormatTime(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

// コマンド本文に含まれる社員名から、対象社員ID(複数の場合あり)を推測する。
// 「中村」は営業事業部(nakamura_s)とMEO事業部(nakamura_meo)の2名が該当し文面だけでは
// 一意に特定できないため、両方を対象として扱う(誤って片方だけを稼働中にしない)。
const AIO_NAME_TO_IDS = {
    '小島': ['kojima'],
    '高橋': ['takahashi'],
    '三浦': ['miura'],
    '田中': ['tanaka_m'],
    '中村': ['nakamura_s', 'nakamura_meo'],
    '佐藤': ['sato'],
    '湯浅': ['yuasa'],
    '国貞': ['kunisada'],
    '青木': ['aoki'],
    '遠藤': ['endo'],
    '久保': ['kubo']
};

function aioDetectMentionedIds(text) {
    const ids = [];
    Object.keys(AIO_NAME_TO_IDS).forEach(name => {
        if (text.indexOf(name) !== -1) ids.push.apply(ids, AIO_NAME_TO_IDS[name]);
    });
    return ids;
}

// リサーチ系のキーワードを含む場合は「リサーチ中」、それ以外は「稼働中」として
// 即時表示する(あくまで見た目上の初期反応で、実際の処理はスケジュールタスクが行う)。
function aioGuessCategory(text) {
    const researchKw = ['リサーチ', '調査', '分析', '市場', '競合', 'トレンド', 'YouTube', 'Threads', 'SNS', '数値'];
    return researchKw.some(k => text.indexOf(k) !== -1) ? 'research' : 'active';
}

function aioRenderCommandRow(cmd) {
    const s = aioCmdStatusInfo(cmd);
    return `
    <div class="aio-cmditem">
      <div class="aio-cmditem-head">
        <span class="aio-status ${s.cls}">${s.emoji} ${s.text}</span>
        <span class="aio-cmditem-time">${aioFormatTime(cmd.createdAt)}${cmd.requestedBy ? ' / ' + aioEsc(cmd.requestedBy) : ''}</span>
      </div>
      <div class="aio-cmditem-text">${aioEsc(cmd.text)}</div>
      ${cmd.result ? `<div class="aio-cmditem-result">💬 ${aioEsc(cmd.result)}</div>` : ''}
      ${cmd.note ? `<div class="aio-cmditem-note">📌 ${aioEsc(cmd.note)}</div>` : ''}
    </div>`;
}

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

function aioBuildOfficeHTML(state, commands) {
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
        <p>送信したコマンドは、1時間ごとに自動実行されるスケジュールタスクが確認・処理します(即時ではありません。今すぐ処理してほしい場合は、コージさんからClaudeとのチャットで一言お声がけください)。対応できるのは「リサーチ・分析・文章ドラフト」「各事業部への指示・確認事項の整理」です。サイトの修正・機能追加の指示は自動処理の対象外のため、コージさんとのチャットで直接ご依頼ください。</p>
      </div>

      <div class="aio-cmdhistory">
        <h3>🗂️ コマンド履歴</h3>
        ${(!commands || commands.length === 0) ? `<p style="color:var(--text-tertiary); font-size:0.85rem;">まだ送信したコマンドはありません。</p>` : commands.map(aioRenderCommandRow).join('')}
      </div>
    </div>`;

    return html;
}

App.Pages.ai_office = async function() {
    if (window._aioTimer) { clearInterval(window._aioTimer); window._aioTimer = null; }

    async function tick() {
        const root = document.getElementById('aio-root');
        if (!root) { if (window._aioTimer) { clearInterval(window._aioTimer); window._aioTimer = null; } return; }

        // コマンド入力欄に入力中(フォーカスあり)の場合は、定期更新による再描画で
        // 入力中の文字やフォーカスが消し飛ばないよう、いったん自動更新をスキップする。
        // (この画面は6秒おきにDOM全体を作り直すため、何もしないと入力欄ごと
        //  作り直されてフォーカスが外れ、「勝手に外れて入力できなくなる」原因になっていた)
        const existingInput = document.getElementById('aio-cmd-input');
        if (existingInput && document.activeElement === existingInput) {
            return;
        }

        let state = null, commands = [];
        try {
            [state, commands] = await Promise.all([
                Store.getAiOfficeState(),
                Store.getAiOfficeCommands()
            ]);
        } catch (e) { console.error(e); }

        // 万が一、上のフォーカス確認とawaitの間に入力を始めた場合に備えて、
        // 再描画の直前にもう一度だけ値とフォーカス状態を保持しておく。
        const inputBeforeRender = document.getElementById('aio-cmd-input');
        const hadFocus = inputBeforeRender && document.activeElement === inputBeforeRender;
        if (hadFocus) { return; } // 入力中に切り替わっていたら、この回の更新は諦めて次回に回す
        const preservedValue = inputBeforeRender ? inputBeforeRender.value : '';

        root.innerHTML = aioBuildOfficeHTML(state || AIO_DEFAULT_STATE, commands || []);

        const sendBtn = document.getElementById('aio-cmd-send');
        const input = document.getElementById('aio-cmd-input');
        if (input && preservedValue) input.value = preservedValue; // 送信前の下書きが残っていれば復元

        if (sendBtn && input) {
            sendBtn.addEventListener('click', async () => {
                const text = input.value.trim();
                if (!text) return;
                sendBtn.disabled = true;
                try {
                    const user = Auth.getCurrentUser();
                    await Store.postAiOfficeCommand(text, user ? user.email : 'unknown');
                    input.value = '';

                    // ここから: 送信直後の見た目上の即時反応。
                    // 実際の処理はスケジュールタスク(1時間ごと)が行うが、送信した瞬間に
                    // 「何も動いていないように見える」ことがないよう、該当社員(と小島)を
                    // 先に「稼働中/リサーチ中」表示に切り替えておく。あくまで受付表示であり、
                    // 実処理の完了を意味しない旨はログにも明記する。
                    try {
                        const currentState = (await Store.getAiOfficeState()) || AIO_DEFAULT_STATE;
                        const employees = (currentState.employees || AIO_DEFAULT_STATE.employees).map(e => Object.assign({}, e));
                        const mentionedIds = aioDetectMentionedIds(text);
                        const category = aioGuessCategory(text);
                        const optimisticStatus = category === 'research' ? 'research' : 'active';

                        employees.forEach(e => {
                            if (e.id === 'kojima') e.status = 'active';
                            if (mentionedIds.indexOf(e.id) !== -1) e.status = optimisticStatus;
                        });

                        const mentionedNames = mentionedIds
                            .map(id => { const e = employees.find(x => x.id === id); return e ? e.name : null; })
                            .filter((v, i, arr) => v && arr.indexOf(v) === i);
                        const targetLabel = mentionedNames.length ? mentionedNames.join('・') : '担当未特定';
                        const nowLabel = aioFormatTime(new Date().toISOString());
                        const newLogEntry = { time: nowLabel, text: `📥 コマンド受信(${targetLabel}宛): 「${text}」 ※小島が確認中。実際の対応はスケジュールタスクが処理を開始し次第、履歴に反映されます` };
                        const activityLog = [newLogEntry].concat(currentState.activityLog || []).slice(0, 30);

                        await Store.updateAiOfficeState(Object.assign({}, currentState, {
                            employees: employees,
                            activityLog: activityLog,
                            updatedAt: new Date().toISOString()
                        }));
                    } catch (optErr) {
                        // 見た目上の即時反応が失敗しても、コマンド自体は送信済みなので致命的ではない
                        console.error('optimistic status update failed', optErr);
                    }

                    alert('コマンドを送信しました。担当者を「稼働中」表示に切り替えました。実際の処理は通常1時間以内に自動実行されます。今すぐ処理してほしい場合は、Claudeとのチャットでお声がけください。');
                    tick();
                } catch (e) {
                    console.error(e);
                    alert('コマンドの送信に失敗しました。');
                } finally {
                    sendBtn.disabled = false;
                }
            });

            // 日本語入力(IME)で漢字変換を確定するEnterキーを、誤って送信ボタンの
            // クリックとして扱わないようにする。変換確定中(isComposing)や、
            // それを検知できない古いブラウザ向けの keyCode===229 判定もあわせて行う。
            let isComposing = false;
            input.addEventListener('compositionstart', () => { isComposing = true; });
            input.addEventListener('compositionend', () => { isComposing = false; });
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                if (isComposing || e.isComposing || e.keyCode === 229) return;
                sendBtn.click();
            });
        }
    }

    App.mount('<div id="aio-root"></div>', () => {
        tick();
        window._aioTimer = setInterval(tick, 6000);
    });
};
