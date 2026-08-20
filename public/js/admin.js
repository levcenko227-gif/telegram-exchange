// ==================== GLOBALS ====================
let currentPage = 'dashboard';

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

async function checkAuth() {
    try {
        const response = await fetch('/api/admin/dashboard');
        if (response.ok) {
            showDashboard();
        }
    } catch (error) {
        // Not authenticated
    }
}

// ==================== LOGIN ====================
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const totpCode = document.getElementById('login-2fa').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, totp_code: totpCode })
        });
        
        const data = await response.json();
        
        if (data.requires_2fa) {
            document.getElementById('2fa-group').style.display = 'block';
            document.getElementById('login-2fa').focus();
            errorEl.style.display = 'none';
            return;
        }
        
        if (data.success) {
            showDashboard();
            errorEl.style.display = 'none';
        } else {
            errorEl.textContent = data.error || 'Ошибка авторизации';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        errorEl.textContent = 'Ошибка подключения';
        errorEl.style.display = 'block';
    }
}

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'flex';
    loadDashboard();
    loadSettings();
    loadAdmin2FAStatus();
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.reload();
}

// ==================== NAVIGATION ====================
function showPage(page) {
    currentPage = page;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });
    
    // Update title
    const titles = {
        dashboard: 'Дашборд',
        transactions: 'Транзакции',
        users: 'Пользователи',
        settings: 'Настройки',
        security: 'Безопасность'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    
    // Load data
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'transactions':
            loadAllTransactions();
            break;
        case 'users':
            loadUsers();
            break;
        case 'settings':
            loadSettings();
            break;
        case 'security':
            loadAdmin2FAStatus();
            break;
    }
    
    // Close sidebar on mobile
    document.querySelector('.sidebar').classList.remove('open');
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
    try {
        const response = await fetch('/api/admin/dashboard');
        const data = await response.json();
        
        document.getElementById('stat-users').textContent = data.total_users;
        document.getElementById('stat-transactions').textContent = data.total_transactions;
        document.getElementById('stat-pending').textContent = data.pending_transactions;
        document.getElementById('stat-volume').textContent = `${data.total_volume_usdt.toFixed(2)} USDT`;
        
        renderRecentTransactions(data.recent_transactions);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function renderRecentTransactions(transactions) {
    const tbody = document.getElementById('recent-transactions-body');
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--gray-400);">Нет транзакций</td></tr>';
        return;
    }
    
    tbody.innerHTML = transactions.map(t => `
        <tr>
            <td>#${t.id}</td>
            <td>${t.first_name || t.username || 'N/A'}</td>
            <td>${t.amount_usdt} USDT</td>
            <td><span class="badge badge-${t.status}">${getStatusText(t.status)}</span></td>
            <td>${formatDate(t.created_at)}</td>
        </tr>
    `).join('');
}

// ==================== TRANSACTIONS ====================
async function loadAllTransactions() {
    const status = document.getElementById('filter-status').value;
    
    try {
        let url = '/api/admin/transactions';
        if (status) url += `?status=${status}`;
        
        const response = await fetch(url);
        const transactions = await response.json();
        
        renderAllTransactions(transactions);
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

function renderAllTransactions(transactions) {
    const tbody = document.getElementById('all-transactions-body');
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--gray-400);">Нет транзакций</td></tr>';
        return;
    }
    
    tbody.innerHTML = transactions.map(t => `
        <tr>
            <td>#${t.id}</td>
            <td>${t.first_name || t.username || 'N/A'}<br><small style="color: var(--gray-400);">@${t.username || 'N/A'}</small></td>
            <td>${t.type === 'exchange' ? '💱 Обмен' : '💸 Вывод'}</td>
            <td>${t.amount_usdt}</td>
            <td>${formatRub(t.amount_rub)}</td>
            <td>${t.rate} ₽</td>
            <td><span class="badge badge-${t.status}">${getStatusText(t.status)}</span></td>
            <td>
                ${t.status === 'pending' ? `
                    <button class="btn btn-success btn-small" onclick="confirmTransaction(${t.id})">✓</button>
                    <button class="btn btn-danger btn-small" onclick="rejectTransaction(${t.id})">✕</button>
                ` : `
                    <button class="btn btn-small" onclick="viewTransaction(${t.id})">👁</button>
                `}
            </td>
        </tr>
    `).join('');
}

