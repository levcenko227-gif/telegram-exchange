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
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== SSE (Server-Sent Events) ====================
const sseClients = new Set();
const sseUsers = new Map();

function sendSSEToAdmin(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

function sendSSEToUser(userId, event, data) {
  const clients = sseUsers.get(userId);
  if (!clients) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch (e) { clients.delete(res); }
  }
}

function sendSSEToAllUsers(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [userId, clients] of sseUsers) {
    for (const res of clients) {
      try { res.write(msg); } catch (e) { clients.delete(res); }
    }
  }
}

app.get('/api/admin/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/user/events', isUserAuth, (req, res) => {
  const userId = req.session.userId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('event: connected\ndata: {}\n\n');
  if (!sseUsers.has(userId)) sseUsers.set(userId, new Set());
  sseUsers.get(userId).add(res);
  req.on('close', () => {
    const clients = sseUsers.get(userId);
    if (clients) { clients.delete(res); if (clients.size === 0) sseUsers.delete(userId); }
  });
});

const DB_PATH = path.join(__dirname, 'data', 'exchange.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

setInterval(() => {
  const backupPath = path.join(BACKUP_DIR, `backup-${Date.now()}.db`);
  db.backup(backupPath).then(() => console.log(`✅ Backup: ${backupPath}`)).catch(console.error);
}, 60 * 60 * 1000);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    internal_id TEXT UNIQUE,
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
    is_online INTEGER DEFAULT 0,
    password_changed INTEGER DEFAULT 0,
    username_changed INTEGER DEFAULT 0,
    active_requisite_id INTEGER DEFAULT 0,
    held_rub REAL DEFAULT 0,
    withdrawal_pending REAL DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    lock_until INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS verification_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    selfie_url TEXT,
    passport_photo_url TEXT,
    passport_registration_url TEXT,
    phone TEXT,
    telegram_link TEXT,
    social_links TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    order_number TEXT UNIQUE,
    amount_rub REAL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'expired', 'failed')),
    timer_minutes INTEGER DEFAULT 15,
    timer_started_at DATETIME,
    timer_ends_at DATETIME,
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    appeal_number TEXT UNIQUE,
    order_number TEXT,
    amount_rub REAL,
    description TEXT,
    receipt_url TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'rejected')),
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount_usdt REAL,
    amount_rub REAL,
    rate REAL,
    markup_percent REAL,
    earned_rub REAL,
    network TEXT,
    coin TEXT DEFAULT 'USDT',
    tx_hash TEXT,
    wallet_address TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected')),
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount_rub REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'completed')),
    requisite_id INTEGER,
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS requisites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    bank TEXT,
    is_active INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    is_super_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT,
    username TEXT,
    success INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 0,
    message TEXT,
    type TEXT DEFAULT 'info',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try { db.prepare('ALTER TABLE users ADD COLUMN held_rub REAL DEFAULT 0').run(); } catch (e) {}
try { db.prepare('ALTER TABLE users ADD COLUMN withdrawal_pending REAL DEFAULT 0').run(); } catch (e) {}

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('base_rate', '80');
insertSetting.run('markup_percent', '5');
insertSetting.run('min_deposit_usdt', '20');
insertSetting.run('min_withdrawal_rub', '1000');
insertSetting.run('support_contact', '@support');
insertSetting.run('app_name', 'CryptoSwaap');
insertSetting.run('order_timer_minutes', '15');
insertSetting.run('networks', JSON.stringify([
  { id: 'TRC-20', name: 'USDT TRC-20 (Tron)', coin: 'USDT', enabled: true, wallet: 'YOUR_TRC20_WALLET' },
  { id: 'BEP-20', name: 'USDT BEP-20 (BSC)', coin: 'USDT', enabled: false, wallet: 'YOUR_BEP20_WALLET' },
  { id: 'ERC-20', name: 'USDT ERC-20 (Ethereum)', coin: 'USDT', enabled: false, wallet: 'YOUR_ERC20_WALLET' },
  { id: 'BTC', name: 'Bitcoin (BTC)', coin: 'BTC', enabled: false, wallet: 'YOUR_BTC_WALLET' },
  { id: 'ETH', name: 'Ethereum (ETH)', coin: 'ETH', enabled: false, wallet: 'YOUR_ETH_WALLET' },
  { id: 'SOL', name: 'Solana (SOL)', coin: 'SOL', enabled: false, wallet: 'YOUR_SOL_WALLET' }
]));

const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash, is_super_admin) VALUES (?, ?, 1)').run('admin', hash);
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cryptoswaap-secret-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много попыток.' } });

