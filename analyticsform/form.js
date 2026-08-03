// Supabase Configuration
const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
let supabase = null;

let formData = null;
let currentSlideIndex = 0;
const answers = {};
let slidesCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!window.supabase) {
            throw new Error("Supabaseライブラリの読み込みに失敗しました。ネット環境を確認してください。");
        }
        supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'meo_form');
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

        // 非同期でViewのログ保存
        logStat('view').catch(e => console.error("View log failed:", e));

        renderForm();

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

    const applyTheme = (isTitle) => {
        if (!formData.theme) return '';
        if (isTitle) {
            return `color: ${formData.theme.titleColor || 'inherit'}; font-size: ${formData.theme.titleSize || 'inherit'};`;
        } else {
            return `color: ${formData.theme.descColor || 'inherit'}; font-size: ${formData.theme.descSize || 'inherit'};`;
        }
    };

    const getAlignClass = (obj) => {
        return obj && obj.align ? `align-${obj.align}` : 'align-left';
    };

    // OP Slide (Index 0)
    html += `
        <div class="slide ${getAlignClass(formData.op)}" id="slide-0" data-type="op">
            ${formData.op.imageUrl ? `<div class="slide-img-container"><img src="${formData.op.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title" style="${applyTheme(true)}">${formData.op.title || ''}</div>
            <div class="slide-desc" style="${applyTheme(false)}">${(formData.op.description || '').replace(/\n/g, '<br>')}</div>
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
        html += `<div class="slide-title" style="${applyTheme(true)}">${idx + 1}. ${q.title || ''}${reqMark}</div>`;
        if (q.description) {
            html += `<div class="slide-desc" style="${applyTheme(false)}">${q.description.replace(/\n/g, '<br>')}</div>`;
        }

        const placeholderText = q.placeholder !== undefined ? q.placeholder : "こちらに回答を入力...";

        if (q.type === 'short_text') {
            html += `<input type="text" class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}">`;
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>`;
        } else if (q.type === 'long_text') {
            html += `<textarea class="input-text q-input" data-id="${q.id}" placeholder="${placeholderText}" style="resize:none; height:100px;"></textarea>`;
            html += `<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px; width: 100%;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>`;
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
            <div class="slide-title" style="${applyTheme(true)}">${formData.review.title || '回答内容の確認'}</div>
            <div class="slide-desc" style="${applyTheme(false)}">${formData.review.description || '以下の内容でよろしいですか？'}</div>
            <div id="review-content" style="margin-bottom:32px; width:100%;"></div>
            <button class="btn-primary" id="submit-btn" onclick="submitForm()">${formData.review.buttonText || 'この内容で提出する'}</button>
        </div>
    `;

    // ED Slide (Index N+2) - window.close() closing trigger
    const edIdx = formData.questions.length + 2;
    html += `
        <div class="slide ${getAlignClass(formData.ed)}" id="slide-${edIdx}" data-type="ed">
            ${formData.ed.imageUrl ? `<div class="slide-img-container"><img src="${formData.ed.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title" style="${applyTheme(true)}">${formData.ed.title || ''}</div>
            <div class="slide-desc" style="${applyTheme(false)}">${(formData.ed.description || '').replace(/\n/g, '<br>')}</div>
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
    logStat('start').catch(e => console.error(e));
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
                logStat('reach', qId).catch(e => console.error(e));
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
        const responseData = {
            formId: formData.id || 'default',
            answers: answers,
            submittedAt: new Date().toISOString(),
            device: navigator.userAgent
        };
        await supabase.from('customers').insert([{ id: Date.now(), service_type: 'meo_form_response', data: responseData }]);
        
        await logStat('submission');

        currentSlideIndex++;
        updateView();
    } catch (err) {
        console.error(err);
        alert('エラーが発生しました。時間をおいて再度お試しください。');
        btn.innerHTML = formData.review.buttonText || '提出する';
        btn.disabled = false;
    }
}

function logStat(type, detailId = null) {
    if (!supabase) return Promise.resolve();
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const statData = { type: type, detail: detailId, timestamp: new Date().toISOString(), session: getSessionId() };
    return supabase.from('customers').insert([{ id, service_type: 'meo_form_stats', data: statData }]);
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
        loader.innerHTML = `<div style="font-size:1.2rem; color:var(--text-primary); text-align:center; padding:20px;">${msg}</div>`;
        loader.style.opacity = '1';
    }
}

function closeFormWindow() {
    window.close();
    // ブラウザのセキュリティにより自動で閉じない場合のフォールバック表示
    const guide = document.getElementById('close-guide');
    if (guide) guide.style.display = 'block';
}
