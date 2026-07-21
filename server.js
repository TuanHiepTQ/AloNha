// server.js
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { google } = require('googleapis');

const app = express();
const server = createServer(app);

// Cấu hình Socket.io với buffer lớn hỗ trợ truyền file dung lượng cao 1GB
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e9 // 1GB
});

const PORT = process.env.PORT || 3000;
// Lấy JWT_SECRET từ environment (bắt buộc thiết lập trên production)
const JWT_SECRET = process.env.JWT_SECRET || 'AloNhaSecureJWTSecretKey2026_Prod';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn("⚠️ Chạy ở production mà không có JWT_SECRET trong env — KHÔNG AN TOÀN!");
}

// Đảm bảo các thư mục upload tồn tại cục bộ
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AVATARS_DIR = path.join(__dirname, 'public', 'uploads', 'avatars');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// 🎯 ĐỒNG BỘ LOGO MẶC ĐỊNH TỪ THƯ MỤC GỐC SANG THƯ MỤC PUBLIC
const rootLogoPath = path.join(__dirname, 'logo.png');
const publicLogoPath = path.join(__dirname, 'public', 'logo.png');

try {
  if (fs.existsSync(rootLogoPath) && fs.statSync(rootLogoPath).size > 100) {
    fs.copyFileSync(rootLogoPath, publicLogoPath);
    console.log("🎯 [Logo Sync] Đã phát hiện và đồng bộ thành công logo.png từ thư mục chính sang public/logo.png!");
  } else {
    if (fs.existsSync(publicLogoPath)) {
      fs.unlinkSync(publicLogoPath);
      console.log("🧹 [Logo Sync] Đã dọn dẹp public/logo.png cũ để kích hoạt hiển thị SVG mặc định.");
    }
  }
} catch (err) {
  console.warn("⚠️ [Logo Sync] Gặp lỗi trong quá trình xử lý đồng bộ logo:", err.message);
}

