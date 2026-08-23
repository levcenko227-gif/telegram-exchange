/* ==========================================================================
   blueberry — Client Core JS
   Human-crafted interactive logic with full server API & SSE integration
   ========================================================================== */

let currentUser = null;
let currentDeposit = null;
let networks = [];
let orderTimers = {};
let withdrawalTimers = {};
let autoRefreshInterval = null;
let eventSource = null;

document.addEventListener('DOMContentLoaded', () => {
    // ——— DOM Event Listeners ———
    document.getElementById('btn-login')?.addEventListener('click', handleLogin);
    document.getElementById('btn-logout')?.addEventListener('click', doLogout);
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => { 
            e.preventDefault(); 
            showPage(item.dataset.page); 
        });
    });

    document.getElementById('btn-menu')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('open');
    });

    document.getElementById('btn-online')?.addEventListener('click', toggleOnline);
    document.getElementById('btn-deposit')?.addEventListener('click', createDeposit);
    document.getElementById('btn-confirm-deposit')?.addEventListener('click', confirmDeposit);
    document.getElementById('btn-cancel-deposit')?.addEventListener('click', cancelDeposit);
    document.getElementById('btn-copy')?.addEventListener('click', copyAddress);
    document.getElementById('amount-usdt')?.addEventListener('input', calcPreview);
    document.getElementById('deposit-network')?.addEventListener('change', updateCoinSuffix);
    document.getElementById('btn-withdraw')?.addEventListener('click', createWithdrawal);
    document.getElementById('btn-save-req')?.addEventListener('click', saveRequisite);
    document.getElementById('btn-mark-read')?.addEventListener('click', markNotificationsRead);
    document.getElementById('btn-change-pass')?.addEventListener('click', changePassword);
    document.getElementById('btn-2fa')?.addEventListener('click', setup2FA);
    document.getElementById('btn-verify-2fa')?.addEventListener('click', verify2FA);
    
    // Setup Wizard Steps
    document.getElementById('btn-setup-submit-verification')?.addEventListener('click', setupSubmitVerification);
    document.getElementById('btn-setup-change-password')?.addEventListener('click', setupChangePassword);
    document.getElementById('btn-setup-verify-2fa')?.addEventListener('click', setupVerify2FA);
    
    document.getElementById('filter-orders')?.addEventListener('change', loadOrders);

    // Initializations
    initTheme();
    initClock();
    checkSession();
});

// ——— SESSION CHECK ———
async function checkSession() {
    try {
        const res = await fetch('/api/user/profile');
        if (res.ok) { 
            currentUser = await res.json(); 
            showApp(); 
        }
    } catch (e) {
        console.error("Session check failed, waiting for login.");
    }
}

// ——— LOGIN FLOW ———
async function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const totp = document.getElementById('login-totp').value.trim();
    const errEl = document.getElementById('login-error');
    
    if (!username || !password) { 
        showError(errEl, 'Введите логин и пароль'); 
        return; 
    }
    
    try {
        const res = await fetch('/api/login', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ username, password, totp_code: totp }) 
        });
        const data = await res.json();
        
        if (data.requires_2fa) { 
            document.getElementById('login-2fa-group').style.display = 'block'; 
            errEl.style.display = 'none'; 
            showToast('Введите 2FA код', 'info');
            return; 
        }
        
        if (data.success) { 
            currentUser = data.user; 
            showApp(); 
        } else { 
            showError(errEl, data.error || 'Неверный логин или пароль'); 
        }
    } catch (e) { 
        showError(errEl, 'Ошибка подключения к серверу'); 
    }
}

async function doLogout() { 
    await fetch('/api/logout', { method: 'POST' }); 
    currentUser = null; 
    location.reload(); 
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    const mainApp = document.getElementById('main-app');
    mainApp.classList.remove('hidden');
    mainApp.style.display = 'flex';
    
    const needsPasswordChange = !currentUser.password_changed;
    const needs2FA = !currentUser.totp_enabled;
    const needsVerification = !currentUser.is_verified;
    
    if (needsPasswordChange || needs2FA || needsVerification) {
        showSetupWizard();
    } else {
        showDashboard();
    }
    lucide.createIcons();
}

// ——— SETUP WIZARD ———
function showSetupWizard() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    const pageSetup = document.getElementById('page-setup');
    pageSetup.style.display = 'block';
    pageSetup.classList.add('active');
    
    document.getElementById('page-title').textContent = 'Настройка Blueberry';
    updateSetupSteps();
}

