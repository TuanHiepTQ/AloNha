// ==========================================================
// 🔌 AloNha Server - Auto DB Adapter (PostgreSQL ↔ SQLite)
// ==========================================================
// File này tự động dùng SQLite khi không có PostgreSQL
// KHÔNG cần cài đặt gì thêm ngoài npm install better-sqlite3
// ==========================================================

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e9
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'AloNhaLocalDevKey2026';

// Xác định đúng thư mục gốc (hoạt động cả khi require từ folder khác)
const APP_ROOT = path.resolve(__dirname, (__dirname.includes('electron-app') ? '..' : '.'));

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOADS_DIR = path.join(APP_ROOT, 'public', 'uploads');
const AVATARS_DIR = path.join(APP_ROOT, 'public', 'uploads', 'avatars');
const DATA_DIR = path.join(APP_ROOT, 'data');

[PUBLIC_DIR, UPLOADS_DIR, AVATARS_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========================================================================
// 🗄️ DATABASE LAYER - Tự động chọn PostgreSQL hoặc SQLite
// ========================================================================
let db;

async function initDatabase() {
  // Thử kết nối PostgreSQL trước
  let usePostgres = false;
  try {
    const { Pool } = require('pg');
    const testPool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://alonha_user:AlonhaSecured2026@127.0.0.1:5432/alonha',
      ssl: false,
      connectionTimeoutMillis: 3000 // 3 giây timeout
    });
    const client = await testPool.connect();
    console.log('✅ [DB] Kết nối PostgreSQL thành công!');
    client.release();
    db = new PostgresDB(testPool);
    usePostgres = true;
  } catch (pgErr) {
    console.log('⚠️ [DB] Không có PostgreSQL, chuyển sang SQLite...');
  }

  if (!usePostgres) {
    try {
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();
      const fs = require('fs');
      const dbPath = path.join(DATA_DIR, 'alonha.db');
      let sqliteDb;
      if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        sqliteDb = new SQL.Database(buffer);
      } else {
        sqliteDb = new SQL.Database();
      }
      db = new SQLiteDB(sqliteDb, dbPath);
      console.log('✅ [DB] SQLite database đã sẵn sàng!');
    } catch (sqliteErr) {
      console.error('❌ [DB] Không thể khởi tạo SQLite:', sqliteErr.message);
      process.exit(1);
    }
  }

  await db.initSchema();
  await db.ensureDefaultSuperAdmin();
}

// ========================================================================
// 📦 LỚP TRỪU TƯỢNG HÓA DATABASE
// ========================================================================

class PostgresDB {
  constructor(pool) { this.pool = pool; this.type = 'postgres'; }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async get(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  async run(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return { lastID: result.rows[0]?.id || null, changes: result.rowCount };
  }

  // Khởi tạo schema PostgreSQL
  async initSchema() {
    const client = await this.pool.connect();
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        avatar_url TEXT DEFAULT '/logo.png',
        phone_number VARCHAR(15) DEFAULT '',
        gender VARCHAR(10) DEFAULT 'Khác',
        dob DATE,
        pin_code VARCHAR(6) DEFAULT NULL,
        pin_timeout INT DEFAULT 1,
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        is_online BOOLEAN DEFAULT false,
        drive_folder_id TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      // ... (các bảng khác giữ nguyên)
      console.log("✅ Đã khởi tạo PostgreSQL schema");
    } finally {
      client.release();
    }
  }

  async ensureDefaultSuperAdmin() {
    try {
      const username = (process.env.SUPER_ADMIN_USERNAME || 'SuperAdmin').toLowerCase();
      const password = process.env.SUPER_ADMIN_PASSWORD || '123456';
      const existing = await this.get(`SELECT id, role FROM users WHERE username = $1`, [username]);
      if (existing) {
        await this.run(`UPDATE users SET role = 'super_admin', is_active = true WHERE username = $1`, [username]);
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      await this.run(`INSERT INTO users (username, password_hash, display_name, avatar_url, role, is_active) VALUES ($1, $2, $3, '/logo.png', 'super_admin', true)`, [username, hash, 'Super Admin']);
      console.log(`✅ Đã tạo Super Admin mặc định: ${username} / ${password}`);
    } catch (err) {
      console.warn('⚠️ Không thể tạo Super Admin:', err.message);
    }
  }
}

class SQLiteDB {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this.type = 'sqlite';
  }

