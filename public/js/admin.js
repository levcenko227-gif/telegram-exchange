let currentPage = 'dashboard';
let lastCreatedUser = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            showPage(item.dataset.page);
        });
    });
    
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-menu').addEventListener('click', toggleSidebar);
    document.getElementById('btn-change-creds').addEventListener('click', changeAdminCreds);
    document.getElementById('btn-setup-2fa').addEventListener('click', setupAdmin2FA);
    document.getElementById('btn-verify-admin-2fa').addEventListener('click', verifyAdmin2FA);
    document.getElementById('btn-close-modal').addEventListener('click', () => {
        document.getElementById('user-modal').style.display = 'none';
    });
    document.getElementById('btn-create-user').addEventListener('click', showCreateUserModal);
    document.getElementById('btn-close-create-modal').addEventListener('click', () => {
        document.getElementById('create-user-modal').style.display = 'none';
        document.getElementById('created-user-info').style.display = 'none';
    });
    document.getElementById('btn-confirm-create').addEventListener('click', createUser);
    
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('filter-status').addEventListener('change', loadTransactions);
    
    checkAuth();
});

async function checkAuth() {
    try {
        const res = await fetch('/api/admin/dashboard');
        if (res.ok) showDashboard();
    } catch (e) {}
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const totpCode = document.getElementById('login-2fa').value;
    const errEl = document.getElementById('login-error');

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, totp_code: totpCode })
        });
        const data = await res.json();

        if (data.requires_2fa) {
            document.getElementById('2fa-group').style.display = 'block';
            return;
        }

        if (data.success) {
            showDashboard();
        } else {
            errEl.textContent = data.error;
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = 'Ошибка';
        errEl.style.display = 'block';
    }
}

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';
    loadDashboard();
    loadSettings();
    loadAdminProfile();
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
}

function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    const titles = { dashboard: 'Дашборд', transactions: 'Транзакции', users: 'Пользователи', settings: 'Настройки', security: 'Безопасность' };
    document.getElementById('page-title').textContent = titles[page];
    if (page === 'dashboard') loadDashboard();
    if (page === 'transactions') loadTransactions();
    if (page === 'users') loadUsers();
    if (page === 'settings') loadSettings();
    document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        document.getElementById('stat-users').textContent = data.total_users;
        document.getElementById('stat-transactions').textContent = data.total_transactions;
        document.getElementById('stat-pending').textContent = data.pending_transactions;
        document.getElementById('stat-volume').textContent = data.total_volume_usdt.toFixed(2);

        const tbody = document.getElementById('recent-body');
        if (!data.recent_transactions.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">Нет транзакций</td></tr>';
        } else {
            tbody.innerHTML = data.recent_transactions.map(t => `
                <tr>
                    <td>#${t.id}</td>
                    <td>${t.username || t.first_name || 'N/A'}</td>
                    <td>${t.amount_usdt}</td>
                    <td><span class="badge badge-${t.status}">${stText(t.status)}</span></td>
                    <td>${fmtDate(t.created_at)}</td>
                </tr>
            `).join('');
        }
    } catch (e) {}
}

