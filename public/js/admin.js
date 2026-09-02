/* ==========================================================================
   blueberry — Admin Control Core JS (Full Feature Edition)
   Credentials Viewer, Individual User Markup, Full API & SSE integration
   ========================================================================== */

let currentPage = 'dashboard';
let lastCreatedUser = null;
let allUsers = [];
let isSuperAdmin = false;
let adminEventSource = null;
let adminRefreshInterval = null;
let currentNetworks = [];
let currentSupportContacts = [];

document.addEventListener('DOMContentLoaded', () => {
    try {
        document.getElementById('login-form')?.addEventListener('submit', handleLogin);

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => { e.preventDefault(); showPage(item.dataset.page); });
        });

        document.getElementById('btn-logout')?.addEventListener('click', logout);
        document.getElementById('btn-menu')?.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.toggle('open');
        });

        document.getElementById('btn-change-creds')?.addEventListener('click', changeAdminCreds);
        document.getElementById('btn-setup-2fa')?.addEventListener('click', setupAdmin2FA);
        document.getElementById('btn-verify-admin-2fa')?.addEventListener('click', verifyAdmin2FA);

        document.getElementById('btn-create-user')?.addEventListener('click', () => openModal('create-user-modal'));
        document.getElementById('btn-confirm-create')?.addEventListener('click', createUser);

        document.getElementById('btn-create-admin')?.addEventListener('click', () => openModal('create-admin-modal'));
        document.getElementById('btn-confirm-create-admin')?.addEventListener('click', createAdmin);

        document.getElementById('settings-form')?.addEventListener('submit', saveSettings);
        document.getElementById('btn-save-networks')?.addEventListener('click', saveNetworks);
        document.getElementById('btn-save-contacts')?.addEventListener('click', saveContacts);

        document.getElementById('btn-notifications')?.addEventListener('click', toggleNotifications);
        document.getElementById('btn-mark-read')?.addEventListener('click', markNotificationsRead);

        document.getElementById('btn-create-order')?.addEventListener('click', showCreateOrderModal);
        document.getElementById('btn-confirm-create-order')?.addEventListener('click', createOrder);

        document.getElementById('btn-create-appeal')?.addEventListener('click', showCreateAppealModal);
        document.getElementById('btn-confirm-create-appeal')?.addEventListener('click', createAppeal);

        document.getElementById('btn-confirm-send-notification')?.addEventListener('click', sendNotification);

        document.getElementById('filter-order-status')?.addEventListener('change', loadOrders);
        document.getElementById('filter-appeal-status')?.addEventListener('change', loadAppeals);
        document.getElementById('filter-deposit-status')?.addEventListener('change', loadDeposits);
        document.getElementById('filter-withdrawal-status')?.addEventListener('change', loadWithdrawals);
        document.getElementById('filter-ver-status')?.addEventListener('change', loadVerifications);

        document.getElementById('s-base_rate')?.addEventListener('input', calculateFinalRatePreview);
        document.getElementById('s-markup_percent')?.addEventListener('input', calculateFinalRatePreview);
    } catch (err) {
        console.error('DOM binding error', err);
    }

    checkAuth();
});

// ——— AUTH ———
async function checkAuth() {
    try {
        const res = await fetch('/api/admin/profile');
        if (res.ok) {
            const data = await res.json();
            isSuperAdmin = data.is_super_admin;
            showDashboard();
        }
    } catch (e) { console.log('Admin not authenticated'); }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const totpCode = document.getElementById('login-2fa').value.trim();
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
            errEl.style.display = 'none';
            notify('Введите 2FA код blueberry', 'info');
            return;
        }

        if (data.success) { isSuperAdmin = data.admin?.is_super_admin; showDashboard(); }
        else { errEl.textContent = data.error || 'Ошибка авторизации'; errEl.style.display = 'block'; }
    } catch (e) {
        errEl.textContent = 'Ошибка подключения к серверу';
        errEl.style.display = 'block';
    }
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
}

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';

    if (!isSuperAdmin) {
        const adminsLink = document.querySelector('[data-page="admins"]');
        if (adminsLink) adminsLink.style.display = 'none';
    }

    loadDashboard();
    loadSettings();
    loadAdminProfile();
    loadNotifications();
    loadUsersForSelect();
    connectAdminSSE();

    if (adminRefreshInterval) clearInterval(adminRefreshInterval);
    adminRefreshInterval = setInterval(() => {
        if (currentPage === 'dashboard') loadDashboard();
        if (currentPage === 'users') loadUsers();
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'withdrawals') loadWithdrawals();
        loadNotifications();
    }, 15000);

    if (window.lucide) lucide.createIcons();
}

// ——— NAVIGATION ———
function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    const titles = {
        dashboard: 'Дашборд Blueberry', verifications: 'Модерация верификаций', orders: 'Книга ордеров',
        appeals: 'Апелляции и споры', deposits: 'Депозиты в криптовалюте', withdrawals: 'Заявки на выплату фиата',
        users: 'Реестр трейдеров-партнеров', admins: 'Управление администраторами', settings: 'Системные настройки', security: 'Безопасность панели'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('sidebar')?.classList.remove('open');

    if (page === 'dashboard') loadDashboard();
    if (page === 'verifications') loadVerifications();
    if (page === 'orders') loadOrders();
    if (page === 'appeals') loadAppeals();
    if (page === 'deposits') loadDeposits();
    if (page === 'withdrawals') loadWithdrawals();
    if (page === 'users') loadUsers();
    if (page === 'admins') loadAdmins();
    if (page === 'settings') loadSettings();

    if (window.lucide) lucide.createIcons();
}

