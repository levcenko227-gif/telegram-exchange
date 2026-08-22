let currentPage = 'dashboard';
let lastCreatedUser = null;
let allUsers = [];
let isSuperAdmin = false;
let adminEventSource = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', (e) => { e.preventDefault(); showPage(item.dataset.page); }));
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('btn-change-creds').addEventListener('click', changeAdminCreds);
    document.getElementById('btn-setup-2fa').addEventListener('click', setupAdmin2FA);
    document.getElementById('btn-verify-admin-2fa').addEventListener('click', verifyAdmin2FA);
    document.getElementById('btn-create-user').addEventListener('click', () => openModal('create-user-modal'));
    document.getElementById('btn-confirm-create').addEventListener('click', createUser);
    document.getElementById('btn-create-admin').addEventListener('click', () => openModal('create-admin-modal'));
    document.getElementById('btn-confirm-create-admin').addEventListener('click', createAdmin);
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('btn-save-networks').addEventListener('click', saveNetworks);
    document.getElementById('btn-notifications').addEventListener('click', toggleNotifications);
    document.getElementById('btn-mark-read').addEventListener('click', markNotificationsRead);
    document.getElementById('btn-create-order').addEventListener('click', showCreateOrderModal);
    document.getElementById('btn-confirm-create-order').addEventListener('click', createOrder);
    document.getElementById('btn-create-appeal').addEventListener('click', showCreateAppealModal);
    document.getElementById('btn-confirm-create-appeal').addEventListener('click', createAppeal);
    document.getElementById('filter-order-status').addEventListener('change', loadOrders);
    document.getElementById('filter-appeal-status').addEventListener('change', loadAppeals);
    document.getElementById('filter-deposit-status').addEventListener('change', loadDeposits);
    document.getElementById('filter-withdrawal-status').addEventListener('change', loadWithdrawals);
    document.getElementById('filter-ver-status').addEventListener('change', loadVerifications);
    checkAuth();
});

async function checkAuth() { try { const res = await fetch('/api/admin/dashboard'); if (res.ok) showDashboard(); } catch (e) {} }

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value, password = document.getElementById('login-password').value, totpCode = document.getElementById('login-2fa').value, errEl = document.getElementById('login-error');
    try {
        const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, totp_code: totpCode }) });
        const data = await res.json();
        if (data.requires_2fa) { document.getElementById('2fa-group').style.display = 'block'; return; }
        if (data.success) { isSuperAdmin = data.admin.is_super_admin; showDashboard(); } else { errEl.textContent = data.error; errEl.style.display = 'block'; }
    } catch (e) { errEl.textContent = 'Ошибка'; errEl.style.display = 'block'; }
}

let adminRefreshInterval = null;

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';
    if (!isSuperAdmin) {
        const adminsLink = document.querySelector('[data-page="admins"]');
        if (adminsLink) adminsLink.style.display = 'none';
    }
    loadDashboard(); loadSettings(); loadAdminProfile(); loadNotifications(); loadUsersForSelect();
    connectAdminSSE();
    // Auto-refresh every 15 seconds as backup
    if (adminRefreshInterval) clearInterval(adminRefreshInterval);
    adminRefreshInterval = setInterval(() => {
        if (currentPage === 'dashboard') loadDashboard();
        if (currentPage === 'users') loadUsers();
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'withdrawals') loadWithdrawals();
        loadNotifications();
    }, 15000);
}

