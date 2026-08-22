let currentUser = null;
let currentDeposit = null;
let networks = [];
let orderTimers = {};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('link-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
    document.getElementById('link-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', (e) => { e.preventDefault(); showPage(item.dataset.page); }));
    document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('btn-online').addEventListener('click', toggleOnline);
    document.getElementById('btn-deposit').addEventListener('click', createDeposit);
    document.getElementById('btn-confirm-deposit').addEventListener('click', confirmDeposit);
    document.getElementById('btn-cancel-deposit').addEventListener('click', cancelDeposit);
    document.getElementById('btn-copy').addEventListener('click', copyAddress);
    document.getElementById('amount-usdt').addEventListener('input', calcPreview);
    document.getElementById('btn-withdraw').addEventListener('click', createWithdrawal);
    document.getElementById('btn-save-req').addEventListener('click', saveRequisite);
    document.getElementById('btn-mark-read').addEventListener('click', markNotificationsRead);
    document.getElementById('btn-change-login').addEventListener('click', changeUsername);
    document.getElementById('btn-change-pass').addEventListener('click', changePassword);
    document.getElementById('btn-2fa').addEventListener('click', setup2FA);
    document.getElementById('btn-verify-2fa').addEventListener('click', verify2FA);
    document.getElementById('btn-submit-verification').addEventListener('click', submitVerification);
    document.getElementById('filter-orders')?.addEventListener('change', loadOrders);
    checkSession();
});

async function checkSession() {
    try {
        const res = await fetch('/api/user/profile');
        if (res.ok) { currentUser = await res.json(); showApp(); }
    } catch (e) {}
}

function showLogin() { document.getElementById('login-form').style.display = 'block'; document.getElementById('register-form').style.display = 'none'; }
function showRegister() { document.getElementById('login-form').style.display = 'none'; document.getElementById('register-form').style.display = 'block'; }

async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const totp = document.getElementById('login-totp').value;
    const errEl = document.getElementById('login-error');
    if (!username || !password) { errEl.textContent = 'Введите логин и пароль'; errEl.style.display = 'block'; return; }
    try {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, totp_code: totp }) });
        const data = await res.json();
        if (data.requires_2fa) { document.getElementById('login-2fa-group').style.display = 'block'; errEl.style.display = 'none'; return; }
        if (data.success) { currentUser = data.user; showApp(); } else { errEl.textContent = data.error; errEl.style.display = 'block'; }
    } catch (e) { errEl.textContent = 'Ошибка подключения'; errEl.style.display = 'block'; }
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    if (!username || !password) { errEl.textContent = 'Введите логин и пароль'; errEl.style.display = 'block'; return; }
    if (username.length < 3) { errEl.textContent = 'Логин минимум 3 символа'; errEl.style.display = 'block'; return; }
    if (password.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; errEl.style.display = 'block'; return; }
    let telegramId = null, firstName = username;
    if (window.Telegram?.WebApp) { const u = window.Telegram.WebApp.initDataUnsafe?.user; if (u) { telegramId = u.id; firstName = u.first_name || username; } }
    try {
        const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, telegram_id: telegramId, first_name: firstName }) });
        const data = await res.json();
        if (data.success) { currentUser = data.user; showApp(); } else { errEl.textContent = data.error; errEl.style.display = 'block'; }
    } catch (e) { errEl.textContent = 'Ошибка подключения'; errEl.style.display = 'block'; }
}

async function doLogout() { await fetch('/api/logout', { method: 'POST' }); currentUser = null; location.reload(); }

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    updateUserUI();
    loadRate();
    loadStats();
    loadOrders();
    loadAppeals();
    loadDeposits();
    loadRequisites();
    loadNotifications();
    loadVerificationStatus();
    updateOnlineButton();
    checkVerificationBanner();
}

