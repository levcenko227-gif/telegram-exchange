let currentUser = null;
let currentTransaction = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('link-register').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
    document.getElementById('link-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
    
    document.getElementById('btn-profile').addEventListener('click', showProfile);
    document.getElementById('btn-refresh').addEventListener('click', loadRate);
    document.getElementById('btn-exchange').addEventListener('click', createExchange);
    document.getElementById('btn-confirm-sent').addEventListener('click', confirmSent);
    document.getElementById('btn-cancel').addEventListener('click', cancelExchange);
    document.getElementById('btn-copy').addEventListener('click', copyAddress);
    
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
        if (res.ok) {
            const data = await res.json();
            currentUser = data;
            showApp();
        }
    } catch (e) {}
}

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const totp = document.getElementById('login-totp').value;
    const errEl = document.getElementById('login-error');

    if (!username || !password) {
        errEl.textContent = 'Введите логин и пароль';
        errEl.style.display = 'block';
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
            return;
        }

        if (data.success) {
            currentUser = data.user;
            showApp();
        } else {
            errEl.textContent = data.error;
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = 'Ошибка подключения к серверу';
        errEl.style.display = 'block';
    }
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');

    if (!username || !password) {
        errEl.textContent = 'Введите логин и пароль';
        errEl.style.display = 'block';
        return;
    }

    if (username.length < 3) {
        errEl.textContent = 'Логин минимум 3 символа';
        errEl.style.display = 'block';
        return;
    }

    if (password.length < 6) {
        errEl.textContent = 'Пароль минимум 6 символов';
        errEl.style.display = 'block';
        return;
    }

    let telegramId = null;
    let firstName = username;
    if (window.Telegram && window.Telegram.WebApp) {
        const tgUser = window.Telegram.WebApp.initDataUnsafe?.user;
        if (tgUser) {
            telegramId = tgUser.id;
            firstName = tgUser.first_name || username;
        }
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, telegram_id: telegramId, first_name: firstName })
        });

        const data = await res.json();

        if (data.success) {
            currentUser = data.user;
            showApp();
        } else {
            errEl.textContent = data.error;
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = 'Ошибка подключения к серверу';
        errEl.style.display = 'block';
    }
}

async function doLogout() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    location.reload();
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    updateUserUI();
    loadRate();
    loadTransactions();
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('user-balance').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = currentUser.first_name || '';
    document.getElementById('stat-usdt').textContent = (currentUser.total_exchanged_usdt || 0).toFixed(2);
    document.getElementById('stat-rub').textContent = formatRub(currentUser.total_received_rub || 0);

    const statusEl = document.getElementById('2fa-status');
    const btn2fa = document.getElementById('btn-2fa');
    if (currentUser.totp_enabled) {
        statusEl.textContent = 'Подключена ✓';
        statusEl.classList.add('active');
        btn2fa.textContent = 'Отключить';
        btn2fa.onclick = () => disable2FA();
    } else {
        statusEl.textContent = 'Не подключена';
        statusEl.classList.remove('active');
        btn2fa.textContent = 'Настроить';
        btn2fa.onclick = () => setup2FA();
    }
}

async function loadRate() {
    try {
        const res = await fetch('/api/exchange/rate');
        const data = await res.json();
        document.getElementById('current-rate').textContent = `${data.final_rate} ₽`;
        document.getElementById('base-rate').textContent = data.base_rate;
        document.getElementById('markup').textContent = data.markup_percent;
    } catch (e) {}
}

function calcPreview() {
    const amount = parseFloat(document.getElementById('amount-usdt').value) || 0;
    const preview = document.getElementById('exchange-preview');
    if (amount > 0) {
        preview.style.display = 'block';
        const rateText = document.getElementById('current-rate').textContent;
        const rate = parseFloat(rateText) || 0;
        document.getElementById('preview-rub').textContent = formatRub(amount * rate);
    } else {
        preview.style.display = 'none';
    }
}

async function createExchange() {
    const amount = parseFloat(document.getElementById('amount-usdt').value);
    if (!amount || amount <= 0) return showToast('Введите сумму', 'error');

    try {
        const res = await fetch('/api/exchange/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount_usdt: amount })
        });
        const data = await res.json();

        if (data.success) {
            currentTransaction = data;
            document.getElementById('exchange-section').style.display = 'none';
            document.getElementById('wallet-section').style.display = 'block';
            document.getElementById('wallet-address').textContent = data.wallet_address;
            document.getElementById('send-amount').textContent = `${data.amount_usdt} USDT`;
            document.getElementById('receive-amount').textContent = `${data.amount_rub} ₽`;
            showToast('Заявка создана!', 'success');
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast('Ошибка', 'error');
    }
}

