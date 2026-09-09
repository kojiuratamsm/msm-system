// ============================================================================
// アンケート公開回答フォーム (surveyform/form.js)
// analyticsform/form.js (既存の分析フォーム 公開回答画面) を複製・改修したもの。
// UI/操作感・保存ロジックはほぼ同一だが、以下の点のみ意図的に異なる:
//
//   1. URLパラメータ ?id=xxx で対象アンケート(surveyId)を判定し、
//      service_type='survey_definition' の該当行を読み込む
//      (分析フォームは単一インスタンスのため service_type='meo_form' 固定だった)。
//
//   2. 回答・統計の保存先も service_type='survey_response' / 'survey_stats' とし、
//      data.surveyId でどのアンケートの回答かを紐付ける。
//
//   3. 分析フォーム専用の「今月◯名が診断を申込しています」表示は含めていない
//      (アンケート機能とは無関係の診断フォーム専用の演出のため)。
//
//   4. calendar_booking(カレンダー日程調整)質問タイプは含めていない。
//      理由: api/calendar.js・api/booking.js が service_type='meo_form' 固定で
//      フォームを検索する実装のため、このままではアンケートには対応できず、
//      本番稼働中のAPIを未検証のまま改修するリスクを避けたため(詳細は
//      js/state.js・js/pages/survey_editor.js内コメント参照)。エディタ側でも
//      この質問タイプは選択できないようにしてあるため、通常は発生しない。
//
//   5. sessionStorageのキーはアンケートごとに surveyId を含めて名前空間を分け、
//      分析フォーム側のキー(meo_form_*)や他のアンケートと衝突しないようにしている。
// ============================================================================

// Global Error Handler to display error on screen directly
window.onerror = function(message, source, lineno, colno, error) {
    const errorDiv = document.createElement('div');
    errorDiv.style = "position:fixed; top:0; left:0; width:100%; background:red; color:white; padding:16px; z-index:99999; font-family:monospace; font-size:0.9rem; line-height:1.4; box-shadow:0 4px 12px rgba(0,0,0,0.3); word-break:break-all;";
    errorDiv.innerHTML = `<strong>GLOBAL ERROR:</strong> ${message}<br><strong>URL:</strong> ${source}<br><strong>Line:</strong> ${lineno}:${colno}<br><strong>Stack:</strong> ${error ? error.stack : 'N/A'}`;
    document.body.appendChild(errorDiv);
    return false;
};

// ズーム（ピンチイン・ピンチアウト・ダブルタップ等）を禁止して画面サイズを固定する
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
}, { passive: false });

// Supabase Configuration
const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
let supabaseClient = null;

let formData = null;
let surveyId = null;
let currentSlideIndex = 0;
const answers = {};
let slidesCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        surveyId = urlParams.get('id');

        if (!surveyId) {
            showError("アンケートIDが指定されていません。URLをご確認ください。");
            return;
        }

        if (!window.supabase) {
            throw new Error("Supabaseライブラリの読み込みに失敗しました。ネット環境を確認してください。");
        }
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabaseClient.from('customers').select('*').eq('service_type', 'survey_definition').eq('id', surveyId);
        if (error) throw error;

        if (!data || data.length === 0) {
            showError("このアンケートは見つかりませんでした。URLをご確認ください。");
            return;
        }

        formData = data[0].data;
        document.title = formData.title || "アンケート";

        // テーマ（文字色・サイズ）の適用
        if (formData.theme) {
            const root = document.documentElement;
            if(formData.theme.titleColor) root.style.setProperty('--title-color', formData.theme.titleColor);
            if(formData.theme.descColor) root.style.setProperty('--desc-color', formData.theme.descColor);
            if(formData.theme.titleSize) root.style.setProperty('--title-size', formData.theme.titleSize);
            if(formData.theme.descSize) root.style.setProperty('--desc-size', formData.theme.descSize);
        }

        // 非同期でViewのログ保存（リロード時はカウントしない）
        const viewLoggedKey = `survey_${surveyId}_view_logged`;
        if (!sessionStorage.getItem(viewLoggedKey)) {
            logStat('view');
            sessionStorage.setItem(viewLoggedKey, 'true');

            // Chatworkアクセス通知(分析フォームと共通のChatwork連携設定を再利用)
            const ref = urlParams.get('ref') || '';
            fetch('/api/chatwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'access', ref: ref, formData: formData })
            }).catch(e => console.error('Chatwork access notification failed', e));
        }

        renderForm();
        setupCloseConfirm();

        // 0.5秒で高速フェードイン表示
        setTimeout(() => {
            const loader = document.getElementById('loading');
            if (loader) loader.style.opacity = '0';
            setTimeout(() => {
                if (loader) loader.style.display = 'none';
                const container = document.getElementById('form-container');
                if (container) {
                    container.style.display = 'block';
                    void container.offsetWidth;
                    container.style.opacity = '1';
                }
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'flex';
                updateView();
            }, 500);
        }, 100);

    } catch (err) {
        console.error(err);
        showError("フォームの読み込みに失敗しました。<br><small style='font-size:0.8rem;color:#999;'>" + err.message + "</small>");
    }
});