function connectAdminSSE() {
    if (adminEventSource) { adminEventSource.close(); adminEventSource = null; }
    adminEventSource = new EventSource('/api/admin/events');
    
    adminEventSource.addEventListener('user_status', (e) => {
        const data = JSON.parse(e.data);
        if (currentPage === 'users') loadUsers();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.addEventListener('new_deposit', (e) => {
        const data = JSON.parse(e.data);
        notify(`💰 Новый депозит от пользователя #${data.userId}`, 'info');
        if (currentPage === 'deposits') loadDeposits();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.addEventListener('new_withdrawal', (e) => {
        const data = JSON.parse(e.data);
        notify(`💸 Новый вывод от пользователя #${data.userId}`, 'info');
        if (currentPage === 'withdrawals') loadWithdrawals();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.addEventListener('withdrawal_cancelled', (e) => {
        notify('❌ Вывод отменён пользователем', 'info');
        if (currentPage === 'withdrawals') loadWithdrawals();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.addEventListener('new_verification', (e) => {
        notify('📋 Новая заявка на верификацию', 'info');
        if (currentPage === 'verifications') loadVerifications();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.addEventListener('order_completed', (e) => {
        const data = JSON.parse(e.data);
        notify(`✅ Ордер выполнен пользователем #${data.userId}`, 'success');
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'dashboard') loadDashboard();
        if (currentPage === 'users') loadUsers();
    });
    
    adminEventSource.addEventListener('order_failed', (e) => {
        const data = JSON.parse(e.data);
        notify(`❌ Ордер не выполнен пользователем #${data.userId}`, 'error');
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'dashboard') loadDashboard();
    });
    
    adminEventSource.onerror = () => {
        setTimeout(connectAdminSSE, 3000);
    };
}

async function logout() { await fetch('/api/admin/logout', { method: 'POST' }); location.reload(); }

function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    const titles = { dashboard: 'Дашборд', verifications: 'Верификации', orders: 'Ордера', appeals: 'Апелляции', deposits: 'Депозиты', withdrawals: 'Выводы', users: 'Пользователи', admins: 'Админы', settings: 'Настройки', security: 'Безопасность' };
    document.getElementById('page-title').textContent = titles[page];
    if (page === 'dashboard') { loadDashboard(); loadNotifications(); }
    if (page === 'verifications') loadVerifications();
    if (page === 'orders') loadOrders();
    if (page === 'appeals') loadAppeals();
    if (page === 'deposits') loadDeposits();
    if (page === 'withdrawals') loadWithdrawals();
    if (page === 'users') loadUsers();
    if (page === 'admins') loadAdmins();
    if (page === 'settings') loadSettings();
    document.getElementById('sidebar').classList.remove('open');
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function toggleNotifications() { const card = document.getElementById('notifications-card'); card.style.display = card.style.display === 'none' ? 'block' : 'none'; }

async function loadUsersForSelect() {
    try {
        const res = await fetch('/api/admin/users');
        allUsers = await res.json();
        const options = allUsers.map(u => `<option value="${u.id}">${u.internal_id || ''} ${u.username} (${u.first_name || ''})</option>`).join('');
        ['order-user', 'appeal-user', 'notif-user'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = (id === 'notif-user' ? '<option value="all">Все пользователи</option>' : '') + options;
        });
    } catch (e) {}
}

async function loadNotifications() {
    try {
        const res = await fetch('/api/admin/notifications');
        const data = await res.json();
        const badge = document.getElementById('notif-count');
        if (data.unread > 0) { badge.textContent = data.unread; badge.style.display = 'inline'; } else { badge.style.display = 'none'; }
        const list = document.getElementById('notifications-list');
        if (!data.notifications.length) { list.innerHTML = '<p style="color:var(--gray-400);">Нет уведомлений</p>'; return; }
        list.innerHTML = data.notifications.slice(0, 20).map(n => `<div style="padding:12px;background:${n.is_read ? 'var(--gray-50)' : '#eff6ff'};border-radius:8px;margin:8px 0;font-size:14px;border-left:4px solid ${n.type === 'deposit' ? '#f59e0b' : n.type === 'withdrawal' ? '#ef4444' : '#6366f1'};">${n.message}<div style="font-size:12px;color:var(--gray-400);margin-top:4px;">${fmtDate(n.created_at)}</div></div>`).join('');
    } catch (e) {}
}

async function markNotificationsRead() { await fetch('/api/admin/notifications/read', { method: 'POST' }); loadNotifications(); }

async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        document.getElementById('stat-users').textContent = data.total_users;
        document.getElementById('stat-online').textContent = data.online_users;
        document.getElementById('stat-verified').textContent = data.verified_users;
        document.getElementById('stat-pending-ver').textContent = data.pending_verifications;
        document.getElementById('stat-active-orders').textContent = data.active_orders;
        document.getElementById('stat-pending-appeals').textContent = data.pending_appeals;
        document.getElementById('stat-pending-dep').textContent = data.pending_deposits;
        document.getElementById('stat-pending-wd').textContent = data.pending_withdrawals;
        const tbody = document.getElementById('recent-body');
        if (!data.recent_deposits.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">Нет</td></tr>'; return; }
        tbody.innerHTML = data.recent_deposits.map(d => `<tr><td>${d.internal_id || '#' + d.id}</td><td>${d.username}</td><td>${d.amount_usdt}</td><td>${fmtRub(d.amount_rub)}</td><td><span class="badge badge-${d.status}">${stText(d.status)}</span></td><td>${fmtDate(d.created_at)}</td></tr>`).join('');
    } catch (e) {}
}

// ==================== VERIFICATIONS ====================
async function loadVerifications() {
    const status = document.getElementById('filter-ver-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/verifications${status ? '?status=' + status : ''}`);
        const list = await res.json();
        const container = document.getElementById('verifications-list');
        if (!list.length) { container.innerHTML = '<div class="empty-state"><p>Нет заявок</p></div>'; return; }
        container.innerHTML = list.map(v => `
            <div style="padding:16px;background:var(--gray-50);border-radius:12px;margin:12px 0;border:1px solid var(--gray-200);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <strong>${v.username}</strong>
                    <span class="badge badge-${v.status === 'pending' ? 'pending' : v.status === 'approved' ? 'confirmed' : 'rejected'}">${verStText(v.status)}</span>
                </div>
                <div style="font-size:13px;color:var(--gray-600);">
                    <p>📞 Телефон: ${v.phone || '—'}</p>
                    <p>📱 Telegram: ${v.telegram_link || '—'}</p>
                    <p>🌐 Соцсети: ${v.social_links || '—'}</p>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-small" onclick="viewVerification(${v.id})">👁 Просмотреть</button>
                    ${v.status === 'pending' ? `
                        <button class="btn btn-success btn-small" onclick="approveVerification(${v.id})">✅ Одобрить</button>
                        <button class="btn btn-danger btn-small" onclick="rejectVerification(${v.id})">❌ Отклонить</button>
                    ` : ''}
                </div>
                <div style="font-size:12px;color:var(--gray-400);margin-top:8px;">${fmtDate(v.created_at)}</div>
            </div>
        `).join('');
    } catch (e) {}
}

async function viewVerification(id) {
    const res = await fetch(`/api/admin/verifications?status=`);
    const list = await res.json();
    const v = list.find(x => x.id === id);
    if (!v) return;
    const imgStyle = 'max-width:100%;max-height:300px;border-radius:8px;margin:8px 0;border:1px solid #e5e7eb;cursor:pointer;';
    document.getElementById('verification-modal-body').innerHTML = `
        <h3>Верификация #${v.id}</h3>
        <p><strong>Пользователь:</strong> ${v.username} (${v.internal_id || ''})</p>
        <p><strong>Телефон:</strong> ${v.phone}</p>
        <p><strong>Telegram:</strong> ${v.telegram_link || '—'}</p>
        <p><strong>Соцсети:</strong> ${v.social_links || '—'}</p>
        <hr style="margin:16px 0;">
        <h4>Документы:</h4>
        ${v.selfie_url ? `<div><strong>📸 Селфи с паспортом:</strong><br><img src="${v.selfie_url}" style="${imgStyle}" onclick="window.open(this.src)" alt="Селфи"></div>` : '<p>📸 Селфи: не загружено</p>'}
        ${v.passport_photo_url ? `<div><strong>📄 Паспорт:</strong><br><img src="${v.passport_photo_url}" style="${imgStyle}" onclick="window.open(this.src)" alt="Паспорт"></div>` : '<p>📄 Паспорт: не загружено</p>'}
        ${v.passport_registration_url ? `<div><strong>📄 Регистрация:</strong><br><img src="${v.passport_registration_url}" style="${imgStyle}" onclick="window.open(this.src)" alt="Регистрация"></div>` : '<p>📄 Регистрация: не загружено</p>'}
        ${v.admin_comment ? `<p style="color:var(--danger);margin-top:12px;"><strong>Комментарий:</strong> ${v.admin_comment}</p>` : ''}
    `;
    openModal('verification-modal');
}

async function approveVerification(id) {
    await fetch(`/api/admin/verifications/${id}/approve`, { method: 'POST' });
    notify('Одобрена', 'success');
    loadVerifications();
    loadDashboard();
}

async function rejectVerification(id) {
    const comment = prompt('Причина отклонения:');
    if (!comment) return;
    await fetch(`/api/admin/verifications/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_comment: comment }) });
    notify('Отклонена', 'success');
    loadVerifications();
    loadDashboard();
}

function verStText(s) { return { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена' }[s] || s; }

// ==================== ORDERS ====================
async function loadOrders() {
    const status = document.getElementById('filter-order-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/orders${status ? '?status=' + status : ''}`);
        const orders = await res.json();
        const tbody = document.getElementById('orders-body');
        if (!orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">Нет</td></tr>'; return; }
        tbody.innerHTML = orders.map(o => `<tr><td>${o.order_number}</td><td>${o.internal_id || ''} ${o.username}</td><td>${fmtRub(o.amount_rub)}</td><td><span class="badge badge-${o.status === 'active' ? 'pending' : o.status === 'completed' ? 'confirmed' : 'rejected'}">${orderStText(o.status)}</span></td><td>${o.status === 'active' ? `<button class="btn btn-success btn-small" onclick="adminCompleteOrder(${o.id})">Завершить</button> <button class="btn btn-danger btn-small" onclick="adminCancelOrder(${o.id})">Отменить</button>` : ''}</td><td>${fmtDate(o.created_at)}</td></tr>`).join('');
    } catch (e) {}
}

function showCreateOrderModal() { 
    openModal('create-order-modal'); 
    loadUsersForSelect().then(() => {
        const userSelect = document.getElementById('order-user');
        userSelect.addEventListener('change', updateOrderAvailableBalance);
        updateOrderAvailableBalance();
    }); 
}

function updateOrderAvailableBalance() {
    const userId = document.getElementById('order-user').value;
    const info = document.getElementById('order-available-info');
    if (!userId || !allUsers.length) { if (info) info.textContent = ''; return; }
    const user = allUsers.find(u => u.id == userId);
    if (user) {
        const available = (user.balance_rub || 0) - (user.held_rub || 0);
        const wp = user.withdrawal_pending || 0;
        if (info) info.innerHTML = `💰 Баланс: ${fmtRub(user.balance_rub)} | 🔒 Холд: ${fmtRub(user.held_rub || 0)} | ✅ Доступно: ${fmtRub(available)}${wp > 0 ? ` | 📤 Осталось вывод: ${fmtRub(wp)}` : ''}`;
    }
}

async function createOrder() {
    const userId = document.getElementById('order-user').value;
    const orderNumber = document.getElementById('order-number').value;
    const amount = document.getElementById('order-amount').value;
    if (!userId || !amount) return notify('Заполните поля', 'error');
    const res = await fetch('/api/admin/orders/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, order_number: orderNumber || undefined, amount_rub: parseFloat(amount) }) });
    const data = await res.json();
    if (data.success) { notify(`Ордер ${data.order_number} создан!`, 'success'); closeModal('create-order-modal'); loadOrders(); loadDashboard(); } else notify(data.error, 'error');
}

function orderStText(s) { return { active: 'Активный', completed: 'Выполнен', expired: 'Истёк', failed: 'Неуспешный' }[s] || s; }

async function adminCompleteOrder(id) {
    if (!confirm('Завершить ордер?')) return;
    const res = await fetch(`/api/admin/orders/${id}/complete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Ордер завершён', 'success'); loadOrders(); loadDashboard(); loadUsers(); } else notify(data.error, 'error');
}

async function adminCancelOrder(id) {
    if (!confirm('Отменить ордер?')) return;
    const res = await fetch(`/api/admin/orders/${id}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Ордер отменён', 'success'); loadOrders(); loadDashboard(); } else notify(data.error, 'error');
}

// ==================== APPEALS ====================
async function loadAppeals() {
    const status = document.getElementById('filter-appeal-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/appeals${status ? '?status=' + status : ''}`);
        const appeals = await res.json();
        const tbody = document.getElementById('appeals-body');
        if (!appeals.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">Нет</td></tr>'; return; }
        tbody.innerHTML = appeals.map(a => `<tr><td>${a.appeal_number}</td><td>${a.internal_id || ''} ${a.username}</td><td>${a.order_number || '—'}</td><td>${fmtRub(a.amount_rub)}</td><td><span class="badge badge-${a.status === 'pending' ? 'pending' : a.status === 'resolved' ? 'confirmed' : 'rejected'}">${appealStText(a.status)}</span></td><td>${a.status === 'pending' ? `<button class="btn btn-success btn-small" onclick="resolveAppeal(${a.id})">✓</button><button class="btn btn-danger btn-small" onclick="rejectAppeal(${a.id})">✕</button>` : ''}</td></tr>`).join('');
    } catch (e) {}
}

function showCreateAppealModal() { openModal('create-appeal-modal'); loadUsersForSelect(); }

async function createAppeal() {
    const userId = document.getElementById('appeal-user').value;
    const internalId = document.getElementById('appeal-internal-id').value;
    const amount = document.getElementById('appeal-amount').value;
    if ((!userId && !internalId) || !amount) return notify('Выберите пользователя или введите ID', 'error');
    const body = { appeal_number: document.getElementById('appeal-number').value || undefined, order_number: document.getElementById('appeal-order').value, amount_rub: parseFloat(amount), description: document.getElementById('appeal-description').value };
    if (userId) body.user_id = userId; else body.internal_id = internalId;
    const res = await fetch('/api/admin/appeals/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { notify(`Апелляция ${data.appeal_number} создана!`, 'success'); closeModal('create-appeal-modal'); loadAppeals(); loadDashboard(); } else notify(data.error, 'error');
}

async function resolveAppeal(id) { await fetch(`/api/admin/appeals/${id}/resolve`, { method: 'POST' }); notify('Решена', 'success'); loadAppeals(); loadDashboard(); }
async function rejectAppeal(id) { await fetch(`/api/admin/appeals/${id}/reject`, { method: 'POST' }); notify('Отклонена', 'success'); loadAppeals(); loadDashboard(); }
function appealStText(s) { return { pending: 'На рассмотрении', resolved: 'Решена', rejected: 'Отклонена' }[s] || s; }

// ==================== DEPOSITS ====================
async function loadDeposits() {
    const status = document.getElementById('filter-deposit-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/deposits${status ? '?status=' + status : ''}`);
        const list = await res.json();
        const tbody = document.getElementById('deposits-body');
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;">Нет</td></tr>'; return; }
        tbody.innerHTML = list.map(d => `<tr><td>${d.internal_id || '#' + d.id}</td><td>${d.username}</td><td>${d.amount_usdt}</td><td>${fmtRub(d.amount_rub)}</td><td>${d.network}</td><td style="max-width:100px;word-break:break-all;font-size:11px;">${d.tx_hash || '—'}</td><td><span class="badge badge-${d.status}">${stText(d.status)}</span></td><td>${d.status === 'pending' ? `<button class="btn btn-success btn-small" onclick="confirmDeposit(${d.id})">✓</button><button class="btn btn-danger btn-small" onclick="rejectDeposit(${d.id})">✕</button>` : ''}</td></tr>`).join('');
    } catch (e) {}
}

async function confirmDeposit(id) {
    const comment = prompt('Комментарий:');
    const res = await fetch(`/api/admin/deposits/${id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_comment: comment }) });
    const data = await res.json();
    if (data.success) { notify('Подтверждён', 'success'); loadDeposits(); loadDashboard(); } else notify(data.error, 'error');
}

async function rejectDeposit(id) {
    const comment = prompt('Причина:');
    if (!comment) return;
    const res = await fetch(`/api/admin/deposits/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_comment: comment }) });
    const data = await res.json();
    if (data.success) { notify('Отклонён', 'success'); loadDeposits(); } else notify(data.error, 'error');
}

// ==================== WITHDRAWALS ====================
async function loadWithdrawals() {
    const status = document.getElementById('filter-withdrawal-status')?.value || '';
    try {
        const res = await fetch(`/api/admin/withdrawals${status ? '?status=' + status : ''}`);
        const list = await res.json();
        const tbody = document.getElementById('withdrawals-body');
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;">Нет</td></tr>'; return; }
        tbody.innerHTML = list.map(w => `<tr><td>${w.internal_id || '#' + w.id}</td><td>${w.username}</td><td>${fmtRub(w.amount_rub)}</td><td>${w.req_bank || '—'}</td><td>${w.req_name || '—'}</td><td>${w.req_phone || '—'}</td><td><span class="badge badge-${w.status === 'completed' ? 'confirmed' : w.status}">${w.status === 'completed' ? 'Выполнен' : stText(w.status)}</span></td><td>${w.status === 'pending' ? `<button class="btn btn-success btn-small" onclick="confirmWithdrawal(${w.id})">✓</button><button class="btn btn-danger btn-small" onclick="rejectWithdrawal(${w.id})">✕</button>` : ''}</td></tr>`).join('');
    } catch (e) {}
}

async function confirmWithdrawal(id) { await fetch(`/api/admin/withdrawals/${id}/confirm`, { method: 'POST' }); notify('Выполнен', 'success'); loadWithdrawals(); loadDashboard(); }
async function rejectWithdrawal(id) { await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' }); notify('Отклонён', 'success'); loadWithdrawals(); loadDashboard(); }

// ==================== USERS ====================
async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();
        document.getElementById('users-body').innerHTML = users.map(u => {
            const available = u.available_rub !== undefined ? u.available_rub : (u.balance_rub - (u.held_rub || 0));
            const wp = u.withdrawal_pending || 0;
            return `
            <tr>
                <td>${u.internal_id || '#' + u.id}</td>
                <td>${u.username || 'N/A'}</td>
                <td>${fmtRub(u.balance_rub)}${(u.held_rub || 0) > 0 ? `<br><span style="font-size:11px;color:#f59e0b;">Холд: ${fmtRub(u.held_rub)}</span>` : ''}<br><span style="font-size:11px;color:#10b981;">Доступно: ${fmtRub(available)}</span>${wp > 0 ? `<br><span style="font-size:11px;color:#6366f1;">Осталось вывод: ${fmtRub(wp)}</span>` : ''}</td>
                <td>${u.is_online ? '🟢' : '🔴'}</td>
                <td>${u.is_verified ? '✅' : '❌'}</td>
                <td>${u.totp_enabled ? '<span class="badge badge-2fa">2FA ✓</span>' : '—'}</td>
                <td>${u.is_blocked ? '<span class="badge badge-blocked">Заблокирован</span>' : '<span class="badge badge-active">Активен</span>'}</td>
                <td>
                    <button class="btn btn-small" onclick="viewUser(${u.id})">👁</button>
                    ${u.is_blocked ? `<button class="btn btn-success btn-small" onclick="unblockUser(${u.id})">🔓</button>` : `<button class="btn btn-warning btn-small" onclick="blockUser(${u.id})">🔒</button>`}
                </td>
            </tr>`;
        }).join('');
    } catch (e) {}
}

async function viewUser(id) {
    const res = await fetch(`/api/admin/users/${id}`);
    const u = await res.json();
    const held = u.held_rub || 0;
    const withdrawalPending = u.withdrawal_pending || 0;
    const available = u.balance_rub - held;
    document.getElementById('user-modal-body').innerHTML = `
        <h3>${u.username}</h3>
        <p>Внутренний ID: <strong>${u.internal_id || '—'}</strong></p>
        <p>Баланс: <strong>${fmtRub(u.balance_rub)}</strong></p>
        ${held > 0 ? `<p style="color:#f59e0b;">🔒 Захолдено: <strong>${fmtRub(held)}</strong></p>` : ''}
        <p style="color:#10b981;">✅ Доступно: <strong>${fmtRub(available)}</strong></p>
        ${withdrawalPending > 0 ? `<p style="color:#6366f1;">📤 Осталось до вывода: <strong>${fmtRub(withdrawalPending)}</strong></p>` : ''}
        <p>Депозит: <strong>${(u.total_deposited_usdt || 0).toFixed(2)} USDT</strong></p>
        <p>Заработок: <strong>${fmtRub(u.total_earned_rub)}</strong></p>
        <p>Онлайн: ${u.is_online ? '🟢' : '🔴'}</p>
        <p>Верификация: ${u.is_verified ? '✅ Пройдена' : '❌ Не пройдена'}</p>
        <p>2FA: ${u.totp_enabled ? 'Подключена' : 'Нет'}</p>
        ${u.verification ? `<p>Телефон: ${u.verification.phone || '—'}</p><p>Telegram: ${u.verification.telegram_link || '—'}</p>` : ''}
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
        <h4 style="margin-top:16px;">Реквизиты</h4>
        ${u.requisites?.length ? u.requisites.map(r => `<div style="padding:8px;background:${r.is_active ? '#d1fae5' : '#f9fafb'};border-radius:8px;margin:4px 0;font-size:13px;">${r.bank} | ${r.name} | ${r.phone} ${r.is_active ? '🟢' : ''}</div>`).join('') : '<p style="color:#9ca3af;">Нет</p>'}
        <h4 style="margin-top:16px;">Ордера</h4>
        ${u.orders?.length ? u.orders.slice(0, 10).map(o => `<div style="padding:8px;background:#f9fafb;border-radius:8px;margin:4px 0;font-size:13px;">${o.order_number} | ${fmtRub(o.amount_rub)} | ${orderStText(o.status)}</div>`).join('') : '<p style="color:#9ca3af;">Нет</p>'}
    `;
    openModal('user-modal');
}

async function adjustBal(id, action) {
    const amount = parseFloat(document.getElementById('bal-amount').value);
    if (!amount) return notify('Введите сумму', 'error');
    const res = await fetch(`/api/admin/users/${id}/balance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, action }) });
    const data = await res.json();
    if (data.success) { notify(`Баланс: ${fmtRub(data.new_balance)}`, 'success'); viewUser(id); loadUsers(); } else notify(data.error, 'error');
}

async function blockUser(id) { if (!confirm('Заблокировать?')) return; await fetch(`/api/admin/users/${id}/block`, { method: 'POST' }); notify('Заблокирован', 'success'); loadUsers(); }
async function unblockUser(id) { await fetch(`/api/admin/users/${id}/unblock`, { method: 'POST' }); notify('Разблокирован', 'success'); loadUsers(); }
async function reset2fa(id) { if (!confirm('Сбросить 2FA?')) return; await fetch(`/api/admin/users/${id}/reset-2fa`, { method: 'POST' }); notify('2FA сброшена', 'success'); viewUser(id); }
async function resetPassword(id) { if (!confirm('Сбросить пароль?')) return; const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' }); const data = await res.json(); if (data.success) { notify(`Пароль: ${data.new_password}`, 'success'); alert(`Пароль: ${data.new_password}`); } }

async function createUser() {
    const custom_username = document.getElementById('new-user-username').value, custom_password = document.getElementById('new-user-password').value;
    const res = await fetch('/api/admin/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_username: custom_username || undefined, custom_password: custom_password || undefined }) });
    const data = await res.json();
    if (data.success) { lastCreatedUser = data.user; document.getElementById('created-username').textContent = data.user.username; document.getElementById('created-password').textContent = data.user.password; document.getElementById('created-user-info').style.display = 'block'; notify('Создан!', 'success'); loadUsers(); loadUsersForSelect(); } else notify(data.error, 'error');
}

function copyCredentials() { if (!lastCreatedUser) return; navigator.clipboard.writeText(`Логин: ${lastCreatedUser.username}\nПароль: ${lastCreatedUser.password}`).then(() => notify('Скопировано!', 'success')); }

// ==================== ADMINS ====================
async function loadAdmins() {
    try {
        const res = await fetch('/api/admin/admins');
        if (!res.ok) { document.getElementById('admins-body').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">Нет доступа</td></tr>'; return; }
        const admins = await res.json();
        document.getElementById('admins-body').innerHTML = admins.map(a => `
            <tr>
                <td>#${a.id}</td>
                <td>${a.username}</td>
                <td>${a.totp_enabled ? '✅' : '❌'}</td>
                <td>${a.is_super_admin ? '⭐' : '—'}</td>
                <td>${!a.is_super_admin ? `<button class="btn btn-danger btn-small" onclick="deleteAdmin(${a.id})">🗑</button>` : '—'}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

async function createAdmin() {
    const username = document.getElementById('new-admin-username').value;
    const password = document.getElementById('new-admin-password').value;
    if (!username || !password) return notify('Заполните поля', 'error');
    const res = await fetch('/api/admin/admins/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.success) {
        document.getElementById('created-admin-username').textContent = data.admin.username;
        document.getElementById('created-admin-password').textContent = data.admin.password;
        document.getElementById('created-admin-info').style.display = 'block';
        notify('Админ создан!', 'success');
        loadAdmins();
    } else notify(data.error, 'error');
}

async function deleteAdmin(id) {
    if (!confirm('Удалить админа?')) return;
    await fetch(`/api/admin/admins/${id}/delete`, { method: 'POST' });
    notify('Удалён', 'success');
    loadAdmins();
}

// ==================== SETTINGS ====================
async function loadSettings() {
    const res = await fetch('/api/admin/settings');
    const s = await res.json();
    document.getElementById('s-app_name').value = s.app_name || '';
    document.getElementById('s-base_rate').value = s.base_rate || '';
    document.getElementById('s-markup_percent').value = s.markup_percent || '';
    document.getElementById('s-min_deposit_usdt').value = s.min_deposit_usdt || '';
    document.getElementById('s-min_withdrawal_rub').value = s.min_withdrawal_rub || '';
    document.getElementById('s-order_timer_minutes').value = s.order_timer_minutes || '15';
    document.getElementById('s-support_contact').value = s.support_contact || '';
    const base = parseFloat(s.base_rate) || 0, markup = parseFloat(s.markup_percent) || 0;
    document.getElementById('final-rate').textContent = `${(base * (1 + markup / 100)).toFixed(2)} ₽`;
    try {
        const networks = JSON.parse(s.networks || '[]');
        document.getElementById('networks-list').innerHTML = networks.map((n, i) => `<div style="padding:12px;background:var(--gray-50);border-radius:8px;margin:8px 0;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>${n.name}</strong><label><input type="checkbox" id="net-enabled-${i}" ${n.enabled ? 'checked' : ''}> Включена</label></div><div class="form-group" style="margin-bottom:0;"><label>Адрес кошелька</label><input type="text" id="net-wallet-${i}" value="${n.wallet || ''}"></div></div>`).join('');
    } catch (e) {}
}

async function saveSettings(e) {
    e.preventDefault();
    const keys = ['app_name', 'base_rate', 'markup_percent', 'min_deposit_usdt', 'min_withdrawal_rub', 'order_timer_minutes', 'support_contact'];
    for (const key of keys) {
        await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: document.getElementById(`s-${key}`).value }) });
    }
    notify('Сохранено!', 'success'); loadSettings();
}

async function saveNetworks() {
    const res = await fetch('/api/admin/settings');
    const s = await res.json();
    let networks = [];
    try { networks = JSON.parse(s.networks || '[]'); } catch (e) { networks = []; }
    networks.forEach((n, i) => { n.enabled = document.getElementById(`net-enabled-${i}`)?.checked || false; n.wallet = document.getElementById(`net-wallet-${i}`)?.value || ''; });
    await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'networks', value: JSON.stringify(networks) }) });
    notify('Сети сохранены!', 'success');
}