function updateSetupSteps() {
    let allComplete = true;
    
    // Шаг 1: Верификация
    const stepVer = document.getElementById('step-verification');
    const stepVerStatus = document.getElementById('step-verification-status');
    const stepVerForm = document.getElementById('step-verification-form');
    const stepVerPending = document.getElementById('step-verification-pending');
    
    if (stepVer) {
        if (currentUser.is_verified) {
            stepVerStatus.textContent = '✅';
            if (stepVerForm) stepVerForm.style.display = 'none';
            if (stepVerPending) stepVerPending.style.display = 'none';
            stepVer.classList.add('completed');
            stepVer.classList.remove('locked');
        } else if (currentUser.verification_status === 'pending') {
            stepVerStatus.textContent = '⏳';
            if (stepVerForm) stepVerForm.style.display = 'none';
            if (stepVerPending) stepVerPending.style.display = 'block';
            allComplete = false;
        } else {
            stepVerStatus.textContent = '❌';
            if (stepVerForm) stepVerForm.style.display = 'block';
            stepVer.classList.remove('locked');
            allComplete = false;
        }
    }

    // Шаг 2: Смена пароля
    const stepPass = document.getElementById('step-password');
    const stepPassStatus = document.getElementById('step-password-status');
    const stepPassForm = document.getElementById('step-password-form');
    
    if (currentUser.password_changed) {
        stepPassStatus.textContent = '✅';
        if (stepPassForm) stepPassForm.style.display = 'none';
        stepPass.classList.add('completed');
        stepPass.classList.remove('locked');
    } else {
        stepPassStatus.textContent = '❌';
        if (stepPassForm) stepPassForm.style.display = 'block';
        stepPass.classList.remove('locked');
        allComplete = false;
    }

    // Шаг 3: 2FA
    const step2FA = document.getElementById('step-2fa');
    const step2FAStatus = document.getElementById('step-2fa-status');
    const step2FAForm = document.getElementById('step-2fa-form');
    
    if (currentUser.totp_enabled) {
        step2FAStatus.textContent = '✅';
        if (step2FAForm) step2FAForm.style.display = 'none';
        step2FA.classList.add('completed');
        step2FA.classList.remove('locked');
    } else {
        step2FAStatus.textContent = '🔒';
        if (step2FAForm) step2FAForm.style.display = 'block';
        if (currentUser.password_changed) {
            step2FA.classList.remove('locked');
            loadSetup2FA();
        } else {
            step2FA.classList.add('locked');
            step2FAForm.style.display = 'none';
        }
        allComplete = false;
    }

    if (allComplete) {
        document.getElementById('setup-steps').style.display = 'none';
        document.getElementById('setup-complete').style.display = 'block';
    }
}

async function setupSubmitVerification() {
    const selfieFile = document.getElementById('setup-v-selfie')?.files[0];
    const passportFile = document.getElementById('setup-v-passport')?.files[0];
    const registrationFile = document.getElementById('setup-v-registration')?.files[0];
    const phone = document.getElementById('setup-v-phone')?.value;
    const telegram = document.getElementById('setup-v-telegram')?.value;
    const social = document.getElementById('setup-v-social')?.value;
    
    if (!selfieFile || !passportFile || !phone) return showToast('Загрузите фото документов и укажите телефон', 'error');
    
    const selfieBase64 = await fileToBase64(selfieFile);
    const passportBase64 = await fileToBase64(passportFile);
    const registrationBase64 = registrationFile ? await fileToBase64(registrationFile) : '';
    
    try {
        const res = await fetch('/api/verification/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                selfie_url: selfieBase64, 
                passport_photo_url: passportBase64, 
                passport_registration_url: registrationBase64, 
                phone, 
                telegram_link: telegram, 
                social_links: social 
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Заявка на верификацию направлена!', 'success');
            currentUser.verification_status = 'pending';
            updateSetupSteps();
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) { 
        showToast('Ошибка отправки верификации', 'error'); 
    }
}

async function setupChangePassword() {
    const curr = document.getElementById('setup-current-pass').value;
    const newP = document.getElementById('setup-new-pass').value;
    if (!curr || !newP) return showToast('Заполните все поля', 'error');
    if (newP.length < 6) return showToast('Минимальная длина пароля - 6 символов', 'error');
    
    const res = await fetch('/api/user/change-password', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ current_password: curr, new_password: newP }) 
    });
    const data = await res.json();
    if (data.success) {
        showToast('Пароль обновлен успешно!', 'success');
        currentUser.password_changed = true;
        updateSetupSteps();
    } else {
        showToast(data.error, 'error');
    }
}

async function loadSetup2FA() {
    try {
        const res = await fetch('/api/2fa/setup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            document.getElementById('setup-qr-code').src = data.qr_code;
            document.getElementById('setup-secret-key').textContent = data.secret;
        }
    } catch (e) {
        console.error("2FA setup loading error", e);
    }
}

async function setupVerify2FA() {
    const code = document.getElementById('setup-totp-code').value.trim();
    if (!code || code.length !== 6) return showToast('Код должен состоять из 6 цифр', 'error');
    const res = await fetch('/api/2fa/verify', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ code }) 
    });
    const data = await res.json();
    if (data.success) {
        showToast('Blueberry 2FA Shield подключена!', 'success');
        currentUser.totp_enabled = true;
        updateSetupSteps();
    } else {
        showToast(data.error, 'error');
    }
}

// ——— DASHBOARD INTERFACES ———
function showDashboard() {
    document.getElementById('page-setup').style.display = 'none';
    document.getElementById('page-home').classList.add('active');
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
    startAutoRefresh();
    connectSSE();
}

function showPage(page) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) targetPage.classList.add('active');
    
    const titles = { 
        home: 'Главная', 
        orders: 'Ордера', 
        appeals: 'Апелляции', 
        balance: 'Баланс', 
        withdraw: 'Вывод', 
        requisites: 'Реквизиты', 
        notifications: 'Уведомления', 
        profile: 'Профиль' 
    };
    
    document.getElementById('page-title').textContent = titles[page] || page;
    document.getElementById('sidebar')?.classList.remove('open');
    
    if (page === 'home') { loadStats(); loadOrders(); }
    if (page === 'orders') loadOrders();
    if (page === 'appeals') loadAppeals();
    if (page === 'balance') { loadDeposits(); loadRate(); }
    if (page === 'withdraw') { loadWithdrawals(); loadRequisites(); }
    if (page === 'requisites') loadRequisites();
    if (page === 'notifications') loadNotifications();
    
    lucide.createIcons();
}

