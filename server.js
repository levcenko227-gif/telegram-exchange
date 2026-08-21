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

const db = new Database('exchange.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    username TEXT UNIQUE,
    password_hash TEXT,
    first_name TEXT,
    balance_rub REAL DEFAULT 0,
    total_deposited_usdt REAL DEFAULT 0,
    total_earned_rub REAL DEFAULT 0,
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
    type TEXT CHECK(type IN ('deposit', 'withdrawal')),
    amount_usdt REAL,
    amount_rub REAL,
    rate REAL,
    markup_percent REAL,
    earned_rub REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'completed')),
    network TEXT DEFAULT 'TRC-20',
    tx_hash TEXT,
    wallet_address TEXT,
    withdrawal_name TEXT,
    withdrawal_phone TEXT,
    withdrawal_bank TEXT,
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

  CREATE TABLE IF NOT EXISTS saved_requisites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    bank TEXT,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER DEFAULT 1,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('base_rate', '80');
insertSetting.run('markup_percent', '5');
insertSetting.run('min_deposit_usdt', '20');
insertSetting.run('min_withdrawal_rub', '1000');
insertSetting.run('support_contact', '@support');
insertSetting.run('app_name', 'CryptoSwaap');
insertSetting.run('networks', JSON.stringify([
  { id: 'TRC-20', name: 'USDT TRC-20 (Tron)', enabled: true, wallet: 'YOUR_TRC20_WALLET' },
  { id: 'BEP-20', name: 'USDT BEP-20 (BSC)', enabled: false, wallet: 'YOUR_BEP20_WALLET' },
  { id: 'ERC-20', name: 'USDT ERC-20 (Ethereum)', enabled: false, wallet: 'YOUR_ERC20_WALLET' }
]));

const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cryptoswaap-secret-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' }
});

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getCurrentRate() {
  const baseRate = parseFloat(getSetting('base_rate') || '80');
  const markup = parseFloat(getSetting('markup_percent') || '5');
  return { base: baseRate, markup, final: baseRate * (1 + markup / 100) };
}

function getNetworks() {
  try { return JSON.parse(getSetting('networks') || '[]'); } catch { return []; }
}

function isUserAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

function isAdminAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Не авторизован' });
}

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

// ==================== AUTH ====================
app.post('/api/register', (req, res) => {
  const { username, password, telegram_id, first_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Этот логин уже занят' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (telegram_id, username, password_hash, first_name, is_verified) VALUES (?, ?, ?, ?, 1)').run(telegram_id || null, username, hash, first_name || username, 1);
  req.session.userId = result.lastInsertRowid;
  res.json({ success: true, user: { id: result.lastInsertRowid, username, first_name: first_name || username, balance_rub: 0, totp_enabled: false } });
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password, totp_code } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 0)').run(req.ip, username);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  if (user.totp_enabled && user.totp_secret) {
    if (!totp_code) return res.json({ requires_2fa: true });
    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totp_code, window: 1 });
    if (!verified) return res.status(401).json({ error: 'Неверный код 2FA' });
  }
  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(user.id);
  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, username: user.username, first_name: user.first_name, balance_rub: user.balance_rub, total_deposited_usdt: user.total_deposited_usdt, total_earned_rub: user.total_earned_rub, totp_enabled: user.totp_enabled === 1 } });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// ==================== USER API ====================
app.get('/api/user/profile', isUserAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json({ id: user.id, username: user.username, first_name: user.first_name, balance_rub: user.balance_rub, total_deposited_usdt: user.total_deposited_usdt, total_earned_rub: user.total_earned_rub, totp_enabled: user.totp_enabled === 1, created_at: user.created_at });
});

app.post('/api/user/change-password', isUserAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) return res.status(400).json({ error: 'Неверный пароль' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Минимум 6 символов' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.userId);
  res.json({ success: true });
});

