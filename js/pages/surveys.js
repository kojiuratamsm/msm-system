// ============================================================================
// アンケート一覧ページ (js/pages/surveys.js)
// 既存の「分析フォーム」(analyticsform / form_editor.js / form_analytics.js) と
// 全く同じフォームビルダー機能を使うが、こちらは複数のアンケートを作成・管理できる。
// 1件だけ存在する meo_form とは異なり、Store.getSurveys() で一覧を取得し、
// 各アンケートを surveyId ごとに編集・分析・複製・削除する。
// ============================================================================

App.Pages.surveys = async function() {
    const user = Auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
        App.mount('<div class="card" style="margin-top:24px; padding: 40px; text-align:center;"><h3 class="card-title">アクセス権限がありません</h3></div>');
        return;
    }

    App.mount(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
            <h2 style="margin:0; font-size:1.5rem; font-weight:700;"><i class="ph ph-clipboard-text" style="margin-right:8px; color:var(--primary-color);"></i>アンケート</h2>
            <button class="btn btn-primary" id="new-survey-btn"><i class="ph ph-plus"></i> 新しいアンケートを作成</button>
        </div>
        <div id="surveys-content" style="text-align:center; padding: 40px;">
            <i class="ph ph-spinner ph-spin" style="font-size:2rem; color:var(--primary-color);"></i>
            <p>読み込み中...</p>
        </div>
    `);

    const newBtn = document.getElementById('new-survey-btn');
    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            const defaultFormData = createDefaultSurveyData();
            const newId = await Store.saveSurvey(null, defaultFormData);
            App.navigate('survey_editor', newId);
        });
    }

    const surveys = await Store.getSurveys();
    renderSurveyList(surveys);
};

function createDefaultSurveyData() {
    return {
        title: "新しいアンケート",
        theme: {
            titleColor: "#1a1a1a",
            descColor: "#666666",
            titleSize: "1.5rem",
            descSize: "1rem"
        },
        op: {
            title: "アンケートにご協力ください",
            description: "いくつかの質問にお答えください",
            imageUrl: "",
            buttonText: "回答をスタート",
            align: "left",
            descAlign: "left"
        },
        ed: {
            title: "ご回答ありがとうございました！",
            description: "貴重なご意見をいただき、誠にありがとうございます。",
            imageUrl: "",
            buttonText: "終了する",
            align: "left",
            descAlign: "left"
        },
        review: {
            title: "回答内容の確認",
            description: "以下の内容でよろしいですか？",
            buttonText: "この内容で提出する",
            align: "left",
            descAlign: "left"
        },
        questions: [
            {
                id: "q" + Date.now(),
                type: "short_text",
                title: "お名前を教えてください",
                description: "",
                required: true,
                choices: [],
                imageUrl: "",
                allowMultiple: false,
                placeholder: "こちらに回答を入力...",
                align: "left",
                descAlign: "left"
            }
        ]
    };
}

function renderSurveyList(surveys) {
    const container = document.getElementById('surveys-content');
    if (!container) return;

    if (!surveys || surveys.length === 0) {
        container.innerHTML = `
            <div class="card" style="padding:40px;">
                <h3 style="margin-bottom:16px;">まだアンケートが作成されていません</h3>
                <p style="color:var(--text-secondary);">右上の「新しいアンケートを作成」から作成してください。</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="text-align:left;">
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:20px;">
    `;

    surveys.forEach(s => {
        const qCount = (s.questions || []).length;
        const title = s.title || '無題のアンケート';
        html += `
            <div class="card survey-card" data-id="${s.id}" style="padding:20px; display:flex; flex-direction:column; gap:12px;">
                <div>
                    <div style="font-weight:700; font-size:1.05rem; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${title}">${title}</div>
                    <div style="color:var(--text-secondary); font-size:0.85rem;">質問数: ${qCount}件</div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:auto;">
                    <button class="btn btn-primary btn-sm survey-edit-btn" data-id="${s.id}"><i class="ph ph-pencil-simple"></i> 編集</button>
                    <button class="btn btn-secondary btn-sm survey-analytics-btn" data-id="${s.id}"><i class="ph ph-chart-bar"></i> 分析</button>
                    <button class="btn btn-secondary btn-sm survey-copyurl-btn" data-id="${s.id}"><i class="ph ph-link"></i> URLコピー</button>
                    <button class="btn btn-secondary btn-sm survey-duplicate-btn" data-id="${s.id}"><i class="ph ph-copy"></i> 複製</button>
                    <button class="btn btn-danger btn-sm survey-delete-btn" data-id="${s.id}"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;

    container.querySelectorAll('.survey-edit-btn').forEach(el => {
        el.addEventListener('click', () => App.navigate('survey_editor', el.getAttribute('data-id')));
    });
    container.querySelectorAll('.survey-analytics-btn').forEach(el => {
        el.addEventListener('click', () => App.navigate('survey_analytics', el.getAttribute('data-id')));
    });
    container.querySelectorAll('.survey-copyurl-btn').forEach(el => {
        el.addEventListener('click', (e) => {
            const id = el.getAttribute('data-id');
            const baseUrl = window.location.href.replace('/index.html', '').replace(/\/$/, '');
            const url = `${baseUrl}/surveyform/index.html?id=${id}`;
            const tmpInput = document.createElement('textarea');
            tmpInput.value = url;
            document.body.appendChild(tmpInput);
            tmpInput.select();
            document.execCommand('copy');
            document.body.removeChild(tmpInput);
            const original = el.innerHTML;
            el.innerHTML = 'コピーしました！';
            setTimeout(() => { el.innerHTML = original; }, 2000);
        });
    });
    container.querySelectorAll('.survey-duplicate-btn').forEach(el => {
        el.addEventListener('click', async () => {
            const id = el.getAttribute('data-id');
            el.disabled = true;
            await Store.duplicateSurvey(id);
            const surveys = await Store.getSurveys();
            renderSurveyList(surveys);
        });
    });
    container.querySelectorAll('.survey-delete-btn').forEach(el => {
        el.addEventListener('click', async () => {
            const id = el.getAttribute('data-id');
            if (!confirm('このアンケートを削除してもよろしいですか？回答データ・統計データもすべて削除されます。')) return;
            el.disabled = true;
            await Store.deleteSurvey(id);
            const surveys = await Store.getSurveys();
            renderSurveyList(surveys);
        });
    });
}
