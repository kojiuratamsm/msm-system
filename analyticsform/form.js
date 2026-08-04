// Global Error Handler to display error on screen directly
window.onerror = function(message, source, lineno, colno, error) {
    const errorDiv = document.createElement('div');
    errorDiv.style = "position:fixed; top:0; left:0; width:100%; background:red; color:white; padding:16px; z-index:99999; font-family:monospace; font-size:0.9rem; line-height:1.4; box-shadow:0 4px 12px rgba(0,0,0,0.3); word-break:break-all;";
    errorDiv.innerHTML = `<strong>GLOBAL ERROR:</strong> ${message}<br><strong>URL:</strong> ${source}<br><strong>Line:</strong> ${lineno}:${colno}<br><strong>Stack:</strong> ${error ? error.stack : 'N/A'}`;
    document.body.appendChild(errorDiv);
    return false;
};

// Supabase Configuration
const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
let supabaseClient = null;

let formData = null;
let currentSlideIndex = 0;
const answers = {};
let slidesCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!window.supabase) {
            throw new Error("Supabaseライブラリの読み込みに失敗しました。ネット環境を確認してください。");
        }
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabaseClient.from('customers').select('*').eq('service_type', 'meo_form');
        if (error) throw error;
        
        if (!data || data.length === 0) {
            showError("現在利用できるフォームがありません。管理画面で「保存」を実行してください。");
            return;
        }

        formData = data[0].data;
        document.title = formData.title || "分析フォーム";
        
        // テーマ（文字色・サイズ）の適用
        if (formData.theme) {
            const root = document.documentElement;
            if(formData.theme.titleColor) root.style.setProperty('--title-color', formData.theme.titleColor);
            if(formData.theme.descColor) root.style.setProperty('--desc-color', formData.theme.descColor);
            if(formData.theme.titleSize) root.style.setProperty('--title-size', formData.theme.titleSize);
            if(formData.theme.descSize) root.style.setProperty('--desc-size', formData.theme.descSize);
        }

        // 非同期でViewのログ保存（リロード時はカウントしない）
        if (!sessionStorage.getItem('meo_form_view_logged')) {
            logStat('view');
            sessionStorage.setItem('meo_form_view_logged', 'true');
        }

        renderForm();

        // カレンダー日程調整設問の初期読み込み
        document.querySelectorAll('.booking-widget-container').forEach(container => {
            const qId = container.id.replace('booking-', '');
            const q = formData.questions.find(x => x.id === qId);
            loadCalendarBookingSlots(q, container);
        });

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
    formData.questions.forEach((q, idx) => {
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
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%; text-align: left;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>`;
        } else if (q.type === 'long_text') {
            html += `<textarea class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}"></textarea>`;
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%; text-align: left;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>`;
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
        } else if (q.type === 'calendar_booking') {
            html += `
                <div class="booking-widget-container" id="booking-${q.id}" style="width:100%;">
                    <div style="display:flex; justify-content:center; align-items:center; padding:32px;">
                        <i class="ph ph-spinner ph-spin" style="font-size:2rem; color:var(--primary-color);"></i>
                        <span style="margin-left:12px; font-weight:500;">空き日程を取得中...</span>
                    </div>
                </div>
            `;
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
        });
    });

    document.getElementById('btn-prev').addEventListener('click', goPrev);
    document.getElementById('btn-next').addEventListener('click', () => {
        if (currentSlideIndex === reviewIdx || currentSlideIndex === edIdx) return;
        goNext();
    });
}

function handleOpStart() {
    if (!sessionStorage.getItem('meo_form_start_logged')) {
        logStat('start');
        sessionStorage.setItem('meo_form_start_logged', 'true');
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
                const reachKey = 'meo_form_reach_' + qId;
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
                setTimeout(() => input.focus(), 600);
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
        const bookingQuestion = (formData.questions || []).find(q => q.type === 'calendar_booking');
        const responseId = sessionStorage.getItem('meo_form_response_id');
        
        if (bookingQuestion) {
            // カレンダー連携＋UTAGE連携用APIを呼び出す
            const res = await fetch('/api/booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    formId: formData.id || 'default',
                    qId: bookingQuestion.id,
                    answers: answers,
                    responseId: responseId
                })
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || '予約処理に失敗しました。');
            }
        } else {
            // 通常のフォーム提出処理
            await saveResponseProgress('completed');
            await logStat('submission');
        }

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

        // セッションごとのユニークIDの永続化
        let responseId = sessionStorage.getItem('meo_form_response_id');
        if (!responseId) {
            responseId = String(Date.now() + Math.floor(Math.random() * 1000));
            sessionStorage.setItem('meo_form_response_id', responseId);
        }

        const responseData = {
            id: responseId,
            formId: formData.id || 'default',
            answers: answers,
            submittedAt: new Date().toISOString(),
            status: status, // 'abandoned' or 'completed'
            device: navigator.userAgent
        };

        // UPSERT (idをキーにして上書き)
        await supabaseClient.from('customers').upsert([{ 
            id: parseInt(responseId), 
            service_type: 'meo_form_response', 
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
        const statData = { type: type, detail: detailId, timestamp: new Date().toISOString(), session: getSessionId() };
        await supabaseClient.from('customers').insert([{ id, service_type: 'meo_form_stats', data: statData }]);
    } catch (e) {
        console.error("logStat error:", e);
    }
}

function getSessionId() {
    let sid = sessionStorage.getItem('meo_form_sid');
    if (!sid) {
        sid = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('meo_form_sid', sid);
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
    window.close();
    const guide = document.getElementById('close-guide');
    if (guide) guide.style.display = 'block';
}

// カレンダー日程調整関連の関数
async function loadCalendarBookingSlots(q, container) {
    try {
        // カレンダーの空き時間スロットをバックエンドAPI経由で取得
        const formId = formData.id || 'default';
        const res = await fetch(`/api/calendar?formId=${encodeURIComponent(formId)}&qId=${encodeURIComponent(q.id)}`);
        const data = await res.json();
        
        if (data.error) {
            container.innerHTML = `<div style="color:#dc3545; font-weight:600; padding:16px;">日程の取得に失敗しました: ${data.error}</div>`;
            return;
        }

        container.dataset.slots = JSON.stringify(data.availableSlots || {});
        renderBookingUI(q, container, data.availableSlots || {});
    } catch (e) {
        console.error("loadCalendarBookingSlots error:", e);
        container.innerHTML = `<div style="color:#dc3545; font-weight:600; padding:16px;">エラーが発生しました。</div>`;
    }
}

function renderBookingUI(q, container, availableSlots) {
    const dates = Object.keys(availableSlots).sort();
    if (dates.length === 0) {
        container.innerHTML = `<div style="padding:24px; color:#666; font-weight:500;">選択可能な空き日程がありません。別の手段でお問い合わせください。</div>`;
        return;
    }

    let selectedDate = dates[0];
    
    const updateTimeSlots = (date) => {
        const slots = availableSlots[date] || [];
        const slotsGrid = container.querySelector('.booking-slots-grid');
        if (slots.length === 0) {
            slotsGrid.innerHTML = `<div style="color:#888; font-size:0.9rem; padding:12px; grid-column: 1/-1;">この日は空き時間がありません</div>`;
            return;
        }
        slotsGrid.innerHTML = slots.map(time => {
            const isSelected = (answers[q.id] === `${date} ${time}`);
            return `<div class="booking-slot-btn ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${q.id}', '${date}', '${time}', this)">${time}</div>`;
        }).join('');
    };

    container.innerHTML = `
        <div class="booking-widget">
            <div class="booking-days-container">
                ${dates.map((d, idx) => {
                    const dateObj = new Date(d);
                    const dayOfWeek = ['日','月','火','水','木','金','土'][dateObj.getDay()];
                    const dateLabel = `${dateObj.getMonth()+1}/${dateObj.getDate()}`;
                    return `
                        <div class="booking-day-card ${d === selectedDate ? 'active' : ''}" data-date="${d}" onclick="selectBookingDate('${q.id}', '${d}', this)">
                            <div class="day-name">${dayOfWeek}</div>
                            <div class="day-val">${dateLabel}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="booking-slots-title" style="font-weight:600; margin-top:20px; margin-bottom:12px; font-size:0.95rem; color:#333; text-align:left;">時間を選択してください</div>
            <div class="booking-slots-grid">
            </div>
        </div>
    `;

    updateTimeSlots(selectedDate);
}

window.selectBookingDate = function(qId, date, cardEl) {
    const container = document.getElementById(`booking-${qId}`);
    container.querySelectorAll('.booking-day-card').forEach(el => el.classList.remove('active'));
    cardEl.classList.add('active');
    
    const slotsGrid = container.querySelector('.booking-slots-grid');
    const slots = JSON.parse(container.dataset.slots)[date] || [];
    if (slots.length === 0) {
        slotsGrid.innerHTML = `<div style="color:#888; font-size:0.9rem; padding:12px; grid-column: 1/-1;">この日は空き時間がありません</div>`;
        return;
    }
    slotsGrid.innerHTML = slots.map(time => {
        const isSelected = (answers[qId] === `${date} ${time}`);
        return `<div class="booking-slot-btn ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${qId}', '${date}', '${time}', this)">${time}</div>`;
    }).join('');
};

window.selectBookingTime = function(qId, date, time, btnEl) {
    const container = document.getElementById(`booking-${qId}`);
    container.querySelectorAll('.booking-slot-btn').forEach(el => el.classList.remove('selected'));
    btnEl.classList.add('selected');
    
    answers[qId] = `${date} ${time}`;
    document.getElementById('err-' + qId).classList.remove('visible');
    
    // 選択されたら少し遅延させて自動で次のスライドへ
    setTimeout(goNext, 300);
};