function showPage(page) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    const titles = { home: 'Главная', orders: 'Ордера', appeals: 'Апелляции', balance: 'Баланс', requisites: 'Реквизиты', notifications: 'Уведомления', verification: 'Верификация', profile: 'Профиль' };
    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('sidebar').classList.remove('open');
    if (page === 'home') { loadStats(); loadOrders(); }
    if (page === 'orders') loadOrders();
    if (page === 'appeals') loadAppeals();
    if (page === 'balance') { loadDeposits(); loadRate(); }
    if (page === 'requisites') loadRequisites();
    if (page === 'notifications') loadNotifications();
    if (page === 'verification') loadVerificationStatus();
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('user-balance-header').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('welcome-name').textContent = currentUser.username;
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = currentUser.first_name || '';
    document.getElementById('balance-value').textContent = formatRub(currentUser.balance_rub);
    const s = document.getElementById('2fa-status'), b = document.getElementById('btn-2fa');
    if (currentUser.totp_enabled) { s.textContent = 'Подключена ✓'; s.classList.add('active'); b.textContent = 'Отключить'; b.onclick = () => disable2FA(); }
    else { s.textContent = 'Не подключена'; s.classList.remove('active'); b.textContent = 'Настроить'; b.onclick = () => setup2FA(); }
}

function updateOnlineButton() {
    const btn = document.getElementById('btn-online');
    if (currentUser?.is_online) { btn.textContent = '🟢 Онлайн'; btn.className = 'btn-online online'; }
    else { btn.textContent = '🔴 Офлайн'; btn.className = 'btn-online offline'; }
}