// 🎯 ĐĂNG KÝ TUYẾN ĐƯỜNG PHÂN PHỐI LOGO MẶC ĐỊNH TRƯỚC EXPRESS.STATIC
app.get('/logo.png', (req, res) => {
  const rootLogo = path.join(__dirname, 'logo.png');
  const publicLogo = path.join(__dirname, 'public', 'logo.png');
  
  if (fs.existsSync(rootLogo) && fs.statSync(rootLogo).size > 1000) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(rootLogo);
  } 
  else if (fs.existsSync(publicLogo) && fs.statSync(publicLogo).size > 1000) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(publicLogo);
  } 
  else {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 280" width="320" height="280" style="background: transparent;">
        <!-- Left Blue Bubble -->
        <path d="M 130,120 C 130,145 110,165 80,165 C 68,165 58,160 50,155 L 25,168 L 32,140 C 18,125 10,105 10,82 C 10,38 64,20 130,20 C 165,20 195,32 212,52" 
              fill="none" stroke="#0072bc" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
              
        <!-- Right Orange Bubble -->
        <path d="M 190,120 C 190,145 210,165 240,165 C 252,165 262,160 270,155 L 295,168 L 288,140 C 302,125 310,105 310,82 C 310,38 256,20 190,20 C 155,20 125,32 108,52" 
              fill="none" stroke="#f58220" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Central Heart - Left Lobe (Orange) -->
        <path d="M 160,82 C 120,52 85,102 160,162" 
              fill="none" stroke="#f58220" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
              
        <!-- Central Heart - Right Lobe (Blue) -->
        <path d="M 160,82 C 200,52 235,102 160,162" 
              fill="none" stroke="#0072bc" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Text "AloNha" with exact font styles from original logo -->
        <text x="160" y="240" font-family="'Inter', 'Helvetica Neue', Arial, sans-serif" font-size="52" font-weight="900" text-anchor="middle" letter-spacing="-1">
          <tspan fill="#005da4">Alo</tspan><tspan fill="#f58220">Nha</tspan>
        </text>
      </svg>
    `.trim());
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Cấu hình kết nối PostgreSQL
const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://alonha_user:AlonhaSecured2026@127.0.0.1:5432/alonha',
  ssl: false
};
const pool = new Pool(dbConfig);

// Khởi tạo các bảng dữ liệu và nâng cấp cấu hình Nhóm chuẩn Zalo & Kết bạn
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
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
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
        is_active BOOLEAN DEFAULT true,
        is_online BOOLEAN DEFAULT false,
        drive_folder_id TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        is_group BOOLEAN DEFAULT false,
        avatar_url TEXT DEFAULT '/logo.png',
        is_archived BOOLEAN DEFAULT false,
        group_link_code VARCHAR(50) DEFAULT NULL,
        group_allow_edit_profile BOOLEAN DEFAULT true,
        group_allow_pin BOOLEAN DEFAULT true,
        group_allow_note BOOLEAN DEFAULT true,
        group_allow_poll BOOLEAN DEFAULT true,
        group_allow_send_message BOOLEAN DEFAULT true,
        group_approval_mode BOOLEAN DEFAULT false,
        group_mark_admin_messages BOOLEAN DEFAULT true,
        group_allow_new_members_read_recent BOOLEAN DEFAULT true,
        group_allow_join_via_link BOOLEAN DEFAULT true,
        creator_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_members (
        room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        unread_count INT DEFAULT 0,
        role VARCHAR(20) DEFAULT 'member',
        is_pinned BOOLEAN DEFAULT false,
        is_muted BOOLEAN DEFAULT false,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
        sender_id INT REFERENCES users(id) ON DELETE CASCADE,
        message_text TEXT DEFAULT '',
        file_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        file_size TEXT DEFAULT '',
        file_type TEXT DEFAULT '',
        status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'pending', 'approved', 'rejected')),
        moderated_by INT REFERENCES users(id) ON DELETE SET NULL,
        is_recalled BOOLEAN DEFAULT false,
        reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL,
        is_system BOOLEAN DEFAULT false,
        self_destruct_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pins (
        id SERIAL PRIMARY KEY,
        room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
        message_id INT REFERENCES messages(id) ON DELETE CASCADE,
        pinned_by INT REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_room_pin UNIQUE (room_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        maintenance_mode BOOLEAN DEFAULT false,
        allow_registration BOOLEAN DEFAULT true,
        max_users INT DEFAULT 1000,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_friend_request UNIQUE (sender_id, receiver_id)
      );

      CREATE TABLE IF NOT EXISTS message_reactions (
        id SERIAL PRIMARY KEY,
        message_id INT REFERENCES messages(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        emoji VARCHAR(10) NOT NULL,
        CONSTRAINT unique_user_message_reaction UNIQUE (message_id, user_id)
      );
    `);

    // Dọn dẹp Triggers cũ
    await client.query(`
      DO $$ 
      DECLARE 
          r RECORD;
      BEGIN
          FOR r IN (
              SELECT trigger_name, event_object_table 
              FROM information_schema.triggers 
              WHERE event_object_table = 'messages' OR event_object_table = 'room_members'
          ) 
          LOOP
              EXECUTE 'DROP TRIGGER IF EXISTS ' || r.trigger_name || ' ON ' || r.event_object_table || ' CASCADE;';
          END LOOP;
      END $$;
      
      DROP TABLE IF EXISTS user_room_read CASCADE;
    `);

    // Auto-Migration kiểm tra và bổ sung cột cho tương thích ngược
    const colsResult = await client.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
    `);
    const cols = colsResult.rows;

    const hasColumn = (tableName, columnName) => {
      return cols.some(c => c.table_name === tableName && c.column_name === columnName);
    };

    // Kiểm tra bảng 'users'
    if (!hasColumn('users', 'phone_number')) await client.query(`ALTER TABLE users ADD COLUMN phone_number VARCHAR(15) DEFAULT '';`);
    if (!hasColumn('users', 'gender')) await client.query(`ALTER TABLE users ADD COLUMN gender VARCHAR(10) DEFAULT 'Khác';`);
    if (!hasColumn('users', 'dob')) await client.query(`ALTER TABLE users ADD COLUMN dob DATE;`);
    if (!hasColumn('users', 'pin_code')) await client.query(`ALTER TABLE users ADD COLUMN pin_code VARCHAR(6) DEFAULT NULL;`);
    if (!hasColumn('users', 'pin_timeout')) await client.query(`ALTER TABLE users ADD COLUMN pin_timeout INT DEFAULT 1;`);
    if (!hasColumn('users', 'role')) await client.query(`ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';`);
    if (!hasColumn('users', 'is_active')) await client.query(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;`);
    if (!hasColumn('users', 'drive_folder_id')) await client.query(`ALTER TABLE users ADD COLUMN drive_folder_id TEXT DEFAULT NULL;`);
    if (!hasColumn('users', 'avatar_url')) {
      await client.query(`ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '/logo.png';`);
    }

    // Kiểm tra bảng 'rooms'
    if (!hasColumn('rooms', 'is_group')) await client.query(`ALTER TABLE rooms ADD COLUMN is_group BOOLEAN DEFAULT false;`);
    if (!hasColumn('rooms', 'avatar_url')) await client.query(`ALTER TABLE rooms ADD COLUMN avatar_url TEXT DEFAULT '/logo.png';`);
    if (!hasColumn('rooms', 'is_archived')) await client.query(`ALTER TABLE rooms ADD COLUMN is_archived BOOLEAN DEFAULT false;`);
    if (!hasColumn('rooms', 'group_link_code')) await client.query(`ALTER TABLE rooms ADD COLUMN group_link_code VARCHAR(50) DEFAULT NULL;`);
    if (!hasColumn('rooms', 'group_allow_edit_profile')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_edit_profile BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_pin')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_pin BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_note')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_note BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_poll')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_poll BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_send_message')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_send_message BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_approval_mode')) await client.query(`ALTER TABLE rooms ADD COLUMN group_approval_mode BOOLEAN DEFAULT false;`);
    if (!hasColumn('rooms', 'group_mark_admin_messages')) await client.query(`ALTER TABLE rooms ADD COLUMN group_mark_admin_messages BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_new_members_read_recent')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_new_members_read_recent BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'group_allow_join_via_link')) await client.query(`ALTER TABLE rooms ADD COLUMN group_allow_join_via_link BOOLEAN DEFAULT true;`);
    if (!hasColumn('rooms', 'creator_id')) await client.query(`ALTER TABLE rooms ADD COLUMN creator_id INT REFERENCES users(id) ON DELETE SET NULL;`);
    if (!hasColumn('rooms', 'group_moderation_mode')) await client.query(`ALTER TABLE rooms ADD COLUMN group_moderation_mode BOOLEAN DEFAULT false;`);

    // Kiểm tra bảng 'room_members'
    if (!hasColumn('room_members', 'unread_count')) await client.query(`ALTER TABLE room_members ADD COLUMN unread_count INT DEFAULT 0;`);
    if (!hasColumn('room_members', 'role')) await client.query(`ALTER TABLE room_members ADD COLUMN role VARCHAR(20) DEFAULT 'member';`);
    if (!hasColumn('room_members', 'is_pinned')) await client.query(`ALTER TABLE room_members ADD COLUMN is_pinned BOOLEAN DEFAULT false;`);
    if (!hasColumn('room_members', 'is_muted')) await client.query(`ALTER TABLE room_members ADD COLUMN is_muted BOOLEAN DEFAULT false;`);
    if (!hasColumn('room_members', 'joined_at')) await client.query(`ALTER TABLE room_members ADD COLUMN joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Kiểm tra bảng 'messages'
    if (!hasColumn('messages', 'message_text')) await client.query(`ALTER TABLE messages ADD COLUMN message_text TEXT DEFAULT '';`);
    if (!hasColumn('messages', 'file_url')) await client.query(`ALTER TABLE messages ADD COLUMN file_url TEXT DEFAULT '';`);
    if (!hasColumn('messages', 'file_name')) await client.query(`ALTER TABLE messages ADD COLUMN file_name TEXT DEFAULT '';`);
    if (!hasColumn('messages', 'file_type')) await client.query(`ALTER TABLE messages ADD COLUMN file_type TEXT DEFAULT '';`);
    if (!hasColumn('messages', 'is_system')) await client.query(`ALTER TABLE messages ADD COLUMN is_system BOOLEAN DEFAULT false;`);
    if (!hasColumn('messages', 'self_destruct_at')) await client.query(`ALTER TABLE messages ADD COLUMN self_destruct_at TIMESTAMP DEFAULT NULL;`);
    if (!hasColumn('messages', 'status')) await client.query(`ALTER TABLE messages ADD COLUMN status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read'));`);
    if (!hasColumn('messages', 'is_recalled')) await client.query(`ALTER TABLE messages ADD COLUMN is_recalled BOOLEAN DEFAULT false;`);
    if (!hasColumn('messages', 'reply_to_id')) await client.query(`ALTER TABLE messages ADD COLUMN reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL;`);
    if (!hasColumn('messages', 'file_size')) {
      await client.query(`ALTER TABLE messages ADD COLUMN file_size TEXT DEFAULT '';`);
    } else {
      try {
        await client.query(`ALTER TABLE messages ALTER COLUMN file_size TYPE TEXT;`);
      } catch (e) {}
    }
    if (!hasColumn('messages', 'moderated_by')) await client.query(`ALTER TABLE messages ADD COLUMN moderated_by INT REFERENCES users(id) ON DELETE SET NULL;`);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_room_pin ON pins (room_id, message_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_room_created_at ON messages (room_id, created_at);`);
    await client.query(`CREATE TABLE IF NOT EXISTS system_settings (
      id SERIAL PRIMARY KEY,
      maintenance_mode BOOLEAN DEFAULT false,
      allow_registration BOOLEAN DEFAULT true,
      max_users INT DEFAULT 1000,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);
    await client.query(`INSERT INTO system_settings (id, maintenance_mode, allow_registration, max_users) VALUES (1, false, true, 1000) ON CONFLICT (id) DO NOTHING;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_room_members_user_room ON room_members (user_id, room_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_room_members_room_user ON room_members (room_id, user_id);`);

    // Đồng bộ logo mặc định cho những tài khoản/nhóm cũ có avatar_url trống, null hoặc bị lệch link
    await client.query(`UPDATE users SET avatar_url = '/logo.png' WHERE avatar_url = '' OR avatar_url IS NULL OR avatar_url = 'logo.png';`);
    await client.query(`UPDATE rooms SET avatar_url = '/logo.png' WHERE avatar_url = '' OR avatar_url IS NULL OR avatar_url = 'logo.png';`);

    console.log("✅ Khởi tạo và liên kết các bảng dữ liệu PostgreSQL thành công!");

    // Tự động cập nhật mã Link & Trưởng nhóm cho các nhóm cũ
    const noLinkGroups = await client.query(`SELECT id FROM rooms WHERE is_group = true AND group_link_code IS NULL`);
    for (const row of noLinkGroups.rows) {
      const code = crypto.randomBytes(8).toString('hex');
      await client.query(`UPDATE rooms SET group_link_code = $1 WHERE id = $2`, [code, row.id]);
    }

    await client.query(`
      UPDATE rooms r 
      SET creator_id = (SELECT user_id FROM room_members WHERE room_id = r.id LIMIT 1) 
      WHERE r.is_group = true AND r.creator_id IS NULL;
    `);

    await client.query(`
      UPDATE room_members rm
      SET role = 'admin'
      WHERE rm.room_id IN (SELECT id FROM rooms WHERE is_group = true) 
        AND rm.user_id = (SELECT creator_id FROM rooms WHERE id = rm.room_id)
        AND rm.role = 'member';
    `);

  } catch (err) {
    console.error("❌ Lỗi bối cảnh khởi tạo cơ sở dữ liệu Postgres:", err.message);
  } finally {
    client.release();
  }
}
initDatabase();

async function ensureDefaultSuperAdmin() {
  try {
    const username = (process.env.SUPER_ADMIN_USERNAME || 'SuperAdmin').toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD || '123456';
    const existing = await pool.query(`SELECT id, role FROM users WHERE username = $1`, [username]);

    if (existing.rows.length > 0) {
      await pool.query(`UPDATE users SET role = 'super_admin', is_active = true, display_name = COALESCE(display_name, 'Super Admin') WHERE username = $1`, [username]);
      console.log(`✅ Đã đồng bộ vai trò Super Admin cho tài khoản: ${username}`);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, display_name, avatar_url, role, is_active) VALUES ($1, $2, $3, '/logo.png', 'super_admin', true)`,
      [username, hash, 'Super Admin']
    );
    console.log(`✅ Đã tạo tài khoản Super Admin mặc định: ${username} / ${password}`);
  } catch (err) {
    console.warn('⚠️ Không thể tạo tài khoản Super Admin mặc định:', err.message);
  }
}

ensureDefaultSuperAdmin();

// Cấu hình Google Drive 3TB
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1ou4P0L12KwoNUzvEvFuFwKkLCvzwvC8V';
let driveService = null;
let driveAuthType = ""; 
let authAccountEmail = "";

const OAUTH2_PATH = path.join(__dirname, 'google-oauth2.json');
const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json');

if (fs.existsSync(OAUTH2_PATH)) {
  try {
    const oauth2Data = JSON.parse(fs.readFileSync(OAUTH2_PATH, 'utf8'));
    const oauth2Client = new google.auth.OAuth2(
      oauth2Data.client_id,
      oauth2Data.client_secret,
      'http://localhost'
    );
    oauth2Client.setCredentials({
      refresh_token: oauth2Data.refresh_token
    });
    driveService = google.drive({ version: 'v3', auth: oauth2Client });
    driveAuthType = "OAuth2";
    authAccountEmail = oauth2Data.email || "hieppt@gmail.com";
    console.log("✅ Google Drive API đã kết nối bằng OAUTH2 thành công!");
    console.log(`👤 Tài khoản Gmail liên kết: ${authAccountEmail}`);
  } catch (e) {
    console.error("❌ Lỗi nạp google-oauth2.json:", e.message);
  }
} else if (fs.existsSync(CREDENTIALS_PATH)) {
  try {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    authAccountEmail = credentials.client_email;
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/drive']
    );
    driveService = google.drive({ version: 'v3', auth });
    driveAuthType = "ServiceAccount";
    console.log("⚠️ Khởi động Google Drive API bằng Service Account!");
  } catch (e) {
    console.error("❌ Lỗi nạp google-credentials.json:", e.message);
  }
}

/**
 * Lấy hoặc tạo một thư mục con riêng biệt trên Google Drive cho từng User AloNha.
 */
async function getOrCreateUserDriveFolder(userId, displayName) {
  if (!driveService) return GOOGLE_DRIVE_FOLDER_ID;

  try {
    const dbRes = await pool.query(`SELECT drive_folder_id FROM users WHERE id = $1`, [userId]);
    if (dbRes.rows.length > 0 && dbRes.rows[0].drive_folder_id) {
      return dbRes.rows[0].drive_folder_id;
    }

    const folderName = `${displayName} (ID ${userId})`;
    const mainFolderId = GOOGLE_DRIVE_FOLDER_ID;

    const query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${mainFolderId}' in parents and trashed = false`;
    const searchResponse = await driveService.files.list({
      q: query,
      spaces: 'drive',
      fields: 'files(id, name)',
      pageSize: 1
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      const existingFolderId = searchResponse.data.files[0].id;
      await pool.query(`UPDATE users SET drive_folder_id = $1 WHERE id = $2`, [existingFolderId, userId]);
      return existingFolderId;
    }

    console.log(`📂 Đang khởi tạo thư mục riêng trên Google Drive cho: ${folderName}`);
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [mainFolderId]
    };
    
    const folderResponse = await driveService.files.create({
      requestBody: fileMetadata,
      fields: 'id'
    });

    const newFolderId = folderResponse.data.id;

    await driveService.permissions.create({
      fileId: newFolderId,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    await pool.query(`UPDATE users SET drive_folder_id = $1 WHERE id = $2`, [newFolderId, userId]);
    return newFolderId;
  } catch (err) {
    console.warn("⚠️ Lỗi phân tích hoặc tạo thư mục trên Drive, fallback về thư mục gốc:", err.message);
    return GOOGLE_DRIVE_FOLDER_ID;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'avatar') {
      cb(null, AVATARS_DIR);
    } else {
      cb(null, UPLOADS_DIR);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

// Middleware xác thực token: verify JWT rồi re-fetch user data từ DB để tránh stale display_name/avatar trong token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Không tìm thấy token truy cập" });
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token không hợp lệ hoặc hết hạn" });
    try {
      const result = await pool.query(`SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, pin_code, pin_timeout, role, is_active FROM users WHERE id = $1`, [decoded.id]);
      if (result.rows.length === 0) return res.status(403).json({ error: "Người dùng không tồn tại" });
      req.user = result.rows[0];
      if (!req.user.is_active) return res.status(403).json({ error: "Tài khoản của bạn đã bị vô hiệu hóa bởi quản trị viên" });
      next();
    } catch (e) {
      console.error("ERROR authenticating user:", e);
      res.status(500).json({ error: "Lỗi xác thực người dùng" });
    }
  });
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || !['super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: "Chỉ Super Admin mới có quyền truy cập khu vực quản trị" });
  }
  next();
};

app.use(cors());
app.use(express.json({ limit: '1024mb' }));
app.use(express.urlencoded({ limit: '1024mb', extended: true }));

// API Đăng ký
app.post('/api/auth/register', async (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const role = (process.env.SUPER_ADMIN_USERNAME && username.trim().toLowerCase() === process.env.SUPER_ADMIN_USERNAME.toLowerCase()) ? 'super_admin' : 'user';
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, avatar_url, role) VALUES ($1, $2, $3, '/logo.png', $4) RETURNING id, username, display_name, role, is_active`,
      [username.trim().toLowerCase(), hash, display_name.trim(), role]
    );
    res.status(201).json({ message: "Đăng ký thành công", user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: "Tên đăng nhập đã tồn tại" });
    res.status(500).json({ error: "Lỗi máy chủ khi đăng ký: " + err.message });
  }
});

// API Đăng nhập
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username.trim().toLowerCase()]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Tài khoản không tồn tại" });
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: "Mật khẩu không chính xác" });

    if (!user.is_active) return res.status(403).json({ error: "Tài khoản của bạn đã bị vô hiệu hóa bởi quản trị viên" });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url || '/logo.png', pin_code: user.pin_code, pin_timeout: user.pin_timeout, role: user.role, is_active: user.is_active } });
  } catch (err) {
    res.status(500).json({ error: "Lỗi máy chủ xử lý đăng nhập" });
  }
});

// API lấy hồ sơ cá nhân
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, phone_number, gender, dob, pin_code, pin_timeout, role, is_active FROM users WHERE id = $1`, [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy thông tin hồ sơ" });
  }
});

// API cập nhật hồ sơ cá nhân
app.put('/api/users/me', authenticateToken, async (req, res) => {
  const { display_name, phone_number, gender, dob, pin_code, pin_timeout } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET display_name = $1, phone_number = $2, gender = $3, dob = $4, pin_code = $5, pin_timeout = $6 WHERE id = $7 RETURNING id, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, phone_number, gender, dob, pin_code, pin_timeout`,
      [display_name, phone_number, gender, dob || null, pin_code || null, pin_timeout || 1, req.user.id]
    );
    res.json({ message: "Cập nhật hồ sơ thành công", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật hồ sơ" });
  }
});

// API Tải ảnh đại diện cá nhân
app.post('/api/users/me/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Vui lòng chọn ảnh đại diện" });
  const relativePath = `/uploads/avatars/${req.file.filename}`;
  try {
    await pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [relativePath, req.user.id]);
    res.json({ message: "Tải lên ảnh đại diện thành công", avatar_url: relativePath });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lưu ảnh đại diện: " + err.message });
  }
});

// API lấy danh sách thành viên
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, is_online, role, is_active FROM users WHERE id != $1 ORDER BY display_name ASC`, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách thành viên" });
  }
});