function updateUserUI() {
    if (!currentUser) return;
    const held = currentUser.held_rub || 0;
    const withdrawalPending = currentUser.withdrawal_pending || 0;
    const available = currentUser.balance_rub - held;
    
    document.getElementById('user-balance-header').textContent = formatRub(available);
    document.getElementById('welcome-name').textContent = currentUser.username;
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = `ID: ${currentUser.internal_id || '—'}`;
    document.getElementById('balance-value').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('withdraw-balance').textContent = formatRub(available);
    
    const heldEl = document.getElementById('held-balance-info');
    if (heldEl) {
        let info = [];
        if (held > 0) info.push(`🔒 Захолдено: ${formatRub(held)}`);
        if (withdrawalPending > 0) info.push(`📤 Осталось до вывода: ${formatRub(withdrawalPending)}`);
        if (info.length > 0) { 
            heldEl.innerHTML = info.join('<br>'); 
            heldEl.style.display = 'block'; 
        } else { 
            heldEl.style.display = 'none'; 
        }
    }
    
    const s = document.getElementById('2fa-status'), b = document.getElementById('btn-2fa');
    if (currentUser.totp_enabled) { 
        s.textContent = 'Подключена ✓'; 
        s.classList.add('active'); 
        b.textContent = 'Отключить'; 
        b.onclick = () => disable2FA(); 
    } else { 
        s.textContent = 'Не подключена'; 
        s.classList.remove('active'); 
        b.textContent = 'Настроить'; 
        b.onclick = () => setup2FA(); 
    }
    lucide.createIcons();
}

function updateOnlineButton() {
    const btn = document.getElementById('btn-online');
    if (currentUser?.is_online) { 
        btn.textContent = '🟢 Онлайн'; 
        btn.className = 'btn-online online'; 
    } else { 
        btn.textContent = '🔴 Офлайн'; 
        btn.className = 'btn-online offline'; 
    }
}

async function toggleOnline() {
    const res = await fetch('/api/user/toggle-online', { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        currentUser.is_online = data.is_online; 
        updateOnlineButton(); 
        showToast(data.is_online ? 'Вы онлайн!' : 'Вы офлайн', data.is_online ? 'success' : 'info'); 
    }
}

async function loadRate() {
    try {
        const res = await fetch('/api/exchange/rate');
        const data = await res.json();
        networks = data.networks || [];
        const select = document.getElementById('deposit-network');
        if (select) select.innerHTML = networks.map(n => `<option value="${n.id}" data-coin="${n.coin || 'USDT'}">${n.coin || 'USDT'} / ${n.id}</option>`).join('');
        updateCoinSuffix();
    } catch (e) {
        console.error("Exchange rates error", e);
    }
}

function updateCoinSuffix() {
    const select = document.getElementById('deposit-network');
    const option = select?.selectedOptions[0];
    const coin = option?.dataset?.coin || 'USDT';
    document.getElementById('coin-suffix').textContent = coin;
}

// ——— STATISTICS ———
async function loadStats() {
    try {
        const res = await fetch('/api/user/stats');
        const data = await res.json();
        
        animateElementCount('stat-today-rub', data.today.rub);
        document.getElementById('stat-today-deals').textContent = `${data.today.orders} сделок`;
        
        animateElementCount('stat-yesterday-rub', data.yesterday.rub);
        document.getElementById('stat-yesterday-deals').textContent = `${data.yesterday.orders} сделок`;
        
        animateElementCount('stat-week-rub', data.week.rub);
        document.getElementById('stat-week-deals').textContent = `${data.week.orders} сделок`;
        
        animateElementCount('stat-lastweek-rub', data.lastWeek.rub);
        document.getElementById('stat-lastweek-deals').textContent = `${data.lastWeek.orders} сделок`;
        
        animateElementCount('stat-month-rub', data.month.rub);
        document.getElementById('stat-month-deals').textContent = `${data.month.orders} сделок`;
        
        animateElementCount('stat-total-earned', data.total.earned);
        document.getElementById('stat-total-deals').textContent = `${data.total.orders} сделок`;
    } catch (e) {
        console.error("Error updating stats dashboard", e);
    }
}

function animateElementCount(id, targetVal) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 1000;
    const start = performance.now();
    function step(now) {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = formatRub(targetVal * ease);
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ——— ORDERS ———
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
        lucide.createIcons();
    } catch (e) {
        console.error("Load orders failure", e);
    }
}