  _save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      require('fs').writeFileSync(this.dbPath, buffer);
    } catch(e) { /* silent */ }
  }

  _fixSql(sql) {
    return sql.replace(/\$(\d+)/g, '?');
  }

  _rowsToObjects(stmt) {
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  async query(sql, params = []) {
    const fixedSql = this._fixSql(sql);
    try {
      const stmt = this.db.prepare(fixedSql);
      if (params && params.length > 0) stmt.bind(params);
      return this._rowsToObjects(stmt);
    } catch(e) {
      if (fixedSql.trim().toUpperCase().startsWith('SELECT') || fixedSql.trim().toUpperCase().startsWith('WITH') || fixedSql.trim().toUpperCase().startsWith('PRAGMA')) {
        return [];
      }
      return [];
    }
  }

  async get(sql, params = []) {
    const fixedSql = this._fixSql(sql);
    try {
      const stmt = this.db.prepare(fixedSql);
      if (params && params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    } catch(e) {
      return null;
    }
  }

  async run(sql, params = []) {
    const fixedSql = this._fixSql(sql);
    try {
      this.db.run(fixedSql, params);
      const lastId = this.db.exec("SELECT last_insert_rowid() as id");
      let id = null;
      if (lastId && lastId.length > 0 && lastId[0].values && lastId[0].values.length > 0) {
        id = lastId[0].values[0][0];
      }
      this._save();
      return { lastID: id, changes: this.db.getRowsModified() };
    } catch(e) {
      console.error("SQLite run error:", e.message, "SQL:", fixedSql);
      return { lastID: null, changes: 0 };
    }
  }

  async exec(sql) {
    try {
      this.db.exec(sql);
      this._save();
    } catch(e) {
      console.error("SQLite exec error:", e.message);
    }
  }

  async initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT DEFAULT '/logo.png',
        phone_number TEXT DEFAULT '',
        gender TEXT DEFAULT 'Khác',
        dob TEXT,
        pin_code TEXT,
        pin_timeout INTEGER DEFAULT 1,
        role TEXT DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        is_online INTEGER DEFAULT 0,
        drive_folder_id TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_group INTEGER DEFAULT 0,
        avatar_url TEXT DEFAULT '/logo.png',
        is_archived INTEGER DEFAULT 0,
        group_link_code TEXT,
        group_allow_edit_profile INTEGER DEFAULT 1,
        group_allow_pin INTEGER DEFAULT 1,
        group_allow_note INTEGER DEFAULT 1,
        group_allow_poll INTEGER DEFAULT 1,
        group_allow_send_message INTEGER DEFAULT 1,
        group_approval_mode INTEGER DEFAULT 0,
        group_mark_admin_messages INTEGER DEFAULT 1,
        group_allow_new_members_read_recent INTEGER DEFAULT 1,
        group_allow_join_via_link INTEGER DEFAULT 1,
        group_moderation_mode INTEGER DEFAULT 0,
        creator_id INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS room_members (
        room_id INTEGER,
        user_id INTEGER,
        unread_count INTEGER DEFAULT 0,
        role TEXT DEFAULT 'member',
        is_pinned INTEGER DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        joined_at TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (room_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER,
        sender_id INTEGER,
        message_text TEXT DEFAULT '',
        file_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        file_size TEXT DEFAULT '',
        file_type TEXT DEFAULT '',
        status TEXT DEFAULT 'sent',
        moderated_by INTEGER,
        is_recalled INTEGER DEFAULT 0,
        reply_to_id INTEGER,
        is_system INTEGER DEFAULT 0,
        self_destruct_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER,
        message_id INTEGER,
        pinned_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        maintenance_mode INTEGER DEFAULT 0,
        allow_registration INTEGER DEFAULT 1,
        max_users INTEGER DEFAULT 1000,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        user_id INTEGER,
        emoji TEXT NOT NULL,
        UNIQUE(message_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id, room_id);
      CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id, user_id);
    `);

    this._save();
    console.log("✅ [SQLite] Khởi tạo database thành công!");
  }

  async ensureDefaultSuperAdmin() {
    try {
      const username = (process.env.SUPER_ADMIN_USERNAME || 'SuperAdmin').toLowerCase();
      const password = process.env.SUPER_ADMIN_PASSWORD || '123456';
      const existing = await this.get(`SELECT id, role FROM users WHERE username = ?`, [username]);
      if (existing) {
        await this.run(`UPDATE users SET role = 'super_admin', is_active = 1 WHERE username = ?`, [username]);
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      await this.run(`INSERT INTO users (username, password_hash, display_name, avatar_url, role, is_active) VALUES (?, ?, ?, '/logo.png', 'super_admin', 1)`, [username, hash, 'Super Admin']);
      console.log(`✅ Đã tạo Super Admin mặc định: ${username} / ${password}`);
    } catch (err) {
      console.warn('⚠️ Không thể tạo Super Admin:', err.message);
    }
  }
}

// ========================================================================
// 🎯 KHỞI TẠO
// ========================================================================

initDatabase().then(() => {
  // Sau khi database sẵn sàng, import các API từ server.js gốc
  console.log('🔄 Đang tải API từ server.js...');
  require('./server-api-loader')(app, io, db, {
    JWT_SECRET, PORT, UPLOADS_DIR, AVATARS_DIR, PUBLIC_DIR,
    authenticateToken, requireSuperAdmin, getLocalFileUrl, getOrCreateUserDriveFolder
  });
}).catch(err => {
  console.error('❌ Lỗi khởi tạo:', err);
  process.exit(1);
});

// Logo handler
app.get('/logo.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 280" width="320" height="280">
      <path d="M 130,120 C 130,145 110,165 80,165 C 68,165 58,160 50,155 L 25,168 L 32,140 C 18,125 10,105 10,82 C 10,38 64,20 130,20 C 165,20 195,32 212,52" fill="none" stroke="#0072bc" stroke-width="12" stroke-linecap="round"/>
      <path d="M 190,120 C 190,145 210,165 240,165 C 252,165 262,160 270,155 L 295,168 L 288,140 C 302,125 310,105 310,82 C 310,38 256,20 190,20 C 155,20 125,32 108,52" fill="none" stroke="#f58220" stroke-width="12" stroke-linecap="round"/>
      <path d="M 160,82 C 120,52 85,102 160,162" fill="none" stroke="#f58220" stroke-width="12" stroke-linecap="round"/>
      <path d="M 160,82 C 200,52 235,102 160,162" fill="none" stroke="#0072bc" stroke-width="12" stroke-linecap="round"/>
      <text x="160" y="240" font-family="Arial, sans-serif" font-size="52" font-weight="900" text-anchor="middle"><tspan fill="#005da4">Alo</tspan><tspan fill="#f58220">Nha</tspan></text>
    </svg>
  `);
});

