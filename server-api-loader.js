// ==========================================================
// 🔌 AloNha API Loader - Tải tất cả API route từ server.js
// ==========================================================
// File này chuyển đổi các API từ PostgreSQL syntax sang SQLite-compatible
// và đăng ký chúng vào Express app
// ==========================================================

module.exports = function(app, io, db, context) {
  const { JWT_SECRET, authenticateToken, requireSuperAdmin, getLocalFileUrl, getOrCreateUserDriveFolder } = context;
  const bcrypt = require('bcryptjs');
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');
  const jwt = require('jsonwebtoken');

  // Cấu hình multer upload
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === 'avatar' ? context.AVATARS_DIR : context.UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + file.originalname);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } });

  // activeSockets map
  const activeSockets = new Map();

  // ======================================================
  // 🚀 AUTH API
  // ======================================================

  app.post('/api/auth/register', async (req, res) => {
    const { username, password, display_name } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await db.run(
        `INSERT INTO users (username, password_hash, display_name, avatar_url, role) VALUES ($1, $2, $3, '/logo.png', 'user')`,
        [username.trim().toLowerCase(), hash, display_name.trim()]
      );
      const user = await db.get(`SELECT id, username, display_name, role, is_active FROM users WHERE id = $1`, [result.lastID]);
      res.status(201).json({ message: "Đăng ký thành công", user });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) return res.status(400).json({ error: "Tên đăng nhập đã tồn tại" });
      res.status(500).json({ error: "Lỗi máy chủ khi đăng ký" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const user = await db.get(`SELECT * FROM users WHERE username = $1`, [username.trim().toLowerCase()]);
      if (!user) return res.status(400).json({ error: "Tài khoản không tồn tại" });
      
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) return res.status(400).json({ error: "Mật khẩu không chính xác" });

      const isActive = user.is_active === true || user.is_active === 1;
      if (!isActive) return res.status(403).json({ error: "Tài khoản đã bị vô hiệu hóa" });

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({
        token,
        user: {
          id: user.id, username: user.username, display_name: user.display_name,
          avatar_url: user.avatar_url || '/logo.png', pin_code: user.pin_code,
          pin_timeout: user.pin_timeout, role: user.role, is_active: isActive
        }
      });
    } catch (err) {
      res.status(500).json({ error: "Lỗi máy chủ xử lý đăng nhập" });
    }
  });

  // ======================================================
  // 👤 USER API
  // ======================================================

  app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
      const user = await db.get(
        `SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, phone_number, gender, dob, pin_code, pin_timeout, role, is_active FROM users WHERE id = $1`,
        [req.user.id]
      );
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: "Lỗi lấy thông tin hồ sơ" });
    }
  });

  app.put('/api/users/me', authenticateToken, async (req, res) => {
    const { display_name, phone_number, gender, dob, pin_code, pin_timeout } = req.body;
    try {
      const user = await db.get(
        `UPDATE users SET display_name = $1, phone_number = $2, gender = $3, dob = $4, pin_code = $5, pin_timeout = $6 WHERE id = $7 RETURNING id, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, phone_number, gender, dob, pin_code, pin_timeout`,
        [display_name, phone_number, gender, dob || null, pin_code || null, pin_timeout || 1, req.user.id]
      );
      // SQLite: không có RETURNING, phải SELECT lại
      if (db.type === 'sqlite') {
        const updated = await db.get(`SELECT id, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, phone_number, gender, dob, pin_code, pin_timeout FROM users WHERE id = $1`, [req.user.id]);
        return res.json({ message: "Cập nhật hồ sơ thành công", user: updated });
      }
      res.json({ message: "Cập nhật hồ sơ thành công", user });
    } catch (err) {
      res.status(500).json({ error: "Lỗi cập nhật hồ sơ" });
    }
  });

  app.post('/api/users/me/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Vui lòng chọn ảnh đại diện" });
    const relativePath = `/uploads/avatars/${req.file.filename}`;
    await db.run(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [relativePath, req.user.id]);
    res.json({ message: "Tải lên ảnh đại diện thành công", avatar_url: relativePath });
  });

  app.get('/api/users', authenticateToken, async (req, res) => {
    try {
      const users = await db.query(
        `SELECT id, username, display_name, COALESCE(avatar_url, '/logo.png') as avatar_url, is_online, role, is_active FROM users WHERE id != $1 ORDER BY display_name ASC`,
        [req.user.id]
      );
      // SQLite: is_online là 0/1, chuyển thành boolean
      res.json(users.map(u => ({
        ...u, is_online: u.is_online === true || u.is_online === 1
      })));
    } catch (err) {
      res.status(500).json({ error: "Lỗi lấy danh sách thành viên" });
    }
  });

  // ======================================================
  // 🏠 ROOMS API
  // ======================================================

  app.get('/api/rooms', authenticateToken, async (req, res) => {
    try {
      let rooms;
      if (db.type === 'sqlite') {
        rooms = await db.query(`
          SELECT r.id, r.is_group, rm.unread_count, rm.is_pinned, rm.is_muted,
            CASE 
              WHEN r.is_group = 0 AND r.name != 'Cloud của tôi' THEN 
                COALESCE(
                  (SELECT u.display_name FROM users u 
                   JOIN room_members rm2 ON u.id = rm2.user_id 
                   WHERE rm2.room_id = r.id AND rm2.user_id != $1 LIMIT 1),
                  r.name
                )
              ELSE r.name 
            END as name,
            CASE 
              WHEN r.is_group = 0 AND r.name != 'Cloud của tôi' THEN 
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
          WHERE rm.user_id = $1 AND (r.is_archived = 0 OR r.is_archived IS NULL)
          ORDER BY rm.is_pinned DESC, last_message_time DESC NULLS LAST, r.id DESC
        `, [req.user.id]);
      } else {
        rooms = await db.query(`
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
          WHERE rm.user_id = $1 AND (r.is_archived = false OR r.is_archived IS NULL)
          ORDER BY rm.is_pinned DESC, last_message_time DESC NULLS LAST, r.id DESC
        `, [req.user.id]);
      }
      // Chuyển đổi boolean
      rooms = rooms.map(r => ({
        ...r,
        is_group: r.is_group === true || r.is_group === 1,
        is_pinned: r.is_pinned === true || r.is_pinned === 1,
        is_muted: r.is_muted === true || r.is_muted === 1
      }));
      res.json(rooms);
    } catch (err) {
      console.error("Lỗi lấy danh sách phòng:", err);
      res.status(500).json({ error: "Lỗi lấy danh sách phòng" });
    }
  });

  // ======================================================
  // 📝 MESSAGES API
  // ======================================================

  app.get('/api/rooms/:roomId/messages', authenticateToken, async (req, res) => {
    const { roomId } = req.params;
    try {
      await db.run(`UPDATE room_members SET unread_count = 0 WHERE room_id = $1 AND user_id = $2`, [roomId, req.user.id]);

      const messages = await db.query(`
        SELECT m.id, m.room_id, m.sender_id, m.message_text, m.file_url, m.file_name, m.file_size, m.file_type,
               m.is_system, m.status, m.is_recalled, m.reply_to_id, m.created_at,
               u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url,
               parent_m.message_text as parent_text, parent_m.file_name as parent_file_name,
               parent_m.is_recalled as parent_is_recalled, parent_u.display_name as parent_sender_name,
               COALESCE(
                 (SELECT json_group_array(json_object('emoji', mr.emoji, 'user_id', mr.user_id, 'display_name', ru.display_name))
                  FROM message_reactions mr JOIN users ru ON mr.user_id = ru.id WHERE mr.message_id = m.id),
                 '[]'
               ) as reactions
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        LEFT JOIN messages parent_m ON m.reply_to_id = parent_m.id
        LEFT JOIN users parent_u ON parent_m.sender_id = parent_u.id
        WHERE m.room_id = $1
        ORDER BY m.created_at ASC
      `, [roomId]);

      // Parse reactions JSON cho SQLite
      const parsed = messages.map(msg => {
        let reactions = [];
        if (typeof msg.reactions === 'string') {
          try { reactions = JSON.parse(msg.reactions); } catch(e) {}
        }
        return { ...msg, reactions, is_recalled: msg.is_recalled === 1 || msg.is_recalled === true };
      });

      res.json(parsed);
    } catch (err) {
      console.error("Lỗi lấy lịch sử chat:", err);
      res.status(500).json({ error: "Lỗi lấy lịch sử chat" });
    }
  });

  // ======================================================
  // 👥 FRIENDS API
  // ======================================================

  app.get('/api/friends', authenticateToken, async (req, res) => {
    try {
      const friends = await db.query(`
        SELECT f.created_at, u.id, u.username, u.display_name, COALESCE(u.avatar_url, '/logo.png') as avatar_url, u.is_online
        FROM friendships f
        JOIN users u ON (f.sender_id = u.id AND f.receiver_id = $1) OR (f.receiver_id = u.id AND f.sender_id = $1)
        WHERE f.status = 'accepted'
        ORDER BY u.display_name ASC
      `, [req.user.id]);
      res.json(friends.map(f => ({ ...f, is_online: f.is_online === 1 || f.is_online === true })));
    } catch (err) {
      res.status(500).json({ error: "Lỗi lấy danh sách bạn bè" });
    }
  });

  // ======================================================
  // 🔌 SOCKET.IO
  // ======================================================

  io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('authenticate', async (token) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        currentUserId = decoded.id;
        
        if (!activeSockets.has(currentUserId)) activeSockets.set(currentUserId, new Set());
        activeSockets.get(currentUserId).add(socket.id);

        await db.run(`UPDATE users SET is_online = 1 WHERE id = $1`, [currentUserId]);
        
        // Join all rooms
        const rooms = await db.query(`SELECT room_id FROM room_members WHERE user_id = $1`, [currentUserId]);
        rooms.forEach(r => {
          socket.join(`room_${r.room_id}`);
        });

        io.emit('user_status_change', { user_id: currentUserId, is_online: true });
      } catch (err) {
        console.warn("Auth error:", err.message);
      }
    });

    socket.on('join_room', (roomId) => {
      socket.join(`room_${roomId}`);
    });

    socket.on('send_message', async (data) => {
      const { room_id, sender_id, message_text, reply_to_id } = data;
      try {
        const message = await db.get(`SELECT id FROM messages WHERE id = $1`, [0]); // dummy
        const result = await db.run(
          `INSERT INTO messages (room_id, sender_id, message_text, status, reply_to_id)
           VALUES ($1, $2, $3, 'sent', $4)`,
          [room_id, sender_id, message_text, reply_to_id || null]
        );

        await db.run(
          `UPDATE room_members SET unread_count = unread_count + 1 WHERE room_id = $1 AND user_id != $2`,
          [room_id, sender_id]
        );

        const user = await db.get(`SELECT display_name, COALESCE(avatar_url, '/logo.png') as avatar_url FROM users WHERE id = $1`, [sender_id]);

        // Lấy tin nhắn vừa tạo
        const newMsg = await db.get(`SELECT * FROM messages WHERE id = $1`, [result.lastID]);

        const enrichedMsg = {
          ...newMsg,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          reactions: []
        };

        io.to(`room_${room_id}`).emit('receive_message', enrichedMsg);
        io.emit('room_list_update');
      } catch (err) {
        console.error("Lỗi gửi tin nhắn:", err);
      }
    });

    socket.on('typing', (data) => {
      socket.to(`room_${data.room_id}`).emit('typing', data);
    });

    socket.on('disconnect', async () => {
      if (currentUserId) {
        const sockets = activeSockets.get(currentUserId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            activeSockets.delete(currentUserId);
            await db.run(`UPDATE users SET is_online = 0 WHERE id = $1`, [currentUserId]);
            io.emit('user_status_change', { user_id: currentUserId, is_online: false });
          }
        }
      }
    });
  });

  console.log('✅ API routes đã được tải thành công!');
};