function renderOrder(o) {
    const isActive = o.status === 'active';
    const timerHtml = isActive ? `<div class="order-timer" id="timer-${o.id}" style="font-family: var(--font-mono); color: var(--amber); font-weight: 600; margin-top: 8px;">Загрузка...</div>` : '';
    const actionsHtml = isActive ? `
        <div class="order-actions" style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="btn btn-success btn-small" onclick="completeOrder(${o.id})">✅ Поступление успешно</button>
            <button class="btn btn-danger btn-small" onclick="failOrder(${o.id})">❌ Не поступило</button>
        </div>` : '';
    
    const reqHtml = o.requisite ? `
        <div class="order-requisite" style="margin-top: 8px; padding: 10px; background: var(--bg-2); border: 1px solid var(--brd-1); border-radius: var(--r-md); font-size: 13px;">
            <div style="font-weight: 700; color: var(--berry);">🏦 ${o.requisite.bank}</div>
            <div>👤 ${o.requisite.name}</div>
            <div style="color: var(--txt-2); font-family: var(--font-mono);">📞 ${o.requisite.phone}</div>
        </div>` : '';

    return `
        <div class="card" style="padding: 16px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="order-number" style="font-weight: 700; font-family: var(--font-mono);">#${o.order_number}</span>
                <span class="order-status status-${o.status}">${orderStText(o.status)}</span>
            </div>
            <div class="order-amount" style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); margin-top: 6px; color: var(--mint);">${formatRub(o.amount_rub)}</div>
            ${reqHtml}
            ${timerHtml}
            ${actionsHtml}
            <div class="order-date" style="font-size: 12px; color: var(--txt-3); margin-top: 8px;">${formatDate(o.created_at)}</div>
        </div>`;
}

function orderStText(s) { return { active: 'Активный', completed: 'Выполнен', expired: 'Истёк', failed: 'Неуспешный' }[s] || s; }