function renderForm() {
    const container = document.getElementById('slide-container');
    let html = '';

    // タイトルと説明の個別の配置・フォントスタイルを適用するヘルパー
    const applyThemeStyle = (isTitle, pageObj) => {
        if (!formData.theme) return '';
        const alignVal = isTitle ? (pageObj.align || 'left') : (pageObj.descAlign || 'left');
        const colorVal = isTitle ? (formData.theme.titleColor || 'inherit') : (formData.theme.descColor || 'inherit');
        const sizeVal = isTitle
            ? (pageObj.titleSize || formData.theme.titleSize || 'inherit')
            : (pageObj.descSize || formData.theme.descSize || 'inherit');
        return `color: ${colorVal}; font-size: ${sizeVal}; text-align: ${alignVal}; width: 100%;`;
    };

    const getAlignClass = (obj) => {
        return obj && obj.align ? `align-${obj.align}` : 'align-left';
    };

    // OP Slide (Index 0)
    html += `
        <div class="slide ${getAlignClass(formData.op)}" id="slide-0" data-type="op">
            ${formData.op.imageUrl ? `<div class="slide-img-container"><img src="${formData.op.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title" style="${applyThemeStyle(true, formData.op)}">${formData.op.title || ''}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.op)}">${(formData.op.description || '').replace(/\n/g, '<br>')}</div>
            <button class="btn-primary" onclick="handleOpStart()">${formData.op.buttonText || 'スタート'}</button>
        </div>
    `;

    // Question Slides
    (formData.questions || []).forEach((q, idx) => {
        const slideIdx = idx + 1;
        const alignClass = getAlignClass(q);
        html += `<div class="slide ${alignClass}" id="slide-${slideIdx}" data-type="question" data-id="${q.id}" data-required="${q.required}">`;

        if (q.imageUrl) {
            html += `<div class="slide-img-container"><img src="${q.imageUrl}" class="slide-img"></div>`;
        }
        const reqMark = q.required ? '<span class="required-mark">*</span>' : '';
        html += `<div class="slide-title" style="${applyThemeStyle(true, q)}">${idx + 1}. ${q.title || ''}${reqMark}</div>`;
        if (q.description) {
            html += `<div class="slide-desc" style="${applyThemeStyle(false, q)}">${q.description.replace(/\n/g, '<br>')}</div>`;
        }

        const placeholderText = q.placeholder !== undefined ? q.placeholder : "こちらに回答を入力...";

        if (q.type === 'short_text') {
            html += `<input type="text" class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}">`;
        } else if (q.type === 'long_text') {
            html += `<textarea class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}" rows="1" style="height:48px; min-height:48px; resize:none; overflow-y:hidden;"></textarea>`;
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%; text-align: left;">改行するには Enter ↵ キーを押してください</div>`;
        } else if (q.type === 'dropdown') {
            html += `<select class="dropdown-select q-select" data-id="${q.id}" onchange="handleDropdownSelect('${q.id}', this)">`;
            html += `<option value="">選択してください...</option>`;
            (q.choices || []).forEach(c => {
                html += `<option value="${c}">${c}</option>`;
            });
            html += `</select>`;
        } else if (q.type === 'multiple_choice') {
            html += `<div class="choices-container" style="width:100%;">`;
            (q.choices || []).forEach((c, cIdx) => {
                const alpha = String.fromCharCode(65 + cIdx);
                html += `
                    <div class="choice-box" onclick="selectChoice('${q.id}', '${c}', this, ${q.allowMultiple === true})">
                        <div class="choice-alpha">${alpha}</div> ${c}
                    </div>
                `;
            });
            html += `</div>`;
        }

        html += `<div class="error-msg" id="err-${q.id}">必須項目です。回答を入力してください。</div>`;

        const isMultiple = (q.type === 'multiple_choice' && q.allowMultiple === true);
        if (isMultiple || q.type === 'short_text' || q.type === 'long_text') {
            html += `<div style="margin-top:32px; width: 100%;"><button class="btn-primary" onclick="goNext()">OK <i class="ph ph-check"></i></button></div>`;
        }
        html += `</div>`;
    });

    // Review Slide (Index N+1)
    const reviewIdx = formData.questions.length + 1;
    html += `
        <div class="slide scrollable ${getAlignClass(formData.review)}" id="slide-${reviewIdx}" data-type="review">
            <div class="slide-title" style="${applyThemeStyle(true, formData.review)}">${formData.review.title || '回答内容の確認'}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.review)}">${formData.review.description || '以下の内容でよろしいですか？'}</div>
            <div id="review-content" style="margin-bottom:32px; width:100%;"></div>
            <button class="btn-primary" id="submit-btn" onclick="submitForm()">${formData.review.buttonText || 'この内容で提出する'}</button>
        </div>
    `;

    // ED Slide (Index N+2)
    const edIdx = formData.questions.length + 2;
    html += `
        <div class="slide ${getAlignClass(formData.ed)}" id="slide-${edIdx}" data-type="ed">
            ${formData.ed.imageUrl ? `<div class="slide-img-container"><img src="${formData.ed.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title" style="${applyThemeStyle(true, formData.ed)}">${formData.ed.title || ''}</div>
            <div class="slide-desc" style="${applyThemeStyle(false, formData.ed)}">${(formData.ed.description || '').replace(/\n/g, '<br>')}</div>
            <button class="btn-primary" onclick="closeFormWindow()">${formData.ed.buttonText || '終了する'}</button>
            <div id="close-guide" style="font-size:0.8rem; color:var(--text-secondary); margin-top:12px; display:none; width: 100%;">※自動で画面が閉じない場合は、ブラウザのタブを閉じてください。</div>
        </div>
    `;

    container.innerHTML = html;
    slidesCount = formData.questions.length + 3;

    document.querySelectorAll('.q-input').forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
                goNext();
            }
        });
        el.addEventListener('input', (e) => {
            answers[e.target.getAttribute('data-id')] = e.target.value;
            document.getElementById('err-' + e.target.getAttribute('data-id')).classList.remove('visible');
            if (e.target.tagName === 'TEXTAREA') {
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
            }
        });
    });

    document.getElementById('btn-prev').addEventListener('click', goPrev);
    document.getElementById('btn-next').addEventListener('click', () => {
        if (currentSlideIndex === reviewIdx || currentSlideIndex === edIdx) return;
        goNext();
    });
}

function handleOpStart() {
    const startLoggedKey = `survey_${surveyId}_start_logged`;
    if (!sessionStorage.getItem(startLoggedKey)) {
        logStat('start');
        sessionStorage.setItem(startLoggedKey, 'true');
    }
    goNext();
}

function handleDropdownSelect(qId, selectEl) {
    const val = selectEl.value;
    if (val) {
        answers[qId] = val;
        document.getElementById('err-' + qId).classList.remove('visible');
        setTimeout(goNext, 300);
    } else {
        answers[qId] = "";
    }
}

function selectChoice(qId, val, el, isMultiple) {
    if (!answers[qId]) answers[qId] = [];

    if (isMultiple) {
        const idx = answers[qId].indexOf(val);
        if (idx > -1) {
            answers[qId].splice(idx, 1);
            el.classList.remove('selected');
        } else {
            answers[qId].push(val);
            el.classList.add('selected');
        }
    } else {
        answers[qId] = [val];
        const container = el.parentElement;
        container.querySelectorAll('.choice-box').forEach(box => box.classList.remove('selected'));
        el.classList.add('selected');
        setTimeout(goNext, 300);
    }
    document.getElementById('err-' + qId).classList.remove('visible');
}

function validateCurrentSlide() {
    const slide = document.getElementById(`slide-${currentSlideIndex}`);
    if (slide && slide.getAttribute('data-type') === 'question') {
        const isRequired = slide.getAttribute('data-required') === 'true';
        const qId = slide.getAttribute('data-id');

        if (isRequired) {
            const val = answers[qId];
            if (!val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && val.trim() === '')) {
                const errMsg = document.getElementById('err-' + qId);
                if (errMsg) errMsg.classList.add('visible');
                return false;
            }
        }
    }
    return true;
}

function goNext() {
    if (currentSlideIndex >= slidesCount - 1) return;
    if (document.getElementById(`slide-${currentSlideIndex}`).getAttribute('data-type') === 'ed') return;
    if (!validateCurrentSlide()) return;

    currentSlideIndex++;
    updateView();

    // 進むたびに、回答内容をリアルタイムで一時保存（離脱ステータス 'abandoned'）
    saveResponseProgress('abandoned').catch(e => console.error("Temp save failed:", e));
}

function goPrev() {
    if (currentSlideIndex <= 0) return;
    if (document.getElementById(`slide-${currentSlideIndex}`).getAttribute('data-type') === 'ed') return;
    currentSlideIndex--;
    updateView();
}

function renderReviewContent() {
    const container = document.getElementById('review-content');
    if (!container) return;
    let html = '';

    formData.questions.forEach((q, idx) => {
        let ans = answers[q.id];
        let displayAns = '<span style="color:#aaa;">(未回答)</span>';

        if (ans) {
            if (Array.isArray(ans)) {
                if (ans.length > 0) displayAns = ans.join(', ');
            } else if (typeof ans === 'string' && ans.trim() !== '') {
                displayAns = ans.replace(/\n/g, '<br>');
            }
        }

        html += `
            <div class="review-item">
                <div class="review-q">${idx + 1}. ${q.title}</div>
                <div class="review-a">${displayAns}</div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateView() {
    for (let i = 0; i < slidesCount; i++) {
        const slide = document.getElementById(`slide-${i}`);
        if (!slide) continue;
        if (i < currentSlideIndex) {
            slide.className = slide.className.replace('active', '').trim() + ' prev';
        } else if (i === currentSlideIndex) {
            slide.className = slide.className.replace('prev', '').trim() + ' active';

            const type = slide.getAttribute('data-type');
            if (type === 'question') {
                const qId = slide.getAttribute('data-id');
                const reachKey = `survey_${surveyId}_reach_${qId}`;
                if (!sessionStorage.getItem(reachKey)) {
                    logStat('reach', qId);
                    sessionStorage.setItem(reachKey, 'true');
                }
            } else if (type === 'review') {
                renderReviewContent();
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'none';
            } else if (type === 'ed') {
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'none';
            } else {
                const nav = document.getElementById('nav-controls');
                if (nav) nav.style.display = 'flex';
            }

            const input = slide.querySelector('.q-input');
            if (input) {
                setTimeout(() => {
                    input.focus();
                    if (input.tagName === 'TEXTAREA') {
                        input.style.height = 'auto';
                        input.style.height = input.scrollHeight + 'px';
                    }
                }, 600);
            }
        } else {
            slide.className = slide.className.replace('active', '').replace('prev', '').trim();
        }
    }

    const progress = ((currentSlideIndex) / (slidesCount - 2)) * 100;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = `${Math.min(progress, 100)}%`;

    const navControls = document.getElementById('nav-controls');
    if(navControls && navControls.style.display !== 'none') {
        const prevBtn = document.getElementById('btn-prev');
        if (prevBtn) prevBtn.style.opacity = currentSlideIndex === 0 ? '0.5' : '1';
        const nextBtn = document.getElementById('btn-next');
        if (nextBtn) nextBtn.style.opacity = '1';
    }
}

