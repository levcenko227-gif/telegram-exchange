let currentUser = null;
let currentDeposit = null;
let networks = [];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('link-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
    document.getElementById('link-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
    document.getElementById('btn-profile').addEventListener('click', showProfile);
    document.getElementById('btn-refresh').addEventListener('click', loadRate);
    document.getElementById('btn-deposit').addEventListener('click', createDeposit);
    document.getElementById('btn-confirm-deposit').addEventListener('click', confirmDeposit);
    document.getElementById('btn-cancel-deposit').addEventListener('click', cancelDeposit);
    document.getElementById('btn-copy').addEventListener('click', copyAddress);
    document.getElementById('btn-withdraw').addEventListener('click', createWithdrawal);
    document.getElementById('btn-close-profile').addEventListener('click', closeProfile);
    document.getElementById('btn-change-pass').addEventListener('click', changePassword);
    document.getElementById('btn-change-login').addEventListener('click', changeUsername);
    document.getElementById('btn-2fa').addEventListener('click', setup2FA);
    document.getElementById('btn-verify-2fa').addEventListener('click', verify2FA);
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.getElementById('amount-usdt').addEventListener('input', calcPreview);
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
    document.getElementById('main-app').style.display = 'block';
    updateUserUI();
    loadRate();
    loadStats();
    loadTransactions();
    loadRequisites();
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('user-balance').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = currentUser.first_name || '';
    document.getElementById('withdraw-balance').textContent = formatRub(currentUser.balance_rub);
    const s = document.getElementById('2fa-status'), b = document.getElementById('btn-2fa');
    if (currentUser.totp_enabled) { s.textContent = 'Подключена ✓'; s.classList.add('active'); b.textContent = 'Отключить'; b.onclick = () => disable2FA(); }
    else { s.textContent = 'Не подключена'; s.classList.remove('active'); b.textContent = 'Настроить'; b.onclick = () => setup2FA(); }
}

async function loadRate() {
    try {
        const res = await fetch('/api/exchange/rate');
        const data = await res.json();
        document.getElementById('current-rate').textContent = `${data.final_rate} ₽`;
        document.getElementById('base-rate').textContent = data.base_rate;
        document.getElementById('markup').textContent = data.markup_percent;
        networks = data.networks || [];
        const select = document.getElementById('deposit-network');
        select.innerHTML = networks.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
        document.getElementById('min-deposit').textContent = '20';
    } catch (e) {}
}

async function loadStats() {
    try {
        const res = await fetch('/api/user/stats');
        const data = await res.json();
        document.getElementById('stat-today').textContent = formatRub(data.today.rub);
        document.getElementById('stat-week').textContent = formatRub(data.week.rub);
        document.getElementById('stat-month').textContent = formatRub(data.month.rub);
        document.getElementById('stat-earned').textContent = formatRub(data.total.earned);
    } catch (e) {}
}

function calcPreview() {
    const amount = parseFloat(document.getElementById('amount-usdt').value) || 0;
    const preview = document.getElementById('exchange-preview');
    if (amount > 0) {
        preview.style.display = 'block';
        const rateText = document.getElementById('current-rate').textContent;
        const rate = parseFloat(rateText) || 0;
        const markup = parseFloat(document.getElementById('markup').textContent) || 0;
        const base = parseFloat(document.getElementById('base-rate').textContent) || 0;
        document.getElementById('preview-rub').textContent = formatRub(amount * rate);
        document.getElementById('preview-earned').textContent = `+${formatRub(amount * base * (markup / 100))}`;
    } else { preview.style.display = 'none'; }
}

async function createDeposit() {
    const amount = parseFloat(document.getElementById('amount-usdt').value);
    const network = document.getElementById('deposit-network').value;
    if (!amount || amount < 20) return showToast('Минимум 20 USDT', 'error');
    const net = networks.find(n => n.id === network);
    if (!net) return showToast('Выберите сеть', 'error');
    currentDeposit = { amount_usdt: amount, network, wallet: net.wallet };
    document.getElementById('deposit-section').style.display = 'none';
    document.getElementById('send-section').style.display = 'block';
    document.getElementById('wallet-address').textContent = net.wallet;
    document.getElementById('send-amount').textContent = `${amount} USDT`;
    const rate = parseFloat(document.getElementById('current-rate').textContent) || 0;
    const base = parseFloat(document.getElementById('base-rate').textContent) || 0;
    const markup = parseFloat(document.getElementById('markup').textContent) || 0;
    document.getElementById('receive-amount').textContent = formatRub(amount * rate);
    document.getElementById('earn-amount').textContent = `+${formatRub(amount * base * (markup / 100))}`;
}

function cancelDeposit() {
    currentDeposit = null;
    document.getElementById('deposit-section').style.display = 'block';
    document.getElementById('send-section').style.display = 'none';
    document.getElementById('amount-usdt').value = '';
    document.getElementById('tx-hash').value = '';
    document.getElementById('exchange-preview').style.display = 'none';
}

async function confirmDeposit() {
    if (!currentDeposit) return;
    const txHash = document.getElementById('tx-hash').value;
    if (!txHash || txHash.length < 10) return showToast('Введите хеш транзакции', 'error');
    try {
        const res = await fetch('/api/deposit/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount_usdt: currentDeposit.amount_usdt, network: currentDeposit.network, tx_hash: txHash })
        });
        const data = await res.json();
        if (data.success) { showToast('Заявка отправлена на проверку!', 'success'); cancelDeposit(); loadTransactions(); }
        else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

function copyAddress() {
    navigator.clipboard.writeText(document.getElementById('wallet-address').textContent).then(() => showToast('Скопировано!', 'success'));
}

async function createWithdrawal() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const name = document.getElementById('withdraw-name').value;
    const phone = document.getElementById('withdraw-phone').value;
    const bank = document.getElementById('withdraw-bank').value;
    if (!amount || amount < 1000) return showToast('Минимум 1000 ₽', 'error');
    if (!name || !phone || !bank) return showToast('Заполните все поля', 'error');
    try {
        const res = await fetch('/api/withdrawal/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount_rub: amount, name, phone, bank })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Заявка на вывод создана!', 'success');
            document.getElementById('withdraw-amount').value = '';
            loadStats();
            updateUserUI();
            loadTransactions();
        } else showToast(data.error, 'error');
    } catch (e) { showToast('Ошибка', 'error'); }
}