async function confirmTransaction(id) {
    const comment = prompt('Комментарий (необязательно):');
    
    try {
        const response = await fetch(`/api/admin/transactions/${id}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_comment: comment })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Транзакция подтверждена', 'success');
            loadAllTransactions();
            loadDashboard();
        } else {
            showNotification(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showNotification('Ошибка подтверждения', 'error');
    }
}

async function rejectTransaction(id) {
    const comment = prompt('Причина отклонения:');
    if (!comment) return;
    
    try {
        const response = await fetch(`/api/admin/transactions/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_comment: comment })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Транзакция отклонена', 'success');
            loadAllTransactions();
        } else {
            showNotification(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showNotification('Ошибка отклонения', 'error');
    }
}

function viewTransaction(id) {
    showNotification(`Просмотр транзакции #${id}`, 'info');
}

// ==================== USERS ====================
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const users = await response.json();
        
        renderUsers(users);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-body');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--gray-400);">Нет пользователей</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>#${u.id}</td>
            <td>${u.telegram_id}</td>
            <td>${u.first_name || u.username || 'N/A'}</td>
            <td>${formatRub(u.balance_rub)}</td>
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
}

async function viewUser(id) {
    try {
        const response = await fetch(`/api/admin/users/${id}`);
        const data = await response.json();
        
        showUserModal(data);
    } catch (error) {
        showNotification('Ошибка загрузки пользователя', 'error');
    }
}