// ==== ADMIN PANEL API ====
app.get('/api/admin/overview', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [usersRes, roomsRes, settingsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_users FROM users`),
      pool.query(`SELECT COUNT(*)::int AS total_rooms FROM rooms`),
      pool.query(`SELECT maintenance_mode, allow_registration, max_users FROM system_settings ORDER BY id DESC LIMIT 1`)
    ]);
    res.json({
      total_users: usersRes.rows[0].total_users,
      total_rooms: roomsRes.rows[0].total_rooms,
      settings: settingsRes.rows[0] || { maintenance_mode: false, allow_registration: true, max_users: 1000 }
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi tải tổng quan quản trị" });
  }
});

app.get('/api/admin/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, role, is_active, created_at FROM users ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách người dùng" });
  }
});

app.put('/api/admin/users/:userId/role', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!['user', 'admin', 'super_admin'].includes(role)) return res.status(400).json({ error: "Vai trò không hợp lệ" });
  try {
    const result = await pool.query(`UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, display_name, role`, [role, userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy người dùng" });
    res.json({ message: "Cập nhật vai trò thành công", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật vai trò" });
  }
});

app.put('/api/admin/users/:userId/status', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { userId } = req.params;
  const { is_active } = req.body;
  try {
    const result = await pool.query(`UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, display_name, is_active`, [is_active, userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy người dùng" });
    res.json({ message: "Cập nhật trạng thái thành công", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật trạng thái người dùng" });
  }
});

app.delete('/api/admin/users/:userId', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { userId } = req.params;
  if (parseInt(userId) === req.user.id) return res.status(400).json({ error: "Không thể xóa tài khoản đang đăng nhập" });
  try {
    const result = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy người dùng" });
    res.json({ message: "Đã xóa người dùng thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa người dùng" });
  }
});

app.get('/api/admin/rooms', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, is_group, is_archived, creator_id, created_at FROM rooms ORDER BY created_at DESC LIMIT 200`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách nhóm" });
  }
});