async function submitForm() {
    const btn = document.getElementById('submit-btn');
    if (!btn) return;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 送信中...';
    btn.disabled = true;

    try {
        await saveResponseProgress('completed');
        await logStat('submission');

        // Chatwork送信完了通知(分析フォームと共通のChatwork連携設定を再利用)
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get('ref') || '';
        fetch('/api/chatwork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'submit', ref: ref, answers: answers, formData: formData })
        }).catch(e => console.error('Chatwork submit notification failed', e));

        currentSlideIndex++;
        updateView();
    } catch (e) {
        console.error("submitForm error:", e);
        alert(e.message || "送信中にエラーが発生しました。もう一度お試しください。");
        btn.innerHTML = 'この内容で提出する';
        btn.disabled = false;
    }
}

// 途中経過または完了時の回答データをリアルタイムで上書き保存・更新するメソッド
async function saveResponseProgress(status = 'abandoned') {
    try {
        if (!supabaseClient) return;

        // セッションごとのユニークIDの永続化(アンケートごとに名前空間を分ける)
        const responseIdKey = `survey_${surveyId}_response_id`;
        let responseId = sessionStorage.getItem(responseIdKey);
        if (!responseId) {
            responseId = String(Date.now() + Math.floor(Math.random() * 1000));
            sessionStorage.setItem(responseIdKey, responseId);
        }

        const responseData = {
            id: responseId,
            surveyId: surveyId,
            answers: answers,
            submittedAt: new Date().toISOString(),
            status: status, // 'abandoned' or 'completed'
            device: navigator.userAgent
        };

        // UPSERT (idをキーにして上書き)
        await supabaseClient.from('customers').upsert([{
            id: parseInt(responseId),
            service_type: 'survey_response',
            data: responseData
        }]);

    } catch (e) {
        console.error("saveResponseProgress error:", e);
    }
}

