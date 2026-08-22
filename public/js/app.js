let currentUser = null;
let currentDeposit = null;
let networks = [];
let orderTimers = {};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', (e) => { e.preventDefault(); showPage(item.dataset.page); }));
    document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('btn-online').addEventListener('click', toggleOnline);
    document.getElementById('btn-deposit').addEventListener('click', createDeposit);
    document.getElementById('btn-confirm-deposit').addEventListener('click', confirmDeposit);
    document.getElementById('btn-cancel-deposit').addEventListener('click', cancelDeposit);
    document.getElementById('btn-copy').addEventListener('click', copyAddress);
    document.getElementById('amount-usdt').addEventListener('input', calcPreview);
    document.getElementById('deposit-network').addEventListener('change', updateCoinSuffix);
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

async function doLogout() { await fetch('/api/logout', { method: 'POST' }); currentUser = null; location.reload(); }

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    
    const needsVerification = !currentUser.is_verified;
    const needsPasswordChange = !currentUser.password_changed;
    const needsUsernameChange = !currentUser.username_changed;
    const needs2FA = !currentUser.totp_enabled;
    
    if (needsVerification || needsPasswordChange || needsUsernameChange || needs2FA) {
        showSetupWizard();
    } else {
        showDashboard();
    }
}

function showSetupWizard() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    let setupPage = document.getElementById('page-setup');
    if (!setupPage) {
        setupPage = document.createElement('div');
        setupPage.id = 'page-setup';
        setupPage.className = 'page active';
        setupPage.innerHTML = `
            <div class="card">
                <h2 class="card-title">🎉 Добро пожаловать в CryptoSwaap!</h2>
                <p style="color:var(--gray-600);margin-bottom:20px;">Для начала работы выполните следующие шаги:</p>
                
                <div id="setup-steps">
                    <div class="setup-step" id="step-verification" style="padding:16px;background:var(--gray-50);border-radius:12px;margin-bottom:12px;border:1px solid var(--gray-200);">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <strong>📋 Шаг 1: Верификация</strong>
                                <p style="font-size:13px;color:var(--gray-500);margin-top:4px;">Пройдите верификацию личности</p>
                            </div>
                            <span id="step-verification-status">⏳</span>
                        </div>
                        <div id="step-verification-form" style="margin-top:16px;">
                            <div class="form-group"><label>Селфи с паспортом (URL)</label><input type="text" id="setup-v-selfie" placeholder="Ссылка на фото"></div>
                            <div class="form-group"><label>Фото паспорта (URL)</label><input type="text" id="setup-v-passport" placeholder="Ссылка на фото"></div>
                            <div class="form-group"><label>Фото регистрации (URL)</label><input type="text" id="setup-v-registration" placeholder="Ссылка на фото"></div>
                            <div class="form-group"><label>Телефон</label><input type="tel" id="setup-v-phone" placeholder="+7 (999) 123-45-67"></div>
                            <div class="form-group"><label>Telegram</label><input type="text" id="setup-v-telegram" placeholder="@username"></div>
                            <div class="form-group"><label>Соцсети</label><input type="text" id="setup-v-social" placeholder="Ссылки через запятую"></div>
                            <button class="btn btn-primary btn-full" id="btn-setup-submit-verification">Отправить на проверку</button>
                        </div>
                        <div id="step-verification-pending" style="display:none;padding:16px;background:#fef3c7;border-radius:8px;color:#92400e;font-weight:600;text-align:center;">
                            ⏳ Заявка на рассмотрении. Ожидайте подтверждения администратора.
                        </div>
                    </div>
                    
                    <div class="setup-step" id="step-password" style="padding:16px;background:var(--gray-50);border-radius:12px;margin-bottom:12px;border:1px solid var(--gray-200);opacity:0.5;pointer-events:none;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <strong>🔑 Шаг 2: Смена пароля</strong>
                                <p style="font-size:13px;color:var(--gray-500);margin-top:4px;">Обязательно смените пароль</p>
                            </div>
                            <span id="step-password-status">🔒</span>
                        </div>
                        <div id="step-password-form" style="margin-top:16px;">
                            <div class="form-group"><label>Текущий пароль</label><input type="password" id="setup-current-pass" placeholder="Пароль от админа"></div>
                            <div class="form-group"><label>Новый пароль</label><input type="password" id="setup-new-pass" placeholder="Придумайте новый пароль"></div>
                            <button class="btn btn-primary btn-full" id="btn-setup-change-password">Сменить пароль</button>
                        </div>
                    </div>
                    
                    <div class="setup-step" id="step-username" style="padding:16px;background:var(--gray-50);border-radius:12px;margin-bottom:12px;border:1px solid var(--gray-200);opacity:0.5;pointer-events:none;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <strong>👤 Шаг 3: Смена логина</strong>
                                <p style="font-size:13px;color:var(--gray-500);margin-top:4px;">Обязательно смените логин</p>
                            </div>
                            <span id="step-username-status">🔒</span>
                        </div>
                        <div id="step-username-form" style="margin-top:16px;">
                            <div class="form-group"><label>Новый логин</label><input type="text" id="setup-new-username" placeholder="Придумайте новый логин"></div>
                            <button class="btn btn-primary btn-full" id="btn-setup-change-username">Сменить логин</button>
                        </div>
                    </div>
                    
                    <div class="setup-step" id="step-2fa" style="padding:16px;background:var(--gray-50);border-radius:12px;margin-bottom:12px;border:1px solid var(--gray-200);opacity:0.5;pointer-events:none;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <strong>🔐 Шаг 4: Двухфакторная аутентификация</strong>
                                <p style="font-size:13px;color:var(--gray-500);margin-top:4px;">Обязательно подключите 2FA</p>
                            </div>
                            <span id="step-2fa-status">🔒</span>
                        </div>
                        <div id="step-2fa-form" style="margin-top:16px;">
                            <div class="qr-container"><img id="setup-qr-code" src="" alt="QR"></div>
                            <div class="secret-key"><label>Ключ:</label><code id="setup-secret-key">--</code></div>
                            <div class="form-group"><input type="text" id="setup-totp-code" placeholder="Код из приложения" maxlength="6"></div>
                            <button class="btn btn-primary btn-full" id="btn-setup-verify-2fa">Подключить 2FA</button>
                        </div>
                    </div>
                </div>
                
                <div id="setup-complete" style="display:none;padding:20px;background:#d1fae5;border-radius:12px;text-align:center;">
                    <h3 style="color:#065f46;margin-bottom:8px;">✅ Всё готово!</h3>
                    <p style="color:#065f46;">Теперь вы можете полноценно пользоваться сервисом</p>
                    <button class="btn btn-primary" style="margin-top:16px;" onclick="showDashboard()">Перейти в кабинет</button>
                </div>
            </div>
        `;
        document.querySelector('.content').appendChild(setupPage);
        
        document.getElementById('btn-setup-submit-verification').addEventListener('click', setupSubmitVerification);
        document.getElementById('btn-setup-change-password').addEventListener('click', setupChangePassword);
        document.getElementById('btn-setup-change-username').addEventListener('click', setupChangeUsername);
        document.getElementById('btn-setup-verify-2fa').addEventListener('click', setupVerify2FA);
    }
    
    updateSetupSteps();
}