app.put('/api/admin/rooms/:roomId/status', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { roomId } = req.params;
  const { is_archived } = req.body;
  try {
    const result = await pool.query(`UPDATE rooms SET is_archived = $1 WHERE id = $2 RETURNING id, name, is_archived`, [is_archived, roomId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy nhóm" });
    res.json({ message: "Cập nhật trạng thái nhóm thành công", room: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật nhóm" });
  }
});

app.get('/api/admin/settings', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, maintenance_mode, allow_registration, max_users, updated_at FROM system_settings ORDER BY id DESC LIMIT 1`);
    res.json(result.rows[0] || { id: 1, maintenance_mode: false, allow_registration: true, max_users: 1000, updated_at: null });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy cài đặt hệ thống" });
  }
});

app.put('/api/admin/settings', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { maintenance_mode, allow_registration, max_users } = req.body;
  try {
    const result = await pool.query(`UPDATE system_settings SET maintenance_mode = $1, allow_registration = $2, max_users = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1 RETURNING id, maintenance_mode, allow_registration, max_users, updated_at`, [maintenance_mode, allow_registration, max_users]);
    if (result.rows.length === 0) {
      const inserted = await pool.query(`INSERT INTO system_settings (id, maintenance_mode, allow_registration, max_users, updated_at) VALUES (1, $1, $2, $3, CURRENT_TIMESTAMP) RETURNING id, maintenance_mode, allow_registration, max_users, updated_at`, [maintenance_mode, allow_registration, max_users]);
      return res.json({ message: "Cập nhật cài đặt hệ thống thành công", settings: inserted.rows[0] });
    }
    res.json({ message: "Cập nhật cài đặt hệ thống thành công", settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật cài đặt hệ thống" });
  }
});

app.get('/api/admin/rooms/:roomId/messages', authenticateToken, requireSuperAdmin, async (req, res) => {
  const { roomId } = req.params;
  try {
    const roomResult = await pool.query(`SELECT id, name, is_group FROM rooms WHERE id = $1`, [roomId]);
    if (roomResult.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng" });

    const result = await pool.query(`
      SELECT m.id, m.room_id, m.sender_id, m.message_text, m.file_url, m.file_name, m.file_size, m.file_type, m.is_system, m.status, m.is_recalled, m.reply_to_id, m.created_at,
             u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url,
             parent_m.message_text as parent_text, parent_m.file_name as parent_file_name, parent_m.is_recalled as parent_is_recalled,
             parent_u.display_name as parent_sender_name,
             COALESCE(
               (SELECT json_agg(json_build_object('emoji', mr.emoji, 'user_id', mr.user_id, 'display_name', ru.display_name))
                FROM message_reactions mr
                JOIN users ru ON mr.user_id = ru.id
                WHERE mr.message_id = m.id),
               '[]'::json
             ) as reactions
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      LEFT JOIN messages parent_m ON m.reply_to_id = parent_m.id
      LEFT JOIN users parent_u ON parent_m.sender_id = parent_u.id
      JOIN rooms r ON m.room_id = r.id
      WHERE m.room_id = $1 AND (m.self_destruct_at IS NULL OR m.self_destruct_at > CURRENT_TIMESTAMP)
      ORDER BY m.created_at ASC
    `, [roomId]);

    res.json({ room: roomResult.rows[0], messages: result.rows });
  } catch (err) {
    console.error("❌ Lỗi lấy lịch sử chat cho admin:", err.message);
    res.status(500).json({ error: "Lỗi lấy lịch sử chat cho admin" });
  }
});

// API lấy danh sách phòng chat
app.get('/api/rooms', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.is_group, rm.unread_count, rm.is_pinned, rm.is_muted,
             CASE 
               WHEN r.is_group = false AND r.name != 'Cloud của tôi' THEN 
                 COALESCE(
                   (SELECT u.display_name FROM users u 
                    JOIN room_members rm2 ON u.id = rm2.user_id 
                    WHERE rm2.room_id = r.id AND rm2.user_id != $1 LIMIT 1),
                   r.name
                 )
               ELSE r.name 
             END as name,
             CASE 
               WHEN r.is_group = false AND r.name != 'Cloud của tôi' THEN 
                 COALESCE(
                   (SELECT u.avatar_url FROM users u 
                    JOIN room_members rm2 ON u.id = rm2.user_id 
                    WHERE rm2.room_id = r.id AND rm2.user_id != $1 LIMIT 1),
                   '/logo.png'
                 )
               ELSE COALESCE(r.avatar_url, '/logo.png') 
             END as partner_avatar,
             (SELECT message_text FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = $1
      ORDER BY rm.is_pinned DESC, last_message_time DESC NULLS LAST, r.id DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách phòng" });
  }
});

// API Tạo phòng chat
app.post('/api/rooms', authenticateToken, async (req, res) => {
  const { name, is_group, members } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const memberArray = Array.isArray(members) ? members : [];

    if (!is_group && memberArray.length === 1) {
      const partnerId = memberArray[0];
      const existingRoom = await client.query(`
        SELECT r.id FROM rooms r
        JOIN room_members rm1 ON r.id = rm1.room_id
        JOIN room_members rm2 ON r.id = rm2.room_id
        WHERE r.is_group = false AND rm1.user_id = $1 AND rm2.user_id = $2
      `, [req.user.id, partnerId]);
      if (existingRoom.rows.length > 0) {
        await client.query('COMMIT');
        return res.json(existingRoom.rows[0]);
      }
    }

    const linkCode = is_group ? crypto.randomBytes(8).toString('hex') : null;
    const roomResult = await client.query(
      `INSERT INTO rooms (name, is_group, creator_id, group_link_code, avatar_url) VALUES ($1, $2, $3, $4, '/logo.png') RETURNING id, name, is_group`,
      [name, is_group, is_group ? req.user.id : null, linkCode]
    );
    const roomId = roomResult.rows[0].id;
    const allMembers = Array.from(new Set([req.user.id, ...memberArray]));
    for (const uId of allMembers) {
      const role = (is_group && uId === req.user.id) ? 'admin' : 'member';
      await client.query(`INSERT INTO room_members (room_id, user_id, role, unread_count, joined_at) VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP)`, [roomId, uId, role]);
    }
    
    if (is_group) {
      await client.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
        roomId, req.user.id, `${req.user.display_name} đã khởi tạo nhóm chat.`
      ]);
    }

    await client.query('COMMIT');
    io.emit('room_list_update');
    res.json(roomResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ [API Create Room Database Error]:", err);
    res.status(500).json({ error: "Lỗi máy chủ tạo phòng: " + err.message });
  } finally {
    client.release();
  }
});

// API Tạo/Lấy phòng chat Cloud
app.post('/api/rooms/cloud', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const checkCloud = await client.query(`
      SELECT r.id, r.name FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id
      WHERE r.name = 'Cloud của tôi' AND r.is_group = false
      GROUP BY r.id
      HAVING COUNT(rm.user_id) = 1 AND MAX(rm.user_id) = $1
    `, [req.user.id]);

    if (checkCloud.rows.length > 0) {
      await client.query('COMMIT');
      return res.json(checkCloud.rows[0]);
    }

    const roomResult = await client.query(`INSERT INTO rooms (name, is_group, avatar_url) VALUES ('Cloud của tôi', false, '/logo.png') RETURNING id, name`);
    const roomId = roomResult.rows[0].id;
    await client.query(`INSERT INTO room_members (room_id, user_id, role, unread_count) VALUES ($1, $2, 'member', 0)`, [roomId, req.user.id]);
    await client.query(
      `INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`,
      [roomId, req.user.id, "Chào mừng bạn đến với kho lưu trữ Cloud cá nhân 3TB! Mọi file, ảnh gửi vào đây sẽ được đồng bộ tuyệt đối bảo mật lên Google Drive."]
    );
    await client.query('COMMIT');
    res.json(roomResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Lỗi không thể khởi tạo Cloud" });
  } finally {
    client.release();
  }
});

// API Lấy lịch sử chat
app.get('/api/rooms/:roomId/messages', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    await pool.query(`UPDATE room_members SET unread_count = 0 WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    
    const result = await pool.query(`
      SELECT m.id, m.room_id, m.sender_id, m.message_text, m.file_url, m.file_name, m.file_size, m.file_type, m.is_system, m.status, m.is_recalled, m.reply_to_id, m.created_at,
             u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url,
             parent_m.message_text as parent_text, parent_m.file_name as parent_file_name, parent_m.is_recalled as parent_is_recalled,
             parent_u.display_name as parent_sender_name,
             COALESCE(
               (SELECT json_agg(json_build_object('emoji', mr.emoji, 'user_id', mr.user_id, 'display_name', ru.display_name))
                FROM message_reactions mr
                JOIN users ru ON mr.user_id = ru.id
                WHERE mr.message_id = m.id),
               '[]'::json
             ) as reactions
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      LEFT JOIN messages parent_m ON m.reply_to_id = parent_m.id
      LEFT JOIN users parent_u ON parent_m.sender_id = parent_u.id
      JOIN room_members rm ON m.room_id = rm.room_id AND rm.user_id = $2
      JOIN rooms r ON m.room_id = r.id
      WHERE m.room_id = $1 AND (m.self_destruct_at IS NULL OR m.self_destruct_at > CURRENT_TIMESTAMP)
        AND (
          r.is_group = false
          OR r.group_allow_new_members_read_recent = true
          OR m.created_at >= rm.joined_at
          OR m.is_system = true
        )
        AND (
          r.is_group = false
          OR r.group_moderation_mode = false
          OR m.status NOT IN ('pending', 'rejected')
          OR m.sender_id = $2
          OR EXISTS (SELECT 1 FROM room_members rm2 WHERE rm2.room_id = m.room_id AND rm2.user_id = $2 AND rm2.role IN ('admin', 'co-leader'))
        )
      ORDER BY m.created_at ASC
    `, [roomId, req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Lỗi lấy lịch sử chat:", err.message);
    res.status(500).json({ error: "Lỗi lấy lịch sử chat" });
  }
});

// API Tải file lên và đồng bộ sang Google Drive (VÁ LỖI TRIỆT ĐỂ: CAST & NaN)
// Bổ sung cleanup: luôn xóa file tạm local khi Drive upload thất bại
app.post('/api/rooms/:roomId/upload', authenticateToken, upload.single('file'), async (req, res) => {
  const { roomId } = req.params;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Không tìm thấy file" });

  const rawSize = file.size;
  let formattedSize = `${(rawSize / 1024).toFixed(1)} KB`;
  if (rawSize > 1024 * 1024) formattedSize = `${(rawSize / (1024 * 1024)).toFixed(1)} MB`;
  if (rawSize > 1024 * 1024 * 1024) formattedSize = `${(rawSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;

  let finalFileUrl = `/uploads/${file.filename}`;
  let driveFileUrl = '';
  const isImage = file.mimetype.startsWith('image/');

  if (driveService) {
    try {
      const userFolderId = await getOrCreateUserDriveFolder(req.user.id, req.user.display_name);

      const fileMetadata = {
        name: file.originalname,
        parents: [userFolderId]
      };
      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.path)
      };
      const driveResponse = await driveService.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink'
      });

      try {
        await driveService.permissions.create({
          fileId: driveResponse.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (permErr) {
        console.warn("⚠️ Không thể set permission public cho file Drive:", permErr.message);
      }

      const fileId = driveResponse.data.id;
      if (driveResponse.data.webViewLink) {
        driveFileUrl = driveResponse.data.webViewLink;
      } else if (driveResponse.data.webContentLink) {
        driveFileUrl = driveResponse.data.webContentLink;
      } else {
        driveFileUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
      }

    } catch (driveErr) {
      console.warn(`⚠️ [${driveAuthType}] Không thể upload lên Google Drive:`, driveErr.message);
      // File local vẫn được giữ lại để client có thể tải từ local
    }
  }

  try {
    const { reply_to_id } = req.body;
    const fileType = isImage ? 'media' : 'file';
    const parsedRoomId = parseInt(roomId);

    // Chuẩn hóa reply_to_id để tránh NaN làm crash database PG
    let parsedReplyToId = null;
    if (reply_to_id && reply_to_id !== 'null' && reply_to_id !== 'undefined') {
      const parsed = parseInt(reply_to_id);
      if (!isNaN(parsed)) {
        parsedReplyToId = parsed;
      }
    }

    // Lưu cả link local và Drive backup vào file_url (format: "local_path||drive_url")
    const combinedFileUrl = driveFileUrl ? `${finalFileUrl}||${driveFileUrl}` : finalFileUrl;

    // Kiểm tra chế độ kiểm duyệt
    const modCheck = await pool.query(`SELECT is_group, group_moderation_mode FROM rooms WHERE id = $1`, [parsedRoomId]);
    let initialStatus = 'sent';
    let isModerated = false;
    if (modCheck.rows.length > 0 && modCheck.rows[0].is_group && modCheck.rows[0].group_moderation_mode) {
      const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [parsedRoomId, req.user.id]);
      if (roleCheck.rows.length > 0 && roleCheck.rows[0].role === 'member') {
        initialStatus = 'pending';
        isModerated = true;
      }
    }

    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, file_url, file_name, file_size, file_type, status, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [parsedRoomId, req.user.id, combinedFileUrl, file.originalname, formattedSize, fileType, initialStatus, parsedReplyToId]
    );

    await pool.query(
      `UPDATE room_members SET unread_count = unread_count + 1 WHERE room_id = $1 AND user_id != $2`,
      [parsedRoomId, req.user.id]
    );

    const userResult = await pool.query(`SELECT display_name, COALESCE(avatar_url, '/logo.png') as avatar_url FROM users WHERE id = $1`, [req.user.id]);
    
    // Nạp chi tiết trích dẫn nếu có
    let parent_sender_name = null;
    let parent_text = null;
    let parent_is_recalled = false;
    if (parsedReplyToId) {
      const parentRes = await pool.query(`
        SELECT pm.message_text, pm.is_recalled, pu.display_name 
        FROM messages pm
        LEFT JOIN users pu ON pm.sender_id = pu.id
        WHERE pm.id = $1
      `, [parsedReplyToId]);
      if (parentRes.rows.length > 0) {
        parent_sender_name = parentRes.rows[0].display_name;
        parent_text = parentRes.rows[0].message_text;
        parent_is_recalled = parentRes.rows[0].is_recalled;
      }
    }

    const enrichedMsg = { 
      ...result.rows[0], 
      display_name: userResult.rows[0].display_name, 
      avatar_url: userResult.rows[0].avatar_url,
      parent_sender_name,
      parent_text,
      parent_is_recalled
    };

    if (isModerated) {
      // Chỉ gửi cho admin và người gửi
      const adminMembers = await pool.query(`SELECT user_id FROM room_members WHERE room_id = $1 AND role IN ('admin', 'co-leader')`, [parsedRoomId]);
      const adminIds = adminMembers.rows.map(a => a.user_id);
      for (const socketInfo of activeSockets) {
        const uid = socketInfo[0];
        if (adminIds.includes(uid)) {
          const sockets = socketInfo[1];
          for (const sid of sockets) {
            io.to(sid).emit('receive_message', { ...enrichedMsg, _moderation_pending: true });
          }
        }
      }
      const senderSockets = activeSockets.get(req.user.id);
      if (senderSockets) {
        for (const sid of senderSockets) {
          io.to(sid).emit('receive_message', { ...enrichedMsg, _my_pending: true });
        }
      }
      io.to(`room_${roomId}`).emit('moderation_queue_updated', { room_id: parsedRoomId });
    } else {
      io.to(`room_${roomId}`).emit('receive_message', enrichedMsg);
    }

    io.emit('room_list_update');
    res.json(enrichedMsg);

    // ✅ Xóa file local sau khi response thành công, nếu đã upload thành công lên Drive
    if (driveFileUrl) {
      try {
        fs.unlink(file.path, (err) => {
          if (err) console.warn(`⚠️ Không thể xóa file local: ${file.filename}`, err.message);
          else console.log(`🗑️ Đã xóa file local: ${file.filename}`);
        });
      } catch (unlinkErr) {
        // silent
      }
    }
  } catch (err) {
    console.error("❌ Lỗi lưu file upload vào CSDL:", err.message);
    res.status(500).json({ error: "Lỗi lưu file vào CSDL: " + err.message });
  }
});

// API Thu hồi tin nhắn
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const msgCheck = await pool.query(`SELECT sender_id, room_id FROM messages WHERE id = $1`, [id]);
    if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    if (msgCheck.rows[0].sender_id !== req.user.id) return res.status(403).json({ error: "Không có quyền thu hồi" });

    const roomId = msgCheck.rows[0].room_id;
    await pool.query(`
      UPDATE messages 
      SET is_recalled = true, message_text = '', file_url = '', file_name = '', file_size = '', file_type = '' 
      WHERE id = $1
    `, [id]);

    await pool.query(`DELETE FROM pins WHERE message_id = $1`, [id]);

    io.to(`room_${roomId}`).emit('message_recalled', { message_id: id, room_id: roomId });
    io.to(`room_${roomId}`).emit('pins_updated', { room_id: roomId });
    io.emit('room_list_update');
    res.json({ message: "Thu hồi tin nhắn thành công", id });
  } catch (err) {
    console.error("Lỗi thu hồi tin nhắn:", err.message);
    res.status(500).json({ error: "Lỗi hệ thống khi thu hồi tin nhắn" });
  }
});

// API Hẹn giờ xóa
app.post('/api/rooms/:roomId/self-destruct', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { seconds } = req.body;
  try {
    let messageText = "";
    if (seconds > 0) {
      const minutes = seconds / 60;
      const hours = minutes / 60;
      const days = hours / 24;
      let timeStr = `${seconds} giây`;
      if (minutes >= 1) timeStr = `${minutes} phút`;
      if (hours >= 1) timeStr = `${hours} giờ`;
      if (days >= 1) timeStr = `${days} ngày`;
      messageText = `⏰ Quản trị viên đã thiết lập tự động xóa tin nhắn sau: ${timeStr}.`;
    } else {
      messageText = `⏰ Quản trị viên đã tắt tự động xóa tin nhắn.`;
    }
    const sysMsg = await pool.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true) RETURNING *`, [roomId, req.user.id, messageText]);
    res.json({ message: "Thiết lập thành công", system_message: sysMsg.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi thiết lập hẹn giờ" });
  }
});

// API Lấy lịch sử ghim
app.get('/api/rooms/:roomId/pins', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.id as pin_id, m.id as message_id, m.message_text, m.file_name, m.file_url, u.display_name
      FROM pins p
      JOIN messages m ON p.message_id = m.id
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE p.room_id = $1
      ORDER BY p.created_at DESC
    `, [roomId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách ghim" });
  }
});

// API Ghim tin nhắn
app.post('/api/rooms/:roomId/pins', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { message_id } = req.body;
  try {
    const roomRes = await pool.query(`SELECT is_group, group_allow_pin FROM rooms WHERE id = $1`, [roomId]);
    if (roomRes.rows.length > 0 && roomRes.rows[0].is_group) {
      const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
      const role = roleCheck.rows.length > 0 ? roleCheck.rows[0].role : 'member';
      if (!roomRes.rows[0].group_allow_pin && role !== 'admin' && role !== 'co-leader') {
        return res.status(403).json({ error: "Trưởng nhóm đã tắt quyền ghim tin nhắn của thành viên" });
      }
    }

    const countCheck = await pool.query(`SELECT COUNT(*) FROM pins WHERE room_id = $1`, [roomId]);
    if (parseInt(countCheck.rows[0].count) >= 10) return res.status(400).json({ error: "Hội thoại tối đa ghim 10 tin" });

    await pool.query(`INSERT INTO pins (room_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [roomId, message_id, req.user.id]);
    io.to(`room_${roomId}`).emit('pins_updated', { room_id: roomId });
    res.json({ message: "Ghim thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi ghim tin nhắn: " + err.message });
  }
});