async function logStat(type, detailId = null) {
    try {
        if (!supabaseClient) return;
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const statData = { surveyId: surveyId, type: type, detail: detailId, timestamp: new Date().toISOString(), session: getSessionId() };
        await supabaseClient.from('customers').insert([{ id, service_type: 'survey_stats', data: statData }]);
    } catch (e) {
        console.error("logStat error:", e);
    }
}

function getSessionId() {
    const sidKey = `survey_${surveyId}_sid`;
    let sid = sessionStorage.getItem(sidKey);
    if (!sid) {
        sid = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem(sidKey, sid);
    }
    return sid;
}

function showError(msg) {
    const loader = document.getElementById('loading');
    if (loader) {
        loader.innerHTML = `
            <div style="background:white; padding:32px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1); max-width:90%; width:400px; text-align:center;">
                <i class="ph ph-warning-circle" style="font-size:3rem; color:#dc3545; margin-bottom:16px; display:block;"></i>
                <div style="font-size:1.1rem; font-weight:600; color:#333; margin-bottom:12px; line-height:1.4;">${msg}</div>
            </div>
        `;
        loader.style.opacity = '1';
    }
}

function closeFormWindow() {
    if (formData && formData.ed && formData.ed.redirectUrl && formData.ed.redirectUrl.trim() !== '') {
        window.location.href = formData.ed.redirectUrl.trim();
    } else {
        window.close();
        const guide = document.getElementById('close-guide');
        if (guide) guide.style.display = 'block';
    }
}