function updateSetupSteps() {
    let allComplete = true;
    
    if (currentUser.is_verified) {
        document.getElementById('step-verification-status').textContent = '✅';
        document.getElementById('step-verification-form').style.display = 'none';
        document.getElementById('step-verification-pending').style.display = 'none';
        document.getElementById('step-verification').style.opacity = '1';
        document.getElementById('step-verification').style.pointerEvents = 'auto';
    } else if (currentUser.verification_status === 'pending') {
        document.getElementById('step-verification-status').textContent = '⏳';
        document.getElementById('step-verification-form').style.display = 'none';
        document.getElementById('step-verification-pending').style.display = 'block';
        document.getElementById('step-verification').style.opacity = '1';
        document.getElementById('step-verification').style.pointerEvents = 'auto';
        allComplete = false;
    } else {
        document.getElementById('step-verification-status').textContent = '❌';
        document.getElementById('step-verification-form').style.display = 'block';
        document.getElementById('step-verification-pending').style.display = 'none';
        document.getElementById('step-verification').style.opacity = '1';
        document.getElementById('step-verification').style.pointerEvents = 'auto';
        allComplete = false;
    }
    
    if (currentUser.password_changed) {
        document.getElementById('step-password-status').textContent = '✅';
        document.getElementById('step-password-form').style.display = 'none';
        document.getElementById('step-password').style.opacity = '1';
        document.getElementById('step-password').style.pointerEvents = 'auto';
    } else {
        document.getElementById('step-password-status').textContent = '❌';
        document.getElementById('step-password-form').style.display = 'block';
        if (currentUser.is_verified) {
            document.getElementById('step-password').style.opacity = '1';
            document.getElementById('step-password').style.pointerEvents = 'auto';
        }
        allComplete = false;
    }
    
    if (currentUser.username_changed) {
        document.getElementById('step-username-status').textContent = '✅';
        document.getElementById('step-username-form').style.display = 'none';
        document.getElementById('step-username').style.opacity = '1';
        document.getElementById('step-username').style.pointerEvents = 'auto';
    } else {
        document.getElementById('step-username-status').textContent = '❌';
        document.getElementById('step-username-form').style.display = 'block';
        if (currentUser.password_changed) {
            document.getElementById('step-username').style.opacity = '1';
            document.getElementById('step-username').style.pointerEvents = 'auto';
        }
        allComplete = false;
    }
    
    if (currentUser.totp_enabled) {
        document.getElementById('step-2fa-status').textContent = '✅';
        document.getElementById('step-2fa-form').style.display = 'none';
        document.getElementById('step-2fa').style.opacity = '1';
        document.getElementById('step-2fa').style.pointerEvents = 'auto';
    } else {
        document.getElementById('step-2fa-status').textContent = '❌';
        document.getElementById('step-2fa-form').style.display = 'block';
        if (currentUser.username_changed) {
            document.getElementById('step-2fa').style.opacity = '1';
            document.getElementById('step-2fa').style.pointerEvents = 'auto';
            loadSetup2FA();
        }
        allComplete = false;
    }
    
    if (allComplete) {
        document.getElementById('setup-complete').style.display = 'block';
    }
}