// ——— DASHBOARD ———
async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        if (!res.ok) return;
        const d = await res.json();

        setText('stat-users', d.users_count ?? d.total_users ?? 0);
        setText('stat-online', d.online_count ?? d.online_users ?? 0);
        setText('stat-verified', d.verified_count ?? d.verified_users ?? 0);
        setText('stat-pending-ver', d.pending_verifications_count ?? d.pending_verifications ?? 0);
        setText('stat-active-orders', d.active_orders_count ?? d.active_orders ?? 0);
        setText('stat-pending-appeals', d.pending_appeals_count ?? d.pending_appeals ?? 0);
        setText('stat-pending-dep', d.pending_deposits_count ?? d.pending_deposits ?? 0);
        setText('stat-pending-wd', d.pending_withdrawals_count ?? d.pending_withdrawals ?? 0);

        const recentBody = document.getElementById('recent-body');
        const recent = d.recent_deposits || d.recent || [];
        if (recentBody) {
            if (!recent.length) {
                recentBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--txt-3);padding:20px;">Нет данных о депозитах</td></tr>';
            } else {
                recentBody.innerHTML = recent.map(dep => `
                    <tr>
                        <td style="font-family:var(--font-mono);">#${dep.id}</td>
                        <td><strong>${dep.username || 'ID ' + dep.user_id}</strong></td>
                        <td style="font-family:var(--font-mono);color:var(--mint);font-weight:700;">+${dep.amount_usdt} USDT</td>
                        <td style="font-family:var(--font-mono);">${formatRub(dep.amount_rub)}</td>
                        <td><span class="badge badge-${dep.status === 'confirmed' ? 'success' : dep.status === 'pending' ? 'warning' : 'danger'}">${dep.status}</span></td>
                        <td style="color:var(--txt-3);font-size:.8rem;">${formatDate(dep.created_at)}</td>
                    </tr>`).join('');
            }
        }
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Dashboard error', e); }
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ——— VERIFICATIONS ———
async function loadVerifications() {
    try {
        const res = await fetch('/api/admin/verifications');
        let list = await res.json();
        const filter = document.getElementById('filter-ver-status')?.value;
        if (filter) list = list.filter(v => v.status === filter);

        const container = document.getElementById('verifications-list');
        if (!container) return;

        if (!list.length) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--txt-3);">Заявок на проверку нет</div>';
            return;
        }

        container.innerHTML = list.map(v => `
            <div style="padding:16px;background:var(--bg-elevated);border-radius:var(--r-md);border:1px solid var(--brd-subtle);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div>
                    <div style="font-weight:700;">${v.username} <span style="font-size:.75rem;color:var(--txt-3);font-family:var(--font-mono);">ID: ${v.internal_id || v.user_id}</span></div>
                    <div style="font-size:.85rem;color:var(--txt-2);margin-top:4px;">📞 ${v.phone || '—'} · Telegram: <strong>${v.telegram_link || '—'}</strong></div>
                    <div style="font-size:.8rem;color:var(--txt-3);margin-top:2px;">Подана: ${formatDate(v.created_at)}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span class="badge badge-${v.status === 'approved' ? 'success' : v.status === 'pending' ? 'warning' : 'danger'}">${v.status}</span>
                    <button class="btn btn-primary btn-small" onclick="viewVerification(${v.id})"><i data-lucide="eye"></i> Документы</button>
                    ${v.status === 'pending' ? `
                        <button class="btn btn-small" style="background:var(--mint-subtle);color:var(--mint);" onclick="approveVerification(${v.id})"><i data-lucide="check"></i></button>
                        <button class="btn btn-small" style="background:var(--rose-subtle);color:var(--rose);" onclick="rejectVerification(${v.id})"><i data-lucide="x"></i></button>` : ''}
                </div>
            </div>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Verifications error', e); }
}

async function viewVerification(id) {
    try {
        const res = await fetch('/api/admin/verifications');
        const list = await res.json();
        const v = list.find(item => item.id === id);
        if (!v) return;

        document.getElementById('verification-modal-body').innerHTML = `
            <div style="font-size:.95rem;margin-bottom:16px;">
                <p><strong>Трейдер:</strong> ${v.username} (${v.internal_id || 'ID: ' + v.user_id})</p>
                <p><strong>Телефон:</strong> ${v.phone || '—'}</p>
                <p><strong>Telegram:</strong> ${v.telegram_link || '—'}</p>
                <p><strong>Соцсети:</strong> ${v.social_links || '—'}</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                ${v.selfie_url ? `<div><label class="fl">Селфи с паспортом</label><img src="${v.selfie_url}" style="width:100%;border-radius:var(--r-md);cursor:pointer;border:1px solid var(--brd-default);" onclick="window.open(this.src)"></div>` : ''}
                ${v.passport_photo_url ? `<div><label class="fl">Разворот паспорта</label><img src="${v.passport_photo_url}" style="width:100%;border-radius:var(--r-md);cursor:pointer;border:1px solid var(--brd-default);" onclick="window.open(this.src)"></div>` : ''}
                ${v.passport_registration_url ? `<div><label class="fl">Страница регистрации</label><img src="${v.passport_registration_url}" style="width:100%;border-radius:var(--r-md);cursor:pointer;border:1px solid var(--brd-default);" onclick="window.open(this.src)"></div>` : ''}
            </div>
            <div style="display:flex;gap:12px;margin-top:20px;">
                <button class="btn btn-primary btn-full" onclick="approveVerification(${v.id});closeModal('verification-modal')"><i data-lucide="check"></i> Одобрить верификацию</button>
                <button class="btn btn-logout btn-full" onclick="rejectVerification(${v.id});closeModal('verification-modal')"><i data-lucide="x"></i> Отклонить</button>
            </div>`;
        openModal('verification-modal');
        if (window.lucide) lucide.createIcons();
    } catch (e) { notify('Ошибка просмотра данных', 'error'); }
}

async function approveVerification(id) {
    if (!confirm('Одобрить верификацию пользователя?')) return;
    const res = await fetch(`/api/admin/verifications/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Верификация подтверждена', 'success'); loadVerifications(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function rejectVerification(id) {
    const comment = prompt('Причина отклонения (будет направлена трейдеру):');
    if (comment === null) return;
    const res = await fetch(`/api/admin/verifications/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment })
    });
    const data = await res.json();
    if (data.success) { notify('Верификация отклонена', 'info'); loadVerifications(); loadDashboard(); }
    else notify(data.error, 'error');
}

// ——— ORDERS ———
async function loadOrders() {
    try {
        const res = await fetch('/api/admin/orders');
        let orders = await res.json();
        const filter = document.getElementById('filter-order-status')?.value;
        if (filter) orders = orders.filter(o => o.status === filter);

        const body = document.getElementById('orders-body');
        if (!body) return;

        if (!orders.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--txt-3);padding:24px;">Ордера отсутствуют</td></tr>';
            return;
        }

        body.innerHTML = orders.map(o => `
            <tr>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--accent);">#${o.order_number}</td>
                <td><strong>${o.username || 'ID ' + o.user_id}</strong></td>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--mint);">${formatRub(o.amount_rub)}</td>
                <td><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'active' ? 'warning' : 'danger'}">${o.status}</span></td>
                <td>${o.status === 'active' ? `
                    <button class="btn btn-small" style="background:var(--mint-subtle);color:var(--mint);" onclick="adminCompleteOrder(${o.id})" title="Завершить"><i data-lucide="check"></i></button>
                    <button class="btn btn-small" style="background:var(--rose-subtle);color:var(--rose);" onclick="adminCancelOrder(${o.id})" title="Отменить"><i data-lucide="x"></i></button>` : '—'}</td>
                <td style="color:var(--txt-3);font-size:.8rem;">${formatDate(o.created_at)}</td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Orders error', e); }
}