function showUserModal(user) {
    const modal = document.getElementById('user-modal');
    const body = document.getElementById('user-modal-body');
    
    body.innerHTML = `
        <div class="user-detail">
            <div class="user-info-header">
                <span class="user-avatar">👤</span>
                <div>
                    <div class="user-name">${user.first_name || user.username || 'N/A'}</div>
                    <div class="user-id">Telegram ID: ${user.telegram_id}</div>
                </div>
            </div>
            
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Баланс:</span>
                    <span class="info-value">${formatRub(user.balance_rub)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">2FA:</span>
                    <span class="info-value">${user.totp_enabled ? 'Подключена' : 'Не подключена'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Статус:</span>
                    <span class="info-value">${user.is_blocked ? 'Заблокирован' : 'Активен'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Регистрация:</span>
                    <span class="info-value">${formatDate(user.created_at)}</span>
                </div>
            </div>
            
            <h3 style="margin-top: 20px;">Изменить баланс</h3>
            <div style="display: flex; gap: 12px; margin-top: 12px;">
                <input type="number" id="balance-amount" placeholder="Сумма" style="flex: 1; padding: 10px; border: 1px solid var(--gray-300); border-radius: 8px;">
                <button class="btn btn-success" onclick="adjustBalance(${user.id}, 'add')">+</button>
                <button class="btn btn-danger" onclick="adjustBalance(${user.id}, 'subtract')">−</button>
            </div>
            
            <div class="user-actions" style="margin-top: 20px;">
                ${user.totp_enabled ? 
                    `<button class="btn btn-warning" onclick="reset2FA(${user.id})">Сбросить 2FA</button>` : ''
                }
                <button class="btn btn-small" onclick="resetAttempts(${user.id})">Сбросить попытки</button>
            </div>
            
            <h3 style="margin-top: 20px;">Последние транзакции</h3>
            <div style="margin-top: 12px; max-height: 200px; overflow-y: auto;">
                ${user.transactions && user.transactions.length > 0 ? `
                    <table style="width: 100%; font-size: 13px;">
                        <thead>
                            <tr>
                                <th>Дата</th>
                                <th>Тип</th>
                                <th>USDT</th>
                                <th>Статус</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${user.transactions.slice(0, 10).map(t => `
                                <tr>
                                    <td>${formatDate(t.created_at)}</td>
                                    <td>${t.type === 'exchange' ? '💱' : '💸'}</td>
                                    <td>${t.amount_usdt}</td>
                                    <td><span class="badge badge-${t.status}">${getStatusText(t.status)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p style="color: var(--gray-400);">Нет транзакций</p>'}
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('user-modal').style.display = 'none';
}

async function adjustBalance(id, action) {
    const amount = parseFloat(document.getElementById('balance-amount').value);
    
    if (!amount || amount <= 0) {
        showNotification('Введите сумму', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/users/${id}/balance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, action })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Баланс обновлён: ${formatRub(data.new_balance)}`, 'success');
            viewUser(id);
            loadUsers();
        } else {
            showNotification(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showNotification('Ошибка обновления баланса', 'error');
    }
}

async function blockUser(id) {
    if (!confirm('Заблокировать пользователя?')) return;
    
    try {
        const response = await fetch(`/api/admin/users/${id}/block`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showNotification('Пользователь заблокирован', 'success');
            loadUsers();
        }
    } catch (error) {
        showNotification('Ошибка блокировки', 'error');
    }
}

async function unblockUser(id) {
    try {
        const response = await fetch(`/api/admin/users/${id}/unblock`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showNotification('Пользователь разблокирован', 'success');
            loadUsers();
        }
    } catch (error) {
        showNotification('Ошибка разблокировки', 'error');
    }
}

async function reset2FA(id) {
    if (!confirm('Сбросить 2FA для пользователя?')) return;
    
    try {
        const response = await fetch(`/api/admin/users/${id}/reset-2fa`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showNotification('2FA сброшена', 'success');
            viewUser(id);
        }
    } catch (error) {
        showNotification('Ошибка сброса 2FA', 'error');
    }
}

async function resetAttempts(id) {
    try {
        const response = await fetch(`/api/admin/users/${id}/reset-attempts`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showNotification('Счётчик попыток сброшен', 'success');
        }
    } catch (error) {
        showNotification('Ошибка', 'error');
    }
}

// ==================== SETTINGS ====================
async function loadSettings() {
    try {
        const response = await fetch('/api/admin/settings');
        const settings = await response.json();
        
        document.getElementById('setting-base_rate').value = settings.base_rate || '';
        document.getElementById('setting-markup_percent').value = settings.markup_percent || '';
        document.getElementById('setting-trc20_wallet').value = settings.trc20_wallet || '';
        document.getElementById('setting-min_exchange_usdt').value = settings.min_exchange_usdt || '';
        document.getElementById('setting-support_contact').value = settings.support_contact || '';
        
        // Calculate final rate
        const base = parseFloat(settings.base_rate) || 0;
        const markup = parseFloat(settings.markup_percent) || 0;
        const finalRate = base * (1 + markup / 100);
        document.getElementById('info-final-rate').textContent = `${finalRate.toFixed(2)} ₽`;
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveSettings(event) {
    event.preventDefault();
    
    const settings = {
        base_rate: document.getElementById('setting-base_rate').value,
        markup_percent: document.getElementById('setting-markup_percent').value,
        trc20_wallet: document.getElementById('setting-trc20_wallet').value,
        min_exchange_usdt: document.getElementById('setting-min_exchange_usdt').value,
        support_contact: document.getElementById('setting-support_contact').value
    };
    
    try {
        for (const [key, value] of Object.entries(settings)) {
            await fetch('/api/admin/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
        }
        
        showNotification('Настройки сохранены', 'success');
        loadSettings();
    } catch (error) {
        showNotification('Ошибка сохранения', 'error');
    }
}

// ==================== ADMIN 2FA ====================
async function loadAdmin2FAStatus() {
    try {
        const response = await fetch('/api/admin/settings');
        const settings = await response.json();
        
        document.getElementById('admin-2fa-status').textContent = 'Проверьте в настройках';
    } catch (error) {
        console.error('Error loading 2FA status:', error);
    }
}

async function setupAdmin2FA() {
    try {
        const response = await fetch('/api/admin/2fa/setup', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('admin-qr-code').src = data.qr_code;
            document.getElementById('admin-secret-key').textContent = data.secret;
            document.getElementById('admin-2fa-setup').style.display = 'block';
        } else {
            showNotification(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        showNotification('Ошибка настройки 2FA', 'error');
    }
}

async function verifyAdmin2FA() {
    const code = document.getElementById('admin-totp-code').value;
    
    if (!code || code.length !== 6) {
        showNotification('Введите 6-значный код', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('2FA успешно подключена!', 'success');
            document.getElementById('admin-2fa-setup').style.display = 'none';
            document.getElementById('admin-2fa-status').textContent = 'Подключена ✓';
            document.getElementById('admin-2fa-status').classList.add('active');
        } else {
            showNotification(data.error || 'Неверный код', 'error');
        }
    } catch (error) {
        showNotification('Ошибка проверки кода', 'error');
    }
}

// ==================== UTILITIES ====================
function getStatusText(status) {
    const statuses = {
        'pending': 'Ожидает',
        'confirmed': 'Подтверждено',
        'rejected': 'Отклонено'
    };
    return statuses[status] || status;
}

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

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        border-radius: 12px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
    `;
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        info: '#3b82f6',
        warning: '#f59e0b'
    };
    
    notification.style.background = colors[type] || colors.info;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Close modal on outside click
document.getElementById('user-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeUserModal();
    }
});

// Add animation style
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);
