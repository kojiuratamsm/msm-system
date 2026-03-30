// Supabase Initialization
let supabase;
try {
    const supabaseUrl = 'https://xztaacxjlluzqzehendp.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dGFhY3hqbGx1enF6ZWhlbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzM4NzMsImV4cCI6MjA4OTgwOTg3M30.79wvIPepXjvPZwLHOPX7KullShvdvCB7LS2gZO5CtuQ';
    
    if (typeof window.supabase === 'undefined') {
        alert("CRITICAL ERROR: window.supabase is UNDEFINED. CDN did not load!");
    } else {
        supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    }
} catch (e) {
    alert("STATE.JS INIT ERROR1: " + e.message);
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
    
    async getPayroll() {
        const { data } = await supabase.from('payroll').select('*');
        const result = { staffs: [], plusOne: [], meo: [], telecom: [] };
        if (data) {
            data.forEach(row => {
                if (result[row.category]) {
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
        for (const [cat, arr] of Object.entries(data)) {
            if (Array.isArray(arr)) {
                arr.forEach(item => {
                    const { id, ...rest } = item;
                    inserts.push({ id: id || Date.now() + Math.random(), category: cat, data: rest });
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
    }
};

// Auth
const Auth = {
    async login(email, password) {
        try {
            const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', password).single();
            if (error && error.code !== 'PGRST116') {
                console.error("Supabase Login Error:", error);
                alert("ログインエラー詳細: " + error.message);
                return false;
            }
            if (data) {
                localStorage.setItem('msm_current_user', JSON.stringify({ name: data.name, role: data.role, email: data.email }));
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
        const u = localStorage.getItem('msm_current_user');
        return u ? JSON.parse(u) : null;
    },
    getDepartment() {
        const u = this.getCurrentUser();
        if (!u || u.role === 'admin') return 'all';
        if (u.email === 'contact@msm-fund.com') return 'plusOne';
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

// Call init once quietly map data to supabase
initData();
