// Supabase Configuration
const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

let formData = null;
let currentSlideIndex = 0;
const answers = {};
let slidesCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Fetch form definition
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'meo_form');
        if (error) throw error;
        
        if (!data || data.length === 0) {
            showError("現在利用できるフォームがありません。");
            return;
        }

        formData = data[0].data;
        document.title = formData.title || "分析フォーム";

        // Record View Log
        logStat('view');

        renderForm();

        // Hide loading, show form
        document.getElementById('loading').style.display = 'none';
        document.getElementById('form-container').style.display = 'block';
        document.getElementById('nav-controls').style.display = 'flex';

        updateView();

    } catch (err) {
        console.error(err);
        showError("フォームの読み込みに失敗しました。");
    }
});

function renderForm() {
    const container = document.getElementById('slide-container');
    let html = '';

    // OP Slide (Index 0)
    html += `
        <div class="slide" id="slide-0" data-type="op">
            ${formData.op.imageUrl ? `<div class="slide-img-container"><img src="${formData.op.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title">${formData.op.title}</div>
            <div class="slide-desc">${(formData.op.description || '').replace(/\\n/g, '<br>')}</div>
            <button class="btn-primary" onclick="handleOpStart()">${formData.op.buttonText || 'スタート'}</button>
        </div>
    `;

    // Question Slides (Index 1 to N)
    formData.questions.forEach((q, idx) => {
        const slideIdx = idx + 1;
        html += `<div class="slide" id="slide-${slideIdx}" data-type="question" data-id="${q.id}" data-required="${q.required}">`;
        
        if (q.imageUrl) {
            html += `<div class="slide-img-container"><img src="${q.imageUrl}" class="slide-img"></div>`;
        }
        html += `<div class="slide-title">${idx + 1}. ${q.title}</div>`;
        if (q.description) {
            html += `<div class="slide-desc">${q.description.replace(/\\n/g, '<br>')}</div>`;
        }

        if (q.type === 'short_text') {
            html += `<input type="text" class="input-text q-input" data-id="${q.id}" placeholder="回答を入力...">`;
        } else if (q.type === 'long_text') {
            html += `<textarea class="input-text q-input" data-id="${q.id}" placeholder="回答を入力..." style="resize:none; height:100px;"></textarea>`;
        } else if (q.type === 'multiple_choice' || q.type === 'dropdown') {
            html += `<div class="choices-container">`;
            (q.choices || []).forEach((c, cIdx) => {
                const alpha = String.fromCharCode(65 + cIdx);
                html += `
                    <div class="choice-box" onclick="selectChoice('${q.id}', '${c}', this, ${q.type === 'multiple_choice'})">
                        <div class="choice-alpha">${alpha}</div> ${c}
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        html += `<div class="error-msg" id="err-${q.id}">必須項目です。回答を入力してください。</div>`;
        html += `<div style="margin-top:32px;"><button class="btn-primary" onclick="goNext()">OK <i class="ph ph-check"></i></button></div>`;
        html += `</div>`;
    });

    // ED Slide (Index N+1)
    const edIdx = formData.questions.length + 1;
    html += `
        <div class="slide" id="slide-${edIdx}" data-type="ed">
            ${formData.ed.imageUrl ? `<div class="slide-img-container"><img src="${formData.ed.imageUrl}" class="slide-img"></div>` : ''}
            <div class="slide-title">${formData.ed.title}</div>
            <div class="slide-desc">${(formData.ed.description || '').replace(/\\n/g, '<br>')}</div>
            <button class="btn-primary" id="submit-btn" onclick="submitForm()">${formData.ed.buttonText || '提出する'}</button>
        </div>
    `;

    container.innerHTML = html;
    slidesCount = formData.questions.length + 2;

    // Add enter key support for text inputs
    document.querySelectorAll('.q-input').forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                goNext();
            }
        });
        el.addEventListener('input', (e) => {
            answers[e.target.getAttribute('data-id')] = e.target.value;
            document.getElementById('err-' + e.target.getAttribute('data-id')).classList.remove('visible');
        });
    });

    document.getElementById('btn-prev').addEventListener('click', goPrev);
    document.getElementById('btn-next').addEventListener('click', goNext);
}