function startOrderTimer(order) {
    if (orderTimers[order.id]) clearInterval(orderTimers[order.id]);
    const timerEl = document.getElementById(`timer-${order.id}`);
    if (!timerEl) return;
    const endsAt = new Date(order.timer_ends_at).getTime();
    orderTimers[order.id] = setInterval(() => {
        const diff = endsAt - Date.now();
        if (diff <= 0) { 
            timerEl.textContent = '⏰ Время вышло'; 
            timerEl.style.color = 'var(--rose)';
            clearInterval(orderTimers[order.id]); 
            return; 
        }
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        timerEl.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

async function completeOrder(id) {
    if (!confirm('Подтвердить поступление средств?')) return;
    const res = await fetch(`/api/orders/${id}/complete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        showToast('Ордер выполнен!', 'success'); 
        loadOrders(); 
        loadStats(); 
    } else {
        showToast(data.error, 'error');
    }
}

async function failOrder(id) {
    if (!confirm('Вы уверены? Это действие отметит ордер как неуспешный.')) return;
    const res = await fetch(`/api/orders/${id}/fail`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        showToast('Ордер отмечен как неуспешный', 'error'); 
        loadOrders(); 
    } else {
        showToast(data.error, 'error');
    }
}

// ——— APPEALS ———
async function loadAppeals() {
    try {
        const res = await fetch('/api/appeals');
        const appeals = await res.json();
        const container = document.getElementById('appeals-list');
        const homeContainer = document.getElementById('active-appeals-list');
        const activeAppeals = appeals.filter(a => a.status === 'pending');
        
        if (homeContainer) {
            if (!activeAppeals.length) homeContainer.innerHTML = '<div class="empty-state"><p>Нет активных апелляций</p></div>';
            else homeContainer.innerHTML = activeAppeals.map(a => renderAppeal(a)).join('');
        }
        if (!container) return;
        if (!appeals.length) { 
            container.innerHTML = '<div class="empty-state"><p>Нет апелляций</p></div>'; 
            return; 
        }
        container.innerHTML = appeals.map(a => renderAppeal(a)).join('');
        lucide.createIcons();
    } catch (e) {
        console.error("Error loading appeals", e);
    }
}

function renderAppeal(a) {
    const reqHtml = a.req_bank ? `
        <div style="font-size:13px; color:var(--txt-2); margin-top:8px; padding:10px; background:var(--bg-2); border-radius:var(--r-md); border: 1px solid var(--brd-1);">
            <strong>🏦 ${a.req_bank}</strong><br>👤 ${a.req_name}<br>📞 ${a.req_phone}
        </div>` : '';
        
    const receiptHtml = a.receipt_url ? `
        <div style="margin-top:8px;">
            <img src="${a.receipt_url}" style="max-width:100%; max-height:200px; border-radius:var(--r-md); cursor:pointer; border:1px solid var(--brd-2);" onclick="window.open(this.src)" alt="Чек">
        </div>` : '';
        
    let actionHtml = '';
    if (a.status === 'pending' && !a.client_action) {
        actionHtml = `
            <div style="margin-top:12px;">
                <div class="form-group">
                    <label>Выписка из банка (обязательно)</label>
                    <input type="file" id="appeal-statement-${a.id}" accept="image/*">
                </div>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="btn btn-success btn-small" onclick="acceptAppeal(${a.id})">Подтвердить</button>
                    <button class="btn btn-danger btn-small" onclick="rejectAppeal(${a.id})">Отклонить</button>
                </div>
            </div>`;
    } else if (a.client_action) {
        actionHtml = `<div style="margin-top:8px; font-size:13px; color:var(--txt-3);">Ваш ответ: <strong style="color:var(--berry);">${a.client_action === 'accepted' ? 'Подтверждено' : 'Отклонено'}</strong></div>`;
    }
    
    return `
        <div class="card" style="padding: 16px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="order-number" style="font-weight: 700; font-family: var(--font-mono);">#${a.appeal_number}</span>
                <span class="order-status status-${a.status}">${appealStText(a.status)}</span>
            </div>
            <div class="order-amount" style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); margin-top: 6px; color: var(--rose);">${formatRub(a.amount_rub)}</div>
            ${a.order_number ? `<div style="font-size:12px; color:var(--txt-3); margin-top: 4px;">Ордер: #${a.order_number}</div>` : ''}
            ${reqHtml}
            ${receiptHtml}
            ${a.description ? `<div style="font-size:13px; color:var(--txt-2); margin-top:8px;">${a.description}</div>` : ''}
            ${actionHtml}
            <div class="order-date" style="font-size: 12px; color: var(--txt-3); margin-top: 8px;">${formatDate(a.created_at)}</div>
        </div>`;
}

async function acceptAppeal(id) {
    const fileInput = document.getElementById(`appeal-statement-${id}`);
    if (!fileInput?.files[0]) return showToast('Прикрепите выписку из банка', 'error');
    const base64 = await fileToBase64(fileInput.files[0]);
    
    if (!confirm('Подтвердить апелляцию?')) return;
    const res = await fetch(`/api/appeals/${id}/accept`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ bank_statement_url: base64 }) 
    });
    const data = await res.json();
    if (data.success) { 
        showToast('Выписка отправлена', 'success'); 
        loadAppeals(); 
    } else {
        showToast(data.error, 'error');
    }
}

async function rejectAppeal(id) {
    const fileInput = document.getElementById(`appeal-statement-${id}`);
    if (!fileInput?.files[0]) return showToast('Прикрепите выписку из банка', 'error');
    const base64 = await fileToBase64(fileInput.files[0]);
    
    if (!confirm('Отклонить апелляцию?')) return;
    const res = await fetch(`/api/appeals/${id}/reject`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ bank_statement_url: base64 }) 
    });
    const data = await res.json();
    if (data.success) { 
        showToast('Выписка отправлена', 'success'); 
        loadAppeals(); 
    } else {
        showToast(data.error, 'error');
    }
}

function appealStText(s) { return { pending: 'На рассмотрении', resolved: 'Решена', rejected: 'Отклонена' }[s] || s; }

// ——— DEPOSITS ———
function calcPreview() {
    const amount = parseFloat(document.getElementById('amount-usdt').value) || 0;
    const preview = document.getElementById('exchange-preview');
    if (amount > 0) {
        preview.style.display = 'block';
        fetch('/api/exchange/rate').then(r => r.json()).then(data => {
            document.getElementById('preview-rub').textContent = formatRub(amount * parseFloat(data.final_rate));
            document.getElementById('preview-earned').textContent = `+${formatRub(amount * parseFloat(data.base_rate) * (parseFloat(data.markup_percent) / 100))}`;
        });
    } else { 
        preview.style.display = 'none'; 
    }
}

async function createDeposit() {
    const amount = parseFloat(document.getElementById('amount-usdt').value);
    const network = document.getElementById('deposit-network').value;
    const option = document.getElementById('deposit-network').selectedOptions[0];
    const coin = option?.dataset?.coin || 'USDT';
    
    if (!amount || amount < 20) return showToast('Минимум 20 USDT', 'error');
    const net = networks.find(n => n.id === network);
    if (!net) return showToast('Выберите сеть', 'error');
    
    currentDeposit = { amount_usdt: amount, network, coin, wallet: net.wallet };
    document.getElementById('wallet-address').textContent = net.wallet;
    document.getElementById('send-amount').textContent = `${amount} ${coin}`;
    
    const data = await (await fetch('/api/exchange/rate')).json();
    document.getElementById('receive-amount').textContent = formatRub(amount * parseFloat(data.final_rate));
    document.getElementById('earn-amount').textContent = `+${formatRub(amount * parseFloat(data.base_rate) * (parseFloat(data.markup_percent) / 100))}`;
    
    document.getElementById('send-section').style.display = 'block';
    lucide.createIcons();
}

function cancelDeposit() { 
    currentDeposit = null; 
    document.getElementById('send-section').style.display = 'none'; 
    document.getElementById('amount-usdt').value = ''; 
    document.getElementById('tx-hash').value = ''; 
    document.getElementById('exchange-preview').style.display = 'none'; 
}

async function confirmDeposit() {
    if (!currentDeposit) return;
    const txHash = document.getElementById('tx-hash').value.trim();
    if (!txHash || txHash.length < 10) return showToast('Введите хеш транзакции', 'error');
    
    try {
        const res = await fetch('/api/deposit/create', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                amount_usdt: currentDeposit.amount_usdt, 
                network: currentDeposit.network, 
                coin: currentDeposit.coin, 
                tx_hash: txHash 
            }) 
        });
        const data = await res.json();
        if (data.success) { 
            showToast('Заявка отправлена!', 'success'); 
            cancelDeposit(); 
            loadDeposits(); 
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) { 
        showToast('Ошибка сети', 'error'); 
    }
}

function copyAddress() { 
    navigator.clipboard.writeText(document.getElementById('wallet-address').textContent).then(() => {
        showToast('Адрес скопирован!', 'success');
    }); 
}

async function loadDeposits() {
    try {
        const res = await fetch('/api/deposits');
        const list = await res.json();
        const container = document.getElementById('deposits-list');
        if (!container) return;
        if (!list.length) { 
            container.innerHTML = '<div class="empty-state"><p>Нет пополнений</p></div>'; 
            return; 
        }
        container.innerHTML = list.map(d => `
            <div class="card" style="padding: 14px; margin-bottom: 10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-family: var(--font-mono); font-weight:700;">${d.network} (${d.coin || 'USDT'})</span>
                    <span class="order-status status-${d.status}">${depStText(d.status)}</span>
                </div>
                <div style="font-size:1.1rem; font-weight:700; margin-top:6px;">${d.amount_usdt} → <span style="color:var(--mint);">${formatRub(d.amount_rub)}</span></div>
                <div style="font-size:12px; color:var(--txt-2); margin-top:2px;">Заработок: +${formatRub(d.earned_rub)}</div>
                ${d.tx_hash ? `<div style="font-size:11px; color:var(--txt-3); word-break:break-all; margin-top:4px;">TX: ${d.tx_hash}</div>` : ''}
                <div style="font-size:11px; color:var(--txt-3); margin-top:4px;">${formatDate(d.created_at)}</div>
            </div>`).join('');
        lucide.createIcons();
    } catch (e) {
        console.error("Deposits history error", e);
    }
}

function depStText(s) { return { pending: 'Ожидает', confirmed: 'Подтверждён', rejected: 'Отклонён' }[s] || s; }

// ——— WITHDRAWALS ———
async function createWithdrawal() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const requisiteId = document.getElementById('withdraw-requisite').value;
    if (!amount || amount < 1000) return showToast('Минимум 1000 ₽', 'error');
    if (!requisiteId) return showToast('Выберите реквизиты', 'error');
    
    try {
        const res = await fetch('/api/withdrawal/create', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ amount_rub: amount, requisite_id: requisiteId }) 
        });
        const data = await res.json();
        if (data.success) { 
            showToast('Заявка создана! У вас 30 секунд на отмену.', 'success'); 
            document.getElementById('withdraw-amount').value = ''; 
            loadStats(); 
            refreshUserProfile();
            loadWithdrawals(); 
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) { 
        showToast('Ошибка вывода', 'error'); 
    }
}

async function cancelWithdrawal(id) {
    if (!confirm('Отменить вывод? Средства вернутся на баланс.')) return;
    try {
        const res = await fetch(`/api/withdrawal/${id}/cancel`, { method: 'POST' });
        const data = await res.json();
        if (data.success) { 
            showToast('Вывод отменён. Средства возвращены.', 'success'); 
            refreshUserProfile(); 
            loadWithdrawals(); 
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) { 
        showToast('Ошибка отмены', 'error'); 
    }
}

async function loadWithdrawals() {
    try {
        const res = await fetch('/api/withdrawals');
        const list = await res.json();
        const container = document.getElementById('withdrawals-list');
        if (!container) return;
        if (!list.length) { 
            container.innerHTML = '<div class="empty-state"><p>Нет выводов</p></div>'; 
            return; 
        }
        container.innerHTML = list.map(w => {
            const isPending = w.status === 'pending';
            const createdTime = new Date(w.created_at).getTime();
            const canCancel = isPending && (Date.now() - createdTime < 30000);
            
            const cancelBtn = canCancel ? `
                <div class="order-actions" style="margin-top: 10px;">
                    <button class="btn btn-danger btn-small" onclick="cancelWithdrawal(${w.id})">❌ Отменить (30с)</button>
                    <div id="wd-timer-${w.id}" style="font-size: 11px; color: var(--amber); margin-top: 4px; font-family: var(--font-mono)"></div>
                </div>` : '';
                
            return `
                <div class="card" style="padding: 14px; margin-bottom: 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:700;">${w.bank || '—'}</span>
                        <span class="order-status status-${w.status}">${w.status === 'completed' ? 'Выполнен' : w.status === 'pending' ? 'Ожидает' : 'Отклонён'}</span>
                    </div>
                    <div style="font-size:1.2rem; font-weight:800; font-family:var(--font-mono); margin-top:6px; color:var(--rose);">${formatRub(w.amount_rub)}</div>
                    <div style="font-size:13px; color:var(--txt-2); margin-top:2px;">${w.name || '—'} | ${w.phone || '—'}</div>
                    ${cancelBtn}
                    <div style="font-size:11px; color:var(--txt-3); margin-top:4px;">${formatDate(w.created_at)}</div>
                </div>`;
        }).join('');
        
        list.forEach(w => {
            if (w.status === 'pending') {
                const createdTime = new Date(w.created_at).getTime();
                const remaining = 30000 - (Date.now() - createdTime);
                if (remaining > 0) startWithdrawalTimer(w.id, createdTime);
            }
        });
        lucide.createIcons();
    } catch (e) {
        console.error("Withdrawals list generation failed", e);
    }
}

function startWithdrawalTimer(id, createdTime) {
    const timerEl = document.getElementById(`wd-timer-${id}`);
    if (!timerEl) return;
    if (withdrawalTimers[id]) clearInterval(withdrawalTimers[id]);
    withdrawalTimers[id] = setInterval(() => {
        const remaining = 30000 - (Date.now() - createdTime);
        if (remaining <= 0) { 
            timerEl.textContent = '⏰ Время на отмену вышло'; 
            clearInterval(withdrawalTimers[id]); 
            loadWithdrawals(); 
            return; 
        }
        const secs = Math.ceil(remaining / 1000);
        timerEl.textContent = `⏱ Отмена через: ${secs}с`;
    }, 1000);
}

// ——— REQUISITES ———
async function saveRequisite() {
    const name = document.getElementById('req-name').value;
    const phone = document.getElementById('req-phone').value;
    const bank = document.getElementById('req-bank').value;
    if (!name || !phone || !bank) return showToast('Заполните все поля', 'error');
    
    try {
        const res = await fetch('/api/requisites/save', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ name, phone, bank }) 
        });
        const data = await res.json();
        if (data.success) { 
            showToast('Реквизит добавлен!', 'success'); 
            document.getElementById('req-name').value = ''; 
            document.getElementById('req-phone').value = ''; 
            document.getElementById('req-bank').value = ''; 
            loadRequisites(); 
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) { 
        showToast('Ошибка при сохранении', 'error'); 
    }
}

async function loadRequisites() {
    try {
        const res = await fetch('/api/requisites');
        const list = await res.json();
        const container = document.getElementById('requisites-list');
        const select = document.getElementById('withdraw-requisite');
        
        if (container) {
            if (!list.length) container.innerHTML = '<p style="color:var(--txt-3); font-size:14px; padding:12px;">Нет активных реквизитов</p>';
            else {
                container.innerHTML = list.map(r => `
                    <div style="padding:14px; background:${r.is_active ? 'var(--mint-subtle)' : 'var(--bg-2)'}; border-radius:var(--r-md); margin:8px 0; display:flex; justify-content:space-between; align-items:center; border:1px solid ${r.is_active ? 'rgba(52,211,153,0.3)' : 'var(--brd-1)'};">
                        <div>
                            <div style="font-weight:700; color:var(--txt-1);">${r.bank}</div>
                            <div style="font-size:13px; color:var(--txt-2);">${r.name} | ${r.phone}</div>
                            ${r.is_active ? '<span style="font-size:11px; color:var(--mint); font-weight:700;">🟢 Включен</span>' : '<span style="font-size:11px; color:var(--txt-3);">Выключен</span>'}
                        </div>
                        <div style="display:flex; gap:8px;">
                            ${r.is_active ? `<button class="btn btn-small btn-danger" onclick="deactivateReq(${r.id})">Выключить</button>` : `<button class="btn btn-small btn-success" onclick="activateReq(${r.id})">Включить</button>`}
                            <button class="btn btn-small btn-secondary" onclick="archiveReq(${r.id})" title="В архив">📦</button>
                        </div>
                    </div>`).join('');
            }
        }
        if (select) select.innerHTML = '<option value="">Выберите реквизит</option>' + list.filter(r => r.is_active).map(r => `<option value="${r.id}">${r.bank} - ${r.name} (${r.phone})</option>`).join('');
        loadArchivedRequisites();
        lucide.createIcons();
    } catch (e) {
        console.error("Requisites loader error", e);
    }
}

async function loadArchivedRequisites() {
    try {
        const res = await fetch('/api/requisites?archived=1');
        const list = await res.json();
        const container = document.getElementById('archived-requisites-list');
        if (!container) return;
        if (!list.length) { 
            container.innerHTML = '<p style="color:var(--txt-3); font-size:13px; padding:8px;">Архив пуст</p>'; 
            return; 
        }
        container.innerHTML = list.map(r => `
            <div style="padding:10px; background:var(--bg-2); border-radius:var(--r-md); margin:6px 0; font-size:13px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--brd-1);">
                <div><strong>${r.bank}</strong> - ${r.name} | ${r.phone}</div>
                <button class="btn btn-small btn-success" onclick="restoreReq(${r.id})">Вернуть</button>
            </div>`).join('');
    } catch (e) {
        console.error("Archive loader error", e);
    }
}

async function archiveReq(id) { await fetch(`/api/requisites/${id}/archive`, { method: 'POST' }); showToast('Перемещено в архив', 'success'); loadRequisites(); }
async function restoreReq(id) { await fetch(`/api/requisites/${id}/restore`, { method: 'POST' }); showToast('Восстановлено из архива', 'success'); loadRequisites(); }
async function activateReq(id) { await fetch(`/api/requisites/${id}/activate`, { method: 'POST' }); showToast('Реквизит активирован!', 'success'); loadRequisites(); }
async function deactivateReq(id) { await fetch(`/api/requisites/${id}/deactivate`, { method: 'POST' }); showToast('Реквизит деактивирован', 'info'); loadRequisites(); }

// ——— NOTIFICATIONS ———
async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications');
        const data = await res.json();
        const container = document.getElementById('notifications-list');
        if (!container) return;
        if (!data.notifications.length) { 
            container.innerHTML = '<div class="empty-state"><p>Нет уведомлений</p></div>'; 
            return; 
        }
        container.innerHTML = data.notifications.map(n => `
            <div class="card" style="padding: 12px; margin-bottom: 8px; border-left: 3px solid var(--berry);">
                <div style="font-size: 0.9rem; font-weight: 500;">${n.message}</div>
                <div style="font-size: 0.75rem; color: var(--txt-3); margin-top: 4px;">${formatDate(n.created_at)}</div>
            </div>`).join('');
    } catch (e) {
        console.error("Notifications load error", e);
    }
}

async function markNotificationsRead() { 
    await fetch('/api/notifications/read', { method: 'POST' }); 
    loadNotifications(); 
}

// ——— PROFILE SECURITY ———
async function changePassword() {
    const curr = document.getElementById('current-pass').value;
    const newP = document.getElementById('new-pass').value;
    if (!curr || !newP) return showToast('Заполните поля паролей', 'error');
    
    const res = await fetch('/api/user/change-password', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ current_password: curr, new_password: newP }) 
    });
    const data = await res.json();
    if (data.success) { 
        showToast('Пароль успешно изменён!', 'success'); 
        document.getElementById('current-pass').value = ''; 
        document.getElementById('new-pass').value = ''; 
    } else {
        showToast(data.error, 'error');
    }
}

async function setup2FA() {
    const res = await fetch('/api/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        document.getElementById('qr-code').src = data.qr_code; 
        document.getElementById('secret-key').textContent = data.secret; 
        document.getElementById('2fa-setup').style.display = 'block'; 
    }
}

async function verify2FA() {
    const code = document.getElementById('totp-code').value.trim();
    if (!code || code.length !== 6) return showToast('Введите 6-значный код', 'error');
    const res = await fetch('/api/2fa/verify', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ code }) 
    });
    const data = await res.json();
    if (data.success) { 
        showToast('2FA успешно подключена!', 'success'); 
        currentUser.totp_enabled = true; 
        updateUserUI(); 
        document.getElementById('2fa-setup').style.display = 'none'; 
    } else {
        showToast(data.error, 'error');
    }
}

async function disable2FA() {
    const code = prompt('Введите код из аутентификатора:');
    if (!code) return;
    const res = await fetch('/api/2fa/disable', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ code }) 
    });
    const data = await res.json();
    if (data.success) { 
        showToast('2FA отключена', 'info'); 
        currentUser.totp_enabled = false; 
        updateUserUI(); 
    } else {
        showToast(data.error, 'error');
    }
}

// ——— SSE (REAL-TIME) ———
function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    eventSource = new EventSource('/api/user/events');
    
    eventSource.addEventListener('balance_update', (e) => {
        const data = JSON.parse(e.data);
        if (data.balance_rub !== undefined) currentUser.balance_rub = data.balance_rub;
        if (data.held_rub !== undefined) currentUser.held_rub = data.held_rub;
        if (data.withdrawal_pending !== undefined) currentUser.withdrawal_pending = data.withdrawal_pending;
        updateUserUI();
    });
    
    eventSource.addEventListener('new_order', (e) => {
        const data = JSON.parse(e.data);
        showToast(`📦 Новый ордер ${data.order_number} на ${formatRub(data.amount_rub)}`, 'info');
        loadOrders();
        loadStats();
    });
    
    eventSource.addEventListener('new_appeal', (e) => {
        const data = JSON.parse(e.data);
        showToast(`⚠️ Новая апелляция ${data.appeal_number}`, 'info');
        loadAppeals();
    });
    
    eventSource.addEventListener('appeal_resolved', (e) => {
        const data = JSON.parse(e.data);
        showToast(`✅ Апелляция ${data.appeal_number} решена. Списано ${formatRub(data.amount)}`, 'success');
        loadAppeals();
        loadStats();
    });
    
    eventSource.addEventListener('appeal_rejected', (e) => {
        const data = JSON.parse(e.data);
        showToast(`❌ Апелляция ${data.appeal_number} отклонена. Средства разморожены.`, 'error');
        loadAppeals();
    });
    
    eventSource.addEventListener('deposit_confirmed', (e) => {
        const data = JSON.parse(e.data);
        showToast(`✅ Депозит ${data.amount_usdt} USDT подтверждён! +${formatRub(data.amount_rub)}`, 'success');
        loadDeposits();
        loadStats();
    });
    
    eventSource.addEventListener('deposit_rejected', () => {
        showToast('❌ Депозит отклонён', 'error');
        loadDeposits();
    });
    
    eventSource.addEventListener('withdrawal_confirmed', () => {
        showToast('✅ Вывод подтверждён!', 'success');
        loadWithdrawals();
    });
    
    eventSource.addEventListener('withdrawal_rejected', () => {
        showToast('❌ Вывод отклонён', 'error');
        loadWithdrawals();
    });
    
    eventSource.addEventListener('new_notification', (e) => {
        const data = JSON.parse(e.data);
        showToast(data.message, data.type === 'error' ? 'error' : 'info');
        loadNotifications();
    });
    
    eventSource.addEventListener('verification_approved', () => {
        showToast('✅ Верификация пройдена!', 'success');
        currentUser.is_verified = true;
        currentUser.verification_status = 'approved';
        refreshUserProfile();
    });
    
    eventSource.addEventListener('verification_rejected', (e) => {
        const data = JSON.parse(e.data);
        showToast(`❌ Верификация отклонена: ${data.comment || ''}`, 'error');
        currentUser.verification_status = 'rejected';
        refreshUserProfile();
    });
    
    eventSource.addEventListener('order_completed', () => {
        loadOrders();
        loadStats();
    });
    
    eventSource.addEventListener('order_failed', () => {
        loadOrders();
    });
    
    eventSource.onerror = () => {
        setTimeout(connectSSE, 3000);
    };
}

// ——— AUTO RUN SERVICES ———
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        refreshUserProfile();
        loadOrders();
        loadWithdrawals();
    }, 10000);
}

async function refreshUserProfile() {
    try {
        const res = await fetch('/api/user/profile');
        if (res.ok) {
            currentUser = await res.json();
            updateUserUI();
        }
    } catch (e) {
        console.error("Profile refresh error", e);
    }
}

// ——— HELPERS & UI ———
function initTheme() {
    const savedTheme = localStorage.getItem('bb-theme-client') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function initClock() {
    // Optional clock initialization if present
}

function formatRub(a) { 
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0); 
}

function formatDate(d) { 
    if (!d) return '—';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); 
}

function showToast(msg, type = 'info') { 
    const t = document.getElementById('toast'); 
    if (!t) return;
    t.textContent = msg; 
    t.className = `toast ${type}`; 
    t.style.display = 'block'; 
    setTimeout(() => t.style.display = 'none', 3000); 
}

function showError(el, text) {
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
