// Supabase Initialization
(async function() {
try {
    let supabase;
    const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
    
    if (typeof window.supabase === 'undefined') {
        const div = document.createElement('div'); div.style='background:red;color:white;position:fixed;top:0;z-index:99999;width:100%;'; div.textContent="CRITICAL ERROR: window.supabase is UNDEFINED. CDN did not load!"; document.body.appendChild(div);
    } else {
        supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    }

// Data Interaction Helpers (Async)
const Store = {
    async getCustomers(serviceType) {
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', serviceType);
        if (error) console.error(error);
        return (data || []).map(row => ({ id: row.id, ...row.data }));
    },
    async addCustomer(serviceType, data) {
        const id = Date.now();
        await supabase.from('customers').insert([{ id, service_type: serviceType, data }]);
    },
    async updateCustomer(serviceType, id, data) {
        const { data: current } = await supabase.from('customers').select('data').eq('id', id).single();
        if (current) {
            const merged = { ...current.data, ...data };
            await supabase.from('customers').update({ data: merged }).eq('id', id);
        }
    },
    async deleteCustomer(serviceType, id) {
        await supabase.from('customers').delete().eq('id', id);
    },
    
    async getTasks() {
        const { data } = await supabase.from('tasks').select('*');
        return (data || []).map(row => ({ id: row.id, ...row.data }));
    },
    async addTask(data) {
        const id = Date.now();
        await supabase.from('tasks').insert([{ id, data: { ...data, done: false } }]);
    },
    async toggleTask(id) {
        const { data: current } = await supabase.from('tasks').select('data').eq('id', id).single();
        if (current) {
            current.data.done = !current.data.done;
            await supabase.from('tasks').update({ data: current.data }).eq('id', id);
        }
    },
    async deleteTask(id) {
        await supabase.from('tasks').delete().eq('id', id);
    },
    
    async getExpenses() {
        const { data } = await supabase.from('expenses').select('*');
        return (data || []).map(row => ({ id: row.id, ...row.data }));
    },
    async addExpense(data) {
        const id = Date.now();
        await supabase.from('expenses').insert([{ id, data }]);
    },
    async deleteExpense(id) {
        await supabase.from('expenses').delete().eq('id', id);
    },
    async updateExpense(id, data) {
        await supabase.from('expenses').update({ data }).eq('id', id);
    },
    
    // YouTube (using customers table)
    async getYTChannels() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'youtube_channel').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async addYTChannel(data) {
        await supabase.from('customers').insert([{ id: Date.now(), service_type: 'youtube_channel', data }]);
    },
    async updateYTChannel(id, data) {
        await supabase.from('customers').update({ data }).eq('id', id);
    },
    async getYTVideos(channelId) {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'youtube_video').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data })).filter(v => v.channelId == channelId).sort((a,b) => new Date(b.date) - new Date(a.date));
    },
    async addYTVideo(data) {
        await supabase.from('customers').insert([{ id: Date.now(), service_type: 'youtube_video', data }]);
    },
    async updateYTVideo(id, data) {
        await supabase.from('customers').update({ data }).eq('id', id);
    },
    async getYTLines() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'youtube_line').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async addYTLine(data) {
        await supabase.from('customers').insert([{ id: Date.now(), service_type: 'youtube_line', data }]);
    },
    async updateYTLine(id, data) {
        await supabase.from('customers').update({ data }).eq('id', id);
    },
    
    // YouTube Scripts
    async getYTScripts() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'youtube_script').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async addYTScript(data) {
        const id = Date.now();
        await supabase.from('customers').insert([{ id, service_type: 'youtube_script', data }]);
        return id;
    },
    async updateYTScript(id, data) {
        await supabase.from('customers').update({ data }).eq('id', id);
    },
    async deleteYTScript(id) {
        await supabase.from('customers').delete().eq('id', id);
    },

    // MEO Form (Typeform-style)
    async getMEOForm() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'meo_form');
        if (data && data.length > 0) return { id: data[0].id, ...data[0].data };
        return null;
    },
    async saveMEOForm(formData) {
        const existing = await this.getMEOForm();
        if (existing && existing.id) {
            await supabase.from('customers').update({ data: formData }).eq('id', existing.id);
            return existing.id;
        } else {
            const id = Date.now();
            await supabase.from('customers').insert([{ id, service_type: 'meo_form', data: formData }]);
            return id;
        }
    },
    async getMEOFormSecrets() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'meo_form_secrets');
        if (data && data.length > 0) return { id: data[0].id, ...data[0].data };
        return { utageApiKey: '', utageScenarioId: '', googleCalendarId: '' };
    },
    async saveMEOFormSecrets(secretsData) {
        const existing = await this.getMEOFormSecrets();
        if (existing && existing.id) {
            await supabase.from('customers').update({ data: secretsData }).eq('id', existing.id);
        } else {
            const id = Date.now();
            await supabase.from('customers').insert([{ id, service_type: 'meo_form_secrets', data: secretsData }]);
        }
    },
    async addMEOFormResponse(responseData) {
        const id = Date.now();
        await supabase.from('customers').insert([{ id, service_type: 'meo_form_response', data: responseData }]);
        return id;
    },
    async getMEOFormResponses() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'meo_form_response').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async logMEOFormStat(statType, detailId = null) {
        // statType: 'view', 'start', 'reach', 'submission'
        // detailId: reachの場合の質問IDなど
        const id = Date.now();
        const statData = { type: statType, detail: detailId, timestamp: new Date().toISOString() };
        await supabase.from('customers').insert([{ id, service_type: 'meo_form_stats', data: statData }]);
    },
    async getMEOFormStats() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'meo_form_stats');
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async clearMEOFormStatsAndResponses() {
        await supabase.from('customers').delete().eq('service_type', 'meo_form_stats');
        await supabase.from('customers').delete().eq('service_type', 'meo_form_response');
    },

    // === Survey (複数作成可能な「アンケート」機能) ===
    // 分析フォーム(meo_form)と全く同じデータ構造(title/theme/op/ed/review/questions[])を使うが、
    // meo_formは customers テーブルに service_type='meo_form' の行が1件だけ、という前提の設計だったのに対し、
    // アンケートは複数作成できるようにするため service_type='survey_definition' の行を複数持たせ、
    // 各行の id がそのまま surveyId になる(1アンケート = 1行)。
    // 回答(survey_response)・アクセス統計(survey_stats)は、それぞれの data.surveyId で
    // どのアンケートに属するデータかを紐付ける(この点だけが meo_form_response/meo_form_stats との違い)。
    // ※既存のMEO Form関連メソッド(getMEOForm等、上記)は一切変更していない。
    // ※v1では calendar_booking(カレンダー日程調整)質問タイプ、および UTAGE/Googleカレンダー/Chatwork
    //   の外部連携設定パネルは意図的に含めていない。理由:
    //   ・api/calendar.js, api/booking.js が service_type='meo_form' 固定でフォームを検索する実装のため、
    //     このままではアンケート(service_type='survey_definition')からは動作しない。
    //   ・かつ、これらは本番稼働中のAPIであり、この環境からは実際に呼び出してテストする手段がない。
    //   ・そのため、未検証のままバックエンドAPIを改修して事故(既存の分析フォームの日程調整機能を壊す等)
    //     を起こすリスクを避け、v1はテキスト/選択肢系の質問タイプのみに絞った。
    //   ・Chatwork通知については、api/chatwork.js 側は認証情報(service_type='meo_form_secrets')を
    //     読むだけでフォームの種類は問わない汎用実装のため、アンケート送信時にも問題なく再利用できる
    //     (通知先チャットルームは分析フォームと共通の1部屋になる制約付き)。
    async getSurveys() {
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'survey_definition').order('id', { ascending: false });
        if (error) console.error(error);
        return (data || []).map(row => ({ id: row.id, ...row.data }));
    },
    async getSurvey(surveyId) {
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'survey_definition').eq('id', surveyId).single();
        if (error || !data) return null;
        return { id: data.id, ...data.data };
    },
    async saveSurvey(surveyId, formData) {
        if (surveyId) {
            await supabase.from('customers').update({ data: formData }).eq('id', surveyId).eq('service_type', 'survey_definition');
            return surveyId;
        } else {
            const id = Date.now();
            await supabase.from('customers').insert([{ id, service_type: 'survey_definition', data: formData }]);
            return id;
        }
    },
    async duplicateSurvey(surveyId) {
        const original = await this.getSurvey(surveyId);
        if (!original) return null;
        const { id: _oldId, ...formData } = original;
        formData.title = (formData.title || 'アンケート') + 'のコピー';
        const newId = Date.now();
        await supabase.from('customers').insert([{ id: newId, service_type: 'survey_definition', data: formData }]);
        return newId;
    },
    async deleteSurvey(surveyId) {
        // アンケート本体と、それに紐づく回答・統計データもまとめて削除する(残骸を残さない)
        await supabase.from('customers').delete().eq('id', surveyId).eq('service_type', 'survey_definition');
        const { data: responses } = await supabase.from('customers').select('id, data').eq('service_type', 'survey_response');
        const resIds = (responses || []).filter(r => r.data && r.data.surveyId == surveyId).map(r => r.id);
        if (resIds.length > 0) await supabase.from('customers').delete().in('id', resIds);
        const { data: stats } = await supabase.from('customers').select('id, data').eq('service_type', 'survey_stats');
        const statIds = (stats || []).filter(r => r.data && r.data.surveyId == surveyId).map(r => r.id);
        if (statIds.length > 0) await supabase.from('customers').delete().in('id', statIds);
    },
    async addSurveyResponse(surveyId, responseData) {
        const id = Date.now();
        await supabase.from('customers').insert([{ id, service_type: 'survey_response', data: { ...responseData, surveyId } }]);
        return id;
    },
    async getSurveyResponses(surveyId) {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'survey_response').order('id', { ascending: false });
        return (data || []).map(r => ({ id: r.id, ...r.data })).filter(r => r.surveyId == surveyId);
    },
    async logSurveyStat(surveyId, statType, detailId = null) {
        // statType: 'view', 'start', 'reach', 'submission'
        const id = Date.now();
        const statData = { surveyId, type: statType, detail: detailId, timestamp: new Date().toISOString() };
        await supabase.from('customers').insert([{ id, service_type: 'survey_stats', data: statData }]);
    },
    async getSurveyStats(surveyId) {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'survey_stats');
        return (data || []).map(r => ({ id: r.id, ...r.data })).filter(r => r.surveyId == surveyId);
    },
    async clearSurveyStatsAndResponses(surveyId) {
        const responses = await this.getSurveyResponses(surveyId);
        const resIds = responses.map(r => r.id);
        if (resIds.length > 0) await supabase.from('customers').delete().in('id', resIds);
        const stats = await this.getSurveyStats(surveyId);
        const statIds = stats.map(r => r.id);
        if (statIds.length > 0) await supabase.from('customers').delete().in('id', statIds);
    },

    // === Mindmap (マインドマップ機能) ===
    // customersテーブルに service_type='mindmap' の行を複数保存(1行=1マインドマップ)。
    // アンケート機能(survey_definition)と同じ「複数インスタンス」の考え方だが、
    // こちらは data.creatorEmail に作成者のメールアドレスを保持し、
    // 一覧取得(getMindmaps)・個別取得(getMindmap)の両方で「本人が作成したものだけ」
    // に絞り込む(コージさん指示:管理者のみが使え、作成者本人だけが閲覧・編集できる)。
    // 万一 creatorEmail が入っていない古いデータがあっても弾かないよう、
    // creatorEmailが無い場合はフィルタしない(安全側に倒す)。
    async getMindmaps() {
        const user = Auth.getCurrentUser();
        const email = user ? user.email : null;
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'mindmap').order('id', { ascending: false });
        if (error) console.error(error);
        return (data || []).map(row => ({ id: row.id, ...row.data })).filter(m => !email || !m.creatorEmail || m.creatorEmail === email);
    },
    async getMindmap(mindmapId) {
        const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'mindmap').eq('id', mindmapId).single();
        if (error || !data) return null;
        const map = { id: data.id, ...data.data };
        const user = Auth.getCurrentUser();
        if (user && map.creatorEmail && map.creatorEmail !== user.email) return null;
        return map;
    },
    async saveMindmap(mindmapId, mapData) {
        if (mindmapId) {
            await supabase.from('customers').update({ data: mapData }).eq('id', mindmapId).eq('service_type', 'mindmap');
            return mindmapId;
        } else {
            const id = Date.now();
            await supabase.from('customers').insert([{ id, service_type: 'mindmap', data: mapData }]);
            return id;
        }
    },
    async duplicateMindmap(mindmapId) {
        const original = await this.getMindmap(mindmapId);
        if (!original) return null;
        const { id: _oldId, ...mapData } = original;
        mapData.title = (mapData.title || 'マインドマップ') + 'のコピー';
        mapData.updatedAt = new Date().toISOString();
        const newId = Date.now();
        await supabase.from('customers').insert([{ id: newId, service_type: 'mindmap', data: mapData }]);
        return newId;
    },
    async deleteMindmap(mindmapId) {
        await supabase.from('customers').delete().eq('id', mindmapId).eq('service_type', 'mindmap');
    },

    // Targets and KPIs
    async getTargetsKpis() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'targets_kpis');
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    },
    async saveTargetsKpi(monthStr, dataObj) {
        const { data } = await supabase.from('customers').select('id, data').eq('service_type', 'targets_kpis');
        const existingRow = (data || []).find(r => r.data.month === monthStr);
        if (existingRow) {
            await supabase.from('customers').update({ data: { ...existingRow.data, ...dataObj, month: monthStr } }).eq('id', existingRow.id);
        } else {
            await supabase.from('customers').insert([{ id: Date.now(), service_type: 'targets_kpis', data: { ...dataObj, month: monthStr } }]);
        }
    },
    
    async getPayroll() {
        const { data } = await supabase.from('payroll').select('*');
        const result = { staffs: [], plusOne: [], meo: [], telecom: [], meoStatus: [], telecomStatus: [] };
        if (data) {
            data.forEach(row => {
                if (result[row.category]) {
                    result[row.category].push({ id: row.id, ...row.data });
                } else if (row.category === 'meoStatus' || row.category === 'telecomStatus') {
                    if (!result[row.category]) result[row.category] = [];
                    result[row.category].push({ id: row.id, ...row.data });
                }
            });
        }
        return result;
    },
    async updatePayroll(data) {
        // Drop and recreate strategy for simplicity of deeply nested objects mapping to simple rows
        await supabase.from('payroll').delete().neq('category', 'dummy'); 
        const inserts = [];
        let index = 0;
        for (const [cat, arr] of Object.entries(data)) {
            if (Array.isArray(arr)) {
                arr.forEach(item => {
                    const { id, ...rest } = item;
                    inserts.push({ id: id || (Date.now() + index++), category: cat, data: rest });
                });
            }
        }
        if (inserts.length > 0) {
            await supabase.from('payroll').insert(inserts);
        }
    },
    
    async logAction(userEmail, desc) {
        await supabase.from('logs').insert([{
            id: Date.now(),
            date: new Date().toISOString(),
            user_email: userEmail,
            description: desc
        }]);
    },
    async getLogs() {
        const { data } = await supabase.from('logs').select('*').order('id', { ascending: false }).limit(50);
        return (data || []).map(row => ({
            id: row.id,
            date: row.date,
            user: row.user_email,
            desc: row.description
        }));
    },
    
    async getUsers() {
        const { data } = await supabase.from('users').select('*');
        return data || [];
    },
    
    async getSettings() {
        try {
            const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'settings');
            if(error) return { services: [], logoUrl: '', bgUrl: '' };
            if(!data || data.length === 0) return { services: [], logoUrl: '', bgUrl: '' };
            return data[0].data || { services: [], logoUrl: '', bgUrl: '' };
        } catch(e) {
            return { services: [], logoUrl: '', bgUrl: '' };
        }
    },
    
    async updateSettings(settingsData) {
        try {
            const { data, error } = await supabase.from('customers').select('id').eq('service_type', 'settings');
            if(data && data.length > 0) {
                await supabase.from('customers').update({ data: settingsData }).eq('id', data[0].id);
            } else {
                await supabase.from('customers').insert([{ id: Date.now(), service_type: 'settings', data: settingsData }]);
            }
        } catch(e) {
            console.error('Error updating settings', e);
        }
    },

    // === MSM AI OFFICE (AI社員稼働状況ボード) ===
    // 全社員の状態をひとまとまりのJSONとして customers テーブルに保存する
    // (service_type='ai_office_state' の1行のみを使う。settings と同じパターン)
    async getAiOfficeState() {
        try {
            const { data, error } = await supabase.from('customers').select('*').eq('service_type', 'ai_office_state');
            if (error || !data || data.length === 0) return null;
            return { id: data[0].id, ...data[0].data };
        } catch (e) {
            console.error('Error fetching AI Office state', e);
            return null;
        }
    },
    async updateAiOfficeState(stateData) {
        try {
            const { data } = await supabase.from('customers').select('id').eq('service_type', 'ai_office_state');
            if (data && data.length > 0) {
                await supabase.from('customers').update({ data: stateData }).eq('id', data[0].id);
            } else {
                await supabase.from('customers').insert([{ id: Date.now(), service_type: 'ai_office_state', data: stateData }]);
            }
        } catch (e) {
            console.error('Error updating AI Office state', e);
        }
    },
    // コマンド (「〇〇 投稿」等) をキューとして保存。Claude側がポーリングして処理する。
    async postAiOfficeCommand(text, requestedBy) {
        const id = Date.now();
        await supabase.from('customers').insert([{
            id,
            service_type: 'ai_office_command',
            data: { text, requestedBy: requestedBy || 'unknown', status: 'pending', createdAt: new Date().toISOString() }
        }]);
        return id;
    },
    async getAiOfficeCommands() {
        const { data } = await supabase.from('customers').select('*').eq('service_type', 'ai_office_command').order('id', { ascending: false }).limit(20);
        return (data || []).map(r => ({ id: r.id, ...r.data }));
    }
};

