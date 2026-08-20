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
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    username TEXT UNIQUE,
    password_hash TEXT,
    first_name TEXT,
    balance_rub REAL DEFAULT 0,
    total_exchanged_usdt REAL DEFAULT 0,
    total_received_rub REAL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    is_blocked INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
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
`);

// Insert default settings
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('base_rate', '88');
insertSetting.run('markup_percent', '5');
insertSetting.run('trc20_wallet', 'YOUR_TRC20_WALLET_ADDRESS');
insertSetting.run('min_exchange_usdt', '10');
insertSetting.run('support_contact', '@support');

// Create default admin
const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

// ==================== MIDDLEWARE ====================
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'super-secret-key-change-in-production-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' }
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

function isUserAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

function isAdminAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

// ==================== USER REGISTRATION ====================
app.post('/api/register', (req, res) => {
  const { username, password, telegram_id, first_name } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Логин минимум 3 символа' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: 'Этот логин уже занят' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (telegram_id, username, password_hash, first_name, is_verified) VALUES (?, ?, ?, ?, 1)'
  ).run(telegram_id || null, username, hash, first_name || username, 1);

  req.session.userId = result.lastInsertRowid;

  res.json({
    success: true,
    user: {
      id: result.lastInsertRowid,
      username,
      first_name: first_name || username,
      balance_rub: 0,
      totp_enabled: false
    }
  });
});

// ==================== USER LOGIN ====================
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password, totp_code } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 0)').run(req.ip, username);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  if (user.is_blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }

  if (user.totp_enabled && user.totp_secret) {
    if (!totp_code) {
      return res.json({ requires_2fa: true });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: totp_code,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({ error: 'Неверный код 2FA' });
    }
  }

  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(user.id);

  req.session.userId = user.id;

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      balance_rub: user.balance_rub,
      total_exchanged_usdt: user.total_exchanged_usdt,
      total_received_rub: user.total_received_rub,
      totp_enabled: user.totp_enabled === 1
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==================== USER PROFILE ====================
app.get('/api/user/profile', isUserAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  res.json({
    id: user.id,
    username: user.username,
    first_name: user.first_name,
    balance_rub: user.balance_rub,
    total_exchanged_usdt: user.total_exchanged_usdt,
    total_received_rub: user.total_received_rub,
    totp_enabled: user.totp_enabled === 1,
    created_at: user.created_at
  });
});

app.post('/api/user/change-password', isUserAuth, (req, res) => {
  const { current_password, new_password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);

  res.json({ success: true, message: 'Пароль изменён' });
});

// ==================== EXCHANGE RATE ====================
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

// ==================== EXCHANGE ====================
app.post('/api/exchange/create', isUserAuth, (req, res) => {
  const { amount_usdt } = req.body;
  const minExchange = parseFloat(getSetting('min_exchange_usdt') || '10');

  if (!amount_usdt || amount_usdt < minExchange) {
    return res.status(400).json({ error: `Минимум: ${minExchange} USDT` });
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

app.post('/api/exchange/confirm-sent', isUserAuth, (req, res) => {
  const { transaction_id } = req.body;

  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(transaction_id, req.session.userId);

  if (!transaction) {
    return res.status(404).json({ error: 'Транзакция не найдена' });
  }

  res.json({ success: true, message: 'Заявка отправлена на проверку' });
});

app.get('/api/transactions', isUserAuth, (req, res) => {
  const transactions = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.session.userId);
  res.json(transactions);
});

// ==================== 2FA FOR USERS ====================
app.post('/api/2fa/setup', isUserAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: 'ExchangeApp',
    issuer: 'TelegramExchange'
  });

  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.userId);

  try {
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, secret: secret.base32, qr_code: qrCodeUrl });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

app.post('/api/2fa/verify', isUserAuth, (req, res) => {
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
    res.json({ success: true, message: '2FA активирована' });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

app.post('/api/2fa/disable', isUserAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (user.totp_enabled && user.totp_secret) {
    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!verified) return res.status(400).json({ error: 'Неверный код' });
  }

  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.session.userId);
  res.json({ success: true, message: '2FA отключена' });
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password, totp_code } = req.body;

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 0)').run(req.ip, username);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  if (admin.totp_enabled && admin.totp_secret) {
    if (!totp_code) return res.json({ requires_2fa: true });

    const verified = speakeasy.totp.verify({
      secret: admin.totp_secret,
      encoding: 'base32',
      token: totp_code,
      window: 1
    });

    if (!verified) return res.status(401).json({ error: 'Неверный код 2FA' });
  }

  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;

  res.json({
    success: true,
    admin: { id: admin.id, username: admin.username, totp_enabled: admin.totp_enabled === 1 }
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==================== ADMIN CHANGE PASSWORD ====================
app.post('/api/admin/change-password', isAdminAuth, (req, res) => {
  const { current_password, new_password, new_username } = req.body;

  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);

  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }

  if (new_password && new_password.length >= 6) {
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, req.session.adminId);
  }

  if (new_username && new_username.length >= 3) {
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ? AND id != ?').get(new_username, req.session.adminId);
    if (existing) return res.status(400).json({ error: 'Этот логин уже занят' });
    db.prepare('UPDATE admin_users SET username = ? WHERE id = ?').run(new_username, req.session.adminId);
    req.session.adminUsername = new_username;
  }

  res.json({ success: true, message: 'Данные обновлены' });
});

// ==================== ADMIN 2FA ====================
app.post('/api/admin/2fa/setup', isAdminAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: 'AdminPanel',
    issuer: 'ExchangeAdmin'
  });

  db.prepare('UPDATE admin_users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.adminId);

  try {
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, secret: secret.base32, qr_code: qrCodeUrl });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

app.post('/api/admin/2fa/verify', isAdminAuth, (req, res) => {
  const { code } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);

  if (!admin.totp_secret) {
    return res.status(400).json({ error: 'Сначала настройте 2FA' });
  }

  const verified = speakeasy.totp.verify({
    secret: admin.totp_secret,
    encoding: 'base32',
    token: code,
    window: 2
  });

  if (verified) {
    db.prepare('UPDATE admin_users SET 