async function setupSubmitVerification() {
    const selfie = document.getElementById('setup-v-selfie').value;
    const passport = document.getElementById('setup-v-passport').value;
    const registration = document.getElementById('setup-v-registration').value;
    const phone = document.getElementById('setup-v-phone').value;
    const telegram = document.getElementById('setup-v-telegram').value;
    const social = document.getElementById('setup-v-social').value;
    if (!selfie || !passport || !phone) return showToast('Заполните обязательные поля', 'error');
    try {
        const res = await fetch('/api/verification/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selfie_url: selfie, passport_photo_url: passport, passport_registration_url: registration, phone, telegram_link: telegram, social_links: social })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Заявка отправлена!', 'success');
            currentUser.verification_status = 'pending';
            updateSetupSteps();
        } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

async function setupChangePassword() {
    const curr = document.getElementById('setup-current-pass').value;
    const newP = document.getElementById('setup-new-pass').value;
    if (!curr || !newP) return showToast('Заполните поля', 'error');
    if (newP.length < 6) return showToast('Пароль минимум 6 символов', 'error');
    const res = await fetch('/api/user/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: curr, new_password: newP }) });
    const data = await res.json();
    if (data.success) {
        showToast('Пароль изменён!', 'success');
        currentUser.password_changed = true;
        updateSetupSteps();
    } else showToast(data.error, 'error');
}

async function setupChangeUsername() {
    const newLogin = document.getElementById('setup-new-username').value;
    if (!newLogin || newLogin.length < 3) return showToast('Логин минимум 3 символа', 'error');
    const res = await fetch('/api/user/change-username', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_username: newLogin }) });
    const data = await res.json();
    if (data.success) {
        showToast('Логин изменён!', 'success');
        currentUser.username = newLogin;
        currentUser.username_changed = true;
        updateSetupSteps();
    } else showToast(data.error, 'error');
}

async function loadSetup2FA() {
    try {
        const res = await fetch('/api/2fa/setup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            document.getElementById('setup-qr-code').src = data.qr_code;
            document.getElementById('setup-secret-key').textContent = data.secret;
        }
    } catch (e) {}
}

async function setupVerify2FA() {
    const code = document.getElementById('setup-totp-code').value;
    if (!code || code.length !== 6) return showToast('Введите 6-значный код', 'error');
    const res = await fetch('/api/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (data.success) {
        showToast('2FA подключена!', 'success');
        currentUser.totp_enabled = true;
        updateSetupSteps();
    } else showToast(data.error, 'error');
}

function showDashboard() {
    updateUserUI();
    loadRate();
    loadStats();
    loadOrders();
    loadAppeals();
    loadDeposits();
    loadWithdrawals();
    loadRequisites();
    loadNotifications();
    updateOnlineButton();
}

function showPage(page) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    const titles = { home: 'Главная', orders: 'Ордера', appeals: 'Апелляции', balance: 'Баланс', withdraw: 'Вывод', requisites: 'Реквизиты', notifications: 'Уведомления', profile: 'Профиль' };
    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('sidebar').classList.remove('open');
    if (page === 'home') { loadStats(); loadOrders(); }
    if (page === 'orders') loadOrders();
    if (page === 'appeals') loadAppeals();
    if (page === 'balance') { loadDeposits(); loadRate(); }
    if (page === 'withdraw') { loadWithdrawals(); loadRequisites(); }
    if (page === 'requisites') loadRequisites();
    if (page === 'notifications') loadNotifications();
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('user-balance-header').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('welcome-name').textContent = currentUser.username;
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = `ID: ${currentUser.internal_id || '—'}`;
    document.getElementById('balance-value').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('withdraw-balance').textContent = formatRub(currentUser.balance_rub);
    const s = document.getElementById('2fa-status'), b = document.getElementById('btn-2fa');
    if (currentUser.totp_enabled) { s.textContent = 'Подключена ✓'; s.classList.add('active'); b.textContent = 'Отключить'; b.onclick = () => disable2FA(); }
    else { s.textContent = 'Не подключена'; s.classList.remove('active'); b.textContent = 'Настроить'; b.onclick = () => setup2FA(); }
}