async function showCreateOrderModal() {
    await loadUsersForSelect();
    const select = document.getElementById('order-user');
    updateOrderModalUserInfo();
    if (select) select.onchange = updateOrderModalUserInfo;
    openModal('create-order-modal');
}

function updateOrderModalUserInfo() {
    const select = document.getElementById('order-user');
    const u = allUsers.find(x => x.id == select?.value);
    const info = document.getElementById('order-available-info');
    if (u && info) {
        const available = u.balance_rub - (u.held_rub || 0);
        info.textContent = `Доступная казна: ${formatRub(available)} (Баланс: ${formatRub(u.balance_rub)}, Холд: ${formatRub(u.held_rub || 0)})`;
    }
}

async function createOrder() {
    const userId = document.getElementById('order-user').value;
    const orderNumber = document.getElementById('order-number').value.trim();
    const amount = parseFloat(document.getElementById('order-amount').value);

    if (!userId || !amount || amount <= 0) return notify('Заполните сумму ордера', 'error');

    const res = await fetch('/api/admin/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, order_number: orderNumber, amount_rub: amount })
    });
    const data = await res.json();
    if (data.success) {
        notify('Ордер сформирован и направлен трейдеру', 'success');
        closeModal('create-order-modal');
        document.getElementById('order-number').value = '';
        document.getElementById('order-amount').value = '';
        loadOrders(); loadDashboard();
    } else notify(data.error, 'error');
}