function handleOpStart() {
    logStat('start');
    goNext();
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
        // 自動で次へ進む
        setTimeout(goNext, 300);
    }
    document.getElementById('err-' + qId).classList.remove('visible');
}

function validateCurrentSlide() {
    const slide = document.getElementById(\`slide-\${currentSlideIndex}\`);
    if (slide.getAttribute('data-type') === 'question') {
        const isRequired = slide.getAttribute('data-required') === 'true';
        const qId = slide.getAttribute('data-id');
        
        if (isRequired) {
            const val = answers[qId];
            if (!val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && val.trim() === '')) {
                document.getElementById('err-' + qId).classList.add('visible');
                return false;
            }
        }
    }
    return true;
}

function goNext() {
    if (currentSlideIndex >= slidesCount - 1) return;
    if (!validateCurrentSlide()) return;
    
    currentSlideIndex++;
    updateView();
}

function goPrev() {
    if (currentSlideIndex <= 0) return;
    currentSlideIndex--;
    updateView();
}

function updateView() {
    for (let i = 0; i < slidesCount; i++) {
        const slide = document.getElementById(\`slide-\${i}\`);
        if (i < currentSlideIndex) {
            slide.className = 'slide prev';
        } else if (i === currentSlideIndex) {
            slide.className = 'slide active';
            
            // Log Reach if question
            const type = slide.getAttribute('data-type');
            if (type === 'question') {
                const qId = slide.getAttribute('data-id');
                // 一度だけカウントしたい場合はフラグ管理しても良いが、今回はシンプルに到達ごとに打つ
                logStat('reach', qId);
            }

            // Focus input if any
            const input = slide.querySelector('.q-input');
            if (input) {
                setTimeout(() => input.focus(), 600);
            }
        } else {
            slide.className = 'slide';
        }
    }

    // Progress bar
    const progress = ((currentSlideIndex) / (slidesCount - 1)) * 100;
    document.getElementById('progress-bar').style.width = \`\${progress}%\`;

    // Nav controls opacity
    document.getElementById('btn-prev').style.opacity = currentSlideIndex === 0 ? '0.5' : '1';
    document.getElementById('btn-next').style.opacity = currentSlideIndex === slidesCount - 1 ? '0.5' : '1';
}

async function submitForm() {
    const btn = document.getElementById('submit-btn');
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 送信中...';
    btn.disabled = true;

    try {
        // Save Response
        const responseData = {
            formId: formData.id || 'default',
            answers: answers,
            submittedAt: new Date().toISOString(),
            device: navigator.userAgent
        };
        await supabase.from('customers').insert([{ id: Date.now(), service_type: 'meo_form_response', data: responseData }]);
        
        // Log Submission
        await logStat('submission');

        // Note: GAS Email Trigger can be added here
        // fetch('YOUR_GAS_WEBHOOK_URL', { method: 'POST', body: JSON.stringify(responseData) });

        btn.innerHTML = '<i class="ph ph-check"></i> 送信完了';
        alert('回答を送信しました！ご協力ありがとうございました。');
    } catch (err) {
        console.error(err);
        alert('エラーが発生しました。時間をおいて再度お試しください。');
        btn.innerHTML = '提出する';
        btn.disabled = false;
    }
}

function logStat(type, detailId = null) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const statData = { type: type, detail: detailId, timestamp: new Date().toISOString(), session: getSessionId() };
    return supabase.from('customers').insert([{ id, service_type: 'meo_form_stats', data: statData }]).catch(e => console.error(e));
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
    document.getElementById('loading').innerHTML = \`<div style="font-size:1.2rem; color:var(--text-primary);">\${msg}</div>\`;
}
