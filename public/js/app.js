// ==================== GLOBALS ====================
let currentUser = null;
let currentTransaction = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    initTelegramApp();
    loadExchangeRate();
    loadTransactions();
});

function initTelegramApp() {
    // Initialize Telegram Web App
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        // Get user data from Telegram
        const user = tg.initDataUnsafe?.user;
        if (user) {
            authenticateUser(user.id, user.username, user.first_name);
        } else {
            // For testing without Telegram
            authenticateUser('test_user_123', 'testuser', 'Тестовый пользователь');
        }
    } else {
        // For testing outside Telegram
        authenticateUser('test_user_123', 'testuser', 'Тестовый пользователь');
    }
}

async function authenticateUser(telegramId, username, firstName) {
    try {
        const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: telegramId,
                username: username,
                first_name: firstName
            })
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            updateUserUI();
        } else {
            showToast('Ошибка авторизации', 'error');
        }
    } catch (error) {
        console.error('Auth error:', error);
        showToast('Ошибка подключения', 'error');
    }
}

// ==================== UI UPDATES ====================
function updateUserUI() {
    if (!currentUser) return;
    
    document.getElementById('user-balance').textContent = formatRub(currentUser.balance_rub);
    document.getElementById('profile-name').textContent = currentUser.first_name || currentUser.username || 'Пользователь';
    document.getElementById('profile-id').textContent = `ID: ${currentUser.telegram_id}`;
    
    // Update 2FA status
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

async function loadExchangeRate() {
    try {
        const response = await fetch('/api/exchange/rate');
        const data = await response.json();
        
        document.getElementById('current-rate').textContent = `${data.final_rate} ₽`;
        document.getElementById('base-rate').textContent = data.base_rate;
        document.getElementById('markup').textContent = data.markup_percent;
    } catch (error) {
        console.error('Error loading rate:', error);
    }
}

async function loadTransactions() {
    try {
        const response = await fetch('/api/transactions');
        const transactions = await response.json();
        
        renderTransactions(transactions);
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

function renderTransactions(transactions) {
    const container = document.getElementById('transactions-list');
    
    if (!transactions || transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📊</span>
                <p>Пока нет операций</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = transactions.map(t => `
        <div class="transaction-item">
            <div class="transaction-header">
                <span class="transaction-type">${t.type === 'exchange' ? '💱 Обмен' : '💸 Вывод'}</span>
                <span class="transaction-status status-${t.status}">
                    ${getStatusText(t.status)}
                </span>
            </div>
            <div class="transaction-details">
                <div class="transaction-row">
                    <span>Сумма USDT:</span>
                    <span class="transaction-amount">${t.amount_usdt} USDT</span>
                </div>
                <div class="transaction-row">
                    <span>Сумма RUB:</span>
                    <span class="transaction-amount">${formatRub(t.amount_rub)}</span>
                </div>
                <div class="transaction-row">
                    <span>Курс:</span>
                    <span>${t.rate} ₽</span>
                </div>
            </div>
            <div class="transaction-date">${formatDate(t.created_at)}</div>
        </div>
    `).join('');
}

function getStatusText(status) {
    const statuses = {
        'pending': 'Ожидает',
        'confirmed': 'Подтверждено',
        'rejected': 'Отклонено'
    };
    return statuses[status] || status;
}

// ==================== EXCHANGE ====================
// Input handler for exchange amount
document.getElementById('amount-usdt')?.addEventListener('input', function() {
    const amount = parseFloat(this.value) || 0;
    const preview = document.getElementById('exchange-preview');
    
    if (amount > 0) {
        preview.style.display = 'block';
        calculatePreview(amount);
    } else {
        preview.style.display = 'none';
    }
});

async function calculatePreview(amount) {
    try {
        const response = await fetch('/api/exchange/rate');
        const data = await response.json();
        
        const rubAmount = amount * parseFloat(data.final_rate);
        
        document.getElementById('preview-rub').textContent = formatRub(rubAmount);
        document.getElementById('preview-rate').textContent = `${data.final_rate} ₽`;
    } catch (error) {
        console.error('Error calculating:', error);
    }
}

async function createExchange() {
    const amountInput = document.getElementById('amount-usdt');
    const amount = parseFloat(amountInput.value);
    
    if (!amount || amount <= 0) {
        showToast('Введите сумму', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/exchange/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount_usdt: amount })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentTransaction = data;
            showWalletSection(data);
            showToast('Заявка создана!', 'success');
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showToast('Ошибка создания заявки', 'error');
    }
}

function showWalletSection(data) {
    document.getElementById('exchange-section').style.display = 'none';
    document.getElementById('wallet-section').style.display = 'block';
    
    document.getElementById('wallet-address').textContent = data.wallet_address;
    document.getElementById('send-amount').textContent = `${data.amount_usdt} USDT`;
    document.getElementById('receive-amount').textContent = formatRub(parseFloat(data.amount_rub));
    
    // Scroll to wallet section
    document.getElementById('wallet-section').scrollIntoView({ behavior: 'smooth' });
}

function cancelExchange() {
    currentTransaction = null;
    document.getElementById('exchange-section').style.display = 'block';
    document.getElementById('wallet-section').style.display = 'none';
    document.getElementById('amount-usdt').value = '';
    document.getElementById('exchange-preview').style.display = 'none';
}

async function confirmSent() {
    if (!currentTransaction) {
        showToast('Ошибка: транзакция не найдена', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/exchange/confirm-sent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: currentTransaction.transaction_id })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Заявка отправлена на проверку!', 'success');
            cancelExchange();
            loadTransactions();
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showToast('Ошибка подтверждения', 'error');
    }
}

function copyAddress() {
    const address = document.getElementById('wallet-address').textContent;
    navigator.clipboard.writeText(address)
        .then(() => showToast('Адрес скопирован!', 'success'))
        .catch(() => showToast('Не удалось скопировать', 'error'));
}

// ==================== PROFILE ====================
function showProfile() {
    document.getElementById('profile-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeProfile() {
    document.getElementById('profile-modal').style.display = 'none';
    document.body.style.overflow = '';
    document.getElementById('2fa-setup').style.display = 'none';
}

// ==================== 2FA ====================
async function setup2FA() {
    try {
        const response = await fetch('/api/2fa/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('qr-code').src = data.qr_code;
            document.getElementById('secret-key').textContent = data.secret;
            document.getElementById('2fa-setup').style.display = 'block';
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showToast('Ошибка настройки 2FA', 'error');
    }
}

async function verify2FA() {
    const code = document.getElementById('totp-code').value;
    
    if (!code || code.length !== 6) {
        showToast('Введите 6-значный код', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('2FA успешно подключена!', 'success');
            currentUser.totp_enabled = true;
            updateUserUI();
            document.getElementById('2fa-setup').style.display = 'none';
            document.getElementById('totp-code').value = '';
        } else {
            showToast(data.error || 'Неверный код', 'error');
        }
    } catch (error) {
        showToast('Ошибка проверки кода', 'error');
    }
}

async function disable2FA() {
    const code = prompt('Введите код из аутентификатора для отключения 2FA:');
    
    if (!code) return;
    
    try {
        const response = await fetch('/api/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('2FA отключена', 'success');
            currentUser.totp_enabled = false;
            updateUserUI();
        } else {
            showToast(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showToast('Ошибка отключения 2FA', 'error');
    }
}

function copySecret() {
    const secret = document.getElementById('secret-key').textContent;
    navigator.clipboard.writeText(secret)
        .then(() => showToast('Секретный ключ скопирован!', 'success'))
        .catch(() => showToast('Не удалось скопировать', 'error'));
}

// ==================== LOGOUT ====================
function logout() {
    currentUser = null;
    window.location.reload();
}

// ==================== UTILITIES ====================
function formatRub(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 2
    }).format(amount || 0);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// Close modal on outside click
document.getElementById('profile-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeProfile();
    }
});