app.post('/api/user/change-username', isUserAuth, (req, res) => {
  const { new_username } = req.body;
  if (!new_username || new_username.length < 3) return res.status(400).json({ error: 'Минимум 3 символа' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(new_username, req.session.userId);
  if (existing) return res.status(400).json({ error: 'Логин занят' });
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(new_username, req.session.userId);
  res.json({ success: true });
});

// ==================== RATE & NETWORKS ====================
app.get('/api/exchange/rate', (req, res) => {
  const rate = getCurrentRate();
  const networks = getNetworks().filter(n => n.enabled);
  res.json({ base_rate: rate.base, markup_percent: rate.markup, final_rate: rate.final.toFixed(2), networks });
});

// ==================== DEPOSIT ====================
app.post('/api/deposit/create', isUserAuth, (req, res) => {
  const { amount_usdt, network, tx_hash } = req.body;
  const minDeposit = parseFloat(getSetting('min_deposit_usdt') || '20');
  if (!amount_usdt || amount_usdt < minDeposit) return res.status(400).json({ error: `Минимум: ${minDeposit} USDT` });
  if (!tx_hash || tx_hash.length < 10) return res.status(400).json({ error: 'Введите хеш транзакции' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  const rate = getCurrentRate();
  const amountRub = amount_usdt * rate.final;
  const earnedRub = amount_usdt * rate.base * (rate.markup / 100);
  const networks = getNetworks();
  const net = networks.find(n => n.id === (network || 'TRC-20'));
  if (!net || !net.enabled) return res.status(400).json({ error: 'Сеть не поддерживается' });
  const result = db.prepare(`INSERT INTO transactions (user_id, type, amount_usdt, amount_rub, rate, markup_percent, earned_rub, network, tx_hash, wallet_address) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.session.userId, amount_usdt, amountRub, rate.final, rate.markup, earnedRub, network || 'TRC-20', tx_hash, net.wallet);
  db.prepare('INSERT INTO notifications (message) VALUES (?)').run(`💰 Новый депозит: ${amount_usdt} USDT (${network || 'TRC-20'}) от ${user.username}. Хеш: ${tx_hash}`);
  res.json({ success: true, transaction_id: result.lastInsertRowid, amount_usdt, amount_rub: amountRub.toFixed(2), earned_rub: earnedRub.toFixed(2), rate: rate.final.toFixed(2) });
});

app.get('/api/transactions', isUserAuth, (req, res) => {
  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  res.json(transactions);
});

// ==================== DASHBOARD STATS ====================
app.get('/api/user/stats', isUserAuth, (req, res) => {
  const userId = req.session.userId;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const todayStats = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as usdt, COALESCE(SUM(amount_rub),0) as rub, COALESCE(SUM(earned_rub),0) as earned FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'confirmed' AND created_at >= ?").get(userId, today);
  const weekStats = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as usdt, COALESCE(SUM(amount_rub),0) as rub, COALESCE(SUM(earned_rub),0) as earned FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'confirmed' AND created_at >= ?").get(userId, weekAgo);
  const monthStats = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as usdt, COALESCE(SUM(amount_rub),0) as rub, COALESCE(SUM(earned_rub),0) as earned FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'confirmed' AND created_at >= ?").get(userId, monthAgo);
  const totalStats = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as usdt, COALESCE(SUM(amount_rub),0) as rub, COALESCE(SUM(earned_rub),0) as earned FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'confirmed'").get(userId);
  res.json({ today: todayStats, week: weekStats, month: monthStats, total: totalStats });
});

// ==================== WITHDRAWAL ====================
app.get('/api/requisites', isUserAuth, (req, res) => {
  const requisites = db.prepare('SELECT * FROM saved_requisites WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(req.session.userId);
  res.json(requisites);
});

app.post('/api/requisites/save', isUserAuth, (req, res) => {
  const { name, phone, bank } = req.body;
  if (!name || !phone || !bank) return res.status(400).json({ error: 'Заполните все поля' });
  const count = db.prepare('SELECT COUNT(*) as c FROM saved_requisites WHERE user_id = ?').get(req.session.userId).c;
  db.prepare('INSERT INTO saved_requisites (user_id, name, phone, bank, is_default) VALUES (?, ?, ?, ?, ?)').run(req.session.userId, name, phone, bank, count === 0 ? 1 : 0);
  res.json({ success: true });
});

app.post('/api/requisites/:id/default', isUserAuth, (req, res) => {
  db.prepare('UPDATE saved_requisites SET is_default = 0 WHERE user_id = ?').run(req.session.userId);
  db.prepare('UPDATE saved_requisites SET is_default = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

app.post('/api/requisites/:id/delete', isUserAuth, (req, res) => {
  db.prepare('DELETE FROM saved_requisites WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

app.post('/api/withdrawal/create', isUserAuth, (req, res) => {
  const { amount_rub, name, phone, bank } = req.body;
  const minWithdrawal = parseFloat(getSetting('min_withdrawal_rub') || '1000');
  if (!amount_rub || amount_rub < minWithdrawal) return res.status(400).json({ error: `Минимум: ${minWithdrawal} ₽` });
  if (!name || !phone || !bank) return res.status(400).json({ error: 'Заполните реквизиты' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.balance_rub < amount_rub) return res.status(400).json({ error: 'Недостаточно средств' });
  const result = db.prepare(`INSERT INTO transactions (user_id, type, amount_rub, status, withdrawal_name, withdrawal_phone, withdrawal_bank) VALUES (?, 'withdrawal', ?, 'pending', ?, ?, ?)`)
    .run(req.session.userId, amount_rub, name, phone, bank);
  db.prepare('UPDATE users SET balance_rub = balance_rub - ? WHERE id = ?').run(amount_rub, req.session.userId);
  db.prepare('INSERT INTO notifications (message) VALUES (?)').run(`💸 Заявка на вывод: ${amount_rub} ₽ от ${user.username}. ${bank}, ${name}, ${phone}`);
  res.json({ success: true, transaction_id: result.lastInsertRowid });
});

// ==================== 2FA ====================
app.post('/api/2fa/setup', isUserAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: 'CryptoSwaap', issuer: 'CryptoSwaap' });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.userId);
  try { const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url); res.json({ success: true, secret: secret.base32, qr_code: qrCodeUrl }); }
  catch (err) { res.status(500).json({ error: 'Ошибка QR' }); }
});

app.post('/api/2fa/verify', isUserAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.totp_secret) return res.status(400).json({ error: '2FA не настроена' });
  const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 1 });
  if (verified) { db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.session.userId); res.json({ success: true }); }
  else res.status(400).json({ error: 'Неверный код' });
});

app.post('/api/2fa/disable', isUserAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.totp_enabled && user.totp_secret) {
    const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Неверный код' });
  }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.session.userId);
  res.json({ success: true });
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
    const verified = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: totp_code, window: 1 });
    if (!verified) return res.status(401).json({ error: 'Неверный код 2FA' });
  }
  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.json({ success: true, admin: { id: admin.id, username: admin.username, totp_enabled: admin.totp_enabled === 1 } });
});

app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.post('/api/admin/change-password', isAdminAuth, (req, res) => {
  const { current_password, new_password, new_username } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) return res.status(400).json({ error: 'Неверный пароль' });
  if (new_password && new_password.length >= 6) db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.adminId);
  if (new_username && new_username.length >= 3) {
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ? AND id != ?').get(new_username, req.session.adminId);
    if (existing) return res.status(400).json({ error: 'Логин занят' });
    db.prepare('UPDATE admin_users SET username = ? WHERE id = ?').run(new_username, req.session.adminId);
    req.session.adminUsername = new_username;
  }
  res.json({ success: true });
});

// ==================== ADMIN 2FA ====================
app.post('/api/admin/2fa/setup', isAdminAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: 'CryptoSwaap Admin', issuer: 'CryptoSwaap' });
  db.prepare('UPDATE admin_users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.adminId);
  try { const qr = await QRCode.toDataURL(secret.otpauth_url); res.json({ success: true, secret: secret.base32, qr_code: qr }); }
  catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/2fa/verify', isAdminAuth, (req, res) => {
  const { code } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  if (!admin.totp_secret) return res.status(400).json({ error: 'Настройте 2FA' });
  const verified = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: code, window: 2 });
  if (verified) { db.prepare('UPDATE admin_users SET totp_enabled = 1 WHERE id = ?').run(req.session.adminId); res.json({ success: true }); }
  else res.status(400).json({ error: 'Неверный код' });
});

app.post('/api/admin/2fa/disable', isAdminAuth, (req, res) => {
  const { code } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  if (admin.totp_enabled && admin.totp_secret) {
    const verified = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: code, window: 2 });
    if (!verified) return res.status(400).json({ error: 'Неверный код' });
  }
  db.prepare('UPDATE admin_users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.session.adminId);
  res.json({ success: true });
});

// ==================== ADMIN API ====================
app.get('/api/admin/profile', isAdminAuth, (req, res) => {
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  res.json({ id: admin.id, username: admin.username, totp_enabled: admin.totp_enabled === 1 });
});

app.get('/api/admin/notifications', isAdminAuth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE is_read = 0').get().c;
  res.json({ notifications, unread });
});

app.post('/api/admin/notifications/read', isAdminAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1').run();
  res.json({ success: true });
});

app.get('/api/admin/dashboard', isAdminAuth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalDeposits = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'deposit'").get().c;
  const pendingDeposits = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'deposit' AND status = 'pending'").get().c;
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type = 'withdrawal' AND status = 'pending'").get().c;
  const totalVolumeUsdt = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as t FROM transactions WHERE type = 'deposit' AND status = 'confirmed'").get().t;
  const totalEarned = db.prepare("SELECT COALESCE(SUM(earned_rub),0) as t FROM transactions WHERE type = 'deposit' AND status = 'confirmed'").get().t;
  const recent = db.prepare(`SELECT t.*, u.username FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 10`).all();
  res.json({ total_users: totalUsers, total_deposits: totalDeposits, pending_deposits: pendingDeposits, pending_withdrawals: pendingWithdrawals, total_volume_usdt: totalVolumeUsdt, total_earned_rub: totalEarned, recent_transactions: recent });
});

app.get('/api/admin/settings', isAdminAuth, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

app.post('/api/admin/settings', isAdminAuth, (req, res) => {
  const { key, value } = req.body;
  const allowedKeys = ['base_rate', 'markup_percent', 'min_deposit_usdt', 'min_withdrawal_rub', 'support_contact', 'app_name', 'networks'];
  if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Недопустимый ключ' });
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  res.json({ success: true });
});

app.get('/api/admin/transactions', isAdminAuth, (req, res) => {
  const { status, type } = req.query;
  let query = `SELECT t.*, u.username, u.telegram_id FROM transactions t JOIN users u ON t.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (type) { query += ' AND t.type = ?'; params.push(type); }
  query += ' ORDER BY t.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/transactions/:id/confirm', isAdminAuth, (req, res) => {
  const { admin_comment } = req.body;
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найдена' });
  if (t.status !== 'pending') return res.status(400).json({ error: 'Уже обработана' });
  if (t.type === 'deposit') {
    db.prepare("UPDATE transactions SET status = 'confirmed', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
    db.prepare('UPDATE users SET balance_rub = balance_rub + ?, total_deposited_usdt = total_deposited_usdt + ?, total_earned_rub = total_earned_rub + ? WHERE id = ?').run(t.amount_rub, t.amount_usdt, t.earned_rub, t.user_id);
  } else {
    db.prepare("UPDATE transactions SET status = 'completed', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
  }
  res.json({ success: true });
});

app.post('/api/admin/transactions/:id/reject', isAdminAuth, (req, res) => {
  const { admin_comment } = req.body;
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найдена' });
  if (t.status !== 'pending') return res.status(400).json({ error: 'Уже обработана' });
  db.prepare("UPDATE transactions SET status = 'rejected', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
  if (t.type === 'withdrawal') { db.prepare('UPDATE users SET balance_rub = balance_rub + ? WHERE id = ?').run(t.amount_rub, t.user_id); }
  res.json({ success: true });
});

// ==================== ADMIN CREATE USER ====================
app.post('/api/admin/create-user', isAdminAuth, (req, res) => {
  const { custom_username, custom_password } = req.body;
  let username = custom_username || 'user_' + generateRandomString(6);
  let password = custom_password || generatePassword(8);
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Логин занят' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, first_name, is_verified) VALUES (?, ?, ?, 1)').run(username, hash, username);
  res.json({ success: true, user: { id: result.lastInsertRowid, username, password, balance_rub: 0 } });
});

app.get('/api/admin/users', isAdminAuth, (req, res) => {
  res.json(db.prepare('SELECT id, telegram_id, username, first_name, balance_rub, total_deposited_usdt, total_earned_rub, totp_enabled, is_blocked, created_at FROM users ORDER BY created_at DESC').all());
});

app.get('/api/admin/users/:id', isAdminAuth, (req, res) => {
  const user = db.prepare('SELECT id, telegram_id, username, first_name, balance_rub, total_deposited_usdt, total_earned_rub, totp_enabled, is_blocked, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...user, transactions });
});

app.post('/api/admin/users/:id/balance', isAdminAuth, (req, res) => {
  const { amount, action } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (action === 'add') db.prepare('UPDATE users SET balance_rub = balance_rub + ? WHERE id = ?').run(amount, req.params.id);
  else { if (user.balance_rub < amount) return res.status(400).json({ error: 'Недостаточно' }); db.prepare('UPDATE users SET balance_rub = balance_rub - ? WHERE id = ?').run(amount, req.params.id); }
  const updated = db.prepare('SELECT balance_rub FROM users WHERE id = ?').get(req.params.id);
  res.json({ success: true, new_balance: updated.balance_rub });
});

app.post('/api/admin/users/:id/block', isAdminAuth, (req, res) => { db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/unblock', isAdminAuth, (req, res) => { db.prepare('UPDATE users SET is_blocked = 0 WHERE id = ?').run(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/reset-2fa', isAdminAuth, (req, res) => { db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.params.id); res.json({ success: true }); });
app.post('/api/admin/users/:id/reset-password', isAdminAuth, (req, res) => {
  const new_password = generatePassword(8);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.params.id);
  res.json({ success: true, new_password });
});

// ==================== STATIC ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CryptoSwaap запущен на http://localhost:${PORT}`);
  console.log(`📱 Приложение: http://localhost:${PORT}`);
  console.log(`🔧 Админка: http://localhost:${PORT}/admin`);
});