// API Bỏ ghim
app.delete('/api/rooms/:roomId/pins/:messageId', authenticateToken, async (req, res) => {
  const { roomId, messageId } = req.params;
  try {
    await pool.query(`DELETE FROM pins WHERE room_id = $1 AND message_id = $2`, [roomId, messageId]);
    io.to(`room_${roomId}`).emit('pins_updated', { room_id: roomId });
    res.json({ message: "Bỏ ghim thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi bỏ ghim" });
  }
});

// API Sidebar tài nguyên
app.get('/api/rooms/:roomId/resources', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    const resources = await pool.query(`
      SELECT id, message_text, file_url, file_name, file_size, file_type, created_at
      FROM messages
      WHERE room_id = $1 AND (self_destruct_at IS NULL OR self_destruct_at > CURRENT_TIMESTAMP)
      ORDER BY created_at DESC
    `, [roomId]);

    const media = [];
    const files = [];
    const links = [];

    resources.rows.forEach(row => {
      if (row.file_type === 'media') {
        media.push(row);
      } else if (row.file_type === 'file') {
        files.push(row);
      } else if (row.message_text && /https?:\/\/[^\s]+/i.test(row.message_text)) {
        const matches = row.message_text.match(/https?:\/\/[^\s]+/gi);
        if (matches) {
          matches.forEach(url => {
            links.push({ id: row.id, url, created_at: row.created_at });
          });
        }
      }
    });

    res.json({ media, files, links });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy tài nguyên" });
  }
});

// Lấy thông tin thành viên và cài đặt chi tiết của Nhóm
app.get('/api/rooms/:roomId/members', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    const groupCheck = await pool.query(`
      SELECT id, name, COALESCE(avatar_url, '/logo.png') as avatar_url, is_group, creator_id, group_link_code,
             group_allow_edit_profile, group_allow_pin, group_allow_note, group_allow_poll, 
             group_allow_send_message, group_approval_mode, group_mark_admin_messages, 
             group_allow_new_members_read_recent, group_allow_join_via_link,
             group_moderation_mode
      FROM rooms WHERE id = $1
    `, [roomId]);
    
    if (groupCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng" });
    const settings = groupCheck.rows[0];

    const selfSetting = await pool.query(`
      SELECT is_pinned, is_muted, role FROM room_members WHERE room_id = $1 AND user_id = $2
    `, [roomId, req.user.id]);

    const membersRes = await pool.query(`
      SELECT rm.user_id, rm.role, rm.is_muted, rm.is_pinned, u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url, u.is_online
      FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = $1
      ORDER BY CASE WHEN rm.role = 'admin' THEN 1 WHEN rm.role = 'co-leader' THEN 2 ELSE 3 END, u.display_name ASC
    `, [roomId]);

    res.json({
      settings,
      self: selfSetting.rows[0] || { is_pinned: false, is_muted: false, role: 'member' },
      members: membersRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy thông tin thành viên nhóm: " + err.message });
  }
});

// Cập nhật cài đặt cá nhân với phòng
app.put('/api/rooms/:roomId/member-settings', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { is_pinned, is_muted } = req.body;
  try {
    const fields = [];
    const values = [];
    let paramIdx = 1;

    if (is_pinned !== undefined) {
      fields.push(`is_pinned = $${paramIdx++}`);
      values.push(is_pinned);
    }
    if (is_muted !== undefined) {
      fields.push(`is_muted = $${paramIdx++}`);
      values.push(is_muted);
    }

    if (fields.length === 0) return res.status(400).json({ error: "Không có dữ liệu cập nhật" });

    values.push(roomId, req.user.id);
    const query = `UPDATE room_members SET ${fields.join(', ')} WHERE room_id = $${paramIdx++} AND user_id = $${paramIdx++} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy thành viên trong phòng" });
    res.json({ message: "Cập nhật cài đặt cá nhân thành công", settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lưu cài đặt cá nhân: " + err.message });
  }
});

// Cập nhật quyền hạn/cài đặt nhóm
app.put('/api/rooms/:roomId/settings', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const {
    group_allow_edit_profile,
    group_allow_pin,
    group_allow_note,
    group_allow_poll,
    group_allow_send_message,
    group_approval_mode,
    group_mark_admin_messages,
    group_allow_new_members_read_recent,
    group_allow_join_via_link,
    group_moderation_mode
  } = req.body;

  try {
    const roomCheck = await pool.query(`SELECT creator_id FROM rooms WHERE id = $1`, [roomId]);
    if (roomCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng nhóm" });
    
    if (roomCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: "Chỉ có Trưởng nhóm mới có quyền thay đổi các cài đặt!" });
    }

    const query = `
      UPDATE rooms SET 
        group_allow_edit_profile = $1,
        group_allow_pin = $2,
        group_allow_note = $3,
        group_allow_poll = $4,
        group_allow_send_message = $5,
        group_approval_mode = $6,
        group_mark_admin_messages = $7,
        group_allow_new_members_read_recent = $8,
        group_allow_join_via_link = $9,
        group_moderation_mode = $10
      WHERE id = $11 RETURNING *
    `;
    const result = await pool.query(query, [
      group_allow_edit_profile,
      group_allow_pin,
      group_allow_note,
      group_allow_poll,
      group_allow_send_message,
      group_approval_mode,
      group_mark_admin_messages,
      group_allow_new_members_read_recent,
      group_allow_join_via_link,
      group_moderation_mode,
      roomId
    ]);

    await pool.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
      roomId, req.user.id, "Cài đặt nhóm đã được cập nhật bởi Trưởng nhóm."
    ]);

    io.to(`room_${roomId}`).emit('group_settings_updated', { room_id: roomId });
    res.json({ message: "Cập nhật cài đặt nhóm thành công", settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật cài đặt nhóm: " + err.message });
  }
});

// Thay đổi tên / ảnh đại diện nhóm
app.put('/api/rooms/:roomId/profile', authenticateToken, upload.single('avatar'), async (req, res) => {
  const { roomId } = req.params;
  const { name } = req.body;
  const file = req.file;

  try {
    const roomCheck = await pool.query(`SELECT is_group, group_allow_edit_profile FROM rooms WHERE id = $1`, [roomId]);
    if (roomCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng" });

    if (roomCheck.rows[0].is_group) {
      const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
      if (roleCheck.rows.length === 0) return res.status(403).json({ error: "Bạn không phải thành viên nhóm" });
      const role = roleCheck.rows[0].role;
      if (!roomCheck.rows[0].group_allow_edit_profile && role !== 'admin' && role !== 'co-leader') {
        return res.status(403).json({ error: "Nhóm đã tắt tính năng cho phép thành viên đổi tên/ảnh đại diện" });
      }
    }

    let query = `UPDATE rooms SET `;
    const values = [];
    let paramIdx = 1;

    if (name) {
      query += `name = $${paramIdx++}, `;
      values.push(name.trim());
    }

    if (file) {
      const relativePath = `/uploads/avatars/${file.filename}`;
      query += `avatar_url = $${paramIdx++}, `;
      values.push(relativePath);
    }

    query = query.slice(0, -2);
    query += ` WHERE id = $${paramIdx++} RETURNING *`;
    values.push(roomId);

    const result = await pool.query(query, values);

    const changeMsg = name && file ? "tên và ảnh đại diện nhóm" : name ? "tên nhóm" : "ảnh đại diện nhóm";
    await pool.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
      roomId, req.user.id, `${req.user.display_name} đã thay đổi ${changeMsg}.`
    ]);

    io.to(`room_${roomId}`).emit('room_profile_updated', { room_id: roomId });
    io.emit('room_list_update');
    res.json({ message: "Cập nhật hồ sơ nhóm thành công", room: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật hồ sơ nhóm: " + err.message });
  }
});

// Thêm thành viên mới vào Nhóm
app.post('/api/rooms/:roomId/members', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { user_ids } = req.body;

  if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ error: "Danh sách thành viên không hợp lệ" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const memberCheck = await client.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    if (memberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Bạn không có quyền thêm thành viên vào nhóm này" });
    }

    const addedNames = [];
    for (const uId of user_ids) {
      const existCheck = await client.query(`SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, uId]);
      if (existCheck.rows.length === 0) {
        await client.query(`INSERT INTO room_members (room_id, user_id, role, unread_count, joined_at) VALUES ($1, $2, 'member', 0, CURRENT_TIMESTAMP)`, [roomId, uId]);
        const uNameRes = await client.query(`SELECT display_name FROM users WHERE id = $1`, [uId]);
        if (uNameRes.rows.length > 0) {
          addedNames.push(uNameRes.rows[0].display_name);
        }
      }
    }

    if (addedNames.length > 0) {
      const addedNamesStr = addedNames.join(", ");
      await client.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
        roomId, req.user.id, `${req.user.display_name} đã thêm ${addedNamesStr} vào nhóm.`
      ]);
    }

    await client.query('COMMIT');

    io.to(`room_${roomId}`).emit('room_members_updated', { room_id: roomId });
    io.emit('room_list_update');
    res.json({ message: "Đã thêm thành viên vào nhóm thành công" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Lỗi thêm thành viên: " + err.message });
  } finally {
    client.release();
  }
});