// ==================== ADMIN SECURITY ====================
async function loadAdminProfile() {
    const res = await fetch('/api/admin/profile');
    const admin = await res.json();
    isSuperAdmin = admin.is_super_admin;
    document.getElementById('admin-2fa-status').textContent = admin.totp_enabled ? '2FA подключена ✓' : '2FA не подключена';
}

async function changeAdminCreds() {
    const current_password = document.getElementById('admin-curr-pass').value, new_username = document.getElementById('admin-new-user').value, new_password = document.getElementById('admin-new-pass').value;
    if (!current_password) return notify('Введите пароль', 'error');
    const res = await fetch('/api/admin/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password, new_username: new_username || undefined, new_password: new_password || undefined }) });
    const data = await res.json();
    if (data.success) { notify('Обновлено!', 'success'); document.getElementById('admin-curr-pass').value = ''; document.getElementById('admin-new-user').value = ''; document.getElementById('admin-new-pass').value = ''; } else notify(data.error, 'error');
}

async function setupAdmin2FA() {
    const res = await fetch('/api/admin/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (data.success) { document.getElementById('admin-qr').src = data.qr_code; document.getElementById('admin-secret').textContent = data.secret; document.getElementById('admin-2fa-setup').style.display = 'block'; }
}

async function verifyAdmin2FA() {
    const code = document.getElementById('admin-totp-code').value;
    if (!code || code.length !== 6) return notify('Введите код', 'error');
    const res = await fetch('/api/admin/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (data.success) { notify('2FA подключена!', 'success'); document.getElementById('admin-2fa-setup').style.display = 'none'; loadAdminProfile(); } else notify(data.error, 'error');
}

// ==================== UTILS ====================
function stText(s) { return { pending: 'Ожидает', confirmed: 'Подтверждено', rejected: 'Отклонено' }[s] || s; }
function fmtRub(a) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0); }
function fmtDate(d) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); }

function notify(msg, type = 'info') {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:24px;right:24px;padding:16px 24px;border-radius:12px;color:white;font-weight:600;z-index:10000;max-width:400px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);`;
    n.style.background = { success: '#10b981', error: '#ef4444', info: '#6366f1' }[type] || '#6366f1';
    n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
}