function checkVerificationBanner() {
    const banner = document.getElementById('verification-banner');
    if (currentUser && !currentUser.is_verified && currentUser.verification_status !== 'pending') {
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

async function toggleOnline() {
    try {
        const res = await fetch('/api/user/toggle-online', { method: 'POST' });
        const data = await res.json();
        if (data.success) { currentUser.is_online = data.is_online; updateOnlineButton(); showToast(data.is_online ? 'Вы онлайн!' : 'Вы офлайн', 'success'); }
    } catch (e) {}
}

async function loadRate() {
    try {
        const res = await fetch('/api/exchange/rate');
        const data = await res.json();
        networks = data.networks || [];
        const select = document.getElementById('deposit-network');
        if (select) select.innerHTML = networks.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    } catch (e) {}
}

async function loadStats() {
    try {
        const res = await fetch('/api/user/stats');
        const data = await res.json();
        document.getElementById('stat-today-rub').textContent = formatRub(data.today.rub);
        document.getElementById('stat-today-deals').textContent = `${data.today.deals + data.today.orders} сделок`;
        document.getElementById('stat-yesterday-rub').textContent = formatRub(data.yesterday.rub);
        document.getElementById('stat-yesterday-deals').textContent = `${data.yesterday.deals + data.yesterday.orders} сделок`;
        document.getElementById('stat-week-rub').textContent = formatRub(data.week.rub);
        document.getElementById('stat-week-deals').textContent = `${data.week.deals + data.week.orders} сделок`;
        document.getElementById('stat-lastweek-rub').textContent = formatRub(data.lastWeek.rub);
        document.getElementById('stat-lastweek-deals').textContent = `${data.lastWeek.deals + data.lastWeek.orders} сделок`;
        document.getElementById('stat-month-rub').textContent = formatRub(data.month.rub);
        document.getElementById('stat-month-deals').textContent = `${data.month.deals + data.month.orders} сделок`;
        document.getElementById('stat-total-earned').textContent = formatRub(data.total.earned);
        document.getElementById('stat-total-deals').textContent = `${data.total.deals + data.total.orders} сделок`;
    } catch (e) {}
}

// ==================== ORDERS ====================
async function loadOrders() {
    try {
        const res = await fetch('/api/orders');
        let orders = await res.json();
        const filter = document.getElementById('filter-orders')?.value;
        if (filter) orders = orders.filter(o => o.status === filter);
        const activeOrders = orders.filter(o => o.status === 'active');
        const homeContainer = document.getElementById('active-orders-list');
        if (homeContainer) {
            if (!activeOrders.length) { homeContainer.innerHTML = '<div class="empty-state"><p>Нет активных ордеров</p></div>'; }
            else { homeContainer.innerHTML = activeOrders.map(o => renderOrder(o)).join(''); }
        }
        const ordersContainer = document.getElementById('orders-list');
        if (ordersContainer) {
            if (!orders.length) { ordersContainer.innerHTML = '<div class="empty-state"><p>Нет ордеров</p></div>'; }
            else { ordersContainer.innerHTML = orders.map(o => renderOrder(o)).join(''); }
        }
        activeOrders.forEach(o => startOrderTimer(o));
    } catch (e) {}
}

function renderOrder(o) {
    const isActive = o.status === 'active';
    const timerHtml = isActive ? `<div class="order-timer" id="timer-${o.id}">Загрузка...</div>` : '';
    const actionsHtml = isActive ? `<div class="order-actions"><button class="btn btn-success btn-small" onclick="completeOrder(${o.id})">✅ Поступление успешно</button><button class="btn btn-danger btn-small" onclick="failOrder(${o.id})">❌ Не поступило</button></div>` : '';
    return `<div class="order-item"><div class="order-header"><span class="order-number">${o.order_number}</span><span class="order-status status-${o.status}">${orderStText(o.status)}</span></div><div class="order-amount">${formatRub(o.amount_rub)}</div>${timerHtml}${actionsHtml}<div class="order-date">${formatDate(o.created_at)}</div></div>`;
}

function orderStText(s) { return { active: 'Активный', completed: 'Выполнен', expired: 'Истёк', failed: 'Неуспешный' }[s] || s; }

function startOrderTimer(order) {
    if (orderTimers[order.id]) clearInterval(orderTimers[order.id]);
    const timerEl = document.getElementById(`timer-${order.id}`);
    if (!timerEl) return;
    const endsAt = new Date(order.timer_ends_at).getTime();
    orderTimers[order.id] = setInterval(() => {
        const diff = endsAt - Date.now();
        if (diff <= 0) { timerEl.textContent = '⏰ Время вышло'; timerEl.classList.add('expired'); clearInterval(orderTimers[order.id]); return; }
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        timerEl.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

async function completeOrder(id) {
    const res = await fetch(`/api/orders/${id}/complete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { showToast('Ордер выполнен!', 'success'); loadOrders(); loadStats(); } else showToast(data.error, 'error');
}

async function failOrder(id) {
    const res = await fetch(`/api/orders/${id}/fail`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { showToast('Ордер отмечен как неуспешный', 'error'); loadOrders(); } else showToast(data.error, 'error');
}

// ==================== APPEALS ====================
async function loadAppeals() {
    try {
        const res = await fetch('/api/appeals');
        const appeals = await res.json();
        const container = document.getElementById('appeals-list');
        if (!container) return;
        if (!appeals.length) { container.innerHTML = '<div class="empty-state"><p>Нет апелляций</p></div>'; return; }
        container.innerHTML = appeals.map(a => `<div class="order-item"><div class="order-header"><span class="order-number">${a.appeal_number}</span><span class="order-status status-${a.status}">${appealStText(a.status)}</span></div><div class="order-amount">${formatRub(a.amount_rub)}</div>${a.order_number ? `<div style="font-size:13px;color:var(--gray-500);">Ордер: ${a.order_number}</div>` : ''}${a.description ? `<div style="font-size:13px;color:var(--gray-600);margin-top:8px;">${a.description}</div>` : ''}<div class="order-date">${formatDate(a.created_at)}</div></div>`).join('');
    } catch (e) {}
}

function appealStText(s) { return { pending: 'На рассмотрении', resolved: 'Решена', rejected: 'Отклонена' }[s] || s; }

// ==================== DEPOSITS ====================
function calcPreview() {
    const amount = parseFloat(document.getElementById('amount-usdt').value) || 0;
    const preview = document.getElementById('exchange-preview');
    if (amount > 0) {
        preview.style.display = 'block';
        fetch('/api/exchange/rate').then(r => r.json()).then(data => {
            document.getElementById('preview-rub').textContent = formatRub(amount * parseFloat(data.final_rate));
            document.getElementById('preview-earned').textContent = `+${formatRub(amount * parseFloat(data.base_rate) * (parseFloat(data.markup_percent) / 100))}`;
        });
    } else { preview.style.display = 'none'; }
}

async function createDeposit() {
    const amount = parseFloat(document.getElementById('amount-usdt').value);
    const network = document.getElementById('deposit-network').value;
    if (!amount || amount < 20) return showToast('Минимум 20 USDT', 'error');
    const net = networks.find(n => n.id === network);
    if (!net) return showToast('Выберите сеть', 'error');
    currentDeposit = { amount_usdt: amount, network, wallet: net.wallet };
    document.getElementById('wallet-address').textContent = net.wallet;
    document.getElementById('send-amount').textContent = `${amount} USDT`;
    const data = await (await fetch('/api/exchange/rate')).json();
    document.getElementById('receive-amount').textContent = formatRub(amount * parseFloat(data.final_rate));
    document.getElementById('earn-amount').textContent = `+${formatRub(amount * parseFloat(data.base_rate) * (parseFloat(data.markup_percent) / 100))}`;
    document.getElementById('send-section').style.display = 'block';
}

function cancelDeposit() { currentDeposit = null; document.getElementById('send-section').style.display = 'none'; document.getElementById('amount-usdt').value = ''; document.getElementById('tx-hash').value = ''; document.getElementById('exchange-preview').style.display = 'none'; }

async function confirmDeposit() {
    if (!currentDeposit) return;
    const txHash = document.getElementById('tx-hash').value;
    if (!txHash || txHash.length < 10) return showToast('Введите хеш транзакции', 'error');
    try {
        const res = await fetch('/api/deposit/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount_usdt: currentDeposit.amount_usdt, network: currentDeposit.network, tx_hash: txHash }) });
        const data = await res.json();
        if (data.success) { showToast('Заявка отправлена!', 'success'); cancelDeposit(); loadDeposits(); } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

function copyAddress() { navigator.clipboard.writeText(document.getElementById('wallet-address').textContent).then(() => showToast('Скопировано!', 'success')); }

async function loadDeposits() {
    try {
        const res = await fetch('/api/deposits');
        const list = await res.json();
        const container = document.getElementById('deposits-list');
        if (!container) return;
        if (!list.length) { container.innerHTML = '<div class="empty-state"><p>Нет депозитов</p></div>'; return; }
        container.innerHTML = list.map(d => `<div class="order-item"><div class="order-header"><span class="order-number">${d.network}</span><span class="order-status status-${d.status}">${depStText(d.status)}</span></div><div class="order-amount">${d.amount_usdt} USDT → ${formatRub(d.amount_rub)}</div><div style="font-size:13px;color:var(--gray-500);">Заработок: +${formatRub(d.earned_rub)}</div>${d.tx_hash ? `<div style="font-size:11px;color:var(--gray-400);word-break:break-all;">TX: ${d.tx_hash}</div>` : ''}<div class="order-date">${formatDate(d.created_at)}</div></div>`).join('');
    } catch (e) {}
}

function depStText(s) { return { pending: 'Ожидает', confirmed: 'Подтверждён', rejected: 'Отклонён' }[s] || s; }

// ==================== WITHDRAWALS ====================
async function createWithdrawal() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const requisiteId = document.getElementById('withdraw-requisite').value;
    if (!amount || amount < 1000) return showToast('Минимум 1000 ₽', 'error');
    if (!requisiteId) return showToast('Выберите реквизиты', 'error');
    try {
        const res = await fetch('/api/withdrawal/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount_rub: amount, requisite_id: requisiteId }) });
        const data = await res.json();
        if (data.success) { showToast('Заявка создана!', 'success'); document.getElementById('withdraw-amount').value = ''; loadStats(); updateUserUI(); } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

// ==================== REQUISITES ====================
async function saveRequisite() {
    const name = document.getElementById('req-name').value;
    const phone = document.getElementById('req-phone').value;
    const bank = document.getElementById('req-bank').value;
    if (!name || !phone || !bank) return showToast('Заполните все поля', 'error');
    try {
        const res = await fetch('/api/requisites/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, bank }) });
        const data = await res.json();
        if (data.success) { showToast('Реквизит добавлен!', 'success'); document.getElementById('req-name').value = ''; document.getElementById('req-phone').value = ''; document.getElementById('req-bank').value = ''; loadRequisites(); } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

async function loadRequisites() {
    try {
        const res = await fetch('/api/requisites');
        const list = await res.json();
        const container = document.getElementById('requisites-list');
        const select = document.getElementById('withdraw-requisite');
        if (container) {
            if (!list.length) { container.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">Нет реквизитов</p>'; }
            else {
                container.innerHTML = list.map(r => `<div style="padding:12px;background:${r.is_active ? '#d1fae5' : 'var(--gray-50)'};border-radius:8px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;border:1px solid ${r.is_active ? '#86efac' : 'var(--gray-200)'};"><div><div style="font-weight:600;">${r.bank}</div><div style="font-size:13px;color:var(--gray-500);">${r.name} | ${r.phone}</div>${r.is_active ? '<span style="font-size:11px;color:#065f46;font-weight:600;">🟢 Активен</span>' : ''}</div><div style="display:flex;gap:8px;">${r.is_active ? `<button class="btn btn-small btn-danger" onclick="deactivateReq(${r.id})">Выключить</button>` : `<button class="btn btn-small btn-success" onclick="activateReq(${r.id})">Включить</button>`}<button class="btn btn-small" onclick="deleteReq(${r.id})">✕</button></div></div>`).join('');
            }
        }
        if (select) select.innerHTML = '<option value="">Выберите реквизит</option>' + list.map(r => `<option value="${r.id}">${r.bank} - ${r.name} (${r.phone})</option>`).join('');
    } catch (e) {}
}

async function activateReq(id) { await fetch(`/api/requisites/${id}/activate`, { method: 'POST' }); showToast('Активирован!', 'success'); loadRequisites(); }
async function deactivateReq(id) { await fetch(`/api/requisites/${id}/deactivate`, { method: 'POST' }); showToast('Деактивирован', 'success'); loadRequisites(); }
async function deleteReq(id) { await fetch(`/api/requisites/${id}/delete`, { method: 'POST' }); loadRequisites(); }

// ==================== NOTIFICATIONS ====================
async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications');
        const data = await res.json();
        const container = document.getElementById('notifications-list');
        if (!container) return;
        if (!data.notifications.length) { container.innerHTML = '<div class="empty-state"><p>Нет уведомлений</p></div>'; return; }
        container.innerHTML = data.notifications.map(n => `<div class="notification-item ${n.is_read ? '' : 'unread'} ${n.type || ''}">${n.message}<div class="notification-date">${formatDate(n.created_at)}</div></div>`).join('');
    } catch (e) {}
}

async function markNotificationsRead() { await fetch('/api/notifications/read', { method: 'POST' }); loadNotifications(); }

// ==================== VERIFICATION ====================
async function loadVerificationStatus() {
    try {
        const res = await fetch('/api/verification/status');
        const data = await res.json();
        const statusEl = document.getElementById('verification-status');
        const formEl = document.getElementById('verification-form');
        if (data.status === 'approved') {
            statusEl.innerHTML = '<div style="padding:16px;background:#d1fae5;border-radius:12px;color:#065f46;font-weight:600;">✅ Верификация пройдена!</div>';
            formEl.style.display = 'none';
        } else if (data.status === 'pending') {
            statusEl.innerHTML = '<div style="padding:16px;background:#fef3c7;border-radius:12px;color:#92400e;font-weight:600;">⏳ Заявка на рассмотрении</div>';
            formEl.style.display = 'none';
        } else if (data.status === 'rejected') {
            statusEl.innerHTML = `<div style="padding:16px;background:#fee2e2;border-radius:12px;color:#991b1b;font-weight:600;">❌ Отклонено${data.admin_comment ? ': ' + data.admin_comment : ''}</div>`;
            formEl.style.display = 'block';
        } else {
            statusEl.innerHTML = '';
            formEl.style.display = 'block';
        }
    } catch (e) {}
}

async function submitVerification() {
    const selfie = document.getElementById('v-selfie').value;
    const passport = document.getElementById('v-passport').value;
    const registration = document.getElementById('v-registration').value;
    const phone = document.getElementById('v-phone').value;
    const telegram = document.getElementById('v-telegram').value;
    const social = document.getElementById('v-social').value;
    if (!selfie || !passport || !phone) return showToast('Заполните обязательные поля', 'error');
    try {
        const res = await fetch('/api/verification/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selfie_url: selfie, passport_photo_url: passport, passport_registration_url: registration, phone, telegram_link: telegram, social_links: social })
        });
        const data = await res.json();
        if (data.success) { showToast('Заявка отправлена!', 'success'); loadVerificationStatus(); checkVerificationBanner(); }
        else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

// ==================== PROFILE ====================
async function changeUsername() {
    const newLogin = document.getElementById('new-login').value;
    if (!newLogin || newLogin.length < 3) return showToast('Логин минимум 3 символа', 'error');
    const res = await fetch('/api/user/change-username', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_username: newLogin }) });
    const data = await res.json();
    if (data.success) { showToast('Логин изменён!', 'success'); currentUser.username = newLogin; updateUserUI(); document.getElementById('new-login').value = ''; }
    else showToast(data.error, 'error');
}

async function changePassword() {
    const curr = document.getElementById('current-pass').value, newP = document.getElementById('new-pass').value;
    if (!curr || !newP) return showToast('Заполните поля', 'error');
    const res = await fetch('/api/user/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: curr, new_password: newP }) });
    const data = await res.json();
    if (data.success) { showToast('Пароль изменён!', 'success'); document.getElementById('current-pass').value = ''; document.getElementById('new-pass').value = ''; }
    else showToast(data.error, 'error');
}

async function setup2FA() {
    const res = await fetch('/api/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (data.success) { document.getElementById('qr-code').src = data.qr_code; document.getElementById('secret-key').textContent = data.secret; document.getElementById('2fa-setup').style.display = 'block'; }
}

async function verify2FA() {
    const code = document.getElementById('totp-code').value;
    if (!code || code.length !== 6) return showToast('Введите 6-значный код', 'error');
    const res = await fetch('/api/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (data.success) { showToast('2FA подключена!', 'success'); currentUser.totp_enabled = true; updateUserUI(); document.getElementById('2fa-setup').style.display = 'none'; }
    else showToast(data.error, 'error');
}

async function disable2FA() {
    const code = prompt('Введите код из аутентификатора:');
    if (!code) return;
    const res = await fetch('/api/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (data.success) { showToast('2FA отключена', 'success'); currentUser.totp_enabled = false; updateUserUI(); }
    else showToast(data.error, 'error');
}

// ==================== UTILS ====================
function formatRub(a) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0); }
function formatDate(d) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); }
function showToast(msg, type = 'info') { const t = document.getElementById('toast'); t.textContent = msg; t.className = `toast ${type}`; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3000); }