function cancelExchange() {
    currentTransaction = null;
    document.getElementById('exchange-section').style.display = 'block';
    document.getElementById('wallet-section').style.display = 'none';
    document.getElementById('amount-usdt').value = '';
    document.getElementById('exchange-preview').style.display = 'none';
}

async function confirmSent() {
    if (!currentTransaction) return;
    try {
        const res = await fetch('/api/exchange/confirm-sent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: currentTransaction.transaction_id })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Отправлено на проверку!', 'success');
            cancelExchange();
            loadTransactions();
        }
    } catch (e) {}
}

function copyAddress() {
    const addr = document.getElementById('wallet-address').textContent;
    navigator.clipboard.writeText(addr).then(() => showToast('Скопировано!', 'success'));
}

async function loadTransactions() {
    try {
        const res = await fetch('/api/transactions');
        const list = await res.json();
        const container = document.getElementById('transactions-list');

        if (!list || list.length === 0) {
            container.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Пока нет операций</p></div>';
            return;
        }

        container.innerHTML = list.map(t => `
            <div class="transaction-item">
                <div class="transaction-header">
                    <span class="transaction-type">${t.type === 'exchange' ? '💱 Обмен' : '💸 Вывод'}</span>
                    <span class="transaction-status status-${t.status}">${statusText(t.status)}</span>
                </div>
                <div class="transaction-details">
                    <div class="transaction-row"><span>USDT:</span><span>${t.amount_usdt}</span></div>
                    <div class="transaction-row"><span>RUB:</span><span>${formatRub(t.amount_rub)}</span></div>
                    <div class="transaction-row"><span>Курс:</span><span>${t.rate} ₽</span></div>
                </div>
                <div class="transaction-date">${formatDate(t.created_at)}</div>
                ${t.admin_comment ? `<div class="admin-comment">💬 ${t.admin_comment}</div>` : ''}
            </div>
        `).join('');
    } catch (e) {}
}

function statusText(s) {
    return { pending: 'Ожидает', confirmed: 'Подтверждено', rejected: 'Отклонено' }[s] || s;
}

function showProfile() {
    document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfile() {
    document.getElementById('profile-modal').style.display = 'none';
    document.getElementById('2fa-setup').style.display = 'none';
}

async function changePassword() {
    const curr = document.getElementById('current-pass').value;
    const newP = document.getElementById('new-pass').value;

    if (!curr || !newP) return showToast('Заполните поля', 'error');

    try {
        const res = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: curr, new_password: newP })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Пароль изменён!', 'success');
            document.getElementById('current-pass').value = '';
            document.getElementById('new-pass').value = '';
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {}
}

async function changeUsername() {
    const newLogin = document.getElementById('new-login').value;

    if (!newLogin || newLogin.length < 3) return showToast('Логин минимум 3 символа', 'error');

    try {
        const res = await fetch('/api/user/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_username: newLogin })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Логин изменён!', 'success');
            currentUser.username = newLogin;
            updateUserUI();
            document.getElementById('new-login').value = '';
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {}
}

async function setup2FA() {
    try {
        const res = await fetch('/api/2fa/setup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            document.getElementById('qr-code').src = data.qr_code;
            document.getElementById('secret-key').textContent = data.secret;
            document.getElementById('2fa-setup').style.display = 'block';
        }
    } catch (e) {}
}

async function verify2FA() {
    const code = document.getElementById('totp-code').value;
    if (!code || code.length !== 6) return showToast('Введите 6-значный код', 'error');

    try {
        const res = await fetch('/api/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.success) {
            showToast('2FA подключена!', 'success');
            currentUser.totp_enabled = true;
            updateUserUI();
            document.getElementById('2fa-setup').style.display = 'none';
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {}
}

async function disable2FA() {
    const code = prompt('Введите код из аутентификатора:');
    if (!code) return;

    try {
        const res = await fetch('/api/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.success) {
            showToast('2FA отключена', 'success');
            currentUser.totp_enabled = false;
            updateUserUI();
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {}
}

function formatRub(a) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(a || 0);
}

function formatDate(d) {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}

document.getElementById('profile-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeProfile();
});