async function adminCompleteOrder(id) {
    if (!confirm('Принудительно закрыть ордер как выполненный?')) return;
    const res = await fetch(`/api/admin/orders/${id}/complete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Ордер успешно исполнен', 'success'); loadOrders(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function adminCancelOrder(id) {
    if (!confirm('Отменить ордер?')) return;
    const res = await fetch(`/api/admin/orders/${id}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Ордер отменён', 'info'); loadOrders(); loadDashboard(); }
    else notify(data.error, 'error');
}

// ——— APPEALS ———
async function loadAppeals() {
    try {
        const res = await fetch('/api/admin/appeals');
        let appeals = await res.json();
        const filter = document.getElementById('filter-appeal-status')?.value;
        if (filter) appeals = appeals.filter(a => a.status === filter);

        const body = document.getElementById('appeals-body');
        if (!body) return;

        if (!appeals.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--txt-3);padding:24px;">Апелляции отсутствуют</td></tr>';
            return;
        }

        body.innerHTML = appeals.map(a => `
            <tr>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--rose);">#${a.appeal_number}</td>
                <td><strong>${a.username || 'ID ' + a.user_id}</strong></td>
                <td style="font-family:var(--font-mono);">${a.order_number ? '#' + a.order_number : '—'}</td>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--rose);">${formatRub(a.amount_rub)}</td>
                <td><span class="badge badge-${a.status === 'resolved' ? 'success' : a.status === 'pending' ? 'warning' : 'danger'}">${a.status}</span></td>
                <td>${a.status === 'pending' ? `
                    <button class="btn btn-small" style="background:var(--mint-subtle);color:var(--mint);" onclick="resolveAppeal(${a.id})"><i data-lucide="check-check"></i> Списать</button>
                    <button class="btn btn-small" style="background:var(--rose-subtle);color:var(--rose);" onclick="rejectAppealAdmin(${a.id})"><i data-lucide="undo-2"></i> Разморозить</button>` : '—'}</td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Appeals error', e); }
}

async function showCreateAppealModal() {
    await loadUsersForSelect();
    const select = document.getElementById('appeal-user');
    if (select) select.innerHTML = '<option value="">Выберите трейдера</option>' + allUsers.map(u => `<option value="${u.id}">${u.username} (${u.internal_id || 'ID ' + u.id})</option>`).join('');
    openModal('create-appeal-modal');
}

async function createAppeal() {
    const userId = document.getElementById('appeal-user').value;
    const internalId = document.getElementById('appeal-internal-id').value.trim();
    const appealNumber = document.getElementById('appeal-number').value.trim();
    const orderNumber = document.getElementById('appeal-order').value.trim();
    const amount = parseFloat(document.getElementById('appeal-amount').value);
    const description = document.getElementById('appeal-description').value.trim();
    const receiptFile = document.getElementById('appeal-receipt')?.files[0];

    if (!amount || amount <= 0) return notify('Укажите сумму спора', 'error');

    let receiptUrl = '';
    if (receiptFile) receiptUrl = await fileToBase64(receiptFile);

    const res = await fetch('/api/admin/appeals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: userId, internal_id: internalId, appeal_number: appealNumber,
            order_number: orderNumber, amount_rub: amount, description, receipt_url: receiptUrl
        })
    });
    const data = await res.json();
    if (data.success) {
        notify('Апелляция открыта, сумма заблокирована в холд', 'success');
        closeModal('create-appeal-modal');
        loadAppeals(); loadDashboard();
    } else notify(data.error, 'error');
}

async function resolveAppeal(id) {
    if (!confirm('Решить апелляцию? Сумма будет окончательно списана с баланса трейдера.')) return;
    const res = await fetch(`/api/admin/appeals/${id}/resolve`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Апелляция удовлетворена, средства списаны', 'success'); loadAppeals(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function rejectAppealAdmin(id) {
    if (!confirm('Отклонить апелляцию? Замороженные средства вернутся на баланс трейдера.')) return;
    const res = await fetch(`/api/admin/appeals/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Апелляция отклонена, холд разморожен', 'info'); loadAppeals(); loadDashboard(); }
    else notify(data.error, 'error');
}

// ——— DEPOSITS ———
async function loadDeposits() {
    try {
        const res = await fetch('/api/admin/deposits');
        let deposits = await res.json();
        const filter = document.getElementById('filter-deposit-status')?.value;
        if (filter) deposits = deposits.filter(d => d.status === filter);

        const body = document.getElementById('deposits-body');
        if (!body) return;

        if (!deposits.length) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--txt-3);padding:24px;">Депозиты отсутствуют</td></tr>';
            return;
        }

        body.innerHTML = deposits.map(d => `
            <tr>
                <td style="font-family:var(--font-mono);">#${d.id}</td>
                <td><strong>${d.username || 'ID ' + d.user_id}</strong></td>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--mint);">${d.amount_usdt} USDT</td>
                <td style="font-family:var(--font-mono);">${formatRub(d.amount_rub)}</td>
                <td><span style="font-family:var(--font-mono);font-size:.75rem;">${d.network}</span></td>
                <td style="font-family:var(--font-mono);font-size:.72rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${d.tx_hash || ''}">${d.tx_hash || '—'}</td>
                <td><span class="badge badge-${d.status === 'confirmed' ? 'success' : d.status === 'pending' ? 'warning' : 'danger'}">${d.status}</span></td>
                <td>${d.status === 'pending' ? `
                    <button class="btn btn-small" style="background:var(--mint-subtle);color:var(--mint);" onclick="confirmDepositAdmin(${d.id})"><i data-lucide="check"></i></button>
                    <button class="btn btn-small" style="background:var(--rose-subtle);color:var(--rose);" onclick="rejectDepositAdmin(${d.id})"><i data-lucide="x"></i></button>` : '—'}</td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Deposits error', e); }
}

async function confirmDepositAdmin(id) {
    if (!confirm('Подтвердить получение криптовалюты и начислить рубли на баланс?')) return;
    const res = await fetch(`/api/admin/deposits/${id}/confirm`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Депозит зачислен на баланс трейдера', 'success'); loadDeposits(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function rejectDepositAdmin(id) {
    if (!confirm('Отклонить депозит?')) return;
    const res = await fetch(`/api/admin/deposits/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Депозит отклонён', 'info'); loadDeposits(); loadDashboard(); }
    else notify(data.error, 'error');
}

// ——— WITHDRAWALS ———
async function loadWithdrawals() {
    try {
        const res = await fetch('/api/admin/withdrawals');
        let withdrawals = await res.json();
        const filter = document.getElementById('filter-withdrawal-status')?.value;
        if (filter) withdrawals = withdrawals.filter(w => w.status === filter);

        const body = document.getElementById('withdrawals-body');
        if (!body) return;

        if (!withdrawals.length) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--txt-3);padding:24px;">Заявки на выплату отсутствуют</td></tr>';
            return;
        }

        body.innerHTML = withdrawals.map(w => `
            <tr>
                <td style="font-family:var(--font-mono);">#${w.id}</td>
                <td><strong>${w.username || 'ID ' + w.user_id}</strong></td>
                <td style="font-family:var(--font-mono);font-weight:700;color:var(--rose);">${formatRub(w.amount_rub)}</td>
                <td><strong style="color:var(--accent);">${w.bank || '—'}</strong></td>
                <td>${w.name || '—'}</td>
                <td style="font-family:var(--font-mono);font-size:.8rem;">${w.phone || '—'}</td>
                <td><span class="badge badge-${w.status === 'completed' ? 'success' : w.status === 'pending' ? 'warning' : 'danger'}">${w.status}</span></td>
                <td>${w.status === 'pending' ? `
                    <button class="btn btn-small" style="background:var(--mint-subtle);color:var(--mint);" onclick="confirmWithdrawalAdmin(${w.id})"><i data-lucide="check"></i> Выплачено</button>
                    <button class="btn btn-small" style="background:var(--rose-subtle);color:var(--rose);" onclick="rejectWithdrawalAdmin(${w.id})"><i data-lucide="x"></i></button>` : '—'}</td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Withdrawals error', e); }
}

async function confirmWithdrawalAdmin(id) {
    if (!confirm('Подтвердить, что вы перевели средства трейдеру по реквизитам?')) return;
    const res = await fetch(`/api/admin/withdrawals/${id}/confirm`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Вывод средств успешно зафиксирован', 'success'); loadWithdrawals(); loadDashboard(); }
    else notify(data.error, 'error');
}

async function rejectWithdrawalAdmin(id) {
    if (!confirm('Отклонить заявку на вывод? Средства вернутся трейдеру.')) return;
    const res = await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Заявка на вывод отклонена', 'info'); loadWithdrawals(); loadDashboard(); }
    else notify(data.error, 'error');
}

// ——— USERS & CREDENTIALS ———
async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users');
        allUsers = await res.json();

        const body = document.getElementById('users-body');
        if (!body) return;

        if (!allUsers.length) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--txt-3);padding:24px;">Пользователи отсутствуют</td></tr>';
            return;
        }

        body.innerHTML = allUsers.map(u => `
            <tr>
                <td style="font-family:var(--font-mono);color:var(--accent);font-weight:600;">${u.internal_id || '#' + u.id}</td>
                <td><strong>${u.username}</strong></td>
                <td style="font-family:var(--font-mono);font-weight:700;">${formatRub(u.balance_rub)}<br><span style="font-size:.72rem;color:var(--txt-3);">Холд: ${formatRub(u.held_rub || 0)}</span></td>
                <td><span class="badge badge-${u.is_online ? 'success' : 'info'}">${u.is_online ? 'Online' : 'Offline'}</span></td>
                <td><span class="badge badge-${u.is_verified ? 'success' : 'warning'}">${u.is_verified ? 'Да' : 'Нет'}</span></td>
                <td><span class="badge badge-${u.totp_enabled ? 'success' : 'danger'}">${u.totp_enabled ? 'ON' : 'OFF'}</span></td>
                <td><span class="badge badge-${u.is_blocked ? 'danger' : 'success'}">${u.is_blocked ? 'Блок' : 'Активен'}</span></td>
                <td><button class="btn btn-primary btn-small" onclick="viewUserModal(${u.id})"><i data-lucide="user-cog"></i> Управление</button></td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Users error', e); }
}

async function loadUsersForSelect() {
    try {
        const res = await fetch('/api/admin/users');
        allUsers = await res.json();

        const orderUser = document.getElementById('order-user');
        if (orderUser) {
            orderUser.innerHTML = allUsers.map(u => `<option value="${u.id}">${u.username} (${u.internal_id || 'ID ' + u.id}) — Казна: ${formatRub(u.balance_rub - (u.held_rub || 0))}</option>`).join('');
        }
        const notifUser = document.getElementById('notif-user');
        if (notifUser) {
            notifUser.innerHTML = '<option value="all">Глобальная рассылка (Всем)</option>' + allUsers.map(u => `<option value="${u.id}">${u.username} (${u.internal_id || 'ID ' + u.id})</option>`).join('');
        }
    } catch (e) { console.error('Users select error', e); }
}

async function viewUserModal(id) {
    try {
        const res = await fetch(`/api/admin/users/${id}`);
        const u = await res.json();
        if (!u) return;

        const currentPassword = u.raw_password ? u.raw_password : '(Пароль ещё не был сохранён в открытом виде)';
        const currentMarkup = u.markup_percent !== null && u.markup_percent !== undefined ? u.markup_percent : '';

        document.getElementById('user-modal-body').innerHTML = `
            <!-- User Credentials & Info Header -->
            <div style="margin-bottom:16px;padding:16px;background:var(--bg-elevated);border-radius:var(--r-md);border:1px solid var(--brd-subtle);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
                    <div>
                        <h3 style="font-size:1.2rem;font-weight:800;color:var(--txt-1);">${u.username}</h3>
                        <p style="color:var(--txt-3);font-family:var(--font-mono);font-size:.85rem;margin-top:2px;">Внутренний ID: <strong>${u.internal_id || u.id}</strong></p>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.3rem;font-weight:800;font-family:var(--font-mono);color:var(--mint);">${formatRub(u.balance_rub)}</div>
                        <div style="font-size:.8rem;color:var(--txt-3);">В холде: ${formatRub(u.held_rub || 0)}</div>
                    </div>
                </div>

                <!-- Credentials viewer block -->
                <div style="margin-top:14px;padding:12px;background:var(--bg-surface);border-radius:var(--r-sm);border:1px dashed var(--brd-strong);">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.88rem;margin-bottom:6px;">
                        <span>👤 Логин: <strong style="font-family:var(--font-mono);color:var(--accent);">${u.username}</strong></span>
                        <button class="btn btn-ghost btn-small" onclick="navigator.clipboard.writeText('${u.username}').then(()=>notify('Логин скопирован','success'))"><i data-lucide="copy"></i></button>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.88rem;">
                        <span>🔑 Пароль: <strong style="font-family:var(--font-mono);color:var(--mint);">${currentPassword}</strong></span>
                        ${u.raw_password ? `<button class="btn btn-ghost btn-small" onclick="navigator.clipboard.writeText('${u.raw_password}').then(()=>notify('Пароль скопирован','success'))"><i data-lucide="copy"></i></button>` : ''}
                    </div>
                </div>
            </div>

            <!-- Individual Rate Markup -->
            <div class="card" style="padding:16px;margin-bottom:16px;">
                <label class="fl">Индивидуальная ставка наценки курса для трейдера (%)</label>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <input type="number" id="user-markup-input" step="0.1" placeholder="Глобальная ставка (по умолчанию)" value="${currentMarkup}" class="fi">
                    <button class="btn btn-primary" onclick="saveUserMarkup(${u.id})">Сохранить ставку</button>
                </div>
                <p style="font-size:11px;color:var(--txt-3);margin-top:6px;">Оставьте поле пустым, чтобы трейдер работал по общей ставке из настроек сервиса.</p>
            </div>

            <!-- Balance Adjustment -->
            <div class="card" style="padding:16px;margin-bottom:16px;">
                <label class="fl">Корректировка баланса казначейства</label>
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                    <input type="number" id="adj-balance-amount" placeholder="Сумма в рублях (₽)" class="fi" style="flex:1;min-width:120px;">
                    <button class="btn btn-primary" onclick="adjustUserBalance(${u.id},'add')">+ Начислить</button>
                    <button class="btn btn-logout" onclick="adjustUserBalance(${u.id},'sub')">− Списать</button>
                </div>
            </div>

            <!-- Action Controls -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <button class="btn ${u.is_blocked ? 'btn-primary' : 'btn-logout'}" onclick="toggleUserBlock(${u.id},${!u.is_blocked})">
                    <i data-lucide="${u.is_blocked ? 'unlock' : 'lock'}"></i> ${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button class="btn ${u.is_restricted ? 'btn-primary' : 'btn-logout'}" onclick="toggleUserRestrict(${u.id},${!u.is_restricted})">
                    <i data-lucide="shield-alert"></i> ${u.is_restricted ? 'Снять запрет' : 'Запретить операции'}
                </button>
                <button class="btn btn-ghost" onclick="resetUser2FA(${u.id})">
                    <i data-lucide="key"></i> Сбросить 2FA
                </button>
                <button class="btn btn-ghost" onclick="resetUserPassword(${u.id})">
                    <i data-lucide="refresh-cw"></i> Задать/сбросить пароль
                </button>
            </div>`;
        openModal('user-modal');
        if (window.lucide) lucide.createIcons();
    } catch (e) { notify('Ошибка загрузки профиля трейдера', 'error'); }
}

async function saveUserMarkup(userId) {
    const markupVal = document.getElementById('user-markup-input')?.value;
    const res = await fetch(`/api/admin/users/${userId}/markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markup_percent: markupVal })
    });
    const data = await res.json();
    if (data.success) {
        notify('Индивидуальная ставка трейдера сохранена', 'success');
        viewUserModal(userId);
    } else notify(data.error, 'error');
}

async function adjustUserBalance(userId, action) {
    const amount = parseFloat(document.getElementById('adj-balance-amount')?.value);
    if (!amount || amount <= 0) return notify('Введите корректную сумму', 'error');

    const res = await fetch(`/api/admin/users/${userId}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, action })
    });
    const data = await res.json();
    if (data.success) {
        notify('Баланс обновлён', 'success');
        viewUserModal(userId);
        loadUsers();
        loadDashboard();
    } else notify(data.error, 'error');
}