async function loadRequisites() {
    try {
        const res = await fetch('/api/requisites');
        const list = await res.json();
        const container = document.getElementById('requisites-list');
        if (!list.length) { container.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">Нет сохранённых реквизитов</p>'; return; }
        container.innerHTML = list.map(r => `
            <div style="padding:12px;background:var(--gray-50);border-radius:8px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-weight:600;">${r.bank}</div>
                    <div style="font-size:13px;color:var(--gray-500);">${r.name} | ${r.phone}</div>
                </div>
                <div style="display:flex;gap:8px;">
                    ${r.is_default ? '<span class="badge badge-confirmed">Основной</span>' : `<button class="btn btn-small" onclick="setDefaultReq(${r.id})">Сделать основным</button>`}
                    <button class="btn btn-small btn-danger" onclick="deleteReq(${r.id})">✕</button>
                </div>
            </div>
        `).join('');
    } catch (e) {}
}

async function setDefaultReq(id) { await fetch(`/api/requisites/${id}/default`, { method: 'POST' }); loadRequisites(); }
async function deleteReq(id) { await fetch(`/api/requisites/${id}/delete`, { method: 'POST' }); loadRequisites(); }

async function loadTransactions() {
    try {
        const res = await fetch('/api/transactions');
        const list = await res.json();
        const container = document.getElementById('transactions-list');
        if (!list.length) { container.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Пока нет операций</p></div>'; return; }
        container.innerHTML = list.map(t => `
            <div class="transaction-item">
                <div class="transaction-header">
                    <span class="transaction-type">${t.type === 'deposit' ? '💰 Пополнение' : '💸 Вывод'}</span>
                    <span class="transaction-status status-${t.status}">${statusText(t.status)}</span>
                </div>
                <div class="transaction-details">
                    ${t.type === 'deposit' ? `
                        <div class="transaction-row"><span>USDT:</span><span>${t.amount_usdt}</span></div>
                        <div class="transaction-row"><span>На баланс:</span><span>${formatRub(t.amount_rub)}</span></div>
                        <div class="transaction-row"><span>Заработок:</span><span style="color:#f59e0b;">+${formatRub(t.earned_rub)}</span></div>
                        <div class="transaction-row"><span>Сеть:</span><span>${t.network}</span></div>
                    ` : `
                        <div class="transaction-row"><span>Сумма:</span><span>${formatRub(t.amount_rub)}</span></div>
                        <div class="transaction-row"><span>Банк:</span><span>${t.withdrawal_bank || '—'}</span></div>
                    `}
                </div>
                ${t.tx_hash ? `<div class="tx-hash">TX: ${t.tx_hash}</div>` : ''}
                <div class="transaction-date">${formatDate(t.created_at)}</div>
                ${t.admin_comment ? `<div class="admin-comment">💬 ${t.admin_comment}</div>` : ''}
            </div>
        `).join('');
    } catch (e) {}
}

function statusText(s) { return { pending: 'Ожидает', confirmed: 'Подтверждено', rejected: 'Отклонено', completed: 'Выполнено' }[s] || s; }

function showProfile() { document.getElementById('profile-modal').style.display = 'flex'; }
function closeProfile() { document.getElementById('profile-modal').style.display = 'none'; document.getElementById('2fa-setup').style.display = 'none'; }

async function changePassword() {
    const curr = document.getElementById('current-pass').value, newP = document.getElementById('new-pass').value;
    if (!curr || !newP) return showToast('Заполните поля', 'error');
    const res = await fetch('/api/user/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: curr, new_password: newP }) });
    const data = await res.json();
    if (data.success) { showToast('Пароль изменён!', 'success'); document.getElementById('current-pass').value = ''; document.getElementById('new-pass').value = ''; }
    else showToast(data.error, 'error');
}

async function changeUsername() {
    const newLogin = document.getElementById('new-login').value;
    if (!newLogin || newLogin.length < 3) return showToast('Логин минимум 3 символа', 'error');
    const res = await fetch('/api/user/change-username', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_username: newLogin }) });
    const data = await res.json();
    if (data.success) { showToast('Логин изменён!', 'success'); currentUser.username = newLogin; updateUserUI(); document.getElementById('new-login').value = ''; }
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

function formatRub(a) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0); }
function formatDate(d) { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)); }
function showToast(msg, type = 'info') { const t = document.getElementById('toast'); t.textContent = msg; t.className = `toast ${type}`; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3000); }
document.getElementById('profile-modal')?.addEventListener('click', function(e) { if (e.target === this) closeProfile(); });