function getSetting(key) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
function getCurrentRate() { const b = parseFloat(getSetting('base_rate') || '80'); const m = parseFloat(getSetting('markup_percent') || '5'); return { base: b, markup: m, final: b * (1 + m / 100) }; }
function getNetworks() { try { return JSON.parse(getSetting('networks') || '[]'); } catch { return []; } }
function isUserAuth(req, res, next) { if (req.session?.userId) return next(); return res.status(401).json({ error: 'Не авторизован' }); }
function isAdminAuth(req, res, next) { if (req.session?.adminId) return next(); return res.status(401).json({ error: 'Не авторизован' }); }
function genStr(l) { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let r = ''; for (let i = 0; i < l; i++) r += c[Math.floor(Math.random() * c.length)]; return r; }
function genPass(l = 8) { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let r = ''; for (let i = 0; i < l; i++) r += c[Math.floor(Math.random() * c.length)]; return r; }
function genInternalId() { 
  const len = Math.floor(Math.random() * 3) + 4;
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return 'CS-' + (Math.floor(Math.random() * (max - min + 1)) + min);
}
function genOrderNum() { return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + genStr(4).toUpperCase(); }
function genAppealNum() { return 'APL-' + Date.now().toString(36).toUpperCase() + '-' + genStr(4).toUpperCase(); }

// ==================== AUTH ====================
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
    if (!speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: totp_code, window: 1 }))
      return res.status(401).json({ error: 'Неверный код 2FA' });
  }
  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(user.id);
  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, internal_id: user.internal_id, username: user.username, first_name: user.first_name, balance_rub: user.balance_rub, held_rub: user.held_rub || 0, withdrawal_pending: user.withdrawal_pending || 0, total_deposited_usdt: user.total_deposited_usdt, total_earned_rub: user.total_earned_rub, totp_enabled: user.totp_enabled === 1, is_online: user.is_online === 1, is_verified: user.is_verified === 1, password_changed: user.password_changed === 1, username_changed: user.username_changed === 1 } });
});

app.post('/api/logout', (req, res) => {
  if (req.session?.userId) db.prepare('UPDATE users SET is_online = 0 WHERE id = ?').run(req.session.userId);
  req.session.destroy();
  res.json({ success: true });
});

// ==================== USER API ====================
app.get('/api/user/profile', isUserAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const verification = db.prepare('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.userId);
  res.json({ id: user.id, internal_id: user.internal_id, username: user.username, first_name: user.first_name, balance_rub: user.balance_rub, held_rub: user.held_rub || 0, withdrawal_pending: user.withdrawal_pending || 0, total_deposited_usdt: user.total_deposited_usdt, total_earned_rub: user.total_earned_rub, totp_enabled: user.totp_enabled === 1, is_online: user.is_online === 1, is_verified: user.is_verified === 1, password_changed: user.password_changed === 1, username_changed: user.username_changed === 1, verification_status: verification ? verification.status : 'none', created_at: user.created_at });
});