async function toggleUserBlock(userId, block) {
    const res = await fetch(`/api/admin/users/${userId}/${block ? 'block' : 'unblock'}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify(block ? 'Пользователь заблокирован' : 'Пользователь разблокирован', 'info'); viewUserModal(userId); loadUsers(); }
    else notify(data.error, 'error');
}

async function toggleUserRestrict(userId, restrict) {
    const res = await fetch(`/api/admin/users/${userId}/${restrict ? 'restrict' : 'unrestrict'}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify(restrict ? 'Действия ограничены' : 'Ограничения сняты', 'info'); viewUserModal(userId); loadUsers(); }
    else notify(data.error, 'error');
}

async function resetUser2FA(userId) {
    if (!confirm('Сбросить двухфакторную аутентификацию трейдеру?')) return;
    const res = await fetch(`/api/admin/users/${userId}/reset-2fa`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('2FA сброшена', 'success'); viewUserModal(userId); loadUsers(); }
    else notify(data.error, 'error');
}

async function resetUserPassword(userId) {
    const customPass = prompt('Введите новый пароль для трейдера (или оставьте пустым для случайной генерации):');
    if (customPass === null) return;

    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: customPass.trim() })
    });
    const data = await res.json();
    if (data.success) {
        notify(`Новый пароль сохранён: ${data.new_password}`, 'success');
        viewUserModal(userId);
        loadUsers();
    } else notify(data.error, 'error');
}