// Rời nhóm / Mời ra khỏi nhóm
app.delete('/api/rooms/:roomId/members/:userId', authenticateToken, async (req, res) => {
  const { roomId, userId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selfCheck = await client.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    if (selfCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Bạn không phải thành viên nhóm" });
    }
    const selfRole = selfCheck.rows[0].role;

    const targetCheck = await client.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, userId]);
    if (targetCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Thành viên không tồn tại trong nhóm" });
    }

    const isSelfKick = parseInt(userId) === req.user.id;

    if (!isSelfKick) {
      if (selfRole !== 'admin' && selfRole !== 'co-leader') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: "Bạn không có quyền mời thành viên khác ra khỏi nhóm." });
      }
    }

    const targetUserRes = await client.query(`SELECT display_name FROM users WHERE id = $1`, [userId]);
    const targetName = targetUserRes.rows[0].display_name;

    await client.query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, userId]);

    const sysMsg = isSelfKick 
      ? `${targetName} đã tự rời khỏi nhóm.`
      : `${req.user.display_name} đã mời ${targetName} ra khỏi nhóm.`;

    await client.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
      roomId, req.user.id, sysMsg
    ]);

    await client.query('COMMIT');

    io.to(`room_${roomId}`).emit('room_members_updated', { room_id: roomId });
    io.emit('room_list_update');
    res.json({ message: isSelfKick ? "Đã rời khỏi nhóm thành công" : "Đã xóa thành viên ra khỏi nhóm" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Lỗi rời/mời khỏi nhóm: " + err.message });
  } finally {
    client.release();
  }
});

// Lấy thông tin nhóm bằng mã liên kết
app.get('/api/rooms/by-link/:linkCode', authenticateToken, async (req, res) => {
  const { linkCode } = req.params;
  try {
    const result = await pool.query(`
      SELECT r.id, r.name, COALESCE(r.avatar_url, '/logo.png') as avatar_url, r.is_group, r.group_allow_join_via_link,
             (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
      FROM rooms r 
      WHERE r.is_group = true AND r.group_link_code = $1
    `, [linkCode]);

    if (result.rows.length === 0) return res.status(404).json({ error: "Liên kết tham gia nhóm không tồn tại" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy thông tin liên kết: " + err.message });
  }
});

// Tham gia nhóm bằng mã liên kết
app.post('/api/rooms/join/:linkCode', authenticateToken, async (req, res) => {
  const { linkCode } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomRes = await client.query(`SELECT id, name, group_allow_join_via_link, group_approval_mode FROM rooms WHERE is_group = true AND group_link_code = $1`, [linkCode]);
    if (roomRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Liên kết tham gia nhóm không tồn tại" });
    }

    const room = roomRes.rows[0];
    if (!room.group_allow_join_via_link) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Nhóm đã tắt tính năng tham gia bằng đường dẫn công khai" });
    }

    const memberCheck = await client.query(`SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`, [room.id, req.user.id]);
    if (memberCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json({ message: "Bạn đã là thành viên của nhóm này", room_id: room.id });
    }

    await client.query(`INSERT INTO room_members (room_id, user_id, role, unread_count, joined_at) VALUES ($1, $2, 'member', 0, CURRENT_TIMESTAMP)`, [room.id, req.user.id]);
    
    const sysMsg = room.group_approval_mode 
      ? `${req.user.display_name} đã tham gia nhóm (Ban quản trị đã duyệt tự động thông qua Chế độ phê duyệt nhanh).`
      : `${req.user.display_name} đã tham gia nhóm bằng liên kết chia sẻ.`;

    await client.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
      room.id, req.user.id, sysMsg
    ]);

    await client.query('COMMIT');

    io.to(`room_${room.id}`).emit('room_members_updated', { room_id: room.id });
    io.emit('room_list_update');
    res.json({ message: "Tham gia nhóm thành công", room_id: room.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Lỗi tham gia nhóm: " + err.message });
  } finally {
    client.release();
  }
});

// Giải tán nhóm
app.delete('/api/rooms/:roomId', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    const checkAdmin = await pool.query(`SELECT creator_id FROM rooms WHERE id = $1`, [roomId]);
    if (checkAdmin.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy phòng" });
    if (checkAdmin.rows[0].creator_id !== req.user.id) return res.status(403).json({ error: "Chỉ Trưởng nhóm mới có quyền giải tán nhóm!" });

    await pool.query("DELETE FROM rooms WHERE id = $1", [roomId]);
    io.to(`room_${roomId}`).emit('group_dissolved', { room_id: roomId });
    io.emit('room_list_update');
    res.json({ message: "Giải tán nhóm thành công!" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi giải tán nhóm: " + err.message });
  }
});

// CHUYỂN QUYỀN TRƯỞNG NHÓM
app.put('/api/rooms/:roomId/transfer-owner', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { new_owner_id } = req.body;

  if (!new_owner_id) return res.status(400).json({ error: "Vui lòng chỉ định một thành viên nhận quyền Trưởng nhóm!" });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomCheck = await client.query(`SELECT is_group, creator_id, name FROM rooms WHERE id = $1`, [roomId]);
    if (roomCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Không tìm thấy phòng chat này" });
    }

    const room = roomCheck.rows[0];
    if (!room.is_group) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Cuộc hội thoại này không phải là nhóm chat" });
    }

    if (room.creator_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Chỉ có Trưởng nhóm mới có quyền chuyển giao chức vụ!" });
    }

    const memberCheck = await client.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, new_owner_id]);
    if (memberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Thành viên được chọn không tồn tại trong nhóm này" });
    }

    await client.query(`UPDATE rooms SET creator_id = $1 WHERE id = $2`, [new_owner_id, roomId]);
    await client.query(`UPDATE room_members SET role = 'admin' WHERE room_id = $1 AND user_id = $2`, [roomId, new_owner_id]);
    await client.query(`UPDATE room_members SET role = 'member' WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);

    const nameQuery = await client.query(`SELECT id, display_name FROM users WHERE id IN ($1, $2)`, [req.user.id, new_owner_id]);
    const oldOwnerName = nameQuery.rows.find(u => u.id === req.user.id)?.display_name || "Trưởng nhóm cũ";
    const newOwnerName = nameQuery.rows.find(u => u.id === parseInt(new_owner_id))?.display_name || "Trưởng nhóm mới";

    const sysMsgText = `👑 ${oldOwnerName} đã nhượng lại quyền Trưởng nhóm cho ${newOwnerName}.`;
    await client.query(`INSERT INTO messages (room_id, sender_id, message_text, is_system) VALUES ($1, $2, $3, true)`, [
      roomId, req.user.id, sysMsgText
    ]);

    await client.query('COMMIT');

    io.to(`room_${roomId}`).emit('room_members_updated', { room_id: roomId });
    io.to(`room_${roomId}`).emit('room_profile_updated', { room_id: roomId });
    io.emit('room_list_update');

    res.json({ message: "Chuyển giao quyền Trưởng nhóm thành công!", new_owner_id, new_owner_name: newOwnerName });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Lỗi hệ thống chuyển quyền trưởng nhóm: " + err.message });
  } finally {
    client.release();
  }
});

// =========================================================================
// 🤝 CÁC API PHÁT TRIỂN TÍNH NĂNG BẠN BÈ / KẾT BẠN
// =========================================================================

// Gửi lời mời kết bạn mới
app.post('/api/friends/request', authenticateToken, async (req, res) => {
  const { receiver_id } = req.body;
  if (!receiver_id) return res.status(400).json({ error: "Vui lòng truyền receiver_id" });
  if (parseInt(receiver_id) === req.user.id) return res.status(400).json({ error: "Không thể tự kết bạn với chính mình" });
  
  try {
    const check = await pool.query(`
      SELECT id, status, sender_id FROM friendships 
      WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
    `, [req.user.id, receiver_id]);
    
    if (check.rows.length > 0) {
      const rel = check.rows[0];
      if (rel.status === 'accepted') {
        return res.status(400).json({ error: "Hai bạn đã là bạn bè" });
      } else {
        if (rel.sender_id === req.user.id) {
          return res.status(400).json({ error: "Yêu cầu kết bạn đã được gửi trước đó" });
        } else {
          await pool.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [rel.id]);
          io.emit('contacts_update');
          return res.json({ message: "Hai bạn đã trở thành bạn bè" });
        }
      }
    }
    
    await pool.query(`INSERT INTO friendships (sender_id, receiver_id, status) VALUES ($1, $2, 'pending')`, [req.user.id, receiver_id]);
    io.emit('contacts_update');
    res.json({ message: "Đã gửi lời mời kết bạn thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi gửi kết bạn: " + err.message });
  }
});

// Đồng ý / Từ chối lời mời kết bạn
app.put('/api/friends/request/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'accepted' hoặc 'rejected'
  
  if (status !== 'accepted' && status !== 'rejected') {
    return res.status(400).json({ error: "Trạng thái không hợp lệ" });
  }
  
  try {
    const reqCheck = await pool.query(`SELECT sender_id, receiver_id FROM friendships WHERE id = $1`, [id]);
    if (reqCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy lời mời kết bạn" });
    
    const r = reqCheck.rows[0];
    if (r.receiver_id !== req.user.id) {
      return res.status(403).json({ error: "Bạn không có quyền xử lý lời mời này" });
    }
    
    if (status === 'accepted') {
      await pool.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [id]);
      
      const partnerId = r.sender_id;
      const checkRoom = await pool.query(`
        SELECT r.id FROM rooms r
        JOIN room_members rm1 ON r.id = rm1.room_id
        JOIN room_members rm2 ON r.id = rm2.room_id
        WHERE r.is_group = false AND rm1.user_id = $1 AND rm2.user_id = $2
      `, [req.user.id, partnerId]);
      
      if (checkRoom.rows.length === 0) {
        const partnerNameRes = await pool.query(`SELECT display_name FROM users WHERE id = $1`, [partnerId]);
        const partnerName = partnerNameRes.rows[0]?.display_name || "Bạn bè";
        const roomRes = await pool.query(`INSERT INTO rooms (name, is_group, avatar_url) VALUES ($1, false, '/logo.png') RETURNING id`, [partnerName]);
        const newRoomId = roomRes.rows[0].id;
        await pool.query(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`, [newRoomId, req.user.id, partnerId]);
      }
      
      res.json({ message: "Đã đồng ý kết bạn thành công" });
    } else {
      await pool.query(`DELETE FROM friendships WHERE id = $1`, [id]);
      res.json({ message: "Đã từ chối lời mời kết bạn" });
    }
    io.emit('contacts_update');
    io.emit('room_list_update');
  } catch (err) {
    res.status(500).json({ error: "Lỗi xử lý yêu cầu kết bạn: " + err.message });
  }
});

