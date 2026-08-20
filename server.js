const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== DATABASE ====================
const db = new Database('exchange.db');

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    username TEXT,
    first_name TEXT,
    balance_rub REAL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    is_blocked INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    lock_until INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT CHECK(type IN ('exchange', 'withdrawal')),
    amount_usdt REAL,
    amount_rub REAL,
    rate REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected')),
    wallet_address TEXT,
    withdrawal_details TEXT,
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT,
    username TEXT,
    success INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Insert default settings if not exists
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('base_rate', '88');
insertSetting.run('markup_percent', '5');
insertSetting.run('trc20_wallet', 'YOUR_TRC20_WALLET_ADDRESS');
insertSetting.run('min_exchange_usdt', '10');
insertSetting.run('support_contact', '@support');

// Create default admin if not exists
const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

// ==================== MIDDLEWARE ====================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 2 * 60 * 60 * 1000 // 2 hours
  }
}));

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== HELPERS ====================
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getCurrentRate() {
  const baseRate = parseFloat(getSetting('base_rate') || '88');
  const markup = parseFloat(getSetting('markup_percent') || '5');
  return baseRate * (1 + markup / 100);
}

function isAuthenticated(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.status(401).json({ error: 'Не авторизован' });
}

// ==================== TELEGRAM AUTH ====================
app.post('/api/auth/telegram', (req, res) => {
  const { telegram_id, username, first_name } = req.body;
  
  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID обязателен' });
  }

  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  
  if (!user) {
    db.prepare('INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)').run(telegram_id, username, first_name);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
  }

  req.session.userId = user.id;
  req.session.telegramId = telegram_id;

  res.json({
    success: true,
    user: {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: user.first_name,
      balance_rub: user.balance_rub,
      totp_enabled: user.totp_enabled === 1
    }
  });
});

// ==================== USER API ====================
app.get('/api/user/profile', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  res.json({
    id: user.id,
    telegram_id: user.telegram_id,
    username: user.username,
    first_name: user.first_name,
    balance_rub: user.balance_rub,
    totp_enabled: user.totp_enabled === 1
  });
});

app.get('/api/exchange/rate', (req, res) => {
  const baseRate = parseFloat(getSetting('base_rate') || '88');
  const markup = parseFloat(getSetting('markup_percent') || '5');
  const finalRate = getCurrentRate();
  
  res.json({
    base_rate: baseRate,
    markup_percent: markup,
    final_rate: finalRate.toFixed(2)
  });
});

app.post('/api/exchange/create', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { amount_usdt } = req.body;
  const minExchange = parseFloat(getSetting('min_exchange_usdt') || '10');

  if (!amount_usdt || amount_usdt < minExchange) {
    return res.status(400).json({ error: `Минимальная сумма обмена: ${minExchange} USDT` });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.is_blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }

  const rate = getCurrentRate();
  const amountRub = amount_usdt * rate;
  const walletAddress = getSetting('trc20_wallet');

  const result = db.prepare(`
    INSERT INTO transactions (user_id, type, amount_usdt, amount_rub, rate, wallet_address)
    VALUES (?, 'exchange', ?, ?, ?, ?)
  `).run(req.session.userId, amount_usdt, amountRub, rate, walletAddress);

  res.json({
    success: true,
    transaction_id: result.lastInsertRowid,
    amount_usdt,
    amount_rub: amountRub.toFixed(2),
    rate: rate.toFixed(2),
    wallet_address: walletAddress
  });
});

app.post('/api/exchange/confirm-sent', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { transaction_id } = req.body;

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(transaction_id, req.session.userId);
  
  if (!transaction) {
    return res.status(404).json({ error: 'Транзакция не найдена' });
  }

  res.json({
    success: true,
    message: 'Заявка отправлена на проверку. Ожидайте подтверждения.'
  });
});

app.get('/api/transactions', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const transactions = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.session.userId);

  res.json(transactions);
});