// Serve index.html từ thư mục gốc
app.use(express.static(APP_ROOT));
app.use('/', express.static(APP_ROOT));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(cors());
app.use(express.json({ limit: '1024mb' }));
app.use(express.urlencoded({ limit: '1024mb', extended: true }));

// Middleware xác thực
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Không tìm thấy token" });
  
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token không hợp lệ" });
    try {
      const user = await db.get(`SELECT id, username, display_name, avatar_url, pin_code, pin_timeout, role, is_active FROM users WHERE id = ?`, [decoded.id]);
      if (!user) return res.status(403).json({ error: "Người dùng không tồn tại" });
      if (!user.is_active && user.is_active !== undefined) {
        // SQLite dùng 0/1, Postgres dùng true/false
        if (user.is_active === 0 || user.is_active === false) 
          return res.status(403).json({ error: "Tài khoản đã bị vô hiệu hóa" });
      }
      req.user = user;
      next();
    } catch (e) {
      res.status(500).json({ error: "Lỗi xác thực" });
    }
  });
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: "Chỉ Super Admin mới có quyền này" });
  }
  next();
}

function getLocalFileUrl(fileUrl) {
  if (!fileUrl) return '';
  if (fileUrl.includes('||')) {
    const parts = fileUrl.split('||');
    const matchFileId = parts[1].match(/[?&]id=([a-zA-Z0-9_-]+)/) || parts[1].match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFileId) return `https://drive.google.com/thumbnail?id=${matchFileId[1]}&sz=w800`;
    return parts[1];
  }
  return fileUrl;
}

async function getOrCreateUserDriveFolder(userId, displayName) {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || '1ou4P0L12KwoNUzvEvFuFwKkLCvzwvC8V';
}

// ========================================================================
// 🚀 START SERVER
// ========================================================================
server.listen(PORT, () => {
  console.log(`✅ AloNha Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📝 Tài khoản mặc định: SuperAdmin / 123456`);
});