async function loadTransactions() {
    const status = document.getElementById('filter-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/transactions${status ? '?status=' + status : ''}`);
        const list = await res.json();
        const tbody = document.getElementById('all-trans-body');

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;">Нет</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(t => `
            <tr>
                <td>#${t.id}</td>
                <td>${t.username || 'N/A'}</td>
                <td>${t.amount_usdt}</td>
                <td>${fmtRub(t.amount_rub)}</td>
                <td>${t.rate} ₽</td>
                <td><span class="badge badge-${t.status}">${stText(t.status)}</span></td>
                <td>
                    ${t.status === 'pending' ? `
                        <button class="btn btn-success btn-small" onclick="confirmTx(${t.id})">✓</button>
                        <button class="btn btn-danger btn-small" onclick="rejectTx(${t.id})">✕</button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    } catch (e) {}
}

async function confirmTx(id) {
    const comment = prompt('Комментарий (необязательно):');
    const res = await fetch(`/api/admin/transactions/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_comment: comment })
    });
    const data = await res.json();
    if (data.success) { notify('Подтверждено', 'success'); loadTransactions(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function rejectTx(id) {
    const comment = prompt('Причина:');
    if (!comment) return;
    const res = await fetch(`/api/admin/transactions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_comment: comment })
    });
    const data = await res.json();
    if (data.success) { notify('Отклонено', 'success'); loadTransactions(); }
    else notify(data.error, 'error');
}

async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();
        const tbody = document.getElementById('users-body');

        tbody.innerHTML = users.map(u => `
            <tr>
                <td>#${u.id}</td>
                <td>${u.username || 'N/A'}</td>
                <td>${fmtRub(u.balance_rub)}</td>
                <td>${(u.total_exchanged_usdt || 0).toFixed(2)}</td>
                <td>${u.totp_enabled ? '<span class="badge badge-2fa">2FA ✓</span>' : '—'}</td>
                <td>${u.is_blocked ? '<span class="badge badge-blocked">Заблокирован</span>' : '<span class="badge badge-active">Активен</span>'}</td>
                <td>
                    <button class="btn btn-small" onclick="viewUser(${u.id})">👁</button>
                    ${u.is_blocked ?
                        `<button class="btn btn-success btn-small" onclick="unblockUser(${u.id})">🔓</button>` :
                        `<button class="btn btn-warning btn-small" onclick="blockUser(${u.id})">🔒</button>`
                    }
                </td>
            </tr>
        `).join('');
    } catch (e) {}
}

async function viewUser(id) {
    const res = await fetch(`/api/admin/users/${id}`);
    const u = await res.json();
    const body = document.getElementById('user-modal-body');

    body.innerHTML = `
        <h3>${u.username}</h3>
        <p>ID: ${u.telegram_id || 'Нет'}</p>
        <p>Баланс: <strong>${fmtRub(u.balance_rub)}</strong></p>
        <p>Оборот: <strong>${(u.total_exchanged_usdt || 0).toFixed(2)} USDT</strong></p>
        <p>Получено: <strong>${fmtRub(u.total_received_rub)}</strong></p>
        <p>2FA: ${u.totp_enabled ? 'Подключена' : 'Нет'}</p>
        <hr style="margin:16px 0;">
        <h4>Изменить баланс</h4>
        <div style="display:flex;gap:8px;margin:12px 0;">
            <input type="number" id="bal-amount" placeholder="Сумма" style="flex:1;padding:8px;border:1px solid #e5e7eb;border-radius:8px;">
            <button class="btn btn-success btn-small" onclick="adjustBal(${u.id},'add')">+</button>
            <button class="btn btn-danger btn-small" onclick="adjustBal(${u.id},'subtract')">−</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            ${u.totp_enabled ? `<button class="btn btn-warning btn-small" onclick="reset2fa(${u.id})">Сбросить 2FA</button>` : ''}
            <button class="btn btn-small" onclick="resetPassword(${u.id})">🔄 Сбросить пароль</button>
        </div>
        <h4 style="margin-top:16px;">Транзакции</h4>
        ${u.transactions?.length ? u.transactions.slice(0, 10).map(t => `
            <div style="padding:8px;background:#f9fafb;border-radius:8px;margin:4px 0;font-size:13px;">
                ${fmtDate(t.created_at)} | ${t.amount_usdt} USDT | ${stText(t.status)}
            </div>
        `).join('') : '<p style="color:#9ca3af;">Нет</p>'}
    `;
    document.getElementById('user-modal').style.display = 'flex';
}

async function adjustBal(id, action) {
    const amount = parseFloat(document.getElementById('bal-amount').value);
    if (!amount) return notify('Введите сумму', 'error');
    const res = await fetch(`/api/admin/users/${id}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, action })
    });
    const data = await res.json();
    if (data.success) { notify(`Баланс: ${fmtRub(data.new_balance)}`, 'success'); viewUser(id); loadUsers(); }
    else notify(data.error, 'error');
}

async function blockUser(id) {
    if (!confirm('Заблокировать?')) return;
    await fetch(`/api/admin/users/${id}/block`, { method: 'POST' });
    notify('Заблокирован', 'success');
    loadUsers();
}

async function unblockUser(id) {
    await fetch(`/api/admin/users/${id}/unblock`, { method: 'POST' });
    notify('Разблокирован', 'success');
    loadUsers();
}

async function reset2fa(id) {
    if (!confirm('Сбросить 2FA?')) return;
    await fetch(`/api/admin/users/${id}/reset-2fa`, { method: 'POST' });
    notify('2FA сброшена', 'success');
    viewUser(id);
}

async function resetPassword(id) {
    if (!confirm('Сбросить пароль?')) return;
    const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
        notify(`Новый пароль: ${data.new_password}`, 'success');
        alert(`Новый пароль для пользователя: ${data.new_password}\nСохраните его!`);
    }
}