async function createUser() {
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value.trim();

    const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
        lastCreatedUser = data.user;
        document.getElementById('created-username').textContent = data.user?.username || username;
        document.getElementById('created-password').textContent = data.user?.password || password;
        document.getElementById('created-user-info').classList.remove('hidden');
        document.getElementById('created-user-info').style.display = 'block';
        loadUsers(); loadDashboard();
        notify('Трейдер blueberry успешно создан!', 'success');
        if (window.lucide) lucide.createIcons();
    } else notify(data.error, 'error');
}

function copyCredentials() {
    const u = document.getElementById('created-username').textContent;
    const p = document.getElementById('created-password').textContent;
    navigator.clipboard.writeText(`Логин: ${u}\nПароль: ${p}`).then(() => notify('Реквизиты доступа скопированы!', 'success'));
}

// ——— ADMINS ———
async function loadAdmins() {
    if (!isSuperAdmin) return;
    try {
        const res = await fetch('/api/admin/admins');
        const list = await res.json();
        const body = document.getElementById('admins-body');
        if (!body) return;

        body.innerHTML = list.map(a => `
            <tr>
                <td style="font-family:var(--font-mono);">#${a.id}</td>
                <td><strong>${a.username}</strong></td>
                <td><span class="badge badge-${a.totp_enabled ? 'success' : 'danger'}">${a.totp_enabled ? 'ON' : 'OFF'}</span></td>
                <td><span class="badge badge-${a.is_super_admin ? 'success' : 'info'}">${a.is_super_admin ? 'Да' : 'Нет'}</span></td>
                <td>${!a.is_super_admin ? `<button class="btn btn-logout btn-small" onclick="deleteAdmin(${a.id})"><i data-lucide="trash-2"></i></button>` : '—'}</td>
            </tr>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (e) { console.error('Admins error', e); }
}

async function createAdmin() {
    const username = document.getElementById('new-admin-username').value.trim();
    const password = document.getElementById('new-admin-password').value;
    if (!username || !password) return notify('Заполните логин и пароль', 'error');

    const res = await fetch('/api/admin/admins/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('created-admin-username').textContent = username;
        document.getElementById('created-admin-password').textContent = password;
        document.getElementById('created-admin-info').classList.remove('hidden');
        document.getElementById('created-admin-info').style.display = 'block';
        loadAdmins();
        notify('Администратор зарегистрирован', 'success');
    } else notify(data.error, 'error');
}

async function deleteAdmin(id) {
    if (!confirm('Удалить администратора?')) return;
    const res = await fetch(`/api/admin/admins/${id}/delete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { notify('Администратор удалён', 'info'); loadAdmins(); }
    else notify(data.error, 'error');
}

// ——— SETTINGS ———
async function loadSettings() {
    try {
        const res = await fetch('/api/admin/settings');
        const s = await res.json();

        setVal('s-app_name', s.app_name || 'blueberry');
        setVal('s-base_rate', s.base_rate || '');
        setVal('s-markup_percent', s.markup_percent || '');
        setVal('s-min_deposit_usdt', s.min_deposit_usdt || '');
        setVal('s-min_withdrawal_rub', s.min_withdrawal_rub || '');
        setVal('s-order_timer_minutes', s.order_timer_minutes || '');
        setVal('s-support_contact', s.support_contact || '');

        calculateFinalRatePreview();

        currentNetworks = typeof s.networks === 'string' ? JSON.parse(s.networks) : (s.networks || []);
        renderNetworksEditor();

        currentSupportContacts = typeof s.support_contacts === 'string' ? JSON.parse(s.support_contacts) : (s.support_contacts || []);
        renderSupportContactsEditor();
    } catch (e) { console.error('Settings error', e); }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

function calculateFinalRatePreview() {
    const base = parseFloat(document.getElementById('s-base_rate')?.value) || 0;
    const markup = parseFloat(document.getElementById('s-markup_percent')?.value) || 0;
    const finalRate = base * (1 + markup / 100);
    const el = document.getElementById('final-rate');
    if (el) el.textContent = `${finalRate.toFixed(2)} ₽`;
}

async function saveSettings(e) {
    e.preventDefault();
    const settings = {
        app_name: document.getElementById('s-app_name').value,
        base_rate: parseFloat(document.getElementById('s-base_rate').value),
        markup_percent: parseFloat(document.getElementById('s-markup_percent').value),
        min_deposit_usdt: parseFloat(document.getElementById('s-min_deposit_usdt').value),
        min_withdrawal_rub: parseFloat(document.getElementById('s-min_withdrawal_rub').value),
        order_timer_minutes: parseInt(document.getElementById('s-order_timer_minutes').value),
        support_contact: document.getElementById('s-support_contact').value
    };

    try {
        for (const [key, value] of Object.entries(settings)) {
            await fetch('/api/admin/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
        }
        notify('Системные настройки Blueberry сохранены', 'success');
        calculateFinalRatePreview();
    } catch (e) { notify('Ошибка сохранения настроек', 'error'); }
}

function renderNetworksEditor() {
    const container = document.getElementById('networks-list');
    if (!container) return;
    container.innerHTML = currentNetworks.map((n, idx) => `
        <div style="display:grid;grid-template-columns:90px 100px 1fr 40px;gap:8px;align-items:center;margin-bottom:8px;">
            <input type="text" class="fi" value="${n.coin || 'USDT'}" onchange="currentNetworks[${idx}].coin=this.value" placeholder="Coin">
            <input type="text" class="fi" value="${n.id || ''}" onchange="currentNetworks[${idx}].id=this.value" placeholder="TRC20">
            <input type="text" class="fi" value="${n.wallet || ''}" onchange="currentNetworks[${idx}].wallet=this.value" placeholder="Адрес кошелька">
            <button class="btn btn-logout btn-small" onclick="currentNetworks.splice(${idx},1);renderNetworksEditor()"><i data-lucide="x"></i></button>
        </div>`).join('') +
        `<button class="btn btn-ghost btn-small" style="margin-top:6px;" onclick="currentNetworks.push({coin:'USDT',id:'TRC20',wallet:''});renderNetworksEditor()"><i data-lucide="plus"></i> Добавить сеть</button>`;
    if (window.lucide) lucide.createIcons();
}

async function saveNetworks() {
    await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'networks', value: JSON.stringify(currentNetworks) })
    });
    notify('Сети и кошельки зафиксированы', 'success');
}