// Auth
const Auth = {
    async register(name, email, password, code) {
        let role = '';
        let suffix = '';
        if (code === 'Plus One') {
            role = 'plusOneMember';
            suffix = ' (Plus One)';
        } else if (code === 'MEO Taisaku') {
            role = 'meoMember';
            suffix = ' (MEO)';
        } else if (code === 'MSM Tsushin') {
            role = 'telecomMember';
            suffix = ' (通信)';
        } else {
            alert('招待コードが間違っています。');
            return false;
        }

        try {
            const { data: existing } = await supabase.from('users').select('id').eq('email', email);
            if (existing && existing.length > 0) {
                alert('このメールアドレスは既に登録されています。');
                return false;
            }
            const { error } = await supabase.from('users').insert([{
                email: email,
                password: password,
                role: role,
                name: name + suffix
            }]);
            if (error) {
                console.error(error);
                return false;
            }
            Store.logAction(email, '新規メンバー登録しました').catch(e => console.error(e));
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }
    },
    async login(email, password) {
        try {
            const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', password).single();
            if (error && error.code !== 'PGRST116') {
                console.error("Supabase Login Error:", error);
                alert("ログインエラー詳細: " + error.message);
                return false;
            }
            if (data) {
                // ログイン履歴を記録 (非同期で投げておく)
                Store.logAction(data.email, 'システムにログインしました').catch(e => console.error(e));
                
                localStorage.setItem('msm_current_user', JSON.stringify({ 
                    name: data.name, 
                    role: data.role, 
                    email: data.email, 
                    loginTime: Date.now() 
                }));
                return true;
            }
            return false;
        } catch (err) {
            console.error("Network/JS Error:", err);
            alert("通信・予期しないエラー: " + err.message);
            return false;
        }
    },
    logout() {
        localStorage.removeItem('msm_current_user');
    },
    getCurrentUser() {
        const uStr = localStorage.getItem('msm_current_user');
        if (!uStr) return null;
        try {
            const u = JSON.parse(uStr);
            const HOUR_12 = 12 * 60 * 60 * 1000;
            if (u.loginTime && (Date.now() - u.loginTime > HOUR_12)) {
                this.logout();
                return null;
            }
            return u;
        } catch(e) {
            this.logout();
            return null;
        }
    },
    getDepartment() {
        const u = this.getCurrentUser();
        if (!u || u.role === 'admin') return 'all';
        if (u.email === 'contact@msm-fund.com' || u.role === 'plusOneMember') return 'plusOne';
        if (u.email === 'info@msm-fund.com') return 'meo';
        if (u.email === 'jinzai@msm-fund.com') return 'telecom';
        return 'all';
    }
};

