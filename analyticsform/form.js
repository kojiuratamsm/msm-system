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
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'meo_form');
        if (error) throw error;
        
        if (!data || data.length === 0) {
            showError("現在利用できるフォームがありません。");
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

        logStat('view');

        renderForm();

        // 0.5秒表示のための高速フェードイン
        setTimeout(() => {
            document.getElementById('loading').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loading').style.display = 'none';
                const container = document.getElementById('form-container');
                container.style.display = 'block';
                // trigger reflow
                void container.offsetWidth;
                container.style.opacity = '1';
                document.getElementById('nav-controls').style.display = 'flex';
                updateView();
            }, 500);
        }, 100);

    } catch (err) {
        console.error(err);
        showError("フォームの読み込みに失敗しました。");
    }
});

function renderForm() {
    const container = document.getElementById('slide-container');
    let html = '';

    const applyTheme = (isTitle) => {
        if (!formData.theme) return '';
        if (isTitle) {
            return \`color: \${formData.theme.titleColor || 'inherit'}; font-size: \${formData.theme.titleSize || 'inherit'};\`;
        } else {
            return \`color: \${formData.theme.descColor || 'inherit'}; font-size: \${formData.theme.descSize || 'inherit'};\`;
        }
    };

    // OP Slide (Index 0)
    html += \`
        <div class="slide" id="slide-0" data-type="op">
            \${formData.op.imageUrl ? \`<div class="slide-img-container"><img src="\${formData.op.imageUrl}" class="slide-img"></div>\` : ''}
            <div class="slide-title" style="\${applyTheme(true)}">\${formData.op.title || ''}</div>
            <div class="slide-desc" style="\${applyTheme(false)}">\${(formData.op.description || '').replace(/\\n/g, '<br>')}</div>
            <button class="btn-primary" onclick="handleOpStart()">\${formData.op.buttonText || 'スタート'}</button>
        </div>
    \`;

    // Question Slides
    formData.questions.forEach((q, idx) => {
        const slideIdx = idx + 1;
        html += \`<div class="slide" id="slide-\${slideIdx}" data-type="question" data-id="\${q.id}" data-required="\${q.required}">\`;
        
        if (q.imageUrl) {
            html += \`<div class="slide-img-container"><img src="\${q.imageUrl}" class="slide-img"></div>\`;
        }
        const reqMark = q.required ? \`<span class="required-mark">*</span>\` : '';
        html += \`<div class="slide-title" style="\${applyTheme(true)}">\${idx + 1}. \${q.title || ''}\${reqMark}</div>\`;
        if (q.description) {
            html += \`<div class="slide-desc" style="\${applyTheme(false)}">\${q.description.replace(/\\n/g, '<br>')}</div>\`;
        }

        if (q.type === 'short_text') {
            html += \`<input type="text" class="input-text q-input" data-id="\${q.id}" placeholder="こちらに回答を入力...">\`;
            html += \`<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>\`;
        } else if (q.type === 'long_text') {
            html += \`<textarea class="input-text q-input" data-id="\${q.id}" placeholder="こちらに回答を入力..." style="resize:none; height:100px;"></textarea>\`;
            html += \`<div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">段落を追加するためには Shift ⇧ と Enter ↵ キーを同時に押して下さい</div>\`;
        } else if (q.type === 'multiple_choice' || q.type === 'dropdown') {
            html += \`<div class="choices-container">\`;
            (q.choices || []).forEach((c, cIdx) => {
                const alpha = String.fromCharCode(65 + cIdx);
                html += \`
                    <div class="choice-box" onclick="selectChoice('\${q.id}', '\${c}', this, \${q.type === 'multiple_choice'})">
                        <div class="choice-alpha">\${alpha}</div> \${c}
                    </div>
                \`;
            });
            html += \`</div>\`;
        }
        
        html += \`<div class="error-msg" id="err-\${q.id}">必須項目です。回答を入力してください。</div>\`;
        html += \`<div style="margin-top:32px;"><button class="btn-primary" onclick="goNext()">OK <i class="ph ph-check"></i></button></div>\`;
        html += \`</div>\`;
    });

    // Review Slide (Index N+1)
    const reviewIdx = formData.questions.length + 1;
    html += \`
        <div class="slide scrollable" id="slide-\${reviewIdx}" data-type="review">
            <div class="slide-title" style="\${applyTheme(true)}">回答内容の確認</div>
            <div class="slide-desc" style="\${applyTheme(false)}">以下の内容でよろしいですか？</div>
            <div id="review-content" style="margin-bottom:32px;"></div>
            <button class="btn-primary" id="submit-btn" onclick="submitForm()">\${formData.ed.buttonText || '提出する'}</button>
        </div>
    \`;

    // ED Slide (Index N+2)
    const edIdx = formData.questions.length + 2;
    html += \`
        <div class="slide" id="slide-\${edIdx}" data-type="ed">
            \${formData.ed.imageUrl ? \`<div class="slide-img-container"><img src="\${formData.ed.imageUrl}" class="slide-img"></div>\` : ''}
            <div class="slide-title" style="\${applyTheme(true)}">\${formData.ed.title || ''}</div>
            <div class="slide-desc" style="\${applyTheme(false)}">\${(formData.ed.description || '').replace(/\\n/g, '<br>')}</div>
        </div>
    \`;

    container.innerHTML = html;
    slidesCount = formData.questions.length + 3;

    document.querySelectorAll('.q-input').forEach(el => {
        el.addEventListener('keypress', (e) => {
            // Shift+Enterは改行、Enter単体は次へ
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
    if (document.getElementById(\`slide-\${currentSlideIndex}\`).getAttribute('data-type') === 'ed') return;
    if (!validateCurrentSlide()) return;
    
    currentSlideIndex++;
    updateView();
}

function goPrev() {
    if (currentSlideIndex <= 0) return;
    if (document.getElementById(\`slide-\${currentSlideIndex}\`).getAttribute('data-type') === 'ed') return;
    currentSlideIndex--;
    updateView();
}

function renderReviewContent() {
    const container = document.getElementById('review-content');
    let html = '';
    
    formData.questions.forEach((q, idx) => {
        let ans = answers[q.id];
        let displayAns = '<span style="color:#aaa;">(未回答)</span>';
        
        if (ans) {
            if (Array.isArray(ans)) {
                if (ans.length > 0) displayAns = ans.join(', ');
            } else if (typeof ans === 'string' && ans.trim() !== '') {
                displayAns = ans.replace(/\\n/g, '<br>');
            }
        }
        
        html += \`
            <div class="review-item">
                <div class="review-q">\${idx + 1}. \${q.title}</div>
                <div class="review-a">\${displayAns}</div>
            </div>
        \`;
    });
    
    container.innerHTML = html;
}

function updateView() {
    for (let i = 0; i < slidesCount; i++) {
        const slide = document.getElementById(\`slide-\${i}\`);
        if (i < currentSlideIndex) {
            slide.className = slide.className.replace('active', '').trim() + ' prev';
        } else if (i === currentSlideIndex) {
            slide.className = slide.className.replace('prev', '').trim() + ' active';
            
            const type = slide.getAttribute('data-type');
            if (type === 'question') {
                const qId = slide.getAttribute('data-id');
                logStat('reach', qId);
            } else if (type === 'review') {
                // Generate review HTML dynamically when entering review slide
                renderReviewContent();
                document.getElementById('nav-controls').style.display = 'none'; // レビュー・EDでは右下ナビゲーションを隠す
            } else if (type === 'ed') {
                document.getElementById('nav-controls').style.display = 'none';
            } else {
                document.getElementById('nav-controls').style.display = 'flex';
            }

            const input = slide.querySelector('.q-input');
            if (input) {
                setTimeout(() => input.focus(), 600);
            }
        } else {
            slide.className = slide.className.replace('active', '').replace('prev', '').trim();
        }
    }

    const progress = ((currentSlideIndex) / (slidesCount - 2)) * 100; // EDを除く
    document.getElementById('progress-bar').style.width = \`\${Math.min(progress, 100)}%\`;

    if(document.getElementById('nav-controls').style.display !== 'none') {
        document.getElementById('btn-prev').style.opacity = currentSlideIndex === 0 ? '0.5' : '1';
        document.getElementById('btn-next').style.opacity = '1';
    }
}

async function submitForm() {
    const btn = document.getElementById('submit-btn');
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

        // Go to ED slide
        currentSlideIndex++;
        updateView();
    } catch (err) {
        console.error(err);
        alert('エラーが発生しました。時間をおいて再度お試しください。');
        btn.innerHTML = formData.ed.buttonText || '提出する';
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
    document.getElementById('loading').style.opacity = '1';
}