// Hủy lời mời kết bạn đã gửi (Chờ duyệt)
app.delete('/api/friends/request/:id/cancel', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query(`SELECT sender_id FROM friendships WHERE id = $1`, [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
    if (check.rows[0].sender_id !== req.user.id) return res.status(403).json({ error: "Bạn không có quyền hủy yêu cầu này" });
    
    await pool.query(`DELETE FROM friendships WHERE id = $1`, [id]);
    io.emit('contacts_update');
    res.json({ message: "Đã hủy yêu cầu kết bạn" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi hủy kết bạn: " + err.message });
  }
});

// Hủy kết bạn (Xóa bạn bè)
app.delete('/api/friends/:friendId', authenticateToken, async (req, res) => {
  const { friendId } = req.params;
  try {
    await pool.query(`
      DELETE FROM friendships 
      WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
    `, [req.user.id, friendId]);
    io.emit('contacts_update');
    res.json({ message: "Đã hủy kết bạn thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi hủy kết bạn: " + err.message });
  }
});

// Lấy danh sách bạn bè đã được chấp nhận
app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.created_at, u.id, u.username, u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url, u.is_online
      FROM friendships f
      JOIN users u ON (f.sender_id = u.id AND f.receiver_id = $1) OR (f.receiver_id = u.id AND f.sender_id = $1)
      WHERE f.status = 'accepted'
      ORDER BY u.display_name ASC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách bạn bè: " + err.message });
  }
});

// Lấy danh sách yêu cầu kết bạn (Đã nhận & Đã gửi)
app.get('/api/friends/requests', authenticateToken, async (req, res) => {
  try {
    const received = await pool.query(`
      SELECT f.id, f.created_at, u.id as sender_id, u.username as sender_username, u.display_name as sender_name, COALESCE(u.avatar_url, '/logo.png') as sender_avatar
      FROM friendships f
      JOIN users u ON f.sender_id = u.id
      WHERE f.receiver_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    
    const sent = await pool.query(`
      SELECT f.id, f.created_at, u.id as receiver_id, u.username as receiver_username, u.display_name as receiver_name, COALESCE(u.avatar_url, '/logo.png') as receiver_avatar
      FROM friendships f
      JOIN users u ON f.receiver_id = u.id
      WHERE f.sender_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    
    res.json({ received: received.rows, sent: sent.rows });
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách lời mời: " + err.message });
  }
});

// Tìm kiếm thành viên mới để Kết bạn
app.get('/api/friends/search-add', authenticateToken, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url,
             f.id as friendship_id, f.status as friendship_status, f.sender_id as friendship_sender_id
      FROM users u
      LEFT JOIN friendships f ON 
        (f.sender_id = $1 AND f.receiver_id = u.id) OR 
        (f.receiver_id = $1 AND f.sender_id = u.id)
      WHERE u.id != $1 AND (u.username ILIKE $2 OR u.display_name ILIKE $2)
      ORDER BY u.display_name ASC
      LIMIT 20
    `, [req.user.id, `%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi tìm kiếm thành viên: " + err.message });
  }
});

// API Cập nhật trạng thái tin nhắn (Tính năng Giai đoạn 1)
app.post('/api/messages/status', authenticateToken, async (req, res) => {
  const { messageId, status, roomId } = req.body;
  if (!messageId || !status || !roomId) return res.status(400).json({ error: "Thiếu thông tin cập nhật trạng thái" });
  try {
    await pool.query('UPDATE messages SET status = $1 WHERE id = $2', [status, messageId]);
    io.to(`room_${roomId}`).emit('message_status_updated', { messageId, status, roomId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Lỗi máy chủ cập nhật trạng thái tin nhắn: " + err.message });
  }
});

// API Đánh dấu Đã xem toàn bộ tin nhắn trong phòng một cách tối ưu (Tính năng Giai đoạn 1 nâng cao)
app.post('/api/rooms/:roomId/read', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    await pool.query(
      `UPDATE room_members SET unread_count = 0 WHERE room_id = $1 AND user_id = $2`,
      [roomId, req.user.id]
    );

    await pool.query(
      `UPDATE messages SET status = 'read' 
       WHERE room_id = $1 AND sender_id != $2 AND status != 'read'`,
      [roomId, req.user.id]
    );

    io.to(`room_${roomId}`).emit('room_messages_read', { room_id: roomId, reader_id: req.user.id });
    io.emit('room_list_update');
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Lỗi API bulk-read:", err.message);
    res.status(500).json({ error: "Lỗi máy chủ xử lý bulk-read" });
  }
});

// API Thả biểu cảm cảm xúc (Reactions Giai đoạn 2)
app.post('/api/messages/:id/reactions', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { emoji } = req.body; 
  try {
    const msgCheck = await pool.query(`SELECT room_id, is_recalled FROM messages WHERE id = $1`, [id]);
    if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    if (msgCheck.rows[0].is_recalled) return res.status(400).json({ error: "Không thể thả cảm xúc vào tin nhắn đã thu hồi" });
    
    const roomId = msgCheck.rows[0].room_id;

    if (!emoji) {
      await pool.query(`DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`, [id, req.user.id]);
    } else {
      await pool.query(`
        INSERT INTO message_reactions (message_id, user_id, emoji) 
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id) 
        DO UPDATE SET emoji = EXCLUDED.emoji
      `, [id, req.user.id, emoji]);
    }

    const reactionsRes = await pool.query(`
      SELECT mr.emoji, mr.user_id, u.display_name 
      FROM message_reactions mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.message_id = $1
    `, [id]);

    io.to(`room_${roomId}`).emit('message_reactions_updated', {
      message_id: id,
      room_id: roomId,
      reactions: reactionsRes.rows
    });

    res.json({ success: true, reactions: reactionsRes.rows });
  } catch (err) {
    console.error("Lỗi cập nhật reactions:", err.message);
    res.status(500).json({ error: "Lỗi máy chủ khi cập nhật reactions" });
  }
});