function updateOnlineButton() {
    const btn = document.getElementById('btn-online');
    if (currentUser?.is_online) { btn.textContent = '🟢 Онлайн'; btn.className = 'btn-online online'; }
    else { btn.textContent = '🔴 Офлайн'; btn.className = 'btn-online offline'; }
}

async function toggleOnline() {
    const res = await fetch('/api/user/toggle-online', { method: 'POST' });
    const data = await res.json();
    if (data.success) { currentUser.is_online = data.is_online; updateOnlineButton(); showToast(data.is_online ? 'Вы онлайн!' : 'Вы офлайн', 'success'); }
}

async function loadRate() {
    try {
        const res = await fetch('/api/exchange/rate');
        const data = await res.json();
        networks = data.networks || [];
        const select = document.getElementById('deposit-network');
        if (select) select.innerHTML = networks.map(n => `<option value="${n.id}" data-coin="${n.coin || 'USDT'}">${n.name}</option>`).join('');
        updateCoinSuffix();
    } catch (e) {}
}

function updateCoinSuffix() {
    const select = document.getElementById('deposit-network');
    const option = select?.selectedOptions[0];
    const coin = option?.dataset?.coin || 'USDT';
    document.getElementById('coin-suffix').textContent = coin;
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
            if (!activeOrders.length) homeContainer.innerHTML = '<div class="empty-state"><p>Нет активных ордеров</p></div>';
            else homeContainer.innerHTML = activeOrders.map(o => renderOrder(o)).join('');
        }
        const ordersContainer = document.getElementById('orders-list');
        if (ordersContainer) {
            if (!orders.length) ordersContainer.innerHTML = '<div class="empty-state"><p>Нет ордеров</p></div>';
            else ordersContainer.innerHTML = orders.map(o => renderOrder(o)).join('');
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
    const option = document.getElementById('deposit-network').selectedOptions[0];
    const coin = option?.dataset?.coin || 'USDT';
    if (!amount || amount < 20) return showToast('Минимум 20', 'error');
    const net = networks.find(n => n.id === network);
    if (!net) return showToast('Выберите сеть', 'error');
    currentDeposit = { amount_usdt: amount, network, coin, wallet: net.wallet };
    document.getElementById('wallet-address').textContent = net.wallet;
    document.getElementById('send-amount').textContent = `${amount} ${coin}`;
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
        const res = await fetch('/api/deposit/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount_usdt: currentDeposit.amount_usdt, network: currentDeposit.network, coin: currentDeposit.coin, tx_hash: txHash }) });
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
        if (!list.length) { container.innerHTML = '<div class="empty-state"><p>Нет пополнений</p></div>'; return; }
        container.innerHTML = list.map(d => `<div class="order-item"><div class="order-header"><span class="order-number">${d.network} (${d.coin || 'USDT'})</span><span class="order-status status-${d.status}">${depStText(d.status)}</span></div><div class="order-amount">${d.amount_usdt} → ${formatRub(d.amount_rub)}</div><div style="font-size:13px;color:var(--gray-500);">Заработок: +${formatRub(d.earned_rub)}</div>${d.tx_hash ? `<div style="font-size:11px;color:var(--gray-400);word-break:break-all;">TX: ${d.tx_hash}</div>` : ''}<div class="order-date">${formatDate(d.created_at)}</div></div>`).join('');
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
        if (data.success) { showToast('Заявка создана!', 'success'); document.getElementById('withdraw-amount').value = ''; loadStats(); updateUserUI(); loadWithdrawals(); } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

async function loadWithdrawals() {
    try {
        const res = await fetch('/api/withdrawals');
        const list = await res.json();
        const container = document.getElementById('withdrawals-list');
        if (!container) return;
        if (!list.length) { container.innerHTML = '<div class="empty-state"><p>Нет выводов</p></div>'; return; }
        container.innerHTML = list.map(w => `<div class="order-item"><div class="order-header"><span class="order-number">${w.bank || '—'}</span><span class="order-status status-${w.status}">${w.status === 'completed' ? 'Выполнен' : w.status === 'pending' ? 'Ожидает' : 'Отклонён'}</span></div><div class="order-amount">${formatRub(w.amount_rub)}</div><div style="font-size:13px;color:var(--gray-500);">${w.name || '—'} | ${w.phone || '—'}</div><div class="order-date">${formatDate(w.created_at)}</div></div>`).join('');
    } catch (e) {}
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
            if (!list.length) container.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">Нет реквизитов</p>';
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