app.post('/api/user/change-password', isUserAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) return res.status(400).json({ error: 'Неверный пароль' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Минимум 6 символов' });
  db.prepare('UPDATE users SET password_hash = ?, password_changed = 1 WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.userId);
  res.json({ success: true });
});

app.post('/api/user/change-username', isUserAuth, (req, res) => {
  const { new_username } = req.body;
  if (!new_username || new_username.length < 3) return res.status(400).json({ error: 'Минимум 3 символа' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(new_username, req.session.userId);
  if (existing) return res.status(400).json({ error: 'Логин занят' });
  db.prepare('UPDATE users SET username = ?, username_changed = 1 WHERE id = ?').run(new_username, req.session.userId);
  res.json({ success: true });
});

app.post('/api/user/toggle-online', isUserAuth, (req, res) => {
  const user = db.prepare('SELECT is_online FROM users WHERE id = ?').get(req.session.userId);
  const newStatus = user.is_online ? 0 : 1;
  db.prepare('UPDATE users SET is_online = ? WHERE id = ?').run(newStatus, req.session.userId);
  sendSSEToAdmin('user_status', { userId: req.session.userId, is_online: newStatus === 1 });
  res.json({ success: true, is_online: newStatus === 1 });
});

// ==================== VERIFICATION ====================
app.post('/api/verification/submit', isUserAuth, (req, res) => {
  const { selfie_url, passport_photo_url, passport_registration_url, phone, telegram_link, social_links } = req.body;
  if (!selfie_url || !passport_photo_url || !phone) return res.status(400).json({ error: 'Заполните обязательные поля' });
  const result = db.prepare('INSERT INTO verification_requests (user_id, selfie_url, passport_photo_url, passport_registration_url, phone, telegram_link, social_links) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.session.userId, selfie_url, passport_photo_url, passport_registration_url || '', phone, telegram_link || '', social_links || '');
  db.prepare('INSERT INTO notifications (message, type) VALUES (?, ?)').run(`📋 Новая заявка на верификацию от пользователя #${req.session.userId}`, 'verification');
  sendSSEToAdmin('new_verification', { userId: req.session.userId });
  res.json({ success: true, request_id: result.lastInsertRowid });
});

app.get('/api/verification/status', isUserAuth, (req, res) => {
  const verification = db.prepare('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.session.userId);
  res.json(verification || { status: 'none' });
});

// ==================== RATE & NETWORKS ====================
app.get('/api/exchange/rate', (req, res) => {
  const rate = getCurrentRate();
  const networks = getNetworks().filter(n => n.enabled);
  res.json({ base_rate: rate.base, markup_percent: rate.markup, final_rate: rate.final.toFixed(2), networks });
});

// ==================== ORDERS ====================
app.get('/api/orders', isUserAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  const now = new Date();
  const user = db.prepare('SELECT active_requisite_id FROM users WHERE id = ?').get(req.session.userId);
  const activeReq = user?.active_requisite_id ? db.prepare('SELECT * FROM requisites WHERE id = ?').get(user.active_requisite_id) : null;
  orders.forEach(o => {
    if (o.status === 'active' && o.timer_ends_at && new Date(o.timer_ends_at) < now) {
      db.prepare("UPDATE orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(o.id);
      db.prepare('UPDATE users SET withdrawal_pending = withdrawal_pending + ? WHERE id = ?').run(o.amount_rub, req.session.userId);
      o.status = 'expired';
    }
    o.requisite = activeReq ? { bank: activeReq.bank, name: activeReq.name, phone: activeReq.phone } : null;
  });
  res.json(orders);
});

app.post('/api/orders/:id/complete', isUserAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Не найден' });
  if (order.status !== 'active') return res.status(400).json({ error: 'Ордер не активен' });
  db.prepare("UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const wp = user.withdrawal_pending || 0;
  if (wp >= order.amount_rub) {
    db.prepare('UPDATE users SET withdrawal_pending = MAX(0, withdrawal_pending - ?), held_rub = MAX(0, held_rub - ?) WHERE id = ?').run(order.amount_rub, order.amount_rub, req.session.userId);
  } else {
    const excess = order.amount_rub - wp;
    db.prepare('UPDATE users SET withdrawal_pending = 0, held_rub = MAX(0, held_rub - ?), balance_rub = MAX(0, balance_rub - ?) WHERE id = ?').run(order.amount_rub, excess, req.session.userId);
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(req.session.userId, `✅ Ордер ${order.order_number} выполнен. Списано ${order.amount_rub} ₽`, 'success');
  sendSSEToAdmin('order_completed', { userId: req.session.userId, orderId: req.params.id, amount: order.amount_rub });
  sendSSEToUser(req.session.userId, 'balance_update', { balance_rub: updated.balance_rub, held_rub: updated.held_rub, withdrawal_pending: updated.withdrawal_pending });
  res.json({ success: true });
});

app.post('/api/orders/:id/fail', isUserAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!order) return res.status(404).json({ error: 'Не найден' });
  if (order.status !== 'active') return res.status(400).json({ error: 'Ордер не активен' });
  db.prepare("UPDATE orders SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET withdrawal_pending = withdrawal_pending + ? WHERE id = ?').run(order.amount_rub, req.session.userId);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(req.session.userId, `❌ Ордер ${order.order_number} не выполнен.`, 'error');
  sendSSEToAdmin('order_failed', { userId: req.session.userId, orderId: req.params.id });
  res.json({ success: true });
});

app.get('/api/appeals', isUserAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId));
});

// ==================== DEPOSITS ====================
app.post('/api/deposit/create', isUserAuth, (req, res) => {
  const { amount_usdt, network, coin, tx_hash } = req.body;
  const minDeposit = parseFloat(getSetting('min_deposit_usdt') || '20');
  if (!amount_usdt || amount_usdt < minDeposit) return res.status(400).json({ error: `Минимум: ${minDeposit}` });
  if (!tx_hash || tx_hash.length < 10) return res.status(400).json({ error: 'Введите хеш транзакции' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.is_blocked) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  const rate = getCurrentRate();
  const amountRub = amount_usdt * rate.final;
  const earnedRub = amount_usdt * rate.base * (rate.markup / 100);
  const networks = getNetworks();
  const net = networks.find(n => n.id === network);
  if (!net || !net.enabled) return res.status(400).json({ error: 'Сеть не поддерживается' });
  const result = db.prepare(`INSERT INTO deposits (user_id, amount_usdt, amount_rub, rate, markup_percent, earned_rub, network, coin, tx_hash, wallet_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.session.userId, amount_usdt, amountRub, rate.final, rate.markup, earnedRub, network, coin || net.coin || 'USDT', tx_hash, net.wallet);
  db.prepare('INSERT INTO notifications (message, type) VALUES (?, ?)').run(`💰 Депозит: ${amount_usdt} ${coin || 'USDT'} (${network}) от ${user.username} [${user.internal_id}]. Хеш: ${tx_hash}`, 'deposit');
  sendSSEToAdmin('new_deposit', { userId: req.session.userId, amount_usdt, network });
  res.json({ success: true, deposit_id: result.lastInsertRowid });
});

app.get('/api/deposits', isUserAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId));
});

// ==================== WITHDRAWALS ====================
app.post('/api/withdrawal/create', isUserAuth, (req, res) => {
  const { amount_rub, requisite_id } = req.body;
  const minWithdrawal = parseFloat(getSetting('min_withdrawal_rub') || '1000');
  if (!amount_rub || amount_rub < minWithdrawal) return res.status(400).json({ error: `Минимум: ${minWithdrawal} ₽` });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const available = user.balance_rub - user.held_rub;
  if (available < amount_rub) return res.status(400).json({ error: 'Недостаточно средств' });
  const req_data = db.prepare('SELECT * FROM requisites WHERE id = ? AND user_id = ?').get(requisite_id, req.session.userId);
  if (!req_data) return res.status(400).json({ error: 'Выберите реквизиты' });
  const cancelDeadline = new Date(Date.now() + 30 * 1000).toISOString();
  const result = db.prepare(`INSERT INTO withdrawals (user_id, amount_rub, requisite_id, status) VALUES (?, ?, ?, 'pending')`).run(req.session.userId, amount_rub, requisite_id);
  db.prepare('UPDATE users SET held_rub = held_rub + ?, withdrawal_pending = withdrawal_pending + ? WHERE id = ?').run(amount_rub, amount_rub, req.session.userId);
  db.prepare('INSERT INTO notifications (message, type) VALUES (?, ?)').run(`💸 Вывод: ${amount_rub} ₽ от ${user.username} [${user.internal_id}]. ${req_data.bank}, ${req_data.name}`, 'withdrawal');
  sendSSEToAdmin('new_withdrawal', { userId: req.session.userId, amount_rub });
  res.json({ success: true, withdrawal_id: result.lastInsertRowid, cancel_deadline: cancelDeadline });
});

app.post('/api/withdrawal/:id/cancel', isUserAuth, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!w) return res.status(404).json({ error: 'Не найден' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Нельзя отменить' });
  db.prepare("UPDATE withdrawals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET held_rub = MAX(0, held_rub - ?), withdrawal_pending = MAX(0, withdrawal_pending - ?) WHERE id = ?').run(w.amount_rub, w.amount_rub, req.session.userId);
  sendSSEToAdmin('withdrawal_cancelled', { userId: req.session.userId, withdrawalId: req.params.id });
  res.json({ success: true });
});

app.get('/api/withdrawals', isUserAuth, (req, res) => {
  res.json(db.prepare('SELECT w.*, r.name, r.bank, r.phone FROM withdrawals w LEFT JOIN requisites r ON w.requisite_id = r.id WHERE w.user_id = ? ORDER BY w.created_at DESC').all(req.session.userId));
});

// ==================== REQUISITES ====================
app.get('/api/requisites', isUserAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM requisites WHERE user_id = ? ORDER BY is_active DESC, is_default DESC, created_at DESC').all(req.session.userId));
});

app.post('/api/requisites/save', isUserAuth, (req, res) => {
  const { name, phone, bank } = req.body;
  if (!name || !phone || !bank) return res.status(400).json({ error: 'Заполните все поля' });
  const count = db.prepare('SELECT COUNT(*) as c FROM requisites WHERE user_id = ?').get(req.session.userId).c;
  db.prepare('INSERT INTO requisites (user_id, name, phone, bank, is_default) VALUES (?, ?, ?, ?, ?)').run(req.session.userId, name, phone, bank, count === 0 ? 1 : 0);
  res.json({ success: true });
});

app.post('/api/requisites/:id/activate', isUserAuth, (req, res) => {
  db.prepare('UPDATE requisites SET is_active = 0 WHERE user_id = ?').run(req.session.userId);
  db.prepare('UPDATE requisites SET is_active = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  db.prepare('UPDATE users SET active_requisite_id = ? WHERE id = ?').run(req.params.id, req.session.userId);
  const r = db.prepare('SELECT * FROM requisites WHERE id = ?').get(req.params.id);
  db.prepare('INSERT INTO notifications (message, type) VALUES (?, ?)').run(`💳 Реквизит активирован: ${r.name}, ${r.bank}, ${r.phone}`, 'info');
  res.json({ success: true });
});

app.post('/api/requisites/:id/deactivate', isUserAuth, (req, res) => {
  db.prepare('UPDATE requisites SET is_active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  db.prepare('UPDATE users SET active_requisite_id = 0 WHERE id = ?').run(req.session.userId);
  res.json({ success: true });
});

app.post('/api/requisites/:id/delete', isUserAuth, (req, res) => {
  db.prepare('DELETE FROM requisites WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// ==================== NOTIFICATIONS ====================
app.get('/api/notifications', isUserAuth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id = 0 ORDER BY created_at DESC LIMIT 50').all(req.session.userId);
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE (user_id = ? OR user_id = 0) AND is_read = 0').get(req.session.userId).c;
  res.json({ notifications, unread });
});

app.post('/api/notifications/read', isUserAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id = 0').run(req.session.userId);
  res.json({ success: true });
});

// ==================== STATS ====================
app.get('/api/user/stats', isUserAuth, (req, res) => {
  const userId = req.session.userId;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const getOrderStats = (from) => db.prepare("SELECT COALESCE(SUM(amount_rub),0) as rub, COUNT(*) as orders FROM orders WHERE user_id = ? AND status = 'completed' AND created_at >= ?").get(userId, from);
  const totalEarned = db.prepare("SELECT COALESCE(SUM(earned_rub),0) as t FROM deposits WHERE user_id = ? AND status = 'confirmed'").get(userId).t;
  const totalOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status = 'completed'").get(userId).count;
  res.json({
    today: getOrderStats(today),
    yesterday: getOrderStats(yesterday),
    week: getOrderStats(weekAgo),
    lastWeek: getOrderStats(lastWeekStart),
    month: getOrderStats(monthAgo),
    total: { earned: totalEarned, orders: totalOrders }
  });
});

// ==================== 2FA ====================
app.post('/api/2fa/setup', isUserAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({ name: 'CryptoSwaap', issuer: 'CryptoSwaap' });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.userId);
  try { const qr = await QRCode.toDataURL(secret.otpauth_url); res.json({ success: true, secret: secret.base32, qr_code: qr }); }
  catch (e) { res.status(500).json({ error: 'Ошибка QR' }); }
});

app.post('/api/2fa/verify', isUserAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.totp_secret) return res.status(400).json({ error: '2FA не настроена' });
  if (speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 1 })) {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.session.userId);
    res.json({ success: true });
  } else res.status(400).json({ error: 'Неверный код' });
});

app.post('/api/2fa/disable', isUserAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.totp_enabled && user.totp_secret) {
    if (!speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 1 }))
      return res.status(400).json({ error: 'Неверный код' });
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
    if (!speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: totp_code, window: 1 }))
      return res.status(401).json({ error: 'Неверный код 2FA' });
  }
  db.prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, 1)').run(req.ip, username);
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  req.session.isSuperAdmin = admin.is_super_admin === 1;
  res.json({ success: true, admin: { id: admin.id, username: admin.username, totp_enabled: admin.totp_enabled === 1, is_super_admin: admin.is_super_admin === 1 } });
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
  if (speakeasy.totp.verify({ secret: admin.totp_secret, encoding: 'base32', token: code, window: 2 })) {
    db.prepare('UPDATE admin_users SET totp_enabled = 1 WHERE id = ?').run(req.session.adminId);
    res.json({ success: true });
  } else res.status(400).json({ error: 'Неверный код' });
});

// ==================== ADMIN CREATE ADMINS ====================
app.get('/api/admin/admins', isAdminAuth, (req, res) => {
  if (!req.session.isSuperAdmin) return res.status(403).json({ error: 'Только для суперадмина' });
  res.json(db.prepare('SELECT id, username, totp_enabled, is_super_admin, created_at FROM admin_users ORDER BY created_at DESC').all());
});

app.post('/api/admin/admins/create', isAdminAuth, (req, res) => {
  if (!req.session.isSuperAdmin) return res.status(403).json({ error: 'Только для суперадмина' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Логин занят' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO admin_users (username, password_hash, is_super_admin) VALUES (?, ?, 0)').run(username, hash);
  res.json({ success: true, admin: { id: result.lastInsertRowid, username, password } });
});

app.post('/api/admin/admins/:id/delete', isAdminAuth, (req, res) => {
  if (!req.session.isSuperAdmin) return res.status(403).json({ error: 'Только для суперадмина' });
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ error: 'Нельзя удалить себя' });
  db.prepare('DELETE FROM admin_users WHERE id = ? AND is_super_admin = 0').run(req.params.id);
  res.json({ success: true });
});

// ==================== ADMIN API ====================
app.get('/api/admin/profile', isAdminAuth, (req, res) => {
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
  res.json({ id: admin.id, username: admin.username, totp_enabled: admin.totp_enabled === 1, is_super_admin: admin.is_super_admin === 1 });
});

app.get('/api/admin/dashboard', isAdminAuth, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const onlineUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_online = 1').get().c;
  const verifiedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_verified = 1').get().c;
  const pendingVerifications = db.prepare("SELECT COUNT(*) as c FROM verification_requests WHERE status = 'pending'").get().c;
  const totalDeposits = db.prepare("SELECT COUNT(*) as c FROM deposits").get().c;
  const pendingDeposits = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'").get().c;
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'").get().c;
  const activeOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'active'").get().c;
  const pendingAppeals = db.prepare("SELECT COUNT(*) as c FROM appeals WHERE status = 'pending'").get().c;
  const totalVolumeUsdt = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as t FROM deposits WHERE status = 'confirmed'").get().t;
  const totalEarned = db.prepare("SELECT COALESCE(SUM(earned_rub),0) as t FROM deposits WHERE status = 'confirmed'").get().t;
  const recent = db.prepare(`SELECT d.*, u.username, u.internal_id FROM deposits d JOIN users u ON d.user_id = u.id ORDER BY d.created_at DESC LIMIT 10`).all();
  res.json({ total_users: totalUsers, online_users: onlineUsers, verified_users: verifiedUsers, pending_verifications: pendingVerifications, total_deposits: totalDeposits, pending_deposits: pendingDeposits, pending_withdrawals: pendingWithdrawals, active_orders: activeOrders, pending_appeals: pendingAppeals, total_volume_usdt: totalVolumeUsdt, total_earned_rub: totalEarned, recent_deposits: recent });
});

app.get('/api/admin/settings', isAdminAuth, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

app.post('/api/admin/settings', isAdminAuth, (req, res) => {
  const { key, value } = req.body;
  const allowedKeys = ['base_rate', 'markup_percent', 'min_deposit_usdt', 'min_withdrawal_rub', 'support_contact', 'app_name', 'networks', 'order_timer_minutes'];
  if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Недопустимый ключ' });
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  res.json({ success: true });
});

// ==================== ADMIN VERIFICATION ====================
app.get('/api/admin/verifications', isAdminAuth, (req, res) => {
  const { status } = req.query;
  let query = `SELECT v.*, u.username, u.internal_id FROM verification_requests v JOIN users u ON v.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND v.status = ?'; params.push(status); }
  query += ' ORDER BY v.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/verifications/:id/approve', isAdminAuth, (req, res) => {
  const v = db.prepare('SELECT * FROM verification_requests WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Не найдена' });
  db.prepare("UPDATE verification_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(v.user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(v.user_id, '✅ Верификация пройдена!', 'success');
  sendSSEToUser(v.user_id, 'verification_approved', {});
  res.json({ success: true });
});

app.post('/api/admin/verifications/:id/reject', isAdminAuth, (req, res) => {
  const { admin_comment } = req.body;
  const v = db.prepare('SELECT * FROM verification_requests WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Не найдена' });
  db.prepare("UPDATE verification_requests SET status = 'rejected', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(v.user_id, `❌ Верификация отклонена. ${admin_comment || ''}`, 'error');
  sendSSEToUser(v.user_id, 'verification_rejected', { comment: admin_comment });
  res.json({ success: true });
});

// ==================== ADMIN ORDERS ====================
app.get('/api/admin/orders', isAdminAuth, (req, res) => {
  const { status } = req.query;
  let query = `SELECT o.*, u.username, u.internal_id FROM orders o JOIN users u ON o.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND o.status = ?'; params.push(status); }
  query += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/orders/create', isAdminAuth, (req, res) => {
  const { user_id, order_number, amount_rub } = req.body;
  if (!user_id || !amount_rub) return res.status(400).json({ error: 'Заполните поля' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const num = order_number || genOrderNum();
  const timerMinutes = parseInt(getSetting('order_timer_minutes') || '15');
  const now = new Date();
  const endsAt = new Date(now.getTime() + timerMinutes * 60 * 1000);
  const result = db.prepare('INSERT INTO orders (user_id, order_number, amount_rub, timer_minutes, timer_started_at, timer_ends_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user_id, num, amount_rub, timerMinutes, now.toISOString(), endsAt.toISOString());
  db.prepare('UPDATE users SET withdrawal_pending = MAX(0, withdrawal_pending - ?) WHERE id = ?').run(amount_rub, user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(user_id, `📦 Новый ордер ${num} на ${amount_rub} ₽`, 'order');
  sendSSEToUser(user_id, 'new_order', { order_number: num, amount_rub, timer_minutes: timerMinutes });
  res.json({ success: true, order_id: result.lastInsertRowid, order_number: num });
});

// ==================== ADMIN APPEALS ====================
app.get('/api/admin/appeals', isAdminAuth, (req, res) => {
  const { status } = req.query;
  let query = `SELECT a.*, u.username, u.internal_id FROM appeals a JOIN users u ON a.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND a.status = ?'; params.push(status); }
  query += ' ORDER BY a.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/appeals/create', isAdminAuth, (req, res) => {
  const { user_id, appeal_number, order_number, amount_rub, description } = req.body;
  if (!user_id || !amount_rub) return res.status(400).json({ error: 'Заполните поля' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const num = appeal_number || genAppealNum();
  const result = db.prepare('INSERT INTO appeals (user_id, appeal_number, order_number, amount_rub, description) VALUES (?, ?, ?, ?, ?)')
    .run(user_id, num, order_number || '', amount_rub, description || '');
  db.prepare('UPDATE users SET held_rub = held_rub + ? WHERE id = ?').run(amount_rub, user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(user_id, `⚠️ Апелляция ${num} на ${amount_rub} ₽`, 'appeal');
  sendSSEToUser(user_id, 'new_appeal', { appeal_number: num, amount_rub });
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  sendSSEToUser(user_id, 'balance_update', { balance_rub: updatedUser.balance_rub, held_rub: updatedUser.held_rub, withdrawal_pending: updatedUser.withdrawal_pending });
  res.json({ success: true, appeal_id: result.lastInsertRowid, appeal_number: num });
});

app.post('/api/admin/appeals/:id/resolve', isAdminAuth, (req, res) => {
  const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(req.params.id);
  if (!appeal) return res.status(404).json({ error: 'Не найдена' });
  db.prepare("UPDATE appeals SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET balance_rub = MAX(0, balance_rub - ?), held_rub = MAX(0, held_rub - ?) WHERE id = ?').run(appeal.amount_rub, appeal.amount_rub, appeal.user_id);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(appeal.user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(appeal.user_id, `✅ Апелляция ${appeal.appeal_number} решена. Списано ${appeal.amount_rub} ₽`, 'success');
  sendSSEToUser(appeal.user_id, 'appeal_resolved', { appeal_number: appeal.appeal_number, amount: appeal.amount_rub });
  sendSSEToUser(appeal.user_id, 'balance_update', { balance_rub: updatedUser.balance_rub, held_rub: updatedUser.held_rub, withdrawal_pending: updatedUser.withdrawal_pending });
  res.json({ success: true });
});

app.post('/api/admin/appeals/:id/reject', isAdminAuth, (req, res) => {
  const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(req.params.id);
  if (!appeal) return res.status(404).json({ error: 'Не найдена' });
  db.prepare("UPDATE appeals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET held_rub = MAX(0, held_rub - ?) WHERE id = ?').run(appeal.amount_rub, appeal.user_id);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(appeal.user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(appeal.user_id, `❌ Апелляция ${appeal.appeal_number} отклонена. Средства разморожены.`, 'error');
  sendSSEToUser(appeal.user_id, 'appeal_rejected', { appeal_number: appeal.appeal_number });
  sendSSEToUser(appeal.user_id, 'balance_update', { balance_rub: updatedUser.balance_rub, held_rub: updatedUser.held_rub, withdrawal_pending: updatedUser.withdrawal_pending });
  res.json({ success: true });
});

// ==================== ADMIN DEPOSITS ====================
app.get('/api/admin/deposits', isAdminAuth, (req, res) => {
  const { status } = req.query;
  let query = `SELECT d.*, u.username, u.internal_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  query += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/deposits/:id/confirm', isAdminAuth, (req, res) => {
  const { admin_comment } = req.body;
  const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Не найден' });
  if (d.status !== 'pending') return res.status(400).json({ error: 'Уже обработан' });
  db.prepare("UPDATE deposits SET status = 'confirmed', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
  db.prepare('UPDATE users SET balance_rub = balance_rub + ?, total_deposited_usdt = total_deposited_usdt + ?, total_earned_rub = total_earned_rub + ? WHERE id = ?').run(d.amount_rub, d.amount_usdt, d.earned_rub, d.user_id);
  db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(d.user_id, `✅ Депозит ${d.amount_usdt} ${d.coin || 'USDT'} подтверждён. Начислено ${d.amount_rub.toFixed(2)} ₽`, 'success');
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(d.user_id);
  sendSSEToUser(d.user_id, 'deposit_confirmed', { amount_usdt: d.amount_usdt, amount_rub: d.amount_rub });
  sendSSEToUser(d.user_id, 'balance_update', { balance_rub: updatedUser.balance_rub, held_rub: updatedUser.held_rub, withdrawal_pending: updatedUser.withdrawal_pending });
  res.json({ success: true });
});

app.post('/api/admin/deposits/:id/reject', isAdminAuth, (req, res) => {
  const { admin_comment } = req.body;
  const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Не найден' });
  db.prepare("UPDATE deposits SET status = 'rejected', admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_comment || '', req.params.id);
  sendSSEToUser(d.user_id, 'deposit_rejected', { id: req.params.id });
  res.json({ success: true });
});

// ==================== ADMIN WITHDRAWALS ====================
app.get('/api/admin/withdrawals', isAdminAuth, (req, res) => {
  const { status } = req.query;
  let query = `SELECT w.*, u.username, u.internal_id, r.name as req_name, r.bank as req_bank, r.phone as req_phone FROM withdrawals w JOIN users u ON w.user_id = u.id LEFT JOIN requisites r ON w.requisite_id = r.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND w.status = ?'; params.push(status); }
  query += ' ORDER BY w.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/admin/withdrawals/:id/confirm', isAdminAuth, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Не найден' });
  db.prepare("UPDATE withdrawals SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE users SET held_rub = MAX(0, held_rub - ?), withdrawal_pending = MAX(0, withdrawal_pending - ?) WHERE id = ?').run(w.amount_rub, w.amount_rub, w.user_id);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(w.user_id);
  sendSSEToUser(w.user_id, 'withdrawal_confirmed', { id: req.params.id });
  sendSSEToUser(w.user_id, 'balance_update', { balance_rub: updatedUser.balance_rub, held_rub: updatedUser.held_rub, withdrawal_pending: updatedUser.withdrawal_pending });
  res.json({ success: true });
});

app.post('/api/admin/withdrawals/:id/reject', isAdminAuth, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (w) {
    db.prepare('UPDATE users SET held_rub = MAX(0, held_rub - ?), withdrawal_pending = MAX(0, withdrawal_pending - ?) WHERE id = ?').run(w.amount_rub, w.amount_rub, w.user_id);
  }
  db.prepare("UPDATE withdrawals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  if (w) sendSSEToUser(w.user_id, 'withdrawal_rejected', { id: req.params.id });
  res.json({ success: true });
});

// ==================== ADMIN USERS ====================
app.get('/api/admin/users', isAdminAuth, (req, res) => {
  res.json(db.prepare('SELECT *, (balance_rub - held_rub) as available_rub FROM users ORDER BY created_at DESC').all());
});

app.get('/api/admin/users/:id', isAdminAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const deposits = db.prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  const appeals = db.prepare('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  const requisites = db.prepare('SELECT * FROM requisites WHERE user_id = ?').all(req.params.id);
  const verification = db.prepare('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.id);
  res.json({ ...user, deposits, orders, appeals, requisites, verification });
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
  const new_password = genPass(8);
  db.prepare('UPDATE users SET password_hash = ?, password_changed = 0 WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.params.id);
  res.json({ success: true, new_password });
});

app.post('/api/admin/create-user', isAdminAuth, (req, res) => {
  const { custom_username, custom_password } = req.body;
  let username = custom_username || 'user_' + genStr(6);
  let password = custom_password || genPass(8);
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Логин занят' });
  const hash = bcrypt.hashSync(password, 10);
  const internalId = genInternalId();
  const result = db.prepare('INSERT INTO users (internal_id, username, password_hash, first_name, is_verified) VALUES (?, ?, ?, ?, 0)').run(internalId, username, hash, username);
  res.json({ success: true, user: { id: result.lastInsertRowid, internal_id: internalId, username, password, balance_rub: 0 } });
});

// ==================== ADMIN NOTIFICATIONS ====================
app.get('/api/admin/notifications', isAdminAuth, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE is_read = 0').get().c;
  res.json({ notifications, unread });
});

app.post('/api/admin/notifications/read', isAdminAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1').run();
  res.json({ success: true });
});

app.post('/api/admin/notifications/send', isAdminAuth, (req, res) => {
  const { user_id, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'Введите сообщение' });
  if (user_id && user_id !== 'all') {
    db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(user_id, message, type || 'info');
    sendSSEToUser(parseInt(user_id), 'new_notification', { message, type: type || 'info' });
  } else {
    db.prepare('INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)').run(0, message, type || 'info');
    sendSSEToAllUsers('new_notification', { message, type: type || 'info' });
  }
  res.json({ success: true });
});

// ==================== ADMIN EXPORT ====================
app.get('/api/admin/export/users', isAdminAuth, (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=users-export.json');
  res.json(users);
});

app.get('/api/admin/export/transactions', isAdminAuth, (req, res) => {
  const deposits = db.prepare('SELECT * FROM deposits').all();
  const withdrawals = db.prepare('SELECT * FROM withdrawals').all();
  const orders = db.prepare('SELECT * FROM orders').all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=transactions-export.json');
  res.json({ deposits, withdrawals, orders });
});

// ==================== STATIC ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CryptoSwaap запущен на http://localhost:${PORT}`);
  console.log(`📱 Приложение: http://localhost:${PORT}`);
  console.log(`🔧 Админка: http://localhost:${PORT}/admin`);
});