// ==================== CREATE USER ====================
function showCreateUserModal() {
    document.getElementById('create-user-modal').style.display = 'flex';
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('created-user-info').style.display = 'none';
}

async function createUser() {
    const custom_username = document.getElementById('new-user-username').value;
    const custom_password = document.getElementById('new-user-password').value;

    const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            custom_username: custom_username || undefined, 
            custom_password: custom_password || undefined 
        })
    });
    const data = await res.json();

    if (data.success) {
        lastCreatedUser = data.user;
        document.getElementById('created-username').textContent = data.user.username;
        document.getElementById('created-password').textContent = data.user.password;
        document.getElementById('created-user-info').style.display = 'block';
        notify('Пользователь создан!', 'success');
        loadUsers();
    } else {
        notify(data.error, 'error');
    }
}

function copyCredentials() {
    if (!lastCreatedUser) return;
    const text = `Логин: ${lastCreatedUser.username}\nПароль: ${lastCreatedUser.password}`;
    navigator.clipboard.writeText(text).then(() => notify('Скопировано!', 'success'));
}

// ==================== SETTINGS ====================
async function loadSettings() {
    const res = await fetch('/api/admin/settings');
    const s = await res.json();
    document.getElementById('s-base_rate').value = s.base_rate || '';
    document.getElementById('s-markup_percent').value = s.markup_percent || '';
    document.getElementById('s-trc20_wallet').value = s.trc20_wallet || '';
    document.getElementById('s-min_exchange_usdt').value = s.min_exchange_usdt || '';
    document.getElementById('s-support_contact').value = s.support_contact || '';

    const base = parseFloat(s.base_rate) || 0;
    const markup = parseFloat(s.markup_percent) || 0;
    document.getElementById('final-rate').textContent = `${(base * (1 + markup / 100)).toFixed(2)} ₽`;
}

async function saveSettings(e) {
    e.preventDefault();
    const keys = ['base_rate', 'markup_percent', 'trc20_wallet', 'min_exchange_usdt', 'support_contact'];
    for (const key of keys) {
        await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: document.getElementById(`s-${key}`).value })
        });
    }
    notify('Сохранено!', 'success');
    loadSettings();
}

// ==================== ADMIN SECURITY ====================
async function loadAdminProfile() {
    const res = await fetch('/api/admin/profile');
    const admin = await res.json();
    document.getElementById('admin-2fa-status').textContent = admin.totp_enabled ? '2FA подключена ✓' : '2FA не подключена';
}

async function changeAdminCreds() {
    const current_password = document.getElementById('admin-curr-pass').value;
    const new_username = document.getElementById('admin-new-user').value;
    const new_password = document.getElementById('admin-new-pass').value;

    if (!current_password) return notify('Введите текущий пароль', 'error');

    const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password, new_username: new_username || undefined, new_password: new_password || undefined })
    });
    const data = await res.json();
    if (data.success) {
        notify('Данные обновлены!', 'success');
        document.getElementById('admin-curr-pass').value = '';
        document.getElementById('admin-new-user').value = '';
        document.getElementById('admin-new-pass').value = '';
    } else {
        notify(data.error, 'error');
    }
}

async function setupAdmin2FA() {
    const res = await fetch('/api/admin/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
        document.getElementById('admin-qr').src = data.qr_code;
        document.getElementById('admin-secret').textContent = data.secret;
        document.getElementById('admin-2fa-setup').style.display = 'block';
    }
}

async function verifyAdmin2FA() {
    const code = document.getElementById('admin-totp-code').value;
    if (!code || code.length !== 6) return notify('Введите 6-значный код', 'error');

    const res = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
        notify('2FA подключена!', 'success');
        document.getElementById('admin-2fa-setup').style.display = 'none';
        loadAdminProfile();
    } else {
        notify(data.error, 'error');
    }
}

// ==================== UTILS ====================
function stText(s) { return { pending: 'Ожидает', confirmed: 'Подтверждено', rejected: 'Отклонено' }[s] || s; }
function fmtRub(a) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0); }
function fmtDate(d) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); }

function notify(msg, type = 'info') {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:24px;right:24px;padding:16px 24px;border-radius:12px;color:white;font-weight:600;z-index:10000;max-width:400px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);`;
    n.style.background = { success: '#10b981', error: '#ef4444', info: '#6366f1' }[type] || '#6366f1';
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}