// Initial Sync Action (Run once, silently pushes local data to cloud if cloud is empty)
async function initData() {
    try {
        const { data: users, error } = await supabase.from('users').select('id').limit(1);
        if (error) return;
        
        const { data: customers } = await supabase.from('customers').select('id').limit(1);
        
        if (!customers || customers.length === 0) {
            console.log('Migrating local records to Supabase...');
            const pKey = Object.keys(localStorage).find(k => k.includes('msm_state') || k.includes('msm_data') || k.includes('app_data') || k.includes('data'));
            const local = pKey ? localStorage.getItem(pKey) : null;
            
            // Fixed default users if local didn't have any
            const defaultUsers = [
                { email: 'urata@msm-jap.com', password: 'Koji2819', role: 'admin', name: '管理者' },
                { email: 'contact@msm-fund.com', password: 'msm1234', role: 'member', name: '社内メンバー (Plus One)' },
                { email: 'info@msm-fund.com', password: 'meo1234', role: 'member', name: '社内メンバー (MEO)' },
                { email: 'jinzai@msm-fund.com', password: 'jinzai1234', role: 'member', name: '社内メンバー (通信)' }
            ];
            let state = local ? JSON.parse(local) : {};
            
            await supabase.from('users').insert(state.users && state.users.length ? state.users : defaultUsers);
            
            if (state.customers) {
                for (const [type, arr] of Object.entries(state.customers)) {
                    if (Array.isArray(arr) && arr.length > 0) {
                        const inserts = arr.map((c, i) => {
                            const { id, ...rest } = c;
                            return { id: id || Date.now() + i, service_type: type, data: rest };
                        });
                        await supabase.from('customers').insert(inserts);
                    }
                }
            }
            if (state.tasks && state.tasks.length > 0) {
                const inserts = state.tasks.map((t, i) => {
                    const { id, ...rest } = t;
                    return { id: id || Date.now() + i, data: rest };
                });
                await supabase.from('tasks').insert(inserts);
            }
            if (state.expenses && state.expenses.length > 0) {
                const inserts = state.expenses.map((t, i) => {
                    const { id, ...rest } = t;
                    return { id: id || Date.now() + i, data: rest };
                });
                await supabase.from('expenses').insert(inserts);
            }
            if (state.payroll && !Array.isArray(state.payroll)) {
                for (const [cat, arr] of Object.entries(state.payroll)) {
                    if (Array.isArray(arr) && arr.length > 0) {
                        const inserts = arr.map((t, i) => {
                            const { id, ...rest } = t;
                            return { id: id || Date.now() + i, category: cat, data: rest };
                        });
                        await supabase.from('payroll').insert(inserts);
                    }
                }
            }
            if (state.logs && state.logs.length > 0) {
                const inserts = state.logs.map((l, i) => ({
                    id: Date.now() + i,
                    date: l.date,
                    user_email: l.user || 'system',
                    description: l.desc
                }));
                await supabase.from('logs').insert(inserts);
            }
            console.log('Migration complete!');
        }
    } catch (err) {
        console.error('Migration skipped or failed', err);
    }
}

window.Store = Store;
window.Auth = Auth;
initData();

} catch(e) {
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:50px;left:0;width:100%;background:purple;color:white;z-index:999999;padding:20px;font-size:16px;white-space:pre-wrap;box-sizing:border-box;';
    errDiv.innerText = 'STATE.JS EXECUTION ERROR: ' + e.message + '\n' + e.stack;
    document.body.appendChild(errDiv);
}
})();