function renderSupportContactsEditor() {
    const container = document.getElementById('support-contacts-list');
    if (!container) return;
    container.innerHTML = currentSupportContacts.map((c, idx) => `
        <div style="display:grid;grid-template-columns:120px 1fr 40px;gap:8px;align-items:center;margin-bottom:8px;">
            <input type="text" class="fi" value="${c.label || ''}" onchange="currentSupportContacts[${idx}].label=this.value" placeholder="Метка">
            <input type="text" class="fi" value="${c.value || ''}" onchange="currentSupportContacts[${idx}].value=this.value" placeholder="Ссылка">
            <button class="btn btn-logout btn-small" onclick="currentSupportContacts.splice(${idx},1);renderSupportContactsEditor()"><i data-lucide="x"></i></button>
        </div>`).join('') +
        `<button class="btn btn-ghost btn-small" style="margin-top:6px;" onclick="currentSupportContacts.push({label:'Telegram',value:''});renderSupportContactsEditor()"><i data-lucide="plus"></i> Добавить контакт</button>`;
    if (window.lucide) lucide.createIcons();
}

async function saveContacts() {
    await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'support_contacts', value: JSON.stringify(currentSupportContacts) })
    });
    notify('Контакты поддержки сохранены', 'success');
}

// ——— ADMIN SECURITY ———
async function loadAdminProfile() {
    try {
        const res = await fetch('/api/admin/profile');
        const d = await res.json();
        const statusEl = document.getElementById('admin-2fa-status');
        const setupBtn = document.getElementById('btn-setup-2fa');
        if (!statusEl) return;
        if (d.totp_enabled) {
            statusEl.textContent = '✅ 2FA активна (Google Authenticator)';
            statusEl.style.color = 'var(--mint)';
            if (setupBtn) setupBtn.style.display = 'none';
        } else {
            statusEl.textContent = '⚠️ 2FA отключена. Рекомендуется активировать.';
            statusEl.style.color = 'var(--amber)';
            if (setupBtn) setupBtn.style.display = 'inline-flex';
        }
    } catch (e) { console.error('Admin profile error', e); }
}