// ==================== 2FA FOR USERS ====================
app.post('/api/2fa/setup', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const secret = speakeasy.generateSecret({
    name: 'TelegramExchange',
    issuer: 'ExchangeApp'
  });

  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.userId);

  try {
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({
      success: true,
      secret: secret.base32,
      qr_code: qrCodeUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

app.post('/api/2fa/verify', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!user.totp_secret) {
    return res.status(400).json({ error: '2FA не настроена' });
  }

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: code,
    window: 1
  });

  if (verified) {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.session.userId);
    res.json({ success: true, message: '2FA успешно активирована' });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

app.post('/api/2fa/disable', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (user.totp_enabled && user.totp_secret) {
    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ error: 'Неверный код' });
    }
  }

  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.session.userId);
  res.json({ success: true, message: '2FA отключена' });
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password, totp_code } = req.body;
  const ip = req.ip;

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 0)').run(ip, username);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  if (admin.totp_enabled && admin.totp_secret) {
    if (!totp_code) {
      return res.json({ requires_2fa: true });
    }

    const verified = speakeasy.totp.verify({
      secret: admin.totp_secret,
      encoding: 'base32',
      token: totp_code,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({ error: 'Неверный код 2FA' });
    }
  }

  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(ip, username);
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;

  res.json({
    success: true,
    admin: {
      id: admin.id,
      username: admin.username,
      totp_enabled: admin.totp_enabled === 1
    }
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==================== ADMIN 2FA ====================
app.post('/api/admin/2fa/setup', isAuthenticated, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: 'ExchangeAdmin',
    issuer: 'ExchangeApp'
  });

  db.prepare('UPDATE admin_users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.adminId);

  try {
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({
      success: true,
      secret: secret.base32,
      qr_code: qrCodeUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

app.post('/api/admin/2fa/verify', isAuthenticated, (req, res) => {
  const { code } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);

  if (!admin.totp_secret) {
    return res.status(400).json({ error: '2FA не настроена' });
  }

  const verified = speakeasy.totp.verify({
    secret: admin.totp_secret,
    encoding: 'base32',
    token: code,
    window: 1
  });

  if (verified) {
    db.prepare('UPDATE admin_users SET totp_enabled = 1 WHERE id = ?').run(req.session.adminId);
    res.json({ success: true, message: '2FA успешно активирована' });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

// ==================== ADMIN API ====================
app.get('/api/admin/dashboard', isAuthenticated, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
  const pendingTransactions = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'pending'").get().count;
  const totalVolumeUsdt = db.prepare("SELECT COALESCE(SUM(amount_usdt), 0) as total FROM transactions WHERE status = 'confirmed' AND type = 'exchange'").get().total;
  const totalVolumeRub = db.prepare("SELECT COALESCE(SUM(amount_rub), 0) as total FROM transactions WHERE status = 'confirmed' AND type = 'exchange'").get().total;

  const recentTransactions = db.prepare(`
    SELECT t.*, u.username, u.first_name 
    FROM transactions t 
    JOIN users u ON t.user_id = u.id 
    ORDER BY t.created_at DESC 
    LIMIT 10
  `).all();

  res.json({
    total_users: totalUsers,
    total_transactions: totalTransactions,
    pending_transactions: pendingTransactions,
    total_volume_usdt: totalVolumeUsdt,
    total_volume_rub: totalVolumeRub,
    recent_transactions: recentTransactions
  });
});

app.get('/api/admin/settings', isAuthenticated, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(row => {
    settings[row.key] = row.value;
  });
  res.json(settings);
});

app.post('/api/admin/settings', isAuthenticated, (req, res) => {
  const { key, value } = req.body;
  
  const allowedKeys = ['base_rate', 'markup_percent', 'trc20_wallet', 'min_exchange_usdt', 'support_contact'];
  if (!allowedKeys.includes(key)) {
    return res.status(400).json({ error: 'Недопустимый ключ настройки' });
  }

  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  res.json({ success: true });
});

app.get('/api/admin/transactions', isAuthenticated, (req, res) => {
  const { status, type } = req.query;
  
  let query = `
    SELECT t.*, u.username, u.first_name, u.telegram_id 
    FROM transactions t 
    JOIN users u ON t.user_id = u.id 
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (type) {
    query += ' AND t.type = ?';
    params.push(type);
  }

  query += ' ORDER BY t.created_at DESC';

  const transactions = db.prepare(query).all(...params);
  res.json(transactions);
});

app.post('/api/admin/transactions/:id/confirm', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { admin_comment } = req.body;

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!transaction) {
    return res.status(404).json({ error: 'Транзакция не найдена' });
  }

  if (transaction.status !== 'pending') {
    return res.status(400).json({ error: 'Транзакция уже обработана' });
  }

  db.prepare("UPDATE transactions SET status = 'confirmed', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', id);

  if (transaction.type === 'exchange') {
    db.prepare('UPDATE users SET balance_rub = balance_rub + ? WHERE id = ?').run(transaction.amount_rub, transaction.user_id);
  }

  res.json({ success: true, message: 'Транзакция подтверждена' });
});

app.post('/api/admin/transactions/:id/reject', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { admin_comment } = req.body;

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!transaction) {
    return res.status(404).json({ error: 'Транзакция не найдена' });
  }

  if (transaction.status !== 'pending') {
    return res.status(400).json({ error: 'Транзакция уже обработана' });
  }

  db.prepare("UPDATE transactions SET status = 'rejected', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', id);

  res.json({ success: true, message: 'Транзакция отклонена' });
});

app.get('/api/admin/users', isAuthenticated, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.get('/api/admin/users/:id', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(id);
  const loginHistory = db.prepare(`
    SELECT * FROM login_attempts WHERE username = ? ORDER BY created_at DESC LIMIT 20
  `).all(user.username || user.telegram_id);

  res.json({
    ...user,
    transactions,
    login_history: loginHistory
  });
});

app.post('/api/admin/users/:id/balance', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { amount, action } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (action === 'add') {
    db.prepare('UPDATE users SET balance_rub = balance_rub + ? WHERE id = ?').run(amount, id);
  } else if (action === 'subtract') {
    if (user.balance_rub < amount) {
      return res.status(400).json({ error: 'Недостаточно средств' });
    }
    db.prepare('UPDATE users SET balance_rub = balance_rub - ? WHERE id = ?').run(amount, id);
  }

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ success: true, new_balance: updatedUser.balance_rub });
});

app.post('/api/admin/users/:id/block', isAuthenticated, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(id);
  res.json({ success: true, message: 'Пользователь заблокирован' });
});

app.post('/api/admin/users/:id/unblock', isAuthenticated, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE users SET is_blocked = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: 'Пользователь разблокирован' });
});

app.post('/api/admin/users/:id/reset-2fa', isAuthenticated, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(id);
  res.json({ success: true, message: '2FA сброшена' });
});

app.post('/api/admin/users/:id/reset-attempts', isAuthenticated, (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE users SET failed_attempts = 0, lock_until = 0 WHERE id = ?').run(id);
  res.json({ success: true, message: 'Счётчик попыток сброшен' });
});

// ==================== STATIC FILES ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📱 Telegram Mini App: http://localhost:${PORT}`);
  console.log(`🔧 Админ-панель: http://localhost:${PORT}/admin`);
  console.log(`\n👤 