// 🚀 PHASE 3 API: Tìm kiếm tin nhắn trong phòng trò chuyện
app.get('/api/rooms/:roomId/search', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { q } = req.query;
  if (!q || q.trim() === '') return res.json([]);
  try {
    const result = await pool.query(`
      SELECT m.id, m.message_text, m.created_at, m.file_name, m.file_url, m.file_type,
             u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1 AND m.is_system = false AND m.is_recalled = false
        AND (m.message_text ILIKE $2 OR m.file_name ILIKE $2)
      ORDER BY m.created_at DESC
      LIMIT 30
    `, [roomId, `%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error("Lỗi tìm kiếm tin nhắn:", err.message);
    res.status(500).json({ error: "Lỗi tìm kiếm tin nhắn" });
  }
});

// =========================================================================
// 🛡️ KIỂM DUYỆT NỘI DUNG NHÓM (MODERATION MODE)
// =========================================================================

// Lấy danh sách tin nhắn chờ kiểm duyệt (chỉ admin/trưởng nhóm)
app.get('/api/rooms/:roomId/pending-messages', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  try {
    const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    if (roleCheck.rows.length === 0 || !['admin', 'co-leader'].includes(roleCheck.rows[0].role)) {
      return res.status(403).json({ error: "Chỉ Trưởng nhóm/Phó nhóm mới xem được tin nhắn chờ duyệt" });
    }

    const result = await pool.query(`
      SELECT m.id, m.room_id, m.sender_id, m.message_text, m.file_url, m.file_name, m.file_size, m.file_type, m.is_system, m.status, m.created_at,
             u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1 AND m.status = 'pending' AND m.is_recalled = false
      ORDER BY m.created_at ASC
    `, [roomId]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Lỗi lấy danh sách chờ kiểm duyệt:", err.message);
    res.status(500).json({ error: "Lỗi lấy danh sách chờ kiểm duyệt" });
  }
});

// Duyệt tin nhắn (approve)
app.post('/api/rooms/:roomId/moderate/:messageId/approve', authenticateToken, async (req, res) => {
  const { roomId, messageId } = req.params;
  try {
    const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    if (roleCheck.rows.length === 0 || !['admin', 'co-leader'].includes(roleCheck.rows[0].role)) {
      return res.status(403).json({ error: "Chỉ Trưởng nhóm/Phó nhóm mới có quyền duyệt tin" });
    }

    const msgCheck = await pool.query(`SELECT id, sender_id, status FROM messages WHERE id = $1 AND room_id = $2`, [messageId, roomId]);
    if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    if (msgCheck.rows[0].status !== 'pending') return res.status(400).json({ error: "Tin nhắn không ở trạng thái chờ duyệt" });

    await pool.query(
      `UPDATE messages SET status = 'approved', moderated_by = $1 WHERE id = $2`,
      [req.user.id, messageId]
    );

    // Gửi lại tin nhắn đã được duyệt tới mọi người trong phòng
    const enrichedMsg = await pool.query(`
      SELECT m.*, u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.id = $1
    `, [messageId]);

    io.to(`room_${roomId}`).emit('message_approved', enrichedMsg.rows[0]);
    io.to(`room_${roomId}`).emit('receive_message', enrichedMsg.rows[0]);
    io.emit('room_list_update');
    res.json({ message: "Đã duyệt tin nhắn", msg: enrichedMsg.rows[0] });
  } catch (err) {
    console.error("❌ Lỗi duyệt tin:", err.message);
    res.status(500).json({ error: "Lỗi duyệt tin nhắn" });
  }
});

// Từ chối tin nhắn (reject)
app.post('/api/rooms/:roomId/moderate/:messageId/reject', authenticateToken, async (req, res) => {
  const { roomId, messageId } = req.params;
  try {
    const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);
    if (roleCheck.rows.length === 0 || !['admin', 'co-leader'].includes(roleCheck.rows[0].role)) {
      return res.status(403).json({ error: "Chỉ Trưởng nhóm/Phó nhóm mới có quyền từ chối tin" });
    }

    const msgCheck = await pool.query(`SELECT id, status, sender_id FROM messages WHERE id = $1 AND room_id = $2`, [messageId, roomId]);
    if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    if (msgCheck.rows[0].status !== 'pending') return res.status(400).json({ error: "Tin nhắn không ở trạng thái chờ duyệt" });

    await pool.query(
      `UPDATE messages SET status = 'rejected', moderated_by = $1 WHERE id = $2`,
      [req.user.id, messageId]
    );

    // Thông báo cho người gửi biết tin nhắn bị từ chối
    io.to(`room_${roomId}`).emit('message_rejected', { message_id: messageId, room_id: roomId });
    res.json({ message: "Đã từ chối tin nhắn" });
  } catch (err) {
    console.error("❌ Lỗi từ chối tin:", err.message);
    res.status(500).json({ error: "Lỗi từ chối tin nhắn" });
  }
});

// ---------------- SOCKET.IO REALTIME EVENTS ----------------

// activeSockets: Map<userId, Set<socketId>> để hỗ trợ nhiều thiết bị/Tab cùng đăng nhập
const activeSockets = new Map();

io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('authenticate', async (token) => {
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) return;
      currentUserId = decoded.id;
      // Add socket id to set
      if (!activeSockets.has(currentUserId)) activeSockets.set(currentUserId, new Set());
      activeSockets.get(currentUserId).add(socket.id);
      
      // Mark user online (if not already)
      try {
        await pool.query(`UPDATE users SET is_online = true WHERE id = $1`, [currentUserId]);
        io.emit('user_status_change', { user_id: currentUserId, is_online: true });
      } catch (e) { console.warn("Failed to set user online:", e.message); }

      // PHASE 1: ĐỒNG BỘ TRẠNG THÁI "ĐÃ NHẬN" (delivered) KHI NGƯỜI DÙNG ONLINE
      await pool.query(`
        UPDATE messages 
        SET status = 'delivered' 
        WHERE room_id IN (SELECT room_id FROM room_members WHERE user_id = $1)
          AND sender_id != $1 
          AND status = 'sent'
      `, [currentUserId]);

      const rooms = await pool.query(`SELECT room_id FROM room_members WHERE user_id = $1`, [currentUserId]);
      rooms.rows.forEach(r => {
        socket.join(`room_${r.room_id}`);
        socket.to(`room_${r.room_id}`).emit('room_messages_delivered', { room_id: r.room_id });
      });
    });
  });

  socket.on('join_room', (roomId) => {
    socket.join(`room_${roomId}`);
  });

  socket.on('send_message', async (data) => {
    const { room_id, sender_id, message_text, self_destruct_seconds, reply_to_id } = data;
    try {
      const roomCheck = await pool.query(`SELECT is_group, group_allow_send_message, group_moderation_mode FROM rooms WHERE id = $1`, [room_id]);
      if (roomCheck.rows.length > 0 && roomCheck.rows[0].is_group) {
        const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [room_id, sender_id]);
        if (roleCheck.rows.length > 0 && !roomCheck.rows[0].group_allow_send_message && roleCheck.rows[0].role !== 'admin' && roleCheck.rows[0].role !== 'co-leader') {
          return; 
        }
      }

      const onlineMembers = await pool.query(`
        SELECT rm.user_id FROM room_members rm
        JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = $1 AND rm.user_id != $2 AND u.is_online = true
      `, [room_id, sender_id]);
      
      let initialStatus = onlineMembers.rows.length > 0 ? 'delivered' : 'sent';

      // Kiểm tra chế độ kiểm duyệt
      let isModerated = false;
      if (roomCheck.rows.length > 0 && roomCheck.rows[0].is_group && roomCheck.rows[0].group_moderation_mode) {
        const roleCheck = await pool.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [room_id, sender_id]);
        if (roleCheck.rows.length > 0 && roleCheck.rows[0].role === 'member') {
          initialStatus = 'pending';
          isModerated = true;
        }
      }

      let self_destruct_at = null;
      if (self_destruct_seconds && self_destruct_seconds > 0) {
        self_destruct_at = new Date(Date.now() + self_destruct_seconds * 1000);
      }

      const fileType = data.file_type || '';
      const fileUrl = data.file_url || '';
      const fileName = data.file_name || '';
      const fileSize = data.file_size || '';

      const msgResult = await pool.query(
        `INSERT INTO messages (room_id, sender_id, message_text, file_url, file_name, file_size, file_type, self_destruct_at, status, reply_to_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [room_id, sender_id, message_text, fileUrl, fileName, fileSize, fileType, self_destruct_at, initialStatus, reply_to_id || null]
      );
      const message = msgResult.rows[0];

      await pool.query(
        `UPDATE room_members SET unread_count = unread_count + 1 WHERE room_id = $1 AND user_id != $2`,
        [room_id, sender_id]
      );

      const userResult = await pool.query(`SELECT display_name, COALESCE(avatar_url, '/logo.png') as avatar_url FROM users WHERE id = $1`, [sender_id]);
      
      let parent_sender_name = null;
      let parent_text = null;
      let parent_is_recalled = false;
      if (reply_to_id) {
        const parentRes = await pool.query(`
          SELECT pm.message_text, pm.is_recalled, pu.display_name 
          FROM messages pm
          LEFT JOIN users pu ON pm.sender_id = pu.id
          WHERE pm.id = $1
        `, [reply_to_id]);
        if (parentRes.rows.length > 0) {
          parent_sender_name = parentRes.rows[0].display_name;
          parent_text = parentRes.rows[0].message_text;
          parent_is_recalled = parentRes.rows[0].is_recalled;
        }
      }

      const enrichedMsg = { 
        ...message, 
        display_name: userResult.rows[0].display_name, 
        avatar_url: userResult.rows[0].avatar_url,
        parent_sender_name,
        parent_text,
        parent_is_recalled
      };

      if (isModerated) {
        // Nếu bị kiểm duyệt, chỉ gửi cho admin (và người gửi)
        const adminMembers = await pool.query(`SELECT user_id FROM room_members WHERE room_id = $1 AND role IN ('admin', 'co-leader')`, [room_id]);
        const adminIds = adminMembers.rows.map(a => a.user_id);
        // Gửi cho các admin trong phòng
        for (const socketInfo of activeSockets) {
          const uid = socketInfo[0];
          if (adminIds.includes(uid)) {
            const sockets = socketInfo[1];
            for (const sid of sockets) {
              io.to(sid).emit('receive_message', { ...enrichedMsg, _moderation_pending: true });
            }
          }
        }
        // Gửi cho người gửi (với trạng thái pending)
        const senderSockets = activeSockets.get(sender_id);
        if (senderSockets) {
          for (const sid of senderSockets) {
            io.to(sid).emit('receive_message', { ...enrichedMsg, _my_pending: true });
          }
        }
        io.to(`room_${room_id}`).emit('moderation_queue_updated', { room_id });
      } else {
        io.to(`room_${room_id}`).emit('receive_message', enrichedMsg);
      }

      io.emit('room_list_update');
    } catch (err) {
      console.error("❌ Lỗi gửi tin nhắn Socket:", err.message);
    }
  });

  socket.on('typing', (data) => {
    socket.to(`room_${data.room_id}`).emit('typing', data);
  });

  socket.on('call_request', (data) => {
    socket.to(`room_${data.room_id}`).emit('call_incoming', data);
  });

  socket.on('call_accept', (data) => {
    socket.to(`room_${data.room_id}`).emit('call_accepted', data);
  });

  socket.on('call_reject', (data) => {
    socket.to(`room_${data.room_id}`).emit('call_rejected', data);
  });

  socket.on('webrtc_signal', (data) => {
    socket.to(`room_${data.room_id}`).emit('webrtc_signal', data);
  });

  socket.on('call_hangup', (data) => {
    socket.to(`room_${data.room_id}`).emit('call_hangup', data);
  });

  socket.on('disconnect', async () => {
    if (currentUserId) {
      // Remove socket id from user's set
      const s = activeSockets.get(currentUserId);
      if (s) {
        s.delete(socket.id);
        if (s.size === 0) {
          activeSockets.delete(currentUserId);
          try {
            await pool.query(`UPDATE users SET is_online = false WHERE id = $1`, [currentUserId]);
            io.emit('user_status_change', { user_id: currentUserId, is_online: false });
          } catch (e) { console.warn("Failed to set user offline:", e.message); }
        }
      }
    }
  });
});

setInterval(async () => {
  try {
    const expiredMsgs = await pool.query(
      `DELETE FROM messages WHERE self_destruct_at IS NOT NULL AND self_destruct_at <= CURRENT_TIMESTAMP RETURNING id, room_id`
    );
    if (expiredMsgs.rows.length > 0) {
      expiredMsgs.rows.forEach(msg => {
        io.to(`room_${msg.room_id}`).emit('message_deleted', { message_id: msg.id, room_id: msg.room_id });
      });
    }
  } catch (err) {
    console.error("❌ Lỗi dọn dẹp tin nhắn:", err.message);
  }
}, 10000);

// Ngăn chặn crash server hoàn toàn khi có Exception chưa bắt
process.on('uncaughtException', (err) => {
  console.error('CRITICAL ERROR (Uncaught Exception):', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

server.listen(PORT, () => {
  console.log(`🚀 Máy chủ AloNha đang hoạt động cực kỳ ổn định tại port: ${PORT}`);
});