async function changeAdminCreds() {
    const curr = document.getElementById('admin-curr-pass').value;
    const newUser = document.getElementById('admin-new-user').value.trim();
    const newPass = document.getElementById('admin-new-pass').value;

    if (!curr) return notify('Введите текущий пароль', 'error');

    const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: curr, new_username: newUser, new_password: newPass })
    });
    const data = await res.json();
    if (data.success) {
        notify('Данные администратора обновлены', 'success');
        document.getElementById('admin-curr-pass').value = '';
        document.getElementById('admin-new-user').value = '';
        document.getElementById('admin-new-pass').value = '';
    } else notify(data.error, 'error');
}

async function setupAdmin2FA() {
    const res = await fetch('/api/admin/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
        document.getElementById('admin-qr').src = data.qr_code;
        document.getElementById('admin-secret').textContent = data.secret;
        document.getElementById('admin-2fa-setup').classList.remove('hidden');
        document.getElementById('admin-2fa-setup').style.display = 'block';
    }
}

async function verifyAdmin2FA() {
    const code = document.getElementById('admin-totp-code').value.trim();
    if (!code || code.length !== 6) return notify('Введите 6-значный код', 'error');

    const res = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
        notify('Blueberry 2FA Shield подключена!', 'success');
        document.getElementById('admin-2fa-setup').style.display = 'none';
        loadAdminProfile();
    } else notify(data.error, 'error');
}

// ——— NOTIFICATIONS ———
async function loadNotifications() {
    try {
        const res = await fetch('/api/admin/notifications');
        const data = await res.json();
        const count = data.unread_count || 0;
        const countBadge = document.getElementById('notif-count');
        if (countBadge) {
            countBadge.textContent = count;
            countBadge.style.display = count > 0 ? 'grid' : 'none';
        }
        const container = document.getElementById('notifications-list');
        if (container && data.notifications) {
            container.innerHTML = data.notifications.map(n => `
                <div style="padding:10px 0;border-bottom:1px solid var(--brd-subtle);font-size:.88rem;">
                    ${n.type ? `<strong>[${n.type.toUpperCase()}]</strong> ` : ''}${n.message}
                    <div style="font-size:.75rem;color:var(--txt-3);margin-top:2px;">${formatDate(n.created_at)}</div>
                </div>`).join('');
        }
    } catch (e) { console.error('Notifications error', e); }
}

function toggleNotifications() {
    const card = document.getElementById('notifications-card');
    if (card) card.style.display = (card.style.display === 'none' || !card.style.display) ? 'block' : 'none';
}

async function markNotificationsRead() {
    await fetch('/api/admin/notifications/read', { method: 'POST' });
    loadNotifications();
}

async function sendNotification() {
    const userId = document.getElementById('notif-user').value;
    const type = document.getElementById('notif-type').value;
    const message = document.getElementById('notif-message').value.trim();

    if (!message) return notify('Введите сообщение', 'error');

    const res = await fetch('/api/admin/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, type, message })
    });
    const data = await res.json();
    if (data.success) {
        notify('Уведомление отправлено', 'success');
        document.getElementById('notif-message').value = '';
        closeModal('send-notification-modal');
    } else notify(data.error, 'error');
}

// ——— SSE REAL-TIME ———
function connectAdminSSE() {
    if (adminEventSource) { adminEventSource.close(); adminEventSource = null; }
    adminEventSource = new EventSource('/api/admin/events');

    adminEventSource.addEventListener('user_status', () => {
        if (currentPage === 'users') loadUsers();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('new_deposit', (e) => {
        const data = JSON.parse(e.data);
        notify(`💰 Новый депозит ${data.amount_usdt || ''} USDT от трейдера #${data.userId}`, 'info');
        if (currentPage === 'deposits') loadDeposits();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('new_withdrawal', (e) => {
        const data = JSON.parse(e.data);
        notify(`💸 Новый вывод ${formatRub(data.amount_rub)} от трейдера #${data.userId}`, 'info');
        if (currentPage === 'withdrawals') loadWithdrawals();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('withdrawal_cancelled', () => {
        notify('❌ Вывод отменён пользователем (возврат 30с)', 'info');
        if (currentPage === 'withdrawals') loadWithdrawals();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('new_verification', () => {
        notify('📋 Новая заявка на верификацию!', 'info');
        if (currentPage === 'verifications') loadVerifications();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('order_completed', (e) => {
        const data = JSON.parse(e.data);
        notify(`✅ Ордер #${data.orderId} исполнен трейдером`, 'success');
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('order_failed', (e) => {
        const data = JSON.parse(e.data);
        notify(`⚠️ Ордер #${data.orderId} не выполнен`, 'error');
        if (currentPage === 'orders') loadOrders();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.addEventListener('appeal_client_action', (e) => {
        const data = JSON.parse(e.data);
        notify(`⚖️ Ответ по апелляции #${data.appeal_number}: ${data.action}`, 'info');
        if (currentPage === 'appeals') loadAppeals();
        if (currentPage === 'dashboard') loadDashboard();
    });

    adminEventSource.onerror = () => { setTimeout(connectAdminSSE, 4000); };
}

// ——— MODALS ———
function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'flex'; if (window.lucide) lucide.createIcons(); }
}

window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.style.display = 'none';
};

// ——— UTILS ———
function formatRub(a) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0);
}

function formatDate(d) {
    if (!d) return '—';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}

function notify(msg, type = 'info') {
    let t = document.getElementById('admin-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'admin-toast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(150%);padding:12px 20px;border-radius:12px;font-weight:600;font-size:.88rem;z-index:999999;display:flex;align-items:center;gap:8px;background:var(--bg-elevated);border:1px solid var(--brd-strong);box-shadow:var(--shadow-l);transition:transform .25s cubic-bezier(.34,1.56,.64,1);font-family:var(--font-display);color:var(--txt-1);';
        document.body.appendChild(t);
    }
    t.innerHTML = `<span>${msg}</span>`;
    t.style.borderColor = type === 'success' ? 'var(--mint)' : type === 'error' ? 'var(--rose)' : 'var(--accent)';
    t.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(150%)'; }, 3500);
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