// ============================================================================
// 離脱確認POPの「終了する」・×ボタン単独クリック時に使うタブクローズ処理
// (分析フォーム側の同機能をそのまま踏襲)
// ============================================================================
function closeTabOnly() {
    // 「終了する」ポップアップを閉じてからタブを閉じる。
    // ブラウザの仕様上、スクリプトで開いたタブでない場合は window.close() が
    // 効かないことがあるが、その場合の代替メッセージ(手動で閉じてくださいの案内)は
    // 表示しない仕様(分析フォーム側と同じ、コージさん指示 2026-09-09)。
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) overlay.classList.remove('show');
    window.close();
}

// ============================================================================
// 回答途中で×ボタンを押した際の離脱確認POP(分析フォーム側の同機能をそのまま踏襲)
// ============================================================================
function setupCloseConfirm() {
    const closeBtn = document.getElementById('form-close-btn');
    const overlay = document.getElementById('confirm-overlay');
    const continueBtn = document.getElementById('confirm-continue-btn');
    const exitBtn = document.getElementById('confirm-exit-btn');
    if (!closeBtn || !overlay || !continueBtn || !exitBtn) return;

    const hasUnsavedAnswer = () => {
        const slide = document.getElementById(`slide-${currentSlideIndex}`);
        if (!slide) return false;
        const type = slide.getAttribute('data-type');
        return type === 'question' || type === 'review';
    };

    closeBtn.addEventListener('click', () => {
        if (hasUnsavedAnswer()) {
            overlay.classList.add('show');
        } else {
            closeTabOnly();
        }
    });

    continueBtn.addEventListener('click', () => {
        overlay.classList.remove('show');
    });

    exitBtn.addEventListener('click', async () => {
        try {
            await saveResponseProgress('abandoned');
        } catch (e) {
            console.error('final saveResponseProgress before exit failed:', e);
        }
        closeTabOnly();
    });
}
