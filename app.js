// AloNha Chat Client Application Logic - Golden Standard v1.3.0
// TÆ°Æ¡ng thÃ­ch 100% vá»›i Giao diá»‡n Zalo vÃ  API NhÃ³m nÃ¢ng cao, VÃ¡ lá»—i WebRTC, Mobile layout vÃ  tÃ­nh nÄƒng káº¿t báº¡n Zalo style

let socket = null;
let currentUser = null;
let activeRoomId = null;
let roomsList = [];
let usersList = [];
let unlockedRooms = new Set(); 
let roomsRefreshInFlight = false;
let roomsRefreshPromise = null;
let roomsRefreshTimer = null;

// --- Helper: Parse file_url Ä‘á»ƒ Æ°u tiÃªn local path ---
// file_url cÃ³ thá»ƒ lÃ  "local_path||drive_url" hoáº·c chá»‰ "local_path"
function getLocalFileUrl(fileUrl) {
  if (!fileUrl) return '';
  // Náº¿u cÃ³ dáº¡ng local_path||drive_url, Æ°u tiÃªn dÃ¹ng drive_url
  if (fileUrl.includes('||')) {
    const parts = fileUrl.split('||');
    let driveUrl = parts[1];
    // TrÃ­ch xuáº¥t FILE_ID tá»« drive URL
    // drive.google.com/file/d/FILE_ID/view hoáº·c /uc?id=FILE_ID
    const matchFileId = driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) || driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFileId) {
      const fileId = matchFileId[1];
      // DÃ¹ng thumbnail API cá»§a Google - hiá»ƒn thá»‹ áº£nh khÃ´ng cáº§n xÃ¡c thá»±c
      return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w800";
    }
    return driveUrl;
  }
  // Náº¿u lÃ  file local, kiá»ƒm tra xem file cÃ³ tá»“n táº¡i khÃ´ng, náº¿u khÃ´ng thÃ¬ tráº£ vá» logo
  if (fileUrl.startsWith('/uploads/')) {
    // File local cÃ³ thá»ƒ Ä‘Ã£ bá»‹ xÃ³a, tráº£ vá» nguyÃªn Ä‘á»ƒ server handle 404
    return fileUrl;
  }
  return fileUrl;
}
// --- GIAI ÄOáº N 3: TRáº NG THÃI TRÃCH DáºªN & TÃŒM KIáº¾M TOÃ€N Cá»¤C ---
let replyingToMessageId = null;

// --- PHASE 1, PHASE 2 & PHASE 3: CACHE, STATUS ICONS & REACTIONS ---
const AloNhaCache = {
    save: (roomId, messages) => {
        try {
            localStorage.setItem(`alonha_cache_${roomId}`, JSON.stringify(messages.slice(-50)));
        } catch (e) {
            console.warn("Lá»—i lÆ°u cache tin nháº¯n:", e);
        }
    },
    get: (roomId) => {
        try {
            const cached = localStorage.getItem(`alonha_cache_${roomId}`);
            return cached ? JSON.parse(cached) : [];
        } catch (e) {
            return [];
        }
    }
};

function renderStatusIcon(status) {
    if (status === 'read') return '<i class="fa-solid fa-check-double text-blue-500 status-icon" title="ÄÃ£ xem"></i>';
    if (status === 'delivered') return '<i class="fa-solid fa-check-double text-slate-300 status-icon" title="ÄÃ£ nháº­n"></i>';
    return '<i class="fa-solid fa-check text-slate-300 status-icon" title="ÄÃ£ gá»­i"></i>';
}

function renderReactionsBadge(messageId, reactions) {
  if (!reactions || reactions.length === 0) return "";
  
  const counts = {};
  reactions.forEach(r => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  });
  
  const tooltipText = reactions.map(r => `${r.display_name}: ${r.emoji}`).join('\n');
  let html = `<div class="inline-flex items-center gap-1 bg-white border border-slate-150 rounded-full px-2 py-0.5 shadow-sm text-xs cursor-pointer select-none hover:bg-slate-50" title="${tooltipText}" onclick="event.stopPropagation(); showWhoReactedModal(${messageId});">`;
  
  Object.keys(counts).forEach(emoji => {
    html += `<span>${emoji}</span>`;
  });
  
  if (reactions.length > 1) {
    html += `<span class="text-[9px] text-slate-500 font-bold ml-0.5">${reactions.length}</span>`;
  }
  
  html += `</div>`;
  return html;
}

function submitReaction(messageId, emoji) {
  fetch(`/api/messages/${messageId}/reactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem("alonha_token")}`
    },
    body: JSON.stringify({ emoji })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) alert(data.error);
  })
  .catch(err => console.warn(err));
}

function showWhoReactedModal(messageId) {
  console.log("Xem chi tiáº¿t tháº£ cáº£m xÃºc cho tin nháº¯n:", messageId);
}

function updateMessageStatusOnServer(messageId, status, roomId) {
  fetch('/api/messages/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem("alonha_token")}`
    },
    body: JSON.stringify({ messageId, status, roomId })
  }).catch(err => console.warn(err));
}

// ðŸš€ GIAI ÄOáº N 3: HIá»‚N THá»Š BANNER ÄANG TRáº¢ Lá»œI TIN NHáº®N
function showReplyPreview(messageId, text, senderName) {
  let preview = document.getElementById("reply-preview-banner");
  if (!preview) {
    const form = document.getElementById("chat-input-form");
    preview = document.createElement("div");
    preview.id = "reply-preview-banner";
    preview.className = "flex items-center justify-between bg-slate-50 border-l-4 border-blue-500 px-4 py-2.5 text-xs text-slate-700 select-none rounded-t-xl w-full mb-1 shadow-sm border border-slate-100";
    preview.innerHTML = `
      <div class="min-w-0 flex-1">
        <p class="font-bold text-blue-500 flex items-center gap-1"><i class="fa-solid fa-reply"></i> Äang tráº£ lá»i ${senderName}</p>
        <p class="truncate text-slate-400 italic mt-0.5" id="reply-preview-text"></p>
      </div>
      <button type="button" id="btn-cancel-reply" class="text-slate-400 hover:text-slate-600 focus:outline-none ml-2 p-1">
        <i class="fa-solid fa-xmark text-sm"></i>
      </button>
    `;
    if (form) form.insertBefore(preview, form.firstChild);
    
    const cancelBtn = document.getElementById("btn-cancel-reply");
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        clearReplyState();
      };
    }
  }
  const previewText = document.getElementById("reply-preview-text");
  if (previewText) previewText.textContent = text || "[TÃ i liá»‡u / HÃ¬nh áº£nh]";
  preview.classList.remove("hidden");
  const inputField = document.getElementById("chat-input-field");
  if (inputField) inputField.focus();
}

function clearReplyState() {
  replyingToMessageId = null;
  const preview = document.getElementById("reply-preview-banner");
  if (preview) preview.classList.add("hidden");
}

// ðŸš€ GIAI ÄOáº N 3: CUá»˜N Äáº¾N TIN NHáº®N ÄÆ¯á»¢C CHá»ˆ Äá»ŠNH VÃ€ NHáº¤P NHÃY
window.scrollToTargetMessage = function(targetId) {
  const el = document.getElementById(`msg-${targetId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add("bg-yellow-100/70", "p-2.5", "rounded-2xl", "transition-all", "duration-500", "scale-105");
    setTimeout(() => {
      el.classList.remove("bg-yellow-100/70", "scale-105");
    }, 2000);
  } else {
    alert("Tin nháº¯n gá»‘c Ä‘Ã£ quÃ¡ cÅ© hoáº·c khÃ´ng Ä‘Æ°á»£c hiá»ƒn thá»‹ trong phiÃªn trÃ² chuyá»‡n hiá»‡n táº¡i.");
  }
};

// ðŸš€ GIAI ÄOáº N 3: Bá»˜ TÃŒM KIáº¾M TIN NHáº®N TRONG PHÃ’NG TRÃ’ CHUYá»†N DYNAMIC OVERLAY
function toggleInRoomSearchOverlay() {
  let overlay = document.getElementById("in-room-search-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "in-room-search-modal";
    overlay.className = "fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 hidden";
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]">
        <div class="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <h3 class="text-sm font-bold text-slate-800 flex items-center gap-1.5"><i class="fa-solid fa-magnifying-glass text-blue-500"></i> TÃ¬m kiáº¿m tin nháº¯n</h3>
          <button type="button" id="btn-close-msg-search" class="text-slate-400 hover:text-slate-600 focus:outline-none p-1"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-4 border-b border-slate-100">
          <div class="relative">
            <input type="text" id="input-msg-search-query" class="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:ring-blue-500 focus:border-blue-500 focus:outline-none" placeholder="Nháº­p tá»« khÃ³a tin nháº¯n cáº§n tÃ¬m...">
            <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          </div>
        </div>
        <div id="msg-search-results" class="flex-1 overflow-y-auto p-3 space-y-2 max-h-[50vh]">
          <p class="text-xs text-slate-400 text-center py-8 select-none">Nháº­p tá»« khÃ³a phÃ­a trÃªn Ä‘á»ƒ báº¯t Ä‘áº§u tÃ¬m kiáº¿m.</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const closeBtn = document.getElementById("btn-close-msg-search");
    if (closeBtn) {
      closeBtn.onclick = () => {
        overlay.classList.add("hidden");
      };
    }
    
    const queryInput = document.getElementById("input-msg-search-query");
    if (queryInput) {
      queryInput.addEventListener("input", (e) => {
        const query = e.target.value.trim();
        performInRoomSearch(query);
      });
    }
  }
  
  overlay.classList.remove("hidden");
  const queryInput = document.getElementById("input-msg-search-query");
  if (queryInput) queryInput.value = "";
  const resultsContainer = document.getElementById("msg-search-results");
  if (resultsContainer) resultsContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-8 select-none">Nháº­p tá»« khÃ³a phÃ­a trÃªn Ä‘á»ƒ báº¯t Ä‘áº§u tÃ¬m kiáº¿m.</p>`;
  if (queryInput) queryInput.focus();
}

function performInRoomSearch(q) {
  const resultsContainer = document.getElementById("msg-search-results");
  if (!resultsContainer) return;
  if (!q || q.length < 2) {
    resultsContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-8 select-none">Vui lÃ²ng nháº­p tá»‘i thiá»ƒu 2 kÃ½ tá»±...</p>`;
    return;
  }
  
  fetch(`/api/rooms/${activeRoomId}/search?q=${encodeURIComponent(q)}`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(data => {
    resultsContainer.innerHTML = "";
    if (!data || data.length === 0) {
      resultsContainer.innerHTML = `<div class="text-center py-8 select-none text-slate-400"><i class="fa-solid fa-box-open text-xl mb-1.5 block text-slate-300"></i><p class="text-xs">KhÃ´ng tÃ¬m tháº¥y káº¿t quáº£ nÃ o trÃ¹ng khá»›p.</p></div>`;
      return;
    }
    
    data.forEach(msg => {
      const div = document.createElement("div");
      div.className = "flex gap-2.5 p-2.5 hover:bg-slate-50 border border-slate-100 rounded-xl cursor-pointer transition-colors";
      const text = msg.message_text || `[TÃ i liá»‡u] ${msg.file_name || ''}`;
      const date = new Date(msg.created_at);
      const formattedDate = `${date.getDate()}/${date.getMonth() + 1} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      
      div.innerHTML = `
        <img src="${msg.avatar_url || '/logo.png'}" class="w-8 h-8 rounded-full object-cover border border-slate-100 shrink-0 select-none">
        <div class="min-w-0 flex-1">
          <div class="flex justify-between items-baseline">
            <p class="text-xs font-bold text-slate-700 truncate select-none">${msg.display_name}</p>
            <span class="text-[9px] text-slate-400 font-semibold shrink-0 select-none">${formattedDate}</span>
          </div>
          <p class="text-xs text-slate-500 truncate mt-0.5">${text}</p>
        </div>
      `;
      
      div.onclick = () => {
        const overlay = document.getElementById("in-room-search-modal");
        if (overlay) overlay.classList.add("hidden");
        scrollToTargetMessage(msg.id);
      };
      
      resultsContainer.appendChild(div);
    });
  })
  .catch(err => {
    console.warn("Lá»—i tÃ¬m kiáº¿m:", err);
    resultsContainer.innerHTML = `<p class="text-xs text-red-500 text-center py-8 select-none">CÃ³ lá»—i xáº£y ra khi káº¿t ná»‘i mÃ¡y chá»§</p>`;
  });
}

let activeRoomSettings = null;
let activeRoomSelfSettings = null;
let activeRoomMembers = [];

// Tráº¡ng thÃ¡i danh báº¡
let currentActiveView = 'chat'; // 'chat' hoáº·c 'contacts'
let currentContactsTab = 'friends'; // 'friends', 'groups', 'requests', 'invites'
let allFriendsCached = [];

// Tráº¡ng thÃ¡i cuá»™c gá»i WebRTC
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCaller = false;
let isCallConnecting = false; // Cá» chá»‘ng Race Condition khi khá»Ÿi cháº¡y cuá»™c gá»i
let isMicMuted = false;
let isCamOff = false;

const iceServers = { 
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ] 
};

let currentPinInput = "";
let tempRoomToUnlock = null;
let inactivityTimer = null;

let currentPins = [];
let currentPinIndex = 0;

const accordionStates = {
  members: true,
  notes: false,
  media: true,
  files: true
};

document.addEventListener("DOMContentLoaded", () => {
  // LuÃ´n hiá»ƒn thá»‹ mÃ n hÃ¬nh Ä‘Äƒng nháº­p khi khá»Ÿi cháº¡y
  showAuthScreen();
  initUIEventListeners();
  setupInactivityTimer();
  parseJoinLinkQuery(); 
});

// 1. AUTH CHECK
function checkLocalAuth() {
  const token = localStorage.getItem("alonha_token");
  if (token) {
    fetch('/api/users/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then(user => {
      currentUser = user;
      const authContainer = document.getElementById("auth-container");
      if (authContainer) authContainer.classList.add("hidden");
      const mainApp = document.getElementById("main-app");
      if (mainApp) mainApp.classList.remove("hidden");
      
      updateMyProfileUI();
      connectSocket(token);
      
      loadAllUsers().then(() => {
        loadRooms(true).then(() => {
          updateContactsBadges();
          const savedRoomId = localStorage.getItem("alonha_active_room_id");
          if (savedRoomId && roomsList.some(r => r.id == savedRoomId)) {
            handleRoomSelection(savedRoomId);
          }
        });
      });
    })
    .catch(() => {
      localStorage.removeItem("alonha_token");
      showAuthScreen();
    });
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  const authContainer = document.getElementById("auth-container");
  if (authContainer) authContainer.classList.remove("hidden");
  const mainApp = document.getElementById("main-app");
  if (mainApp) mainApp.classList.add("hidden");
}

function isSuperAdmin() {
  const username = (currentUser?.username || '').toLowerCase();
  return !!(currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin' || username === 'superadmin' || username === 'super_admin'));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAdminOverview(data) {
  const container = document.getElementById('admin-overview');
  if (!container) return;
  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-4">
      <p class="text-xs uppercase tracking-wide text-slate-400">Tá»•ng ngÆ°á»i dÃ¹ng</p>
      <p class="text-2xl font-bold text-slate-800 mt-1">${data.total_users || 0}</p>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200 p-4">
      <p class="text-xs uppercase tracking-wide text-slate-400">Tá»•ng phÃ²ng / nhÃ³m</p>
      <p class="text-2xl font-bold text-slate-800 mt-1">${data.total_rooms || 0}</p>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200 p-4">
      <p class="text-xs uppercase tracking-wide text-slate-400">Tráº¡ng thÃ¡i há»‡ thá»‘ng</p>
      <p class="text-lg font-semibold ${data.settings?.maintenance_mode ? 'text-amber-600' : 'text-emerald-600'} mt-1">${data.settings?.maintenance_mode ? 'Báº£o trÃ¬' : 'Hoáº¡t Ä‘á»™ng'}</p>
    </div>
  `;
}

function renderAdminUsers(users) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.innerHTML = '';
  users.forEach(user => {
    const card = document.createElement('div');
    card.className = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3';
    card.innerHTML = `
      <div>
        <p class="font-semibold text-slate-800">${user.display_name || user.username}</p>
        <p class="text-xs text-slate-500">${user.username} â€¢ ${user.role}</p>
      </div>
      <div class="flex items-center gap-2">
        <select class="text-xs border border-slate-200 rounded-lg px-2 py-1" data-user-id="${user.id}" data-action="role">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
        </select>
        <button class="text-xs px-2 py-1 rounded-lg ${user.is_active ? 'bg-emerald-500 text-white' : 'bg-slate-400 text-white'}" data-user-id="${user.id}" data-action="status">${user.is_active ? 'Active' : 'Inactive'}</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderAdminRooms(rooms) {
  const container = document.getElementById('admin-rooms-list');
  if (!container) return;
  container.innerHTML = '';
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3';
    card.innerHTML = `
      <div>
        <p class="font-semibold text-slate-800">${escapeHtml(room.name)}</p>
        <p class="text-xs text-slate-500">${room.is_group ? 'NhÃ³m' : 'PhÃ²ng'} â€¢ ${room.is_archived ? 'ÄÃ£ archive' : 'Äang hoáº¡t Ä‘á»™ng'}</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="text-xs px-2 py-1 rounded-lg bg-slate-700 text-white" data-room-id="${room.id}" data-action="view-chat">Xem chat</button>
        <button class="text-xs px-2 py-1 rounded-lg ${room.is_archived ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}" data-room-id="${room.id}" data-action="archive">${room.is_archived ? 'Má»Ÿ láº¡i' : 'Archive'}</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderAdminRoomMessages(data) {
  const container = document.getElementById('admin-room-chat-messages');
  const title = document.getElementById('admin-room-chat-title');
  if (!container) return;

  if (title) {
    title.textContent = data.room ? data.room.name : 'PhÃ²ng chat';
  }

  const messages = data.messages || [];
  if (!messages.length) {
    container.innerHTML = '<div class="text-center text-sm text-slate-500 py-8">KhÃ´ng cÃ³ tin nháº¯n nÃ o trong phÃ²ng nÃ y.</div>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    const senderName = msg.display_name || 'NgÆ°á»i dÃ¹ng';
    const text = msg.message_text || '';
    const fileName = msg.file_name || '';
    const createdAt = new Date(msg.created_at).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    let contentHtml = '';
    if (text) contentHtml = `<p class="text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(text)}</p>`;
    if (fileName) {
      const fileUrl = msg.file_url ? `<a href="${escapeHtml(getLocalFileUrl(msg.file_url))}" target="_blank" rel="noopener noreferrer" class="text-xs text-blue-600 underline">${escapeHtml(fileName)}</a>` : `<span class="text-xs text-slate-500">${escapeHtml(fileName)}</span>`;
      contentHtml += `<div class="mt-1">${fileUrl}</div>`;
    }

    return `
      <div class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div>
            <p class="font-semibold text-sm text-slate-800">${escapeHtml(senderName)}</p>
            <p class="text-[11px] text-slate-400">${escapeHtml(createdAt)}</p>
          </div>
          ${msg.is_system ? '<span class="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-amber-100 text-amber-700">System</span>' : ''}
        </div>
        ${contentHtml}
      </div>
    `;
  }).join('');
}

async function openAdminRoomChatViewer(roomId) {
  const modal = document.getElementById('admin-room-chat-modal');
  const title = document.getElementById('admin-room-chat-title');
  const container = document.getElementById('admin-room-chat-messages');
  if (!modal || !container) return;

  if (title) title.textContent = 'Äang táº£i...';
  container.innerHTML = '<div class="text-center text-sm text-slate-500 py-8">Äang táº£i ná»™i dung chat...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/admin/rooms/${roomId}/messages`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` }
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'KhÃ´ng thá»ƒ táº£i ná»™i dung phÃ²ng');
    }
    renderAdminRoomMessages(data);
  } catch (err) {
    console.warn('Lá»—i xem chat phÃ²ng admin:', err);
    if (container) container.innerHTML = `<div class="text-center text-sm text-red-500 py-8">${escapeHtml(err.message || 'KhÃ´ng thá»ƒ táº£i ná»™i dung phÃ²ng')}</div>`;
  }
}

function renderAdminSettings(settings) {
  const container = document.getElementById('admin-settings-form');
  if (!container) return;
  container.innerHTML = `
    <label class="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <span class="text-sm text-slate-700">Cháº¿ Ä‘á»™ báº£o trÃ¬</span>
      <input type="checkbox" id="admin-maintenance" ${settings.maintenance_mode ? 'checked' : ''}>
    </label>
    <label class="flex items-center justify-between rounded-xl border border-slate-200 p-3">
      <span class="text-sm text-slate-700">Cho phÃ©p Ä‘Äƒng kÃ½</span>
      <input type="checkbox" id="admin-registration" ${settings.allow_registration ? 'checked' : ''}>
    </label>
    <label class="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
      <span class="text-sm text-slate-700">Giá»›i háº¡n ngÆ°á»i dÃ¹ng</span>
      <input type="number" id="admin-max-users" value="${settings.max_users || 1000}" class="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm">
    </label>
    <button id="admin-settings-save" class="rounded-xl bg-zalo-primary px-4 py-2 text-sm font-semibold text-white">LÆ°u cÃ i Ä‘áº·t</button>
  `;
}

async function loadAdminPanelData() {
  if (!isSuperAdmin()) return;
  try {
    const overviewRes = await fetch('/api/admin/overview', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` } });
    const overview = await overviewRes.json();
    renderAdminOverview(overview);

    const usersRes = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` } });
    const users = await usersRes.json();
    renderAdminUsers(users);

    const roomsRes = await fetch('/api/admin/rooms', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` } });
    const rooms = await roomsRes.json();
    renderAdminRooms(rooms);

    const settingsRes = await fetch('/api/admin/settings', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` } });
    const settings = await settingsRes.json();
    renderAdminSettings(settings);
  } catch (err) {
    console.warn('Lá»—i táº£i admin panel:', err);
  }
}

async function updateAdminUserRole(userId, role) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` },
      body: JSON.stringify({ role })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else loadAdminPanelData();
  } catch (err) {
    console.warn(err);
  }
}

async function toggleAdminUserStatus(userId, isActive) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` },
      body: JSON.stringify({ is_active: isActive })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else loadAdminPanelData();
  } catch (err) {
    console.warn(err);
  }
}

async function toggleAdminRoomArchive(roomId, isArchived) {
  try {
    const res = await fetch(`/api/admin/rooms/${roomId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` },
      body: JSON.stringify({ is_archived: isArchived })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else loadAdminPanelData();
  } catch (err) {
    console.warn(err);
  }
}

async function saveAdminSettings() {
  try {
    const payload = {
      maintenance_mode: document.getElementById('admin-maintenance')?.checked || false,
      allow_registration: document.getElementById('admin-registration')?.checked || true,
      max_users: parseInt(document.getElementById('admin-max-users')?.value || '1000', 10)
    };
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alonha_token')}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else {
      alert('ÄÃ£ lÆ°u cÃ i Ä‘áº·t há»‡ thá»‘ng');
      loadAdminPanelData();
    }
  } catch (err) {
    console.warn(err);
  }
}

// 2. REALTIME SOCKET.IO
function connectSocket(token) {
  if (typeof io === 'undefined') {
    console.error("Socket.io library not loaded!");
    return;
  }
  socket = io({ auth: { token } });
  socket.emit("authenticate", token);

  socket.on("receive_message", (message) => {
    if (activeRoomId && message.room_id == activeRoomId) {
      renderSingleMessage(message);
      scrollToBottom();
      if (message.sender_id != currentUser.id) {
        markRoomAsRead(activeRoomId);
      }
    }
    scheduleRoomsRefresh();
  });

  // Moderation events
  socket.on("message_moderated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      // data: { message_id, room_id, status: 'approved' | 'rejected' }
      const msgEl = document.getElementById(`msg-${data.message_id}`);
      if (msgEl) {
        const badge = msgEl.querySelector(".moderation-badge");
        if (badge) {
          if (data.status === 'approved') {
            badge.textContent = 'ÄÃ£ duyá»‡t';
            badge.className = 'moderation-badge bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none';
            // Show the message content
            const body = msgEl.querySelector('.moderation-body');
            if (body) body.classList.remove('hidden');
            const pendingOverlay = msgEl.querySelector('.moderation-pending-overlay');
            if (pendingOverlay) pendingOverlay.remove();
          } else if (data.status === 'rejected') {
            badge.textContent = 'ÄÃ£ tá»« chá»‘i';
            badge.className = 'moderation-badge bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none';
            const body = msgEl.querySelector('.moderation-body');
            if (body) body.classList.add('hidden');
          }
        }
      }
    }
    if (data.status === 'approved') {
      // Náº¿u Ä‘Æ°á»£c duyá»‡t, refresh Ä‘á»ƒ load ná»™i dung
      loadMessages(activeRoomId);
    }
  });

  socket.on("message_status_updated", (data) => {
    const statusEl = document.getElementById(`msg-status-${data.messageId}`);
    if (statusEl) {
      statusEl.innerHTML = renderStatusIcon(data.status);
    }
  });

  socket.on("room_messages_read", (data) => {
    if (activeRoomId && data.room_id == activeRoomId && data.reader_id != currentUser.id) {
      const ticks = document.querySelectorAll(`[id^="msg-status-"]`);
      ticks.forEach(tick => {
        tick.innerHTML = renderStatusIcon('read');
      });
    }
  });

  socket.on("room_messages_delivered", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      const ticks = document.querySelectorAll(`[id^="msg-status-"]`);
      ticks.forEach(tick => {
        if (tick.innerHTML.includes('fa-check ') && !tick.innerHTML.includes('fa-check-double')) {
          tick.innerHTML = renderStatusIcon('delivered');
        }
      });
    }
  });

  socket.on("message_recalled", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      const msgItem = document.getElementById(`msg-${data.message_id}`);
      if (msgItem) {
        const bodyContainer = msgItem.querySelector(".bg-\\[\\#cce4ff\\]") || msgItem.querySelector(".bg-white");
        if (bodyContainer) {
          bodyContainer.innerHTML = `<p class="text-xs md:text-sm text-slate-400/80 italic select-none flex items-center gap-1.5"><i class="fa-solid fa-ban text-slate-300"></i> Tin nháº¯n Ä‘Ã£ bá»‹ thu há»“i</p>`;
          bodyContainer.onclick = null;
        }
        const ctxBtn = msgItem.querySelector("button[title='TÃ¡c vá»¥']");
        if (ctxBtn) ctxBtn.remove();
        
        const reactionsBadge = document.getElementById(`msg-reactions-${data.message_id}`);
        if (reactionsBadge) reactionsBadge.innerHTML = "";
      }
    }
  });

  socket.on("message_reactions_updated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      const reactionsBadge = document.getElementById(`msg-reactions-${data.message_id}`);
      if (reactionsBadge) {
        reactionsBadge.innerHTML = renderReactionsBadge(data.message_id, data.reactions);
      }
    }
  });

  socket.on("typing", (data) => {
    if (activeRoomId && data.room_id == activeRoomId && data.user_id != currentUser.id) {
      showTypingIndicator(data.display_name);
    }
  });

  socket.on("user_status_change", (data) => {
    const user = usersList.find(u => u.id == data.user_id);
    if (user) user.is_online = data.is_online;
    if (activeRoomId) updateChatHeaderStatus();
    renderRoomsList(roomsList);
    if (currentActiveView === 'contacts' && currentContactsTab === 'friends') {
      loadFriends();
    }
  });

  socket.on("room_list_update", () => {
    scheduleRoomsRefresh();
  });

  socket.on("contacts_update", () => {
    updateContactsBadges();
    if (currentActiveView === 'contacts') {
      if (currentContactsTab === 'friends') loadFriends();
      else if (currentContactsTab === 'requests') loadFriendRequests();
    }
  });

  socket.on("pins_updated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      loadPins(activeRoomId);
    }
  });

  socket.on("message_deleted", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      const el = document.getElementById(`msg-${data.message_id}`);
      if (el) el.remove();
    }
  });

  socket.on("group_settings_updated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      loadGroupDetails(activeRoomId);
    }
  });

  socket.on("room_profile_updated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      loadRooms().then(() => {
        const room = roomsList.find(r => r.id == activeRoomId);
        if (room) {
          const chatHeaderName = document.getElementById("chat-header-name");
          if (chatHeaderName) chatHeaderName.textContent = room.name;
          const chatHeaderAvatar = document.getElementById("chat-header-avatar");
          if (chatHeaderAvatar) chatHeaderAvatar.src = room.partner_avatar || "/logo.png";
        }
        loadGroupDetails(activeRoomId);
      });
    }
  });

  socket.on("room_members_updated", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      loadGroupDetails(activeRoomId);
    }
  });

  socket.on("group_dissolved", (data) => {
    if (activeRoomId && data.room_id == activeRoomId) {
      alert("Há»™i thoáº¡i nhÃ³m nÃ y Ä‘Ã£ bá»‹ giáº£i tÃ¡n bá»Ÿi TrÆ°á»Ÿng nhÃ³m.");
      location.reload();
    }
  });

  socket.on("call_incoming", (data) => {
    if (peerConnection) {
      socket.emit("call_reject", { room_id: data.room_id });
      return;
    }
    showIncomingCallOverlay(data);
  });

  socket.on("call_accepted", async (data) => {
    const statusText = document.getElementById("call-status-text");
    if (statusText) statusText.textContent = "Äá»‘i phÆ°Æ¡ng Ä‘Ã£ nháº­n cuá»™c gá»i, Ä‘ang káº¿t ná»‘i trá»±c tiáº¿p...";
    if (isCaller) {
      await startWebRTCCall(data.room_id, true);
    }
  });

  socket.on("call_rejected", () => {
    alert("Cuá»™c gá»i Ä‘Ã£ bá»‹ tá»« chá»‘i hoáº·c Ä‘á»‘i tÃ¡c Ä‘ang báº­n.");
    closeCallOverlay();
  });

  socket.on("webrtc_signal", async (data) => {
    if (data.sender_id == currentUser.id) return;
    try {
      if (!peerConnection) {
        console.log("âš¡ [WebRTC] Nháº­n Ä‘Æ°á»£c tÃ­n hiá»‡u nhÆ°ng chÆ°a khá»Ÿi táº¡o PeerConnection, Ä‘ang kÃ­ch hoáº¡t...");
        await startWebRTCCall(data.room_id, false);
      }
      
      if (!peerConnection) {
        console.error("âš ï¸ [WebRTC] Lá»—i nghiÃªm trá»ng: KhÃ´ng thá»ƒ táº¡o PeerConnection.");
        return;
      }

      if (data.signal.sdp) {
        console.log("âš¡ [WebRTC] Nháº­n SDP loáº¡i:", data.signal.sdp.type);
        // Kiá»ƒm tra renegotiation (screen share)
        if (peerConnection.currentRemoteDescription && data.signal.sdp.type === "offer") {
          console.log("âš¡ [WebRTC] PhÃ¡t hiá»‡n renegotiation (screen share)...");
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
        
        if (peerConnection.iceCandidatesQueue) {
          console.log(`âš¡ [WebRTC] Äang Ä‘á»“ng bá»™ hÃ³a ${peerConnection.iceCandidatesQueue.length} candidates lÆ°u táº¡m...`);
          for (const candidate of peerConnection.iceCandidatesQueue) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn(e));
          }
          peerConnection.iceCandidatesQueue = [];
        }
        
        if (peerConnection.remoteDescription.type === 'offer') {
          console.log("âš¡ [WebRTC] Äang táº¡o SDP Answer pháº£n há»“i...");
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit("webrtc_signal", { room_id: data.room_id, signal: { sdp: peerConnection.localDescription }, sender_id: currentUser.id });
        }
      } else if (data.signal.candidate) {
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(e => console.warn(e));
        } else {
          if (!peerConnection.iceCandidatesQueue) peerConnection.iceCandidatesQueue = [];
          peerConnection.iceCandidatesQueue.push(data.signal.candidate);
          console.log("âš¡ [WebRTC] ÄÃ£ lÆ°u candidate vÃ o hÃ ng Ä‘á»£i chá» remoteDescription...");
        }
      }
    } catch (err) {
      console.error("WebRTC Signal Error:", err);
    }
  });

  socket.on("call_hangup", () => {
    closeCallOverlay();
  });
}

// 3. LOAD DATA
function refreshRoomsList(force = false) {
  if (!force && (roomsRefreshPromise || roomsRefreshInFlight)) {
    return roomsRefreshPromise;
  }

  roomsRefreshInFlight = true;
  roomsRefreshPromise = fetch('/api/rooms', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(rooms => {
    roomsList = rooms;
    renderRoomsList(rooms);
    return rooms;
  })
  .catch(err => {
    console.warn("Lá»—i táº£i danh sÃ¡ch phÃ²ng:", err);
    return [];
  })
  .finally(() => {
    roomsRefreshInFlight = false;
    roomsRefreshPromise = null;
  });

  return roomsRefreshPromise;
}

function loadRooms(force = false) {
  return refreshRoomsList(force);
}

function scheduleRoomsRefresh(force = false) {
  if (roomsRefreshTimer) {
    clearTimeout(roomsRefreshTimer);
  }

  roomsRefreshTimer = setTimeout(() => {
    roomsRefreshTimer = null;
    refreshRoomsList(force);
  }, 80);
}

function loadAllUsers() {
  return fetch('/api/users', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(users => {
    usersList = users;
  });
}

// 4. RENDER SIDEBAR ROOMS
function renderRoomsList(rooms) {
  const container = document.getElementById("rooms-list-container");
  if (!container) return;
  container.innerHTML = "";
  let totalUnread = 0;

  if (!rooms || rooms.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "flex flex-col items-center justify-center py-16 px-4";
    emptyDiv.innerHTML = `
      <div class="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <i class="fa-regular fa-comments text-3xl text-slate-300"></i>
      </div>
      <h3 class="text-base font-bold text-slate-400">ChÆ°a cÃ³ há»™i thoáº¡i</h3>
      <p class="text-xs text-slate-300 mt-2 text-center">HÃ£y káº¿t báº¡n vÃ  báº¯t Ä‘áº§u trÃ² chuyá»‡n<br>hoáº·c táº¡o nhÃ³m chat má»›i</p>
    `;
    container.appendChild(emptyDiv);
    return;
  }

  rooms.forEach(room => {
    totalUnread += room.unread_count || 0;
    const isGroup = room.is_group;
    
    let avatarUrl = "/logo.png";
    if (room.name === 'Cloud cá»§a tÃ´i') {
      avatarUrl = "https://img.icons8.com/color/192/000000/cloud.png";
    } else if (room.partner_avatar) {
      avatarUrl = room.partner_avatar;
    }

    const unreadBadge = room.unread_count > 0 
      ? `<span class="bg-red-500 text-white text-[10px] rounded-full h-4.5 min-w-[18px] px-1 flex items-center justify-center font-bold animate-pulse shrink-0">${room.unread_count}</span>` 
      : '';

    const pinIcon = room.is_pinned 
      ? `<i class="fa-solid fa-thumbtack text-slate-400 text-[10px] transform rotate-45 select-none" title="ÄÃ£ ghim há»™i thoáº¡i"></i>` 
      : '';

    const muteIcon = room.is_muted 
      ? `<i class="fa-solid fa-bell-slash text-red-400 text-[10px] select-none" title="ÄÃ£ táº¯t thÃ´ng bÃ¡o"></i>` 
      : '';

    const div = document.createElement("div");
    div.className = `flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-100 relative ${activeRoomId == room.id && currentActiveView === 'chat' ? 'bg-[#e5f1ff] border-r-4 border-zalo-primary' : ''}`;
    
    div.innerHTML = `
      <div class="relative shrink-0 select-none">
        <img src="${avatarUrl}" class="w-11 h-11 rounded-full object-cover">
        ${!isGroup && room.name !== 'Cloud cá»§a tÃ´i' ? `<span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>` : ''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-baseline mb-0.5">
          <h4 class="font-bold text-slate-800 text-sm truncate flex items-center gap-1">
            ${room.name}
            ${muteIcon}
          </h4>
          <span class="text-[10px] text-slate-400 font-semibold shrink-0">${room.last_message_time ? formatTime(room.last_message_time) : ''}</span>
        </div>
        <div class="flex justify-between items-center gap-2">
          <p class="text-xs text-slate-500 truncate flex-1">${room.last_message || 'ChÆ°a cÃ³ tin nháº¯n.'}</p>
          <div class="flex items-center gap-1.5">
            ${pinIcon}
            ${unreadBadge}
          </div>
        </div>
      </div>
    `;

    div.addEventListener("click", () => {
      switchView('chat');
      handleRoomSelection(room.id);
    });

    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openRoomContextMenu(e, room);
    });
    container.appendChild(div);
  });

  const globalBadge = document.getElementById("global-unread-badge");
  if (globalBadge) {
    if (totalUnread > 0) {
      globalBadge.textContent = totalUnread;
      globalBadge.classList.remove("hidden");
    } else {
      globalBadge.classList.add("hidden");
    }
  }
}

// =========================================================================
// ðŸ“Œ QUáº¢N LÃ MENU CHUá»˜T PHáº¢I DANH SÃCH Há»˜I THOáº I (GHIM / Táº®T THÃ”NG BÃO)
// =========================================================================
let contextRoomId = null;

window.openRoomContextMenu = function(e, room) {
  contextRoomId = room.id;
  const menu = document.getElementById("room-context-menu");
  if (!menu) return;
  menu.classList.remove("hidden");
  
  let x = e.pageX;
  let y = e.pageY;
  if (window.innerWidth - x < 200) x -= 200;
  if (window.innerHeight - y < 100) y -= 100;
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const pinBtnSpan = document.getElementById("ctx-room-pin")?.querySelector("span");
  const pinBtnIcon = document.getElementById("ctx-room-pin")?.querySelector("i");
  if (pinBtnSpan && pinBtnIcon) {
    if (room.is_pinned) {
      pinBtnSpan.textContent = "Bá» ghim há»™i thoáº¡i";
      pinBtnIcon.className = "fa-solid fa-thumbtack w-4 text-center text-slate-400";
    } else {
      pinBtnSpan.textContent = "Ghim há»™i thoáº¡i";
      pinBtnIcon.className = "fa-solid fa-thumbtack w-4 text-center transform rotate-45 text-blue-500";
    }
  }

  const muteBtnSpan = document.getElementById("ctx-room-mute")?.querySelector("span");
  const muteBtnIcon = document.getElementById("ctx-room-mute")?.querySelector("i");
  if (muteBtnSpan && muteBtnIcon) {
    if (room.is_muted) {
      muteBtnSpan.textContent = "Báº­t thÃ´ng bÃ¡o";
      muteBtnIcon.className = "fa-solid fa-bell w-4 text-center text-blue-500";
    } else {
      muteBtnSpan.textContent = "Táº¯t thÃ´ng bÃ¡o";
      muteBtnIcon.className = "fa-solid fa-bell-slash w-4 text-center text-red-500";
    }
  }
};

document.addEventListener("click", (e) => {
  const menu = document.getElementById("room-context-menu");
  if (menu && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
  }
});

// 5. CHá»ŒN PHÃ’NG CHAT
function handleRoomSelection(roomId) {
  if (currentUser.pin_code && !unlockedRooms.has(roomId)) {
    tempRoomToUnlock = roomId;
    openPinLockOverlay();
    return;
  }

  clearReplyState();

  activeRoomId = roomId;
  unlockedRooms.add(roomId);
  localStorage.setItem("alonha_active_room_id", roomId);

  if (socket) {
    socket.emit("join_room", roomId);
  }

  if (window.innerWidth < 768) {
    const roomsSidebar = document.getElementById("rooms-sidebar");
    if (roomsSidebar) roomsSidebar.classList.add("hidden");
    const navigationSidebar = document.getElementById("navigation-sidebar");
    if (navigationSidebar) navigationSidebar.classList.add("hidden"); 
    const chatAreaContainer = document.getElementById("chat-area-container");
    if (chatAreaContainer) {
      chatAreaContainer.classList.remove("hidden");
      chatAreaContainer.classList.add("flex");
    }
  } else if (window.innerWidth >= 1024) {
    const infoSidebar = document.getElementById("info-sidebar");
    if (infoSidebar) infoSidebar.classList.remove("hidden");
  }

  const room = roomsList.find(r => r.id == roomId);
  if (room) {
    const welcomeBanner = document.getElementById("welcome-banner");
    if (welcomeBanner) welcomeBanner.classList.add("hidden");
    const chatAreaContainer = document.getElementById("chat-area-container");
    if (chatAreaContainer) {
      chatAreaContainer.classList.remove("hidden");
      chatAreaContainer.classList.add("flex");
    }
    
    const chatHeaderName = document.getElementById("chat-header-name");
    if (chatHeaderName) chatHeaderName.textContent = room.name;
    const chatHeaderAvatar = document.getElementById("chat-header-avatar");
    if (chatHeaderAvatar) chatHeaderAvatar.src = room.partner_avatar || "/logo.png";
    updateChatHeaderStatus();
  }

  const toggleInfoBtn = document.getElementById("btn-toggle-info");
  const headerRight = toggleInfoBtn ? toggleInfoBtn.parentElement : null;
  if (headerRight && !document.getElementById("btn-open-search-msg")) {
    const searchBtn = document.createElement("button");
    searchBtn.id = "btn-open-search-msg";
    searchBtn.className = "w-9 h-9 rounded-full bg-slate-50 border border-slate-100 text-slate-500 hover:text-blue-500 flex items-center justify-center shadow-sm transition-colors focus:outline-none";
    searchBtn.title = "TÃ¬m kiáº¿m tin nháº¯n";
    searchBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass text-sm"></i>`;
    searchBtn.onclick = () => {
      toggleInRoomSearchOverlay();
    };
    headerRight.insertBefore(searchBtn, toggleInfoBtn);
  }

  const cachedMessages = AloNhaCache.get(roomId);
  if (cachedMessages && cachedMessages.length > 0) {
    const container = document.getElementById("chat-messages-container");
    if (container) {
      container.innerHTML = "";
      cachedMessages.forEach(msg => renderSingleMessage(msg));
      scrollToBottom();
    }
  }

  loadGroupDetails(roomId).then(() => {
    loadMessages(roomId);
    loadPins(roomId);
    loadResources(roomId);
  });
  scheduleRoomsRefresh(true);
}

function startOneToOneChat(userId, partnerName) {
  fetch('/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem("alonha_token")}`
    },
    body: JSON.stringify({ name: partnerName, is_group: false, members: [userId] })
  })
  .then(res => res.json())
  .then(room => {
    if (room.error) {
      alert("Lá»—i khi khá»Ÿi Ä‘á»™ng cuá»™c há»™i thoáº¡i: " + room.error);
      return;
    }
    loadRooms(true).then(() => {
      handleRoomSelection(room.id);
    });
  })
  .catch(err => {
    alert("KhÃ´ng thá»ƒ káº¿t ná»‘i mÃ¡y chá»§ Ä‘á»ƒ táº¡o cuá»™c trÃ² chuyá»‡n!");
    console.error(err);
  });
}

// 6. MESSAGES LIST & RENDER
function loadMessages(roomId) {
  fetch(`/api/rooms/${roomId}/messages`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(messages => {
    const container = document.getElementById("chat-messages-container");
    if (container) {
      container.innerHTML = "";
      messages.forEach(msg => {
        renderSingleMessage(msg);
      });
      scrollToBottom();
    }
    AloNhaCache.save(roomId, messages);
    markRoomAsRead(roomId);
  });
}

function markRoomAsRead(roomId) {
  fetch(`/api/rooms/${roomId}/read`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      console.log(`âœ… ÄÃ£ xem toÃ n bá»™ tin nháº¯n trong phÃ²ng: ${roomId}`);
    }
  })
  .catch(err => console.warn("Lá»—i Ä‘Ã¡nh dáº¥u Ä‘Ã£ xem:", err));
}

function renderSingleMessage(msg) {
  const container = document.getElementById("chat-messages-container");
  if (!container) return;
  if (msg.id && document.getElementById(`msg-${msg.id}`)) return;

  if (msg.is_system) {
    const div = document.createElement("div");
    div.className = "flex justify-center my-2 text-center select-none";
    div.innerHTML = `<span class="bg-slate-200/85 text-slate-600 text-[10px] px-3 py-1 rounded-full font-bold shadow-sm">${msg.message_text}</span>`;
    container.appendChild(div);
    return;
  }

  const isMe = msg.sender_id == currentUser.id;
  const isRecalled = msg.is_recalled === true;
  const isStaff = activeRoomSelfSettings && (activeRoomSelfSettings.role === 'admin' || activeRoomSelfSettings.role === 'co-leader');
  
  // Kiá»ƒm duyá»‡t ná»™i dung: tin nháº¯n chá» duyá»‡t náº¿u nhÃ³m báº­t moderation vÃ  ngÆ°á»i gá»­i khÃ´ng pháº£i staff
  const moderationEnabled = activeRoomSettings && activeRoomSettings.is_group && activeRoomSettings.group_moderation_mode;
  const needsModeration = moderationEnabled && !isStaff && !isMe && !msg.is_system && !isRecalled;
  const isPendingModeration = needsModeration && msg.moderation_status === 'pending';
  const isRejectedModeration = needsModeration && msg.moderation_status === 'rejected';

  const div = document.createElement("div");
  div.id = `msg-${msg.id}`;
  if (msg.file_url) div.dataset.rawFileUrl = msg.file_url;
  div.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-4 items-end gap-2 relative group`;

  const avatarUrl = msg.avatar_url || "/logo.png";
  
  let senderRoleTag = "";
  const senderInGroup = activeRoomMembers.find(m => m.user_id == msg.sender_id);
  if (activeRoomSettings && activeRoomSettings.is_group && activeRoomSettings.group_mark_admin_messages && senderInGroup) {
    if (senderInGroup.role === 'admin') {
      senderRoleTag = `<span class="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none">TrÆ°á»Ÿng nhÃ³m</span>`;
    } else if (senderInGroup.role === 'co-leader') {
      senderRoleTag = `<span class="bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none">PhÃ³ nhÃ³m</span>`;
    }
  }

  const displayName = msg.display_name || "ThÃ nh viÃªn";

  let replyBlockHTML = "";
  if (msg.reply_to_id && !isRecalled) {
    const parentSender = msg.parent_sender_name || "ThÃ nh viÃªn";
    let parentPreviewText = msg.parent_text || `[TÃ i liá»‡u] ${msg.parent_file_name || ''}`;
    if (msg.parent_is_recalled) {
      parentPreviewText = "Tin nháº¯n Ä‘Ã£ bá»‹ thu há»“i";
    }
    
    replyBlockHTML = `
      <div class="bg-slate-50 border-l-2 border-blue-500 rounded px-2.5 py-1.5 mb-2 text-[10px] md:text-[11px] text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors max-w-full select-none" onclick="event.stopPropagation(); scrollToTargetMessage(${msg.reply_to_id})">
        <p class="font-bold text-blue-500 text-[10px] truncate flex items-center gap-1"><i class="fa-solid fa-reply text-[8px]"></i> TrÃ­ch dáº«n tá»« ${parentSender}</p>
        <p class="truncate italic mt-0.5">${parentPreviewText}</p>
      </div>
    `;
  }

  let chatBody = "";
  if (isRecalled) {
    chatBody = `<p class="text-xs md:text-sm text-slate-400/80 italic select-none flex items-center gap-1.5"><i class="fa-solid fa-ban text-slate-300"></i> Tin nháº¯n Ä‘Ã£ bá»‹ thu há»“i</p>`;
  } else if (msg.file_type === 'location') {
    // Render location message
    let locData = { lat: 0, lng: 0, name: "Vá»‹ trÃ­", address: "" };
    try {
      const parsed = JSON.parse(msg.message_text);
      locData = { lat: parsed.lat || 0, lng: parsed.lng || 0, name: parsed.name || "Vá»‹ trÃ­", address: parsed.address || "" };
    } catch (e) {
      // If can't parse as JSON, try to extract coordinates from text
      const coordsMatch = msg.message_text.match(/(\d+\.\d+),\s*(\d+\.\d+)/);
      if (coordsMatch) {
        locData = { lat: parseFloat(coordsMatch[1]), lng: parseFloat(coordsMatch[2]), name: "Vá»‹ trÃ­", address: msg.message_text };
      }
    }
    const googleMapsUrl = `https://www.google.com/maps?q=${locData.lat},${locData.lng}`;
    chatBody = `
      ${replyBlockHTML}
      <div class="min-w-[200px] max-w-[260px] cursor-pointer select-none" onclick="event.stopPropagation(); openLocationView(${locData.lat}, ${locData.lng}, '${escapeHtml(locData.name)}', '${escapeHtml(locData.address || '')}')">
        <div id="location-thumb-${msg.id}" class="h-32 bg-slate-200 rounded-t-xl flex items-center justify-center text-slate-400 text-xs relative overflow-hidden">
          <img src="https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-l+ff0000(${locData.lng},${locData.lat})/${locData.lng},${locData.lat},15,0/260x128@2x?access_token=YOUR_MAPBOX_TOKEN" 
               class="w-full h-full object-cover"
               alt="Báº£n Ä‘á»“"
               onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fa-solid fa-map-location-dot text-2xl\\'></i><span class=\\'mt-1\\'>Báº£n Ä‘á»“</span>'">
        </div>
        <div class="bg-white px-3 py-2 rounded-b-xl border border-slate-100 border-t-0">
          <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(locData.name)}</p>
          <p class="text-[10px] text-slate-400 truncate mt-0.5">${escapeHtml(locData.address || 'Xem trÃªn Google Maps')}</p>
        </div>
      </div>
    `;
  } else if (msg.file_url) {
    const isImage = msg.file_type === 'media';
    const fileName = (msg.file_name || '').toLowerCase();
    const fileType = (msg.file_type || '').toLowerCase();
    const isAudio = fileType.includes('audio') || fileName.endsWith('.webm') || fileName.endsWith('.ogg') || fileName.endsWith('.mp3') || fileName.endsWith('.wav') || fileName.includes('voice_');
    const audioMimeType = 'audio/webm';

    if (isAudio) {
      chatBody = `
        ${replyBlockHTML}
        <div class="flex flex-col items-start gap-1 py-1 min-w-[200px]">
          <audio controls preload="metadata" class="h-10 w-full outline-none rounded-full">
            <source src="${getLocalFileUrl(msg.file_url)}" type="${audioMimeType}">
            TrÃ¬nh duyá»‡t khÃ´ng há»— trá»£.
          </audio>
        </div>
      `;
    } else if (isImage) {
      const localUrl = getLocalFileUrl(msg.file_url);
      chatBody = `
        ${replyBlockHTML}
        <div class="relative group/img-container">
          <img src="${localUrl}" class="max-w-[180px] md:max-w-xs rounded-xl shadow-sm border cursor-pointer hover:opacity-95 transition-opacity">
          <div class="absolute top-2 right-2 bg-slate-900/70 hover:bg-slate-950 text-white text-[10px] px-2.5 py-1 rounded-lg opacity-0 group-hover/img-container:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer font-bold select-none z-20" onclick="event.stopPropagation(); window.open('${localUrl}', '_blank')">
            <i class="fa-solid fa-expand"></i> PhÃ³ng to
          </div>
        </div>
      `;
    } else {
      chatBody = `
        ${replyBlockHTML}
        <div class="flex items-center gap-3 p-3 bg-white border rounded-xl shadow-sm text-xs md:text-sm select-none">
          <div class="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center font-bold shrink-0 text-base">
            <i class="fa-solid fa-file-pdf"></i>
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-bold text-slate-800 truncate">${msg.file_name}</p>
            <p class="text-[10px] text-slate-400 font-bold mt-0.5">${msg.file_size}</p>
          </div>
          <a href="${getLocalFileUrl(msg.file_url)}" target="_blank" onclick="event.stopPropagation();" class="text-blue-600 hover:underline font-bold text-xs shrink-0 pl-1">Táº£i vá»</a>
        </div>
      `;
    }
  } else {
    chatBody = `
      ${replyBlockHTML}
      <p class="text-xs md:text-sm break-words leading-relaxed whitespace-pre-wrap">${msg.message_text}</p>
    `;
  }

  const timeStr = formatTime(msg.created_at);
  const encodedText = encodeURIComponent(msg.message_text || '');
  const encodedName = encodeURIComponent(displayName);
  const fileUrlParam = msg.file_url ? `'${encodeURIComponent(getLocalFileUrl(msg.file_url))}'` : 'null';
  
  const ctxBtn = isRecalled ? '' : `<button onclick="openMessageActionMenu(${msg.id}, '${encodedText}', ${isMe}, '${encodedName}', ${fileUrlParam})" class="hidden group-hover:flex absolute top-1/2 -translate-y-1/2 ${isMe ? 'left-[-35px]' : 'right-[-35px]'} bg-white w-7 h-7 rounded-full shadow border text-slate-400 hover:text-blue-500 items-center justify-center focus:outline-none" title="TÃ¡c vá»¥"><i class="fa-solid fa-ellipsis-vertical text-xs"></i></button>`;

  let reactionsHTML = "";
  if (!isRecalled && msg.reactions && msg.reactions.length > 0) {
    reactionsHTML = renderReactionsBadge(msg.id, msg.reactions);
  }

  if (isMe) {
    div.innerHTML = `
      ${ctxBtn}
      <div class="flex flex-col items-end max-w-[75%] relative">
        <div class="bg-[#cce4ff] text-slate-800 py-2.5 px-4 rounded-2xl rounded-tr-none shadow-sm border border-[#a1ccfe]/30 cursor-pointer" ${isRecalled ? '' : `onclick="openMessageActionMenu(${msg.id}, '${encodedText}', ${isMe}, '${encodedName}', ${fileUrlParam})"`}>
          ${chatBody}
        </div>
        <div id="msg-reactions-${msg.id}" class="mt-[-8px] mr-2 z-10">${reactionsHTML}</div>
        <span class="text-[9px] text-slate-400 font-bold mt-1 pr-1 select-none flex items-center gap-1">
          ${timeStr}
          <span id="msg-status-${msg.id}">${renderStatusIcon(msg.status)}</span>
        </span>
      </div>
    `;
  } else {
    let moderationBadge = "";
    let moderationOverlay = "";
    if (isPendingModeration) {
      moderationBadge = `<span class="moderation-badge bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none">Äang chá» duyá»‡t</span>`;
      moderationOverlay = `<div class="moderation-pending-overlay absolute inset-0 bg-white/75 rounded-2xl flex items-center justify-center z-10 cursor-default"><span class="text-[10px] text-amber-700 font-bold bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200 shadow-sm"><i class="fa-solid fa-hourglass-half mr-1"></i> Tin nháº¯n Ä‘ang chá» ban quáº£n trá»‹ phÃª duyá»‡t</span></div>`;
    } else if (isRejectedModeration) {
      moderationBadge = `<span class="moderation-badge bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.2 rounded ml-1 select-none">Bá»‹ tá»« chá»‘i</span>`;
    }

    div.innerHTML = `
      <img src="${avatarUrl}" class="w-8 h-8 rounded-full object-cover shrink-0 shadow-sm mb-1 select-none">
      <div class="flex flex-col max-w-[75%] relative">
        <span class="text-[9px] text-slate-400 font-bold pl-1 mb-1 truncate select-none flex items-center gap-1">
          ${displayName}
          ${senderRoleTag}
          ${moderationBadge}
        </span>
        <div class="bg-white text-slate-800 py-2.5 px-4 rounded-2xl rounded-tl-none shadow-sm border border-slate-100 cursor-pointer relative ${isPendingModeration || isRejectedModeration ? 'opacity-80' : ''}" ${isRecalled ? '' : `onclick="openMessageActionMenu(${msg.id}, '${encodedText}', ${isMe}, '${encodedName}', ${fileUrlParam})"`}>
          ${moderationOverlay}
          <div class="${isPendingModeration || isRejectedModeration ? 'moderation-body' : ''}">
            ${isPendingModeration ? `<p class="text-xs text-slate-400 italic">[Ná»™i dung tin nháº¯n Ä‘ang chá» phÃª duyá»‡t]</p>` : chatBody}
          </div>
        </div>
        <div id="msg-reactions-${msg.id}" class="mt-[-8px] ml-2 z-10">${reactionsHTML}</div>
        <span class="text-[9px] text-slate-400 font-bold mt-1 pl-1 select-none">${timeStr}</span>
      </div>
      ${ctxBtn}
    `;
  }
  container.appendChild(div);
}

// 7. MESSAGE ACTION MENU (GIAI ÄOáº N 3: Bá»• sung thÃªm nÃºt Tráº£ lá»i)
window.openMessageActionMenu = function(messageId, encodedText, isMe, encodedName, encodedFileUrl) {
  const text = decodeURIComponent(encodedText);
  const displayName = decodeURIComponent(encodedName || "ThÃ nh viÃªn");
  const fileUrl = encodedFileUrl ? decodeURIComponent(encodedFileUrl) : null;
  // Láº¥y file_url gá»‘c tá»« dataset cá»§a message div
  const msgDiv = document.getElementById("msg-" + messageId);
  const rawFileUrl = msgDiv ? (msgDiv.dataset.rawFileUrl || fileUrl) : fileUrl;
  const menu = document.getElementById("msg-context-menu");
  if (!menu) return;
  menu.classList.remove("hidden");

  let emojiBar = menu.querySelector(".emoji-reaction-bar");
  if (!emojiBar) {
    emojiBar = document.createElement("div");
    emojiBar.className = "emoji-reaction-bar flex justify-around items-center bg-slate-50 border border-slate-100 rounded-full p-2 mb-2 select-none shadow-sm";
    const emojis = ["ðŸ‘", "â¤ï¸", "ðŸ˜‚", "ðŸ˜®", "ðŸ˜¢", "ðŸ˜¡"];
    emojis.forEach(emoji => {
      const btn = document.createElement("button");
      btn.className = "text-xl hover:scale-125 active:scale-90 transition-transform focus:outline-none";
      btn.textContent = emoji;
      btn.onclick = () => {
        submitReaction(messageId, emoji);
        menu.classList.add("hidden");
      };
      emojiBar.appendChild(btn);
    });
    
    const clearBtn = document.createElement("button");
    clearBtn.className = "w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs flex items-center justify-center font-bold shadow-sm transition-colors focus:outline-none";
    clearBtn.innerHTML = "<i class='fa-solid fa-trash-can text-[10px]'></i>";
    clearBtn.title = "XÃ³a biá»ƒu cáº£m";
    clearBtn.onclick = () => {
      submitReaction(messageId, null);
      menu.classList.add("hidden");
    };
    emojiBar.appendChild(clearBtn);

    if (menu.firstElementChild) {
      menu.firstElementChild.insertBefore(emojiBar, menu.firstElementChild.children[2] || null);
    }
  } else {
    const buttons = emojiBar.querySelectorAll("button");
    const emojis = ["ðŸ‘", "â¤ï¸", "ðŸ˜‚", "ðŸ˜®", "ðŸ˜¢", "ðŸ˜¡"];
    buttons.forEach((btn, idx) => {
      if (idx < emojis.length) {
        btn.onclick = () => {
          submitReaction(messageId, emojis[idx]);
          menu.classList.add("hidden");
        };
      } else {
        btn.onclick = () => {
          submitReaction(messageId, null);
          menu.classList.add("hidden");
        };
      }
    });
  }

  let replyBtn = document.getElementById("ctx-btn-reply");
  if (!replyBtn) {
    replyBtn = document.createElement("button");
    replyBtn.id = "ctx-btn-reply";
    replyBtn.className = "w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-100 flex items-center space-x-2 font-semibold transition-colors";
    replyBtn.innerHTML = `<i class="fa-solid fa-reply text-slate-400 w-4"></i> <span>Tráº£ lá»i</span>`;
    
    const copyBtn = document.getElementById("ctx-btn-copy");
    if (menu.firstElementChild) {
      menu.firstElementChild.insertBefore(replyBtn, copyBtn);
    }
  }
  
  replyBtn.onclick = () => {
    replyingToMessageId = messageId;
    showReplyPreview(messageId, text, isMe ? "chÃ­nh mÃ¬nh" : displayName);
    menu.classList.add("hidden");
  };

  let fileBtn = document.getElementById("ctx-btn-view-file");
  if (fileUrl) {
    if (!fileBtn) {
      fileBtn = document.createElement("button");
      fileBtn.id = "ctx-btn-view-file";
      fileBtn.className = "w-full text-left px-4 py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center space-x-2 font-bold transition-colors border-b border-slate-100";
      fileBtn.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square text-blue-500 w-4"></i> <span>Má»Ÿ rá»™ng / Xem chi tiáº¿t tá»‡p</span>`;
      if (menu.firstElementChild) {
        menu.firstElementChild.insertBefore(fileBtn, menu.firstElementChild.firstChild);
      }
    }
    fileBtn.classList.remove("hidden");
    fileBtn.onclick = () => {
      window.open(fileUrl, '_blank');
      menu.classList.add("hidden");
    };
  } else {
    if (fileBtn) fileBtn.classList.add("hidden");
  }

  const deleteBtn = document.getElementById("ctx-btn-delete");
  if (deleteBtn) {
    if (isMe) deleteBtn.classList.remove("hidden");
    else deleteBtn.classList.add("hidden");
    
    deleteBtn.onclick = () => {
      if (confirm("XÃ¡c nháº­n thu há»“i tin nháº¯n nÃ y Ä‘á»‘i vá»›i má»i ngÆ°á»i?")) {
        fetch(`/api/messages/${messageId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
        })
        .then(() => {
          menu.classList.add("hidden");
        });
      }
    };
  }

  const pinBtn = document.getElementById("ctx-btn-pin");
  if (pinBtn) {
    if (activeRoomSettings && activeRoomSettings.is_group) {
      const isStaff = activeRoomSelfSettings.role === 'admin' || activeRoomSelfSettings.role === 'co-leader';
      if (!activeRoomSettings.group_allow_pin && !isStaff) pinBtn.classList.add("hidden");
      else pinBtn.classList.remove("hidden");
    } else {
      pinBtn.classList.remove("hidden");
    }

    pinBtn.onclick = () => {
      fetch(`/api/rooms/${activeRoomId}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({ message_id: messageId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        menu.classList.add("hidden");
      });
    };
  }

  const copyBtn = document.getElementById("ctx-btn-copy");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text || "[File / HÃ¬nh áº£nh]").then(() => {
        alert("ÄÃ£ sao chÃ©p ná»™i dung tin nháº¯n!");
        menu.classList.add("hidden");
      });
    };
  }

  const cancelBtn = document.getElementById("ctx-btn-cancel");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      menu.classList.add("hidden");
    };
  }
  
  menu.onclick = (e) => {
    if (e.target === menu) menu.classList.add("hidden");
  };
};

const chatInputForm = document.getElementById("chat-input-form");
if (chatInputForm) {
  chatInputForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const field = document.getElementById("chat-input-field");
    const text = field ? field.value.trim() : "";
    if (!text || !activeRoomId) return;

    socket.emit("send_message", {
      room_id: activeRoomId,
      sender_id: currentUser.id,
      message_text: text,
      reply_to_id: replyingToMessageId
    });

    if (field) field.value = "";
    clearReplyState();
    if (field) field.focus();
  });
}

// Typing indicator emission
const chatInputField = document.getElementById("chat-input-field");
if (chatInputField) {
  let typingTimeout = null;
  chatInputField.addEventListener("input", () => {
    if (!activeRoomId) return;
    socket.emit("typing", {
      room_id: activeRoomId,
      user_id: currentUser.id,
      display_name: currentUser.display_name
    });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      // typing stopped
    }, 2000);
  });
}

function uploadFile(source) {
  const file = source instanceof File
    ? source
    : (source && source.files && source.files[0] ? source.files[0] : null);

  if (!file || !activeRoomId) return;

  const formData = new FormData();
  formData.append("file", file);
  
  if (replyingToMessageId) {
    formData.append("reply_to_id", replyingToMessageId);
  }

  const banner = document.getElementById("upload-progress-banner");
  const fill = document.getElementById("upload-progress-bar-fill");
  const percentage = document.getElementById("upload-percentage-text");
  const filenameText = document.getElementById("upload-filename-text");
  if (filenameText) filenameText.textContent = file.name;

  if (banner) banner.classList.remove("hidden");

  console.log('[voice-debug] sending upload', {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    roomId: activeRoomId
  });

  fetch(`/api/rooms/${activeRoomId}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
    body: formData
  })
  .then(async (res) => {
    const text = await res.text();
    console.log('[voice-debug] upload response', {
      status: res.status,
      text
    });
    if (banner) banner.classList.add("hidden");
    clearReplyState();
    if (res.ok) {
      try {
        const msg = JSON.parse(text);
        renderSingleMessage(msg);
        scrollToBottom();
        loadResources(activeRoomId);
      } catch (e) {
        alert('Táº£i lÃªn thÃ nh cÃ´ng nhÆ°ng pháº£n há»“i khÃ´ng há»£p lá»‡.');
      }
    } else if (res.status === 413) {
      alert("Tá»‡p tin quÃ¡ giá»›i háº¡n táº£i lÃªn cá»§a mÃ¡y chá»§ VPS!");
    } else {
      try {
        const errData = JSON.parse(text);
        alert("Táº£i tá»‡p lÃªn tháº¥t báº¡i: " + (errData.error || "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh tá»« mÃ¡y chá»§"));
      } catch (e) {
        alert("Táº£i tá»‡p lÃªn mÃ¡y chá»§ tháº¥t báº¡i! (MÃ£ tráº¡ng thÃ¡i: " + res.status + ")");
      }
    }
  })
  .catch((err) => {
    if (banner) banner.classList.add("hidden");
    console.error('[voice-debug] upload fetch error', err);
    alert("Gá»­i tá»‡p tháº¥t báº¡i do lá»—i máº¡ng hoáº·c mÃ¡y chá»§.");
  });

  if (source && source.value !== undefined) {
    source.value = "";
  }
}

const toolSendImage = document.getElementById("tool-send-image");
if (toolSendImage) toolSendImage.addEventListener("change", function() { uploadFile(this); });
const toolSendFile = document.getElementById("tool-send-file");
if (toolSendFile) toolSendFile.addEventListener("change", function() { uploadFile(this); });

// 8. CO-OP GROUP DETAILS
function loadGroupDetails(roomId) {
  return fetch(`/api/rooms/${roomId}/members`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(data => {
    const isGroup = data.settings.is_group;
    
    activeRoomSettings = data.settings;
    activeRoomSelfSettings = data.self;
    activeRoomMembers = data.members;

    const groupAccordion = document.getElementById("section-members-accordion");
    const notesAccordion = document.getElementById("section-notes-accordion");
    const cloudCard = document.getElementById("cloud-storage-card");
    const infoAvatar = document.getElementById("info-avatar");
    const infoName = document.getElementById("info-name");

    if (infoName) infoName.textContent = data.settings.name;
    if (infoAvatar) infoAvatar.src = isGroup ? (data.settings.avatar_url || "/logo.png") : (data.settings.partner_avatar || "/logo.png");

    updateQuickActionsUI(data.self);
    updateSendMessageInputPermission(data.settings, data.self.role);

    // Xá»­ lÃ½ áº©n/hiá»‡n nÃºt ThÃªm TV vÃ  Quáº£n lÃ½ tÃ¹y theo loáº¡i phÃ²ng chat
    const addMemberBtn = document.getElementById("btn-info-add-member");
    const manageGroupBtn = document.getElementById("btn-info-manage-group");
    const quickActionsContainer = addMemberBtn ? addMemberBtn.parentElement : null;

    if (isGroup) {
      if (groupAccordion) groupAccordion.classList.remove("hidden");
      if (notesAccordion) notesAccordion.classList.remove("hidden");
      if (cloudCard) cloudCard.classList.add("hidden");
      
      if (manageGroupBtn) manageGroupBtn.classList.remove("hidden");
      if (addMemberBtn) addMemberBtn.classList.remove("hidden");
      
      // KhÃ´i phá»¥c layout grid-cols-4 gá»‘c cho nhÃ³m
      if (quickActionsContainer) {
        quickActionsContainer.className = "grid grid-cols-4 gap-1 text-center py-2 select-none";
      }

      const membersCountIndicator = document.getElementById("members-count-indicator");
      if (membersCountIndicator) membersCountIndicator.textContent = data.members.length;

      const joinUrl = `${window.location.origin}/?join=${data.settings.group_link_code}`;
      const groupLinkTextbox = document.getElementById("group-link-textbox");
      const manageGroupLinkTextbox = document.getElementById("manage-group-link-textbox");
      const copyGroupLinkBtn = document.getElementById("btn-copy-group-link");
      const shareGroupLinkBtn = document.getElementById("btn-share-group-link");
      const manageCopyLinkBtn = document.getElementById("btn-manage-copy-group-link");
      
      if (groupLinkTextbox) {
        if (!data.settings.group_allow_join_via_link) {
          groupLinkTextbox.value = "LiÃªn káº¿t tham gia nhÃ³m Ä‘ang bá»‹ táº¯t";
          if (manageGroupLinkTextbox) manageGroupLinkTextbox.value = "LiÃªn káº¿t tham gia nhÃ³m Ä‘ang bá»‹ táº¯t";
          if (copyGroupLinkBtn) copyGroupLinkBtn.disabled = true;
          if (shareGroupLinkBtn) shareGroupLinkBtn.disabled = true;
          if (manageCopyLinkBtn) manageCopyLinkBtn.disabled = true;
        } else {
          groupLinkTextbox.value = joinUrl;
          if (manageGroupLinkTextbox) manageGroupLinkTextbox.value = joinUrl;
          if (copyGroupLinkBtn) copyGroupLinkBtn.disabled = false;
          if (shareGroupLinkBtn) shareGroupLinkBtn.disabled = false;
          if (manageCopyLinkBtn) manageCopyLinkBtn.disabled = false;
        }
      }

      const isStaff = data.self.role === 'admin' || data.self.role === 'co-leader';
      const canEditProfile = data.settings.group_allow_edit_profile || isStaff;
      const triggerRenameBtn = document.getElementById("btn-trigger-rename");
      const editGroupProfileBtn = document.getElementById("btn-edit-group-profile");
      
      if (canEditProfile) {
        if (triggerRenameBtn) triggerRenameBtn.classList.remove("hidden");
        if (editGroupProfileBtn) editGroupProfileBtn.classList.remove("hidden");
      } else {
        if (triggerRenameBtn) triggerRenameBtn.classList.add("hidden");
        if (editGroupProfileBtn) editGroupProfileBtn.classList.add("hidden");
      }

      renderGroupMembers(data.members, data.settings);
      syncGroupSettingsToggles(data.settings, data.self.role);
    } else {
      if (groupAccordion) groupAccordion.classList.add("hidden");
      if (notesAccordion) notesAccordion.classList.add("hidden");
      
      if (manageGroupBtn) manageGroupBtn.classList.add("hidden");
      if (addMemberBtn) addMemberBtn.classList.add("hidden");
      
      // Äiá»u chá»‰nh layout thÃ nh grid-cols-2 cÃ¢n Ä‘á»‘i cho 2 nÃºt cÃ²n láº¡i (Táº¯t bÃ¡o vÃ  Ghim)
      if (quickActionsContainer) {
        quickActionsContainer.className = "grid grid-cols-2 gap-4 text-center py-2 select-none px-4";
      }

      const triggerRenameBtn = document.getElementById("btn-trigger-rename");
      if (triggerRenameBtn) triggerRenameBtn.classList.add("hidden");
      const editGroupProfileBtn = document.getElementById("btn-edit-group-profile");
      if (editGroupProfileBtn) editGroupProfileBtn.classList.add("hidden");

      if (data.settings.name === 'Cloud cá»§a tÃ´i') {
        if (cloudCard) cloudCard.classList.remove("hidden");
        const cloudUsageBar = document.getElementById("cloud-usage-bar");
        if (cloudUsageBar) cloudUsageBar.style.width = "4.2%";
        const cloudUsageText = document.getElementById("cloud-usage-text");
        if (cloudUsageText) cloudUsageText.textContent = "ÄÃ£ dÃ¹ng 128.5 GB / 3.0 TB";
      } else {
        if (cloudCard) cloudCard.classList.add("hidden");
      }
    }
  });
}

function updateQuickActionsUI(selfSettings) {
  const muteBtn = document.getElementById("btn-info-mute");
  if (muteBtn) {
    if (selfSettings.is_muted) {
      const div = muteBtn.querySelector("div");
      if (div) div.className = "w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center text-sm shadow-sm";
      const icon = muteBtn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-bell-slash";
      const span = muteBtn.querySelector("span");
      if (span) span.textContent = "Báº­t bÃ¡o";
    } else {
      const div = muteBtn.querySelector("div");
      if (div) div.className = "w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm";
      const icon = muteBtn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-bell";
      const span = muteBtn.querySelector("span");
      if (span) span.textContent = "Táº¯t bÃ¡o";
    }
  }

  const pinBtn = document.getElementById("btn-info-pin-room");
  if (pinBtn) {
    if (selfSettings.is_pinned) {
      const div = pinBtn.querySelector("div");
      if (div) div.className = "w-10 h-10 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center text-sm shadow-sm";
      const icon = pinBtn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-thumbtack transform rotate-45";
      const span = pinBtn.querySelector("span");
      if (span) span.textContent = "Bá» ghim";
    } else {
      const div = pinBtn.querySelector("div");
      if (div) div.className = "w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm";
      const icon = pinBtn.querySelector("i");
      if (icon) icon.className = "fa-solid fa-thumbtack";
      const span = pinBtn.querySelector("span");
      if (span) span.textContent = "Ghim";
    }
  }
}

function updateSendMessageInputPermission(settings, role) {
  const inputField = document.getElementById("chat-input-field");
  const form = document.getElementById("chat-input-form");
  const sendBtn = form ? form.querySelector("button[type='submit']") : null;
  if (!inputField || !sendBtn) return;
  
  if (settings.is_group) {
    const isStaff = role === 'admin' || role === 'co-leader';
    if (!settings.group_allow_send_message && !isStaff) {
      inputField.disabled = true;
      inputField.placeholder = "Chá»‰ TrÆ°á»Ÿng/PhÃ³ nhÃ³m má»›i Ä‘Æ°á»£c gá»­i tin nháº¯n trong nhÃ³m nÃ y";
      sendBtn.disabled = true;
      sendBtn.className = "bg-slate-300 text-slate-500 w-10 h-10 rounded-xl flex items-center justify-center shadow-none cursor-not-allowed shrink-0";
    } else {
      inputField.disabled = false;
      inputField.placeholder = "Nháº­p tin nháº¯n...";
      sendBtn.disabled = false;
      sendBtn.className = "bg-zalo-primary hover:bg-zalo-hover text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-md transition-colors shrink-0";
    }
  } else {
    inputField.disabled = false;
    inputField.placeholder = "Nháº­p tin nháº¯n...";
    sendBtn.disabled = false;
    sendBtn.className = "bg-zalo-primary hover:bg-zalo-hover text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-md transition-colors shrink-0";
  }
}

function renderGroupMembers(members, settings) {
  const container = document.getElementById("group-members-list");
  if (!container) return;
  container.innerHTML = "";

  members.forEach(m => {
    const avatar = m.avatar_url || "/logo.png";
    let roleBadge = "";
    if (m.role === 'admin') {
      roleBadge = `<span class="bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full select-none shrink-0 border border-red-200">TrÆ°á»Ÿng nhÃ³m</span>`;
    } else if (m.role === 'co-leader') {
      roleBadge = `<span class="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full select-none shrink-0 border border-blue-200">PhÃ³ nhÃ³m</span>`;
    }

    const isActiveUserCreator = settings.creator_id == currentUser.id;
    const isTargetCurrentUser = m.user_id == currentUser.id;

    const activeUserRole = members.find(x => x.user_id == currentUser.id)?.role || 'member';
    const canKick = (activeUserRole === 'admin' || (activeUserRole === 'co-leader' && m.role !== 'admin')) && !isTargetCurrentUser;

    const kickBtn = canKick 
      ? `<button onclick="kickGroupMember(${m.user_id}, '${m.display_name}')" class="text-slate-300 hover:text-red-500 p-1 shrink-0 transition-colors" title="Má»i ra khá»i nhÃ³m"><i class="fa-solid fa-user-minus text-xs"></i></button>`
      : '';

    const canTransferOwner = isActiveUserCreator && !isTargetCurrentUser;
    const transferBtn = canTransferOwner
      ? `<button onclick="transferGroupOwner(${m.user_id}, '${m.display_name}')" class="text-slate-300 hover:text-amber-500 p-1 shrink-0 transition-colors" title="Chuyá»ƒn quyá»n TrÆ°á»Ÿng nhÃ³m"><i class="fa-solid fa-crown text-xs"></i></button>`
      : '';

    const div = document.createElement("div");
    div.className = "flex items-center justify-between gap-2.5 p-1.5 hover:bg-slate-50 rounded-lg select-none";
    div.innerHTML = `
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div class="relative shrink-0">
          <img src="${avatar}" class="w-8 h-8 rounded-full object-cover border border-slate-100">
          <span class="absolute bottom-0 right-0 w-2.5 h-2.5 ${m.is_online ? 'bg-green-500' : 'bg-slate-300'} border-2 border-white rounded-full"></span>
        </div>
        <span class="text-xs font-bold text-slate-700 truncate">${m.display_name}</span>
        ${roleBadge}
      </div>
      <div class="flex items-center gap-1.5">
        ${transferBtn}
        ${kickBtn}
      </div>
    `;
    container.appendChild(div);
  });
}

window.kickGroupMember = function(userId, displayName) {
  if (confirm(`Báº¡n cháº¯c cháº¯n muá»‘n má»i ${displayName} ra khá»i nhÃ³m nÃ y?`)) {
    fetch(`/api/rooms/${activeRoomId}/members/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) alert(data.error);
      else loadGroupDetails(activeRoomId);
    });
  }
};

window.transferGroupOwner = function(newOwnerId, newOwnerName) {
  if (confirm(`âš ï¸ Báº¡n Ä‘ang thá»±c hiá»‡n chuyá»ƒn giao quyá»n TRÆ¯á»žNG NHÃ“M cho [${newOwnerName}]. Sau khi Ä‘á»“ng Ã½, tÃ i khoáº£n cá»§a báº¡n sáº½ trá»Ÿ thÃ nh thÃ nh viÃªn thÆ°á»ng. XÃ¡c nháº­n?`)) {
    fetch(`/api/rooms/${activeRoomId}/transfer-owner`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem("alonha_token")}`
      },
      body: JSON.stringify({ new_owner_id: newOwnerId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) alert(data.error);
      else {
        alert(`BÃ n giao quyá»n TrÆ°á»Ÿng nhÃ³m thÃ nh cÃ´ng cho [${newOwnerName}]!`);
        loadGroupDetails(activeRoomId);
      }
    })
    .catch(() => alert("Gáº·p sá»± cá»‘ khi thá»±c hiá»‡n chuyá»ƒn quyá»n trÆ°á»Ÿng nhÃ³m."));
  }
};

function syncGroupSettingsToggles(settings, role) {
  const isCreator = settings.creator_id == currentUser.id;

  const lockedBanner = document.getElementById("manage-group-locked-banner");
  if (lockedBanner) {
    if (isCreator) lockedBanner.classList.add("hidden");
    else lockedBanner.classList.remove("hidden");
  }

  const t_profile = document.getElementById("opt-allow-edit-profile");
  const t_pin = document.getElementById("opt-allow-pin");
  const t_note = document.getElementById("opt-allow-note");
  const t_poll = document.getElementById("opt-allow-poll");
  const t_send_msg = document.getElementById("opt-allow-send-message");
  const t_approval = document.getElementById("opt-approval-mode");
  const t_mark_admin = document.getElementById("opt-mark-admin-messages");
  const t_read_recent = document.getElementById("opt-allow-new-members-read-recent");
  const t_join_link = document.getElementById("opt-allow-join-via-link");
  const t_moderation = document.getElementById("opt-moderation-mode");

  if (t_profile) t_profile.checked = settings.group_allow_edit_profile;
  if (t_pin) t_pin.checked = settings.group_allow_pin;
  if (t_note) t_note.checked = settings.group_allow_note;
  if (t_poll) t_poll.checked = settings.group_allow_poll;
  if (t_send_msg) t_send_msg.checked = settings.group_allow_send_message;
  if (t_approval) t_approval.checked = settings.group_approval_mode;
  if (t_mark_admin) t_mark_admin.checked = settings.group_mark_admin_messages;
  if (t_read_recent) t_read_recent.checked = settings.group_allow_new_members_read_recent;
  if (t_join_link) t_join_link.checked = settings.group_allow_join_via_link;
  if (t_moderation) t_moderation.checked = settings.group_moderation_mode;

  [t_profile, t_pin, t_note, t_poll, t_send_msg, t_approval, t_mark_admin, t_read_recent, t_join_link, t_moderation].forEach(cb => {
    if (cb) {
      cb.disabled = !isCreator;
      const parentContainer = cb.closest('.flex');
      if (parentContainer) {
        if (!isCreator) parentContainer.classList.add("opacity-50", "pointer-events-none");
        else parentContainer.classList.remove("opacity-50", "pointer-events-none");
      }
    }
  });

  const dissolveBtn = document.getElementById("btn-group-dissolve");
  const leaveBtn = document.getElementById("btn-group-leave");
  
  if (dissolveBtn) {
    if (isCreator) dissolveBtn.classList.remove("hidden");
    else dissolveBtn.classList.add("hidden");
  }
  if (leaveBtn) {
    if (isCreator) leaveBtn.classList.add("hidden");
    else leaveBtn.classList.remove("hidden");
  }
}

function saveGroupSettingsToServer() {
  if (!activeRoomSettings || activeRoomSettings.creator_id != currentUser.id) return;

  const t_profile = document.getElementById("opt-allow-edit-profile");
  const t_pin = document.getElementById("opt-allow-pin");
  const t_note = document.getElementById("opt-allow-note");
  const t_poll = document.getElementById("opt-allow-poll");
  const t_send_msg = document.getElementById("opt-allow-send-message");
  const t_approval = document.getElementById("opt-approval-mode");
  const t_mark_admin = document.getElementById("opt-mark-admin-messages");
  const t_read_recent = document.getElementById("opt-allow-new-members-read-recent");
  const t_join_link = document.getElementById("opt-allow-join-via-link");
  const t_moderation = document.getElementById("opt-moderation-mode");
  const payload = {
    group_allow_edit_profile: t_profile ? t_profile.checked : true,
    group_allow_pin: t_pin ? t_pin.checked : true,
    group_allow_note: t_note ? t_note.checked : true,
    group_allow_poll: t_poll ? t_poll.checked : true,
    group_allow_send_message: t_send_msg ? t_send_msg.checked : true,
    group_approval_mode: t_approval ? t_approval.checked : false,
    group_mark_admin_messages: t_mark_admin ? t_mark_admin.checked : true,
    group_allow_new_members_read_recent: t_read_recent ? t_read_recent.checked : true,
    group_allow_join_via_link: t_join_link ? t_join_link.checked : true,
    group_moderation_mode: t_moderation ? t_moderation.checked : false
  };

  fetch(`/api/rooms/${activeRoomId}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) alert(data.error);
  });
}

// 9. PINS
function loadPins(roomId) {
  fetch(`/api/rooms/${roomId}/pins`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(pins => {
    currentPins = pins || [];
    const banner = document.getElementById("pinned-messages-banner");

    if (banner) {
      if (currentPins.length > 0) {
        banner.classList.remove("hidden");
        currentPinIndex = 0;
        renderPinBanner();
      } else {
        banner.classList.add("hidden");
      }
    }
  });
}

function renderPinBanner() {
  const pin = currentPins[currentPinIndex];
  if (!pin) return;

  const text = pin.message_text || `[TÃ i liá»‡u] ${pin.file_name}`;
  const preview = document.getElementById("pinned-msg-preview");
  if (preview) preview.textContent = `${pin.display_name}: ${text}`;
  const badgeIndex = document.getElementById("pin-banner-index");
  if (badgeIndex) badgeIndex.textContent = `${currentPinIndex + 1}/${currentPins.length}`;
}

const btnPinPrev = document.getElementById("btn-pin-prev");
if (btnPinPrev) {
  btnPinPrev.onclick = (e) => {
    e.stopPropagation();
    if (currentPinIndex > 0) {
      currentPinIndex--;
      renderPinBanner();
    }
  };
}

const btnPinNext = document.getElementById("btn-pin-next");
if (btnPinNext) {
  btnPinNext.onclick = (e) => {
    e.stopPropagation();
    if (currentPinIndex < currentPins.length - 1) {
      currentPinIndex++;
      renderPinBanner();
    }
  };
}

const btnUnpinCurrent = document.getElementById("btn-unpin-current");
if (btnUnpinCurrent) {
  btnUnpinCurrent.onclick = (e) => {
    e.stopPropagation();
    if (currentPins.length === 0) return;
    const pin = currentPins[currentPinIndex];
    fetch(`/api/rooms/${activeRoomId}/pins/${pin.message_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
    })
    .then(() => {
      loadPins(activeRoomId);
    });
  };
}

const btnViewAllPins = document.getElementById("btn-view-all-pins");
if (btnViewAllPins) {
  btnViewAllPins.onclick = () => {
    if (currentPins.length === 0) return;
    const pin = currentPins[currentPinIndex];
    const el = document.getElementById(`msg-${pin.message_id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add("bg-yellow-100/60", "p-2.5", "rounded-xl", "transition-all", "duration-500");
      setTimeout(() => el.classList.remove("bg-yellow-100/60"), 2500);
    } else {
      alert("Tin nháº¯n ghim nÃ y quÃ¡ cÅ© Ä‘á»ƒ hiá»ƒn thá»‹ trÃªn mÃ n hÃ¬nh hiá»‡n táº¡i.");
    }
  };
}

// 10. RESOURCES
function loadResources(roomId) {
  fetch(`/api/rooms/${roomId}/resources`, {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(resData => {
    const grid = document.getElementById("media-grid");
    const flist = document.getElementById("file-list");
    const llist = document.getElementById("link-list");

    if (grid) grid.innerHTML = "";
    if (flist) flist.innerHTML = "";
    if (llist) llist.innerHTML = "";

    const noMediaText = document.getElementById("no-media-text");
    if (resData.media.length > 0) {
      if (noMediaText) noMediaText.classList.add("hidden");
      resData.media.forEach(m => {
        const img = document.createElement("img");
        const localUrl = getLocalFileUrl(m.file_url);
        img.src = localUrl;
        img.className = "w-full aspect-square object-cover rounded-lg border cursor-pointer hover:opacity-90";
        img.onclick = () => window.open(localUrl, '_blank');
        if (grid) grid.appendChild(img);
      });
    } else {
      if (noMediaText) noMediaText.classList.remove("hidden");
    }

    const noFilesText = document.getElementById("no-files-text");
    if (resData.files.length > 0) {
      if (noFilesText) noFilesText.classList.add("hidden");
      resData.files.forEach(f => {
        const div = document.createElement("div");
        div.className = "flex items-center space-x-2 text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100";
        div.innerHTML = `
          <i class="fa-solid fa-file-pdf text-red-500 shrink-0 text-base"></i>
          <div class="min-w-0 flex-1">
            <p class="font-bold truncate select-all">${f.file_name}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${f.file_size}</p>
          </div>
          <a href="${getLocalFileUrl(f.file_url)}" target="_blank" class="text-blue-500 hover:underline shrink-0"><i class="fa-solid fa-download"></i></a>
        `;
        if (flist) flist.appendChild(div);
      });
    } else {
      if (noFilesText) noFilesText.classList.remove("hidden");
    }

    const noLinksText = document.getElementById("no-links-text");
    if (resData.links.length > 0) {
      if (noLinksText) noLinksText.classList.add("hidden");
      resData.links.forEach(l => {
        const div = document.createElement("div");
        div.className = "truncate py-1 border-b border-slate-50 text-xs";
        div.innerHTML = `<a href="${l.url}" target="_blank" class="text-blue-600 hover:underline font-semibold">${l.url}</a>`;
        if (llist) llist.appendChild(div);
      });
    } else {
      if (noLinksText) noLinksText.classList.remove("hidden");
    }
  });
}

// 11. INACTIVITY
function setupInactivityTimer() {
  const events = ['mousemove', 'keypress', 'mousedown', 'touchstart'];
  events.forEach(e => document.addEventListener(e, resetInactivityTimer));
  resetInactivityTimer();
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!currentUser || !currentUser.pin_timeout) return;

  inactivityTimer = setTimeout(() => {
    triggerLockScreen();
  }, currentUser.pin_timeout * 60 * 1000);
}

function triggerLockScreen() {
  unlockedRooms.clear();
  if (activeRoomId) {
    tempRoomToUnlock = activeRoomId;
    activeRoomId = null;
    const welcomeBanner = document.getElementById("welcome-banner");
    if (welcomeBanner) welcomeBanner.classList.remove("hidden");
    const chatAreaContainer = document.getElementById("chat-area-container");
    if (chatAreaContainer) chatAreaContainer.classList.add("hidden");
  }
  openPinLockOverlay();
}

// 12. JOIN VIA LINK
function parseJoinLinkQuery() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("join");
  if (!code) return;

  window.history.replaceState({}, document.title, window.location.pathname);

  const token = localStorage.getItem("alonha_token");
  if (!token) {
    localStorage.setItem("alonha_pending_join_code", code);
    return;
  }

  fetch(`/api/rooms/by-link/${code}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(res => res.json())
  .then(group => {
    if (group.error) {
      alert(group.error);
      return;
    }
    const groupNameEl = document.getElementById("confirm-join-group-name");
    if (groupNameEl) groupNameEl.textContent = group.name;
    const memberCountEl = document.getElementById("confirm-join-member-count");
    if (memberCountEl) memberCountEl.textContent = group.member_count;
    const avatarEl = document.getElementById("confirm-join-avatar");
    if (avatarEl) avatarEl.src = group.avatar_url || "/logo.png";
    const modal = document.getElementById("confirm-join-modal");
    if (modal) modal.classList.remove("hidden");

    const submitBtn = document.getElementById("btn-submit-confirm-join");
    if (submitBtn) {
      submitBtn.onclick = () => {
        fetch(`/api/rooms/join/${code}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
          if (modal) modal.classList.add("hidden");
          if (data.error) alert(data.error);
          else {
            loadRooms().then(() => {
              handleRoomSelection(data.room_id);
            });
          }
        });
      };
    }
  });
}

// 13. WebRTC HD VIDEO CALLS
async function startWebRTCCall(roomId, callerMode) {
  if (isCallConnecting) {
    console.warn("âš ï¸ [WebRTC] Cuá»™c gá»i Ä‘ang Ä‘Æ°á»£c káº¿t ná»‘i song song, cháº·n chá»“ng chÃ©o.");
    while (isCallConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  isCallConnecting = true;

  try {
    try {
    // Thá»­ láº¥y cáº£ video vÃ  audio trÆ°á»›c
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (firstErr) {
    console.warn("âš ï¸ [WebRTC] KhÃ´ng láº¥y Ä‘Æ°á»£c video, tá»± Ä‘á»™ng chuyá»ƒn sang gá»i thoáº¡i:", firstErr.message);
    try {
      // Fallback: chá»‰ láº¥y audio, váº«n tiáº¿p tá»¥c cuá»™c gá»i
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // ThÃ´ng bÃ¡o nháº¹ cho ngÆ°á»i dÃ¹ng
      console.log("â„¹ï¸ [WebRTC] Äang thá»±c hiá»‡n cuá»™c gá»i thoáº¡i (khÃ´ng cÃ³ camera)");
      // Cáº­p nháº­t UI Ä‘á»ƒ thÃ´ng bÃ¡o khÃ´ng cÃ³ camera
      const callStatusText = document.getElementById("call-status-text");
      if (callStatusText) callStatusText.textContent = "Äang gá»i thoáº¡i (khÃ´ng cÃ³ camera)";
      // áº¨n/táº¯t nÃºt camera
      const camBtn = document.getElementById("btn-call-toggle-cam");
      if (camBtn) {
        camBtn.className = "w-14 h-14 rounded-full bg-slate-600 text-white flex items-center justify-center shadow-lg transition-all opacity-50 cursor-not-allowed";
        camBtn.innerHTML = '<i class="fa-solid fa-video-slash text-lg"></i>';
        camBtn.disabled = true;
      }
    } catch (secondErr) {
      console.warn("âš ï¸ [WebRTC] KhÃ´ng láº¥y Ä‘Æ°á»£c audio:", secondErr.message);
      // Thá»­ chá»‰ láº¥y video náº¿u audio cÅ©ng khÃ´ng Ä‘Æ°á»£c
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (thirdErr) {
        // KhÃ´ng cÃ³ thiáº¿t bá»‹ nÃ o, bÃ¡o lá»—i nhÆ°ng khÃ´ng ngáº¯t - váº«n thá»­ káº¿t ná»‘i
        console.error("âŒ [WebRTC] KhÃ´ng cÃ³ thiáº¿t bá»‹ thu/phÃ¡t nÃ o:", thirdErr.message);
        throw thirdErr;
      }
    }
  }
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.classList.remove("hidden");
    }
    
    isMicMuted = false;
    isCamOff = false;
    resetCallControlButtonsUI();

    if (localVideo) {
      await localVideo.play().catch(err => console.warn("Lá»—i phÃ¡t video local:", err));
    }

    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("webrtc_signal", { room_id: roomId, signal: { candidate: e.candidate }, sender_id: currentUser.id });
      }
    };

    peerConnection.ontrack = (e) => {
      console.log("âš¡ [WebRTC] Nháº­n Ä‘Æ°á»£c remote track!");
      const remoteVideo = document.getElementById("remote-video");
      if (remoteVideo) {
        if (e.streams && e.streams[0]) {
          remoteVideo.srcObject = e.streams[0];
        } else {
          if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
          }
          remoteStream.addTrack(e.track);
        }
        
        remoteVideo.play().catch(err => console.warn("Lá»—i náº¡p remote video:", err));
      }
      const statusOverlay = document.getElementById("call-status-overlay");
      if (statusOverlay) statusOverlay.classList.add("hidden");
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log("âš¡ [WebRTC] ICE Connection State:", state);
      if (state === "connected" || state === "completed") {
        const statusOverlay = document.getElementById("call-status-overlay");
        if (statusOverlay) statusOverlay.classList.add("hidden");
        const statusText = document.getElementById("call-status-text");
        if (statusText) statusText.textContent = "ÄÃ£ káº¿t ná»‘i - Äang gá»i...";
      } else if (state === "failed" || state === "disconnected") {
        console.warn("âš ï¸ [WebRTC] Máº¥t káº¿t ná»‘i ICE, cá»‘ gáº¯ng khÃ´i phá»¥c...");
        const statusText = document.getElementById("call-status-text");
        if (statusText) statusText.textContent = "Äang khÃ´i phá»¥c káº¿t ná»‘i...";
      }
    };

    if (callerMode) {
      console.log("âš¡ [WebRTC] Äang táº¡o SDP Offer...");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit("webrtc_signal", { room_id: roomId, signal: { sdp: peerConnection.localDescription }, sender_id: currentUser.id });
    }

  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
    alert("Báº¡n Ä‘Ã£ tá»« chá»‘i quyá»n truy cáº­p Camera/Micro. Vui lÃ²ng cho phÃ©p trong cÃ i Ä‘áº·t trÃ¬nh duyá»‡t.");
  } else if (err.name === "NotFoundError") {
    alert("KhÃ´ng tÃ¬m tháº¥y thiáº¿t bá»‹ Camera/Micro nÃ o trÃªn mÃ¡y tÃ­nh nÃ y.");
  } else if (err.name === "NotReadableError") {
    alert("Camera/Micro Ä‘ang bá»‹ á»©ng dá»¥ng khÃ¡c sá»­ dá»¥ng. Vui lÃ²ng Ä‘Ã³ng á»©ng dá»¥ng Ä‘Ã³ láº¡i.");
  } else {
    alert("KhÃ´ng thá»ƒ káº¿t ná»‘i thiáº¿t bá»‹ thu/phÃ¡t. Lá»—i: " + err.message + "\n\nMáº¹o: HÃ£y Ä‘áº£m báº£o báº¡n Ä‘ang dÃ¹ng HTTPS (localhost cÅ©ng Ä‘Æ°á»£c) vÃ  cáº¥p quyá»n Camera/Micro.");
  }
    console.error("Lá»—i WebRTC getUserMedia:", err);
    closeCallOverlay();
  } finally {
    isCallConnecting = false;
  }
}

function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMicMuted = !isMicMuted;
      audioTrack.enabled = !isMicMuted;
      
      const btn = document.getElementById("btn-call-toggle-mic");
      if (btn) {
        if (isMicMuted) {
          btn.className = "w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-all";
          btn.innerHTML = '<i class="fa-solid fa-microphone-slash text-lg"></i>';
        } else {
          btn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg transition-all";
          btn.innerHTML = '<i class="fa-solid fa-microphone text-lg"></i>';
        }
      }
    }
  }
}

function toggleCam() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isCamOff = !isCamOff;
      videoTrack.enabled = !isCamOff;
      
      const btn = document.getElementById("btn-call-toggle-cam");
      if (btn) {
        if (isCamOff) {
          btn.className = "w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-all";
          btn.innerHTML = '<i class="fa-solid fa-video-slash text-lg"></i>';
        } else {
          btn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg transition-all";
          btn.innerHTML = '<i class="fa-solid fa-video text-lg"></i>';
        }
      }
    }
  }
}

let isScreenSharing = false;
let screenStream = null;

async function toggleScreenShare() {
  const btn = document.getElementById("btn-call-screen-share");
  
  if (isScreenSharing) {
    // Dá»«ng chia sáº» mÃ n hÃ¬nh
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    isScreenSharing = false;
    
    // Báº­t láº¡i camera náº¿u Ä‘ang táº¯t
    if (localStream && peerConnection) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        // Gá»¡ track screen cÅ©, thay báº±ng track camera
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      }
    }
    
    if (btn) {
      btn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg transition-all";
      btn.innerHTML = '<i class="fa-solid fa-display text-lg"></i>';
      btn.title = "Chia sáº» mÃ n hÃ¬nh";
    }
    return;
  }
  
  try {
    // YÃªu cáº§u quyá»n chia sáº» mÃ n hÃ¬nh
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "always",
        displaySurface: "monitor"
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100
      }
    });
    
    isScreenSharing = true;
    
    // Thay tháº¿ video track trÃªn peer connection
    if (peerConnection) {
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        const newSender = peerConnection.addTrack(screenTrack, screenStream);
      }
      // QUAN TRá»ŒNG: Gá»­i láº¡i SDP Ä‘á»ƒ Ä‘á»“ng bá»™ track má»›i vá»›i Ä‘á»‘i tÃ¡c
      peerConnection.onnegotiationneeded = async () => {
        try {
          await peerConnection.setLocalDescription(await peerConnection.createOffer());
          socket.emit("webrtc_signal", { room_id: activeRoomId, signal: { sdp: peerConnection.localDescription }, sender_id: currentUser.id });
        } catch (e) {
          console.warn("âš ï¸ [ScreenShare] negotiation error:", e);
        }
      };
      // KÃ­ch hoáº¡t negotiation
      setTimeout(() => {
        if (peerConnection) {
          peerConnection.onnegotiationneeded(null);
        }
      }, 100);
    }
    
    // Hiá»ƒn thá»‹ mÃ n hÃ¬nh Ä‘ang chia sáº» lÃªn local video
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = screenStream;
      await localVideo.play().catch(err => console.warn("Lá»—i phÃ¡t screen share:", err));
    }
    
    // Xá»­ lÃ½ khi ngÆ°á»i dÃ¹ng dá»«ng chia sáº» tá»« trÃ¬nh duyá»‡t
    screenStream.getVideoTracks()[0].onended = async () => {
      isScreenSharing = false;
      screenStream = null;
      
      // KhÃ´i phá»¥c camera
      if (localStream && peerConnection) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            await sender.replaceTrack(videoTrack);
          }
        }
        const localVideo = document.getElementById("local-video");
        if (localVideo) {
          localVideo.srcObject = localStream;
          await localVideo.play().catch(err => console.warn("Lá»—i khÃ´i phá»¥c local video:", err));
        }
        
        // Gá»­i láº¡i SDP Ä‘á»ƒ Ä‘á»“ng bá»™ track camera vá»›i Ä‘á»‘i tÃ¡c
        if (peerConnection) {
          try {
            peerConnection.onnegotiationneeded = async () => {
              await peerConnection.setLocalDescription(await peerConnection.createOffer());
              socket.emit("webrtc_signal", { room_id: activeRoomId, signal: { sdp: peerConnection.localDescription }, sender_id: currentUser.id });
            };
            setTimeout(() => {
              if (peerConnection) peerConnection.onnegotiationneeded(null);
            }, 100);
          } catch (e) {
            console.warn("âš ï¸ [ScreenShare] negotiation error on stop:", e);
          }
        }
      }
      
      if (btn) {
        btn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg transition-all";
        btn.innerHTML = '<i class="fa-solid fa-display text-lg"></i>';
        btn.title = "Chia sáº» mÃ n hÃ¬nh";
      }
    };
    
    // Cáº­p nháº­t UI
    if (btn) {
      btn.className = "w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg transition-all";
      btn.innerHTML = '<i class="fa-solid fa-stop-circle text-lg"></i>';
      btn.title = "Dá»«ng chia sáº» mÃ n hÃ¬nh";
    }
    
  } catch (err) {
    console.error("âŒ Lá»—i chia sáº» mÃ n hÃ¬nh:", err);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      alert("Báº¡n Ä‘Ã£ tá»« chá»‘i quyá»n chia sáº» mÃ n hÃ¬nh. Vui lÃ²ng cho phÃ©p Ä‘á»ƒ sá»­ dá»¥ng tÃ­nh nÄƒng nÃ y.");
    } else if (err.name === "NotSupportedError") {
      alert("TrÃ¬nh duyá»‡t cá»§a báº¡n khÃ´ng há»— trá»£ chia sáº» mÃ n hÃ¬nh. Vui lÃ²ng sá»­ dá»¥ng Chrome, Edge hoáº·c Firefox má»›i nháº¥t.");
    }
    isScreenSharing = false;
    screenStream = null;
  }
}

function resetCallControlButtonsUI() {
  const micBtn = document.getElementById("btn-call-toggle-mic");
  if (micBtn) {
    micBtn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg transition-all";
    micBtn.innerHTML = '<i class="fa-solid fa-microphone text-lg"></i>';
  }

  const camBtn = document.getElementById("btn-call-toggle-cam");
  if (camBtn) {
    camBtn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-lg transition-all";
    camBtn.innerHTML = '<i class="fa-solid fa-video text-lg"></i>';
  }
}

function showIncomingCallOverlay(data) {
  const callerNameEl = document.getElementById("incoming-caller-name");
  if (callerNameEl) callerNameEl.textContent = data.caller_name;
  const callerAvatarEl = document.getElementById("incoming-caller-avatar");
  if (callerAvatarEl) callerAvatarEl.src = data.caller_avatar || "/logo.png";
  const callTypeEl = document.getElementById("incoming-call-type");
  if (callTypeEl) callTypeEl.innerHTML = `<i class="fa-solid fa-phone mr-1"></i> Cuá»™c gá»i báº£o máº­t Ä‘ang Ä‘áº¿n...`;
  const incomingCallOverlay = document.getElementById("incoming-call-overlay");
  if (incomingCallOverlay) incomingCallOverlay.classList.remove("hidden");

  const acceptBtn = document.getElementById("btn-incoming-accept");
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      if (incomingCallOverlay) incomingCallOverlay.classList.add("hidden");
      showCallFrame(data.caller_name, data.caller_avatar);
      try {
        await startWebRTCCall(data.room_id, false);
        socket.emit("call_accept", { room_id: data.room_id });
      } catch (e) {
        closeCallOverlay();
      }
    };
  }

  const rejectBtn = document.getElementById("btn-incoming-reject");
  if (rejectBtn) {
    rejectBtn.onclick = () => {
      socket.emit("call_reject", { room_id: data.room_id });
      if (incomingCallOverlay) incomingCallOverlay.classList.add("hidden");
    };
  }
}

function showCallFrame(name, avatar) {
  const callStatusName = document.getElementById("call-status-name");
  if (callStatusName) callStatusName.textContent = name;
  const callStatusAvatar = document.getElementById("call-status-avatar");
  if (callStatusAvatar) callStatusAvatar.src = avatar || "/logo.png";
  const callStatusText = document.getElementById("call-status-text");
  if (callStatusText) callStatusText.textContent = "Äang káº¿t ná»‘i cuá»™c gá»i báº£o máº­t...";
  
  const statusOverlay = document.getElementById("call-status-overlay");
  if (statusOverlay) statusOverlay.classList.remove("hidden");
  const callModal = document.getElementById("call-modal");
  if (callModal) callModal.classList.remove("hidden");
  
  // GÃ¡n event listener cho nÃºt chia sáº» mÃ n hÃ¬nh
  const screenShareBtn = document.getElementById("btn-call-screen-share");
  if (screenShareBtn) {
    screenShareBtn.onclick = toggleScreenShare;
    // Reset vá» tráº¡ng thÃ¡i ban Ä‘áº§u
    isScreenSharing = false;
    screenStream = null;
    // Kiá»ƒm tra há»— trá»£ getDisplayMedia
    const hasScreenShareAPI = typeof navigator.mediaDevices !== 'undefined' && typeof navigator.mediaDevices.getDisplayMedia === 'function';
    if (hasScreenShareAPI) {
      screenShareBtn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg transition-all";
      screenShareBtn.innerHTML = '<i class="fa-solid fa-display text-lg"></i>';
      screenShareBtn.title = "Chia sáº» mÃ n hÃ¬nh";
      screenShareBtn.classList.remove("hidden");
    } else {
      // TrÃªn mobile: váº«n hiá»‡n nÃºt nhÆ°ng sáº½ thÃ´ng bÃ¡o khi báº¥m
      screenShareBtn.className = "w-14 h-14 rounded-full bg-slate-800 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg transition-all";
      screenShareBtn.innerHTML = '<i class="fa-solid fa-display text-lg"></i>';
      screenShareBtn.title = "Chia sáº» mÃ n hÃ¬nh (chá»‰ kháº£ dá»¥ng trÃªn mÃ¡y tÃ­nh)";
      screenShareBtn.classList.remove("hidden");
      // Override onclick Ä‘á»ƒ thÃ´ng bÃ¡o
      screenShareBtn.onclick = function() {
        alert("Tinh nang chia se man hinh chi kha dung tren trinh duyet may tinh (Chrome, Edge, Firefox).\n\nTren dien thoai, ban co the chup anh man hinh va gui file anh vao nhom chat.");
      };
    }
  }
}

const btnVoiceCall = document.getElementById("btn-voice-call");
if (btnVoiceCall) {
  btnVoiceCall.onclick = () => {
    if (!activeRoomId) return;
    isCaller = true;
    triggerOutgoingCall("voice");
  };
}

const btnVideoCall = document.getElementById("btn-video-call");
if (btnVideoCall) {
  btnVideoCall.onclick = () => {
    if (!activeRoomId) return;
    isCaller = true;
    triggerOutgoingCall("video");
  };
}

function triggerOutgoingCall(type) {
  const room = roomsList.find(r => r.id == activeRoomId);
  const name = room ? room.name : "Äá»“ng nghiá»‡p";
  const avatar = room ? room.partner_avatar : "/logo.png";
  
  showCallFrame(name, avatar);
  const statusText = document.getElementById("call-status-text");
  if (statusText) statusText.textContent = "Äang káº¿t ná»‘i cuá»™c gá»i an toÃ n...";

  socket.emit("call_request", {
    room_id: activeRoomId,
    caller_id: currentUser.id,
    caller_name: currentUser.display_name,
    caller_avatar: currentUser.avatar_url,
    type: type
  });
}

const btnCallHangup = document.getElementById("btn-call-hangup");
if (btnCallHangup) {
  btnCallHangup.onclick = () => {
    if (activeRoomId) {
      socket.emit("call_hangup", { room_id: activeRoomId });
    }
    closeCallOverlay();
  };
}

function closeCallOverlay() {
  const callModal = document.getElementById("call-modal");
  if (callModal) callModal.classList.add("hidden");
  const statusOverlay = document.getElementById("call-status-overlay");
  if (statusOverlay) statusOverlay.classList.remove("hidden");
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  isScreenSharing = false;
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteStream = null;
  isCaller = false;
  isMicMuted = false;
  isCamOff = false;
  resetCallControlButtonsUI();
}

// =========================================================================
// ðŸ‘¥ TÃNH NÄ‚NG QUáº¢N LÃ DANH Báº  & Káº¾T Báº N TRá»°C QUAN (ZALO STANDARD)
// =========================================================================

function switchView(view) {
  currentActiveView = view;
  
  const chatTab = document.getElementById("tab-btn-chat");
  const contactsTab = document.getElementById("tab-btn-contacts");
  const cloudTab = document.getElementById("tab-btn-cloud");
  
  const roomsSidebar = document.getElementById("rooms-sidebar");
  const contactsSidebar = document.getElementById("contacts-sidebar");
  
  const chatArea = document.getElementById("chat-area-container");
  const welcomeBanner = document.getElementById("welcome-banner");
  const contactsMainPanel = document.getElementById("contacts-main-panel");
  const infoSidebar = document.getElementById("info-sidebar");
  
  [chatTab, contactsTab, cloudTab].forEach(btn => {
    if (btn) btn.className = "flex flex-col md:flex-row items-center justify-center p-3 rounded-xl transition-all text-slate-400 hover:bg-slate-800 md:w-12 md:h-12 relative";
  });
  
  if (view === 'chat') {
    if (chatTab) chatTab.className = "flex flex-col md:flex-row items-center justify-center p-3 rounded-xl transition-all text-white bg-slate-800 md:w-12 md:h-12 relative";
    
    if (roomsSidebar) roomsSidebar.classList.remove("hidden");
    if (contactsSidebar) contactsSidebar.classList.add("hidden");
    if (contactsMainPanel) contactsMainPanel.classList.add("hidden");
    
    if (activeRoomId) {
      if (chatArea) {
        chatArea.classList.remove("hidden");
        chatArea.classList.add("flex");
      }
      if (welcomeBanner) welcomeBanner.classList.add("hidden");
      if (window.innerWidth >= 1024 && infoSidebar) infoSidebar.classList.remove("hidden");
    } else {
      if (chatArea) chatArea.classList.add("hidden");
      if (welcomeBanner) welcomeBanner.classList.remove("hidden");
      if (infoSidebar) infoSidebar.classList.add("hidden");
    }
    loadRooms();
  } else if (view === 'contacts') {
    if (contactsTab) contactsTab.className = "flex flex-col md:flex-row items-center justify-center p-3 rounded-xl transition-all text-white bg-slate-800 md:w-12 md:h-12 relative";
    
    if (roomsSidebar) roomsSidebar.classList.add("hidden");
    if (contactsSidebar) contactsSidebar.classList.remove("hidden");
    
    if (chatArea) chatArea.classList.add("hidden");
    if (welcomeBanner) welcomeBanner.classList.add("hidden");
    if (infoSidebar) infoSidebar.classList.add("hidden");
    
    if (contactsMainPanel) {
      contactsMainPanel.classList.remove("hidden");
      contactsMainPanel.classList.add("flex");
    }
    
    switchContactsTab(currentContactsTab);
  }
}

function switchContactsTab(tab) {
  currentContactsTab = tab;
  
  const menuFriends = document.getElementById("contacts-menu-friends");
  const menuGroups = document.getElementById("contacts-menu-groups");
  const menuRequests = document.getElementById("contacts-menu-requests");
  const menuInvites = document.getElementById("contacts-menu-invites");
  
  const titleEl = document.getElementById("contacts-panel-title");
  
  if (window.innerWidth < 768) {
    const contactsSidebar = document.getElementById("contacts-sidebar");
    if (contactsSidebar) contactsSidebar.classList.add("hidden");
    const contactsMainPanel = document.getElementById("contacts-main-panel");
    if (contactsMainPanel) {
      contactsMainPanel.classList.remove("hidden");
      contactsMainPanel.classList.add("flex");
    }
  }

  [menuFriends, menuGroups, menuRequests, menuInvites].forEach(btn => {
    if (btn) btn.className = "w-full flex items-center gap-3 px-4 py-3.5 text-slate-600 hover:bg-slate-50 text-xs text-left border-t border-slate-50";
  });
  
  if (tab === 'friends') {
    if (menuFriends) menuFriends.className = "w-full flex items-center gap-3 px-4 py-3.5 bg-blue-50 text-zalo-primary font-bold text-xs text-left border-t border-slate-50";
    if (titleEl) titleEl.textContent = "Danh sÃ¡ch báº¡n bÃ¨";
    loadFriends();
  } else if (tab === 'groups') {
    if (menuGroups) menuGroups.className = "w-full flex items-center gap-3 px-4 py-3.5 bg-blue-50 text-zalo-primary font-bold text-xs text-left border-t border-slate-50";
    if (titleEl) titleEl.textContent = "Danh sÃ¡ch nhÃ³m";
    loadGroupRoomsView();
  } else if (tab === 'requests') {
    if (menuRequests) menuRequests.className = "w-full flex items-center justify-between px-4 py-3.5 bg-blue-50 text-zalo-primary font-bold text-xs text-left border-t border-slate-50 relative";
    if (titleEl) titleEl.textContent = "Lá»i má»i káº¿t báº¡n";
    loadFriendRequests();
  } else if (tab === 'invites') {
    if (menuInvites) menuInvites.className = "w-full flex items-center gap-3 px-4 py-3.5 bg-blue-50 text-zalo-primary font-bold text-xs text-left border-t border-slate-50";
    if (titleEl) titleEl.textContent = "Lá»i má»i vÃ o nhÃ³m";
    renderInvitesPlaceholder();
  }
}

function loadFriends() {
  fetch('/api/friends', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(friends => {
    allFriendsCached = friends || [];
    renderFriendsView(allFriendsCached);
  });
}

function renderFriendsView(friends) {
  const body = document.getElementById("contacts-panel-body");
  if (!body) return;
  body.className = "flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar bg-white";
  
  const totalCount = friends.length;
  
  let html = `
    <div class="max-w-4xl mx-auto space-y-6 select-none">
      <div>
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Báº¡n bÃ¨ (${totalCount})</h3>
      </div>
      
      <div class="flex flex-col sm:flex-row gap-3 items-center justify-between pb-4 border-b border-slate-100">
        <div class="relative w-full sm:w-80">
          <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            <i class="fa-solid fa-magnifying-glass text-xs"></i>
          </span>
          <input type="text" id="contact-search-friends" class="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-100 focus:outline-none focus:ring-1 focus:ring-zalo-primary text-xs" placeholder="TÃ¬m báº¡n">
        </div>
        
        <div class="flex gap-2 w-full sm:w-auto">
          <select id="contact-sort-friends" class="border border-slate-200 bg-white text-xs rounded-lg px-3 py-2 text-slate-600 focus:outline-none">
            <option value="name_asc">TÃªn (A-Z)</option>
            <option value="name_desc">TÃªn (Z-A)</option>
          </select>
          <select id="contact-filter-friends" class="border border-slate-200 bg-white text-xs rounded-lg px-3 py-2 text-slate-600 focus:outline-none">
            <option value="all">Táº¥t cáº£</option>
            <option value="online">Äang hoáº¡t Ä‘á»™ng</option>
          </select>
        </div>
      </div>
      
      <div id="friends-grouped-list" class="divide-y divide-slate-100">
      </div>
    </div>
  `;
  body.innerHTML = html;
  
  renderGroupedFriends(friends);
  
  const searchFriends = document.getElementById("contact-search-friends");
  if (searchFriends) searchFriends.addEventListener("input", filterFriendsList);
  const sortFriends = document.getElementById("contact-sort-friends");
  if (sortFriends) sortFriends.addEventListener("change", filterFriendsList);
  const filterFriends = document.getElementById("contact-filter-friends");
  if (filterFriends) filterFriends.addEventListener("change", filterFriendsList);
}

function removeVietnameseTones(str) {
  return str.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/Ä‘/g, "d").replace(/Ä/g, "D");
}

function renderGroupedFriends(list) {
  const container = document.getElementById("friends-grouped-list");
  if (!container) return;
  container.innerHTML = "";
  
  if (list.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs">ChÆ°a cÃ³ báº¡n bÃ¨ nÃ o. Báº¥m nÃºt ThÃªm báº¡n má»›i á»Ÿ gÃ³c trÃ¡i Ä‘á»ƒ káº¿t ná»‘i nhÃ©!</div>`;
    return;
  }
  
  const now = new Date();
  const newFriends = [];
  const restFriends = [];
  
  list.forEach(f => {
    const addedDate = new Date(f.created_at);
    const diffDays = (now - addedDate) / (1000 * 60 * 60 * 24);
    if (diffDays <= 3) {
      newFriends.push(f);
    } else {
      restFriends.push(f);
    }
  });
  
  if (newFriends.length > 0) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "pb-4";
    groupDiv.innerHTML = `<h4 class="text-xs font-bold text-blue-600 mb-2 mt-4 select-none">Báº¡n má»›i</h4>`;
    newFriends.forEach(f => {
      groupDiv.appendChild(createFriendRowHTML(f));
    });
    container.appendChild(groupDiv);
  }
  
  const groups = {};
  restFriends.forEach(f => {
    let firstChar = f.display_name.trim().charAt(0).toUpperCase();
    if (!/[A-Z]/.test(firstChar)) {
      firstChar = removeVietnameseTones(firstChar).charAt(0).toUpperCase();
    }
    if (!/[A-Z]/.test(firstChar)) {
      firstChar = "#";
    }
    if (!groups[firstChar]) groups[firstChar] = [];
    groups[firstChar].push(f);
  });
  
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
  
  sortedKeys.forEach(key => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "pb-4";
    groupDiv.innerHTML = `<h4 class="text-xs font-bold text-slate-400 mb-2 mt-4 select-none">${key}</h4>`;
    
    groups[key].sort((a, b) => a.display_name.localeCompare(b.display_name));
    groups[key].forEach(f => {
      groupDiv.appendChild(createFriendRowHTML(f));
    });
    container.appendChild(groupDiv);
  });
}

function createFriendRowHTML(f) {
  const div = document.createElement("div");
  div.className = "flex items-center justify-between py-3 px-2 hover:bg-slate-50 rounded-xl transition-all border-b border-slate-50/50";
  
  const avatar = f.avatar_url || "/logo.png";
  const onlineDot = f.is_online 
    ? `<span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>` 
    : `<span class="absolute bottom-0 right-0 w-3 h-3 bg-slate-300 border-2 border-white rounded-full"></span>`;
    
  div.innerHTML = `
    <div class="flex items-center gap-3.5 min-w-0">
      <div class="relative shrink-0 select-none">
        <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-slate-100 shadow-sm">
        ${onlineDot}
      </div>
      <div class="min-w-0">
        <h4 class="font-bold text-slate-800 text-sm truncate flex items-center gap-1.5">
          ${f.display_name}
        </h4>
        <p class="text-[10px] text-slate-400 font-bold">${f.is_online ? "Äang hoáº¡t Ä‘á»™ng" : "Ngoáº¡i tuyáº¿n"}</p>
      </div>
    </div>
    
    <div class="flex items-center gap-2 select-none">
      <button onclick="startFriendChat(${f.id}, '${f.display_name}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-blue-50 text-zalo-primary hover:bg-zalo-primary hover:text-white transition-all shadow-sm" title="Nháº¯n tin">
        <i class="fa-solid fa-comment-dots text-sm"></i>
      </button>
      <div class="relative inline-block group">
        <button class="w-9 h-9 flex items-center justify-center rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100 transition-all border border-slate-100">
          <i class="fa-solid fa-ellipsis-h text-xs"></i>
        </button>
        <div class="absolute right-0 top-10 w-40 bg-white border border-slate-100 shadow-xl rounded-xl py-1 hidden group-hover:block z-30 text-slate-700">
          <button onclick="unfriendUser(${f.id}, '${f.display_name}')" class="w-full text-left px-4 py-2.5 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2 font-bold">
            <i class="fa-solid fa-user-minus"></i> Há»§y káº¿t báº¡n
          </button>
        </div>
      </div>
    </div>
  `;
  return div;
}

window.startFriendChat = function(userId, partnerName) {
  switchView('chat');
  startOneToOneChat(userId, partnerName);
};

window.unfriendUser = function(friendId, name) {
  if (confirm(`Báº¡n cháº¯c cháº¯n muá»‘n há»§y káº¿t báº¡n vá»›i ${name}?`)) {
    fetch(`/api/friends/${friendId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) alert(data.error);
      else loadFriends();
    });
  }
};

function filterFriendsList() {
  const query = document.getElementById("contact-search-friends")?.value.toLowerCase().trim() || "";
  const sort = document.getElementById("contact-sort-friends")?.value || "name_asc";
  const filter = document.getElementById("contact-filter-friends")?.value || "all";
  
  let filtered = [...allFriendsCached];
  
  if (query) {
    filtered = filtered.filter(f => f.display_name.toLowerCase().includes(query) || f.username.toLowerCase().includes(query));
  }
  
  if (filter === 'online') {
    filtered = filtered.filter(f => f.is_online);
  }
  
  if (sort === 'name_asc') {
    filtered.sort((a, b) => a.display_name.localeCompare(b.display_name));
  } else if (sort === 'name_desc') {
    filtered.sort((a, b) => b.display_name.localeCompare(a.display_name));
  }
  
  renderGroupedFriends(filtered);
}

function loadGroupRoomsView() {
  const body = document.getElementById("contacts-panel-body");
  if (!body) return;
  body.className = "flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar bg-slate-50";
  
  const groups = roomsList.filter(r => r.is_group);
  const totalCount = groups.length;
  
  let listHTML = "";
  if (groups.length === 0) {
    listHTML = `<div class="text-center py-12 text-slate-400 text-xs select-none">Báº¡n chÆ°a tham gia nhÃ³m chat nÃ o. HÃ£y táº¡o nhÃ³m má»›i hoáº·c quÃ©t mÃ£ tham gia nhÃ©!</div>`;
  } else {
    groups.forEach(g => {
      const avatar = g.partner_avatar || "/logo.png";
      listHTML += `
        <div class="flex items-center justify-between p-4 bg-white border border-slate-200/60 rounded-2xl shadow-sm mb-3 hover:shadow transition-all select-none">
          <div class="flex items-center gap-3.5 min-w-0">
            <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-slate-100">
            <div class="min-w-0">
              <h4 class="font-bold text-slate-800 text-sm truncate">${g.name}</h4>
              <p class="text-[10px] text-slate-400 font-bold mt-0.5 truncate">${g.last_message || "ChÆ°a cÃ³ cuá»™c trÃ² chuyá»‡n nÃ o"}</p>
            </div>
          </div>
          <button onclick="startGroupChatFromContacts(${g.id})" class="bg-zalo-primary hover:bg-zalo-hover text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-1.5">
            <i class="fa-solid fa-comment-dots"></i> VÃ o chat
          </button>
        </div>
      `;
    });
  }
  
  body.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-4">
      <div>
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 select-none">Danh sÃ¡ch nhÃ³m cá»§a báº¡n (${totalCount})</h3>
        <div class="space-y-1">${listHTML}</div>
      </div>
    </div>
  `;
}

window.startGroupChatFromContacts = function(roomId) {
  switchView('chat');
  handleRoomSelection(roomId);
};

function loadFriendRequests() {
  fetch('/api/friends/requests', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(data => {
    renderFriendRequestsView(data.received || [], data.sent || []);
    updateRequestsBadge(data.received.length);
  });
}

function renderFriendRequestsView(received, sent) {
  const body = document.getElementById("contacts-panel-body");
  if (!body) return;
  body.className = "flex-1 overflow-y-auto p-4 md:p-6 no-scrollbar bg-slate-50";
  
  let receivedHTML = "";
  if (received.length === 0) {
    receivedHTML = `<div class="text-center py-6 text-slate-400 text-xs">KhÃ´ng cÃ³ lá»i má»i káº¿t báº¡n nÃ o cáº§n phÃª duyá»‡t.</div>`;
  } else {
    received.forEach(req => {
      const avatar = req.sender_avatar || "/logo.png";
      receivedHTML += `
        <div class="flex items-center justify-between p-4 bg-white border border-slate-200/60 rounded-2xl shadow-sm mb-3">
          <div class="flex items-center gap-3.5 min-w-0">
            <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-slate-100 shrink-0">
            <div class="min-w-0">
              <h4 class="font-bold text-slate-800 text-sm truncate">${req.sender_name}</h4>
              <p class="text-[10px] text-slate-400 font-bold mt-0.5">Muá»‘n káº¿t báº¡n vá»›i báº¡n</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="handleFriendRequest(${req.id}, 'accepted')" class="bg-zalo-primary hover:bg-zalo-hover text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-sm transition-all">Äá»“ng Ã½</button>
            <button onclick="handleFriendRequest(${req.id}, 'rejected')" class="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all">Tá»« chá»‘i</button>
          </div>
        </div>
      `;
    });
  }
  
  let sentHTML = "";
  if (sent.length === 0) {
    sentHTML = `<div class="text-center py-6 text-slate-400 text-xs">KhÃ´ng cÃ³ lá»i má»i káº¿t báº¡n nÃ o Ä‘Ã£ gá»­i.</div>`;
  } else {
    sent.forEach(req => {
      const avatar = req.receiver_avatar || "/logo.png";
      sentHTML += `
        <div class="flex items-center justify-between p-4 bg-white border border-slate-200/60 rounded-2xl shadow-sm mb-3">
          <div class="flex items-center gap-3.5 min-w-0">
            <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-slate-100 shrink-0">
            <div class="min-w-0">
              <h4 class="font-bold text-slate-800 text-sm truncate">${req.receiver_name}</h4>
              <p class="text-[10px] text-slate-400 font-bold mt-0.5">ÄÃ£ gá»­i yÃªu cáº§u káº¿t báº¡n</p>
            </div>
          </div>
          <button onclick="cancelFriendRequest(${req.id})" class="border border-slate-200 text-slate-500 hover:bg-slate-100 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all shrink-0">Há»§y yÃªu cáº§u</button>
        </div>
      `;
    });
  }
  
  body.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-6 select-none">
      <div>
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3"><i class="fa-solid fa-envelope-open-text text-zalo-primary mr-1"></i> Lá»i má»i káº¿t báº¡n Ä‘Ã£ nháº­n (${received.length})</h3>
        <div class="space-y-1">${receivedHTML}</div>
      </div>
      <div class="pt-4 border-t border-slate-200">
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3"><i class="fa-solid fa-paper-plane text-slate-400 mr-1"></i> Lá»i má»i káº¿t báº¡n Ä‘Ã£ gá»­i (${sent.length})</h3>
        <div class="space-y-1">${sentHTML}</div>
      </div>
    </div>
  `;
}

window.handleFriendRequest = function(id, status) {
  fetch(`/api/friends/request/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
    body: JSON.stringify({ status })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) alert(data.error);
    else {
      loadFriendRequests();
      loadFriends();
    }
  });
};

window.cancelFriendRequest = function(id) {
  if (confirm("Báº¡n muá»‘n há»§y yÃªu cáº§u káº¿t báº¡n nÃ y?")) {
    fetch(`/api/friends/request/${id}/cancel`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) alert(data.error);
      else loadFriendRequests();
    });
  }
};

function renderInvitesPlaceholder() {
  const body = document.getElementById("contacts-panel-body");
  if (!body) return;
  body.className = "flex-1 flex items-center justify-center bg-white p-6";
  body.innerHTML = `
    <div class="text-center max-w-sm space-y-3 select-none">
      <div class="w-16 h-16 bg-blue-50 text-zalo-primary rounded-full flex items-center justify-center text-2xl mx-auto">
        <i class="fa-solid fa-people-group"></i>
      </div>
      <h4 class="font-bold text-slate-800 text-sm">Lá»i má»i vÃ o nhÃ³m</h4>
      <p class="text-xs text-slate-400 leading-relaxed">Khi Ä‘á»“ng nghiá»‡p chia sáº» link hoáº·c thÃªm báº¡n trá»±c tiáº¿p, báº¡n sáº½ tham gia nhÃ³m Ä‘Ã³ ngay láº­p tá»©c. TÃ­nh nÄƒng nháº­n tin phÃª duyá»‡t tá»« TrÆ°á»Ÿng nhÃ³m hoáº¡t Ä‘á»™ng tá»± Ä‘á»™ng.</p>
    </div>
  `;
}

function updateContactsBadges() {
  fetch('/api/friends/requests', {
    headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
  })
  .then(res => res.json())
  .then(data => {
    const receivedCount = data.received?.length || 0;
    updateRequestsBadge(receivedCount);
  });
}

function updateRequestsBadge(count) {
  const badge = document.getElementById("requests-badge-count");
  const navBadge = document.getElementById("contacts-unread-badge");
  
  if (count > 0) {
    if (badge) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    }
    if (navBadge) {
      navBadge.textContent = count;
      navBadge.classList.remove("hidden");
    }
  } else {
    if (badge) badge.classList.add("hidden");
    if (navBadge) navBadge.classList.add("hidden");
  }
}

// =========================================================================
// 14. UI EVENT LISTENERS & MODALS INITIALIZATION (Safeguarded against Nulls)
// =========================================================================

function initUIEventListeners() {
  // Báº¯t sá»± kiá»‡n click má»Ÿ menu Avatar
  const userMyAvatar = document.getElementById("user-my-avatar");
  if (userMyAvatar) {
    userMyAvatar.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = document.getElementById("account-dropdown-menu");
      if (menu) menu.classList.toggle("hidden");
    });
  }

  // Tá»± Ä‘á»™ng Ä‘Ã³ng menu khi click ra ngoÃ i vÃ¹ng menu
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("account-dropdown-menu");
    if (menu && !menu.classList.contains("hidden") && !e.target.closest("#account-dropdown-menu") && e.target.id !== "user-my-avatar") {
      menu.classList.add("hidden");
    }
  });

  // Báº­t/táº¯t mic/camera WebRTC
  const toggleMicBtn = document.getElementById("btn-call-toggle-mic");
  if (toggleMicBtn) toggleMicBtn.onclick = toggleMic;
  const toggleCamBtn = document.getElementById("btn-call-toggle-cam");
  if (toggleCamBtn) toggleCamBtn.onclick = toggleCam;

  // Swapping Views
  const tabBtnChat = document.getElementById("tab-btn-chat");
  if (tabBtnChat) {
    tabBtnChat.onclick = () => {
      switchView('chat');
    };
  }
  
  const tabBtnContacts = document.getElementById("tab-btn-contacts");
  if (tabBtnContacts) {
    tabBtnContacts.onclick = () => {
      switchView('contacts');
    };
  }

  // Contacts Sidebar item clicks
  const contactsMenuFriends = document.getElementById("contacts-menu-friends");
  if (contactsMenuFriends) contactsMenuFriends.onclick = () => switchContactsTab('friends');
  const contactsMenuGroups = document.getElementById("contacts-menu-groups");
  if (contactsMenuGroups) contactsMenuGroups.onclick = () => switchContactsTab('groups');
  const contactsMenuRequests = document.getElementById("contacts-menu-requests");
  if (contactsMenuRequests) contactsMenuRequests.onclick = () => switchContactsTab('requests');
  const contactsMenuInvites = document.getElementById("contacts-menu-invites");
  if (contactsMenuInvites) contactsMenuInvites.onclick = () => switchContactsTab('invites');

  // Friends search add modal
  const btnOpenAddFriend = document.getElementById("btn-open-add-friend");
  if (btnOpenAddFriend) {
    btnOpenAddFriend.onclick = () => {
      const input = document.getElementById("add-friend-search-input");
      if (input) input.value = "";
      const results = document.getElementById("add-friend-results-list");
      if (results) results.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none">Nháº­p thÃ´ng tin tÃ¬m kiáº¿m phÃ­a trÃªn Ä‘á»ƒ tÃ¬m báº¡n bÃ¨.</p>`;
      const modal = document.getElementById("add-friend-modal");
      if (modal) modal.classList.remove("hidden");
    };
  }
  
  const btnCloseAddFriend = document.getElementById("btn-close-add-friend");
  if (btnCloseAddFriend) {
    btnCloseAddFriend.onclick = () => {
      const modal = document.getElementById("add-friend-modal");
      if (modal) modal.classList.add("hidden");
    };
  }

  const addFriendSearchInput = document.getElementById("add-friend-search-input");
  if (addFriendSearchInput) {
    addFriendSearchInput.addEventListener("input", function(e) {
      const q = e.target.value.trim();
      const list = document.getElementById("add-friend-results-list");
      if (!list) return;
      if (!q) {
        list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none">Nháº­p thÃ´ng tin tÃ¬m kiáº¿m phÃ­a trÃªn Ä‘á»ƒ tÃ¬m báº¡n bÃ¨.</p>`;
        return;
      }
      
      fetch(`/api/friends/search-add?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
      })
      .then(res => res.json())
      .then(users => {
        list.innerHTML = "";
        if (users.length === 0) {
          list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none">KhÃ´ng tÃ¬m tháº¥y thÃ nh viÃªn phÃ¹ há»£p.</p>`;
          return;
        }
        
        users.forEach(u => {
          const avatar = u.avatar_url || "/logo.png";
          let actionBtn = "";
          
          if (!u.friendship_status) {
            actionBtn = `<button onclick="sendFriendRequest(${u.id}, '${u.display_name}')" class="bg-zalo-primary hover:bg-zalo-hover text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1 shrink-0"><i class="fa-solid fa-user-plus"></i> Káº¿t báº¡n</button>`;
          } else if (u.friendship_status === 'pending') {
            if (u.friendship_sender_id === currentUser.id) {
              actionBtn = `<span class="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg select-none font-semibold shrink-0">ÄÃ£ gá»­i yÃªu cáº§u</span>`;
            } else {
              actionBtn = `<button onclick="handleFriendRequest(${u.friendship_id}, 'accepted')" class="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all shrink-0">Äá»“ng Ã½</button>`;
            }
          } else if (u.friendship_status === 'accepted') {
            actionBtn = `<span class="text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-lg select-none font-bold shrink-0"><i class="fa-solid fa-check-double"></i> Báº¡n bÃ¨</span>`;
          }
          
          const div = document.createElement("div");
          div.className = "flex items-center justify-between p-2.5 hover:bg-white rounded-xl transition-all border border-transparent hover:border-slate-100 bg-white shadow-sm sm:shadow-none";
          div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
              <img src="${avatar}" class="w-10 h-10 rounded-full object-cover border border-slate-100 shrink-0">
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-800 truncate">${u.display_name}</p>
                <p class="text-[10px] text-slate-400 font-bold truncate">@${u.username}</p>
              </div>
            </div>
            ${actionBtn}
          `;
          list.appendChild(div);
        });
      });
    });
  }

  window.sendFriendRequest = function(userId, name) {
    fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
      body: JSON.stringify({ receiver_id: userId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) alert(data.error);
      else {
        alert(`ÄÃ£ gá»­i yÃªu cáº§u káº¿t báº¡n Ä‘áº¿n [${name}]!`);
        const input = document.getElementById("add-friend-search-input");
        if (input) input.dispatchEvent(new Event('input'));
        updateContactsBadges();
      }
    });
  };

  // Contacts mobile layout back to sidebar
  const btnContactsBack = document.getElementById("btn-contacts-back-to-sidebar");
  if (btnContactsBack) {
    btnContactsBack.onclick = () => {
      const contactsSidebar = document.getElementById("contacts-sidebar");
      if (contactsSidebar) contactsSidebar.classList.remove("hidden");
      const contactsMainPanel = document.getElementById("contacts-main-panel");
      if (contactsMainPanel) contactsMainPanel.classList.add("hidden");
    };
  }

  // Tab Auth Swapping
  const tabLoginBtn = document.getElementById("btn-tab-login");
  if (tabLoginBtn) {
    tabLoginBtn.onclick = () => {
      tabLoginBtn.className = "flex-1 pb-3 text-center border-b-2 border-zalo-primary text-zalo-primary";
      const tabRegisterBtn = document.getElementById("btn-tab-register");
      if (tabRegisterBtn) tabRegisterBtn.className = "flex-1 pb-3 text-center border-b-2 border-transparent text-slate-400 hover:text-slate-600";
      const loginForm = document.getElementById("login-form");
      if (loginForm) loginForm.classList.remove("hidden");
      const registerForm = document.getElementById("register-form");
      if (registerForm) registerForm.classList.add("hidden");
    };
  }

  const tabRegisterBtn = document.getElementById("btn-tab-register");
  if (tabRegisterBtn) {
    tabRegisterBtn.onclick = () => {
      tabRegisterBtn.className = "flex-1 pb-3 text-center border-b-2 border-zalo-primary text-zalo-primary";
      const tabLoginBtn = document.getElementById("btn-tab-login");
      if (tabLoginBtn) tabLoginBtn.className = "flex-1 pb-3 text-center border-b-2 border-transparent text-slate-400 hover:text-slate-600";
      const registerForm = document.getElementById("register-form");
      if (registerForm) registerForm.classList.remove("hidden");
      const loginForm = document.getElementById("login-form");
      if (loginForm) loginForm.classList.add("hidden");
    };
  }

  // Auth Forms Submit
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.onsubmit = (e) => {
      e.preventDefault();
      const loginUsernameEl = document.getElementById("login-username");
      const loginPasswordEl = document.getElementById("login-password");
      const u = loginUsernameEl ? loginUsernameEl.value : "";
      const p = loginPasswordEl ? loginPasswordEl.value : "";
      
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          localStorage.setItem("alonha_token", data.token);
          currentUser = data.user;
          const authContainer = document.getElementById("auth-container");
          if (authContainer) authContainer.classList.add("hidden");
          const mainApp = document.getElementById("main-app");
          if (mainApp) mainApp.classList.remove("hidden");
          updateMyProfileUI();
          connectSocket(data.token);
          
          loadAllUsers().then(() => {
            loadRooms().then(() => {
              updateContactsBadges();
              const pendingCode = localStorage.getItem("alonha_pending_join_code");
              if (pendingCode) {
                localStorage.removeItem("alonha_pending_join_code");
                window.location.search = `?join=${pendingCode}`;
              }
            });
          });
        }
      });
    };
  }

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.onsubmit = (e) => {
      e.preventDefault();
      const regUsernameEl = document.getElementById("reg-username");
      const regDisplayNameEl = document.getElementById("reg-display-name");
      const regPasswordEl = document.getElementById("reg-password");
      
      const u = regUsernameEl ? regUsernameEl.value : "";
      const d = regDisplayNameEl ? regDisplayNameEl.value : "";
      const p = regPasswordEl ? regPasswordEl.value : "";
      
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, display_name: d, password: p })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          alert("ÄÄƒng kÃ½ thÃ nh cÃ´ng! Vui lÃ²ng chuyá»ƒn sang tab ÄÄƒng Nháº­p.");
          const btnTabLogin = document.getElementById("btn-tab-login");
          if (btnTabLogin) btnTabLogin.click();
        }
      })
      .catch(() => alert("Gáº·p lá»—i liÃªn káº¿t khi Ä‘Äƒng kÃ½ tÃ i khoáº£n má»›i!"));
    };
  }

  // Má»Ÿ Modal Há»“ sÆ¡ xem trÆ°á»›c (Chuáº©n Zalo)
  const showProfileZaloBtn = document.getElementById("btn-show-profile-zalo");
  if (showProfileZaloBtn) {
    showProfileZaloBtn.onclick = () => {
      const dropdownMenu = document.getElementById("account-dropdown-menu");
      if (dropdownMenu) dropdownMenu.classList.add("hidden");
      
      const profileAvatar = document.getElementById("zalo-profile-avatar");
      if (profileAvatar) profileAvatar.src = currentUser.avatar_url || "/logo.png";
      const profileName = document.getElementById("zalo-profile-name");
      if (profileName) profileName.textContent = currentUser.display_name;
      const profileGender = document.getElementById("zalo-profile-gender");
      if (profileGender) profileGender.textContent = currentUser.gender || "ChÆ°a cáº­p nháº­t";
      const profilePhone = document.getElementById("zalo-profile-phone");
      if (profilePhone) profilePhone.textContent = currentUser.phone_number || "ChÆ°a cáº­p nháº­t";
      
      let dobStr = "ChÆ°a cáº­p nháº­t";
      if (currentUser.dob) {
        const d = new Date(currentUser.dob);
        dobStr = `${d.getDate().toString().padStart(2, '0')} thÃ¡ng ${d.getMonth() + 1}, ${d.getFullYear()}`;
      }
      const profileDob = document.getElementById("zalo-profile-dob");
      if (profileDob) profileDob.textContent = dobStr;
      
      const viewModal = document.getElementById("zalo-profile-view-modal");
      if (viewModal) viewModal.classList.remove("hidden");
    };
  }

  // ÄÃ³ng Modal Há»“ sÆ¡ xem trÆ°á»›c
  const closeZaloProfileBtn = document.getElementById("btn-close-zalo-profile");
  if (closeZaloProfileBtn) {
    closeZaloProfileBtn.onclick = () => {
      const viewModal = document.getElementById("zalo-profile-view-modal");
      if (viewModal) viewModal.classList.add("hidden");
    };
  }

  // NÃºt Cáº­p nháº­t (Chuyá»ƒn sang form Edit cÅ©)
  const openEditProfileBtn = document.getElementById("btn-open-edit-profile");
  if (openEditProfileBtn) {
    openEditProfileBtn.onclick = () => {
      const viewModal = document.getElementById("zalo-profile-view-modal");
      if (viewModal) viewModal.classList.add("hidden");
      
      const displayNameInput = document.getElementById("profile-display-name-input");
      if (displayNameInput) displayNameInput.value = currentUser.display_name;
      const phoneInput = document.getElementById("profile-phone-input");
      if (phoneInput) phoneInput.value = currentUser.phone_number || "";
      const genderSelect = document.getElementById("profile-gender-select");
      if (genderSelect) genderSelect.value = currentUser.gender || "KhÃ¡c";
      const dobInput = document.getElementById("profile-dob-input");
      if (dobInput) dobInput.value = currentUser.dob ? currentUser.dob.split('T')[0] : "";
      const avatarPreview = document.getElementById("profile-avatar-preview");
      if (avatarPreview) avatarPreview.src = currentUser.avatar_url || "/logo.png";
      const profileModal = document.getElementById("profile-modal");
      if (profileModal) profileModal.classList.remove("hidden");
    };
  }

  // Má»Ÿ Modal CÃ i Ä‘áº·t tá»•ng (Chuáº©n Zalo)
  const showSettingsZaloBtn = document.getElementById("btn-show-settings-zalo");
  if (showSettingsZaloBtn) {
    showSettingsZaloBtn.onclick = () => {
      const dropdownMenu = document.getElementById("account-dropdown-menu");
      if (dropdownMenu) dropdownMenu.classList.add("hidden");
      const settingsModal = document.getElementById("zalo-settings-modal");
      if (settingsModal) settingsModal.classList.remove("hidden");
    };
  }

  // ÄÃ³ng Modal CÃ i Ä‘áº·t tá»•ng
  const closeZaloSettingsBtn = document.getElementById("btn-close-zalo-settings");
  if (closeZaloSettingsBtn) {
    closeZaloSettingsBtn.onclick = () => {
      const settingsModal = document.getElementById("zalo-settings-modal");
      if (settingsModal) settingsModal.classList.add("hidden");
    };
  }

  // NÃºt báº¥m bÃªn trong CÃ i Ä‘áº·t tá»•ng Ä‘á»ƒ gá»i Form mÃ£ PIN
  const triggerOldSettingsBtn = document.getElementById("btn-trigger-old-settings");
  if (triggerOldSettingsBtn) {
    triggerOldSettingsBtn.onclick = () => {
      const pinInput = document.getElementById("settings-pin-input");
      if (pinInput) pinInput.value = currentUser.pin_code || "";
      const timeoutSelect = document.getElementById("settings-timeout-select");
      if (timeoutSelect) timeoutSelect.value = currentUser.pin_timeout || 1;
      const settingsModal = document.getElementById("settings-modal");
      if (settingsModal) settingsModal.classList.remove("hidden");
    };
  }

  // Má»Ÿ Admin Panel
  const openAdminPanelBtn = document.getElementById('btn-open-admin-panel');
  const adminPanelModal = document.getElementById('admin-panel-modal');
  const closeAdminPanelBtn = document.getElementById('btn-close-admin-panel');

  if (openAdminPanelBtn) {
    openAdminPanelBtn.onclick = () => {
      const dropdownMenu = document.getElementById('account-dropdown-menu');
      if (dropdownMenu) dropdownMenu.classList.add('hidden');
      if (adminPanelModal) {
        adminPanelModal.classList.remove('hidden');
        loadAdminPanelData();
      }
    };
  }

  if (closeAdminPanelBtn && adminPanelModal) {
    closeAdminPanelBtn.onclick = () => {
      adminPanelModal.classList.add('hidden');
    };
  }

  if (adminPanelModal) {
    adminPanelModal.addEventListener('click', (e) => {
      if (e.target === adminPanelModal) adminPanelModal.classList.add('hidden');
    });
  }

  const adminRoomChatModal = document.getElementById('admin-room-chat-modal');
  const closeAdminRoomChatBtn = document.getElementById('btn-close-admin-room-chat');

  if (closeAdminRoomChatBtn && adminRoomChatModal) {
    closeAdminRoomChatBtn.onclick = () => {
      adminRoomChatModal.classList.add('hidden');
    };
  }

  if (adminRoomChatModal) {
    adminRoomChatModal.addEventListener('click', (e) => {
      if (e.target === adminRoomChatModal) adminRoomChatModal.classList.add('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    const roleSelect = e.target.closest('[data-action="role"]');
    if (roleSelect) {
      roleSelect.onchange = () => updateAdminUserRole(roleSelect.dataset.userId, roleSelect.value);
    }

    const statusBtn = e.target.closest('[data-action="status"]');
    if (statusBtn) {
      const nextState = statusBtn.textContent.includes('Active') ? false : true;
      toggleAdminUserStatus(statusBtn.dataset.userId, nextState);
    }

    const archiveBtn = e.target.closest('[data-action="archive"]');
    if (archiveBtn) {
      const nextState = archiveBtn.textContent.includes('Archive') ? true : false;
      toggleAdminRoomArchive(archiveBtn.dataset.roomId, nextState);
    }

    const chatViewBtn = e.target.closest('[data-action="view-chat"]');
    if (chatViewBtn) {
      openAdminRoomChatViewer(chatViewBtn.dataset.roomId);
    }

    const saveBtn = e.target.closest('#admin-settings-save');
    if (saveBtn) {
      saveAdminSettings();
    }
  });

  // ÄÄƒng xuáº¥t tá»« Menu Zalo má»›i
  const logoutSidebarZaloBtn = document.getElementById("btn-logout-sidebar-zalo");
  if (logoutSidebarZaloBtn) {
    logoutSidebarZaloBtn.onclick = () => {
      localStorage.removeItem("alonha_token");
      localStorage.removeItem("alonha_active_room_id");
      location.reload();
    };
  }

  const inputAvatarFile = document.getElementById("input-avatar-file");
  if (inputAvatarFile) {
    inputAvatarFile.onchange = function() {
      const file = this.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("avatar", file);

      fetch('/api/users/me/avatar', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          currentUser.avatar_url = data.avatar_url;
          const avatarPreview = document.getElementById("profile-avatar-preview");
          if (avatarPreview) avatarPreview.src = data.avatar_url;
          updateMyProfileUI();
        }
      });
    };
  }

  const profileEditForm = document.getElementById("profile-edit-form");
  if (profileEditForm) {
    profileEditForm.onsubmit = (e) => {
      e.preventDefault();
      const displayNameInput = document.getElementById("profile-display-name-input");
      const phoneInput = document.getElementById("profile-phone-input");
      const genderSelect = document.getElementById("profile-gender-select");
      const dobInput = document.getElementById("profile-dob-input");

      const d = displayNameInput ? displayNameInput.value : "";
      const p = phoneInput ? phoneInput.value : "";
      const g = genderSelect ? genderSelect.value : "KhÃ¡c";
      const dob = dobInput ? dobInput.value : "";

      fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({
          display_name: d,
          phone_number: p,
          gender: g,
          dob: dob || null,
          pin_code: currentUser.pin_code,
          pin_timeout: currentUser.pin_timeout
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          currentUser = { ...currentUser, ...data.user };
          updateMyProfileUI();
          const profileModal = document.getElementById("profile-modal");
          if (profileModal) profileModal.classList.add("hidden");
          alert("Cáº­p nháº­t há»“ sÆ¡ cÃ¡ nhÃ¢n thÃ nh cÃ´ng!");
        }
      });
    };
  }

  // Cáº¥u hÃ¬nh PIN
  const showSettingsHandler = () => {
    const pinInput = document.getElementById("settings-pin-input");
    if (pinInput) pinInput.value = currentUser.pin_code || "";
    const timeoutSelect = document.getElementById("settings-timeout-select");
    if (timeoutSelect) timeoutSelect.value = currentUser.pin_timeout || 1;
    const settingsModal = document.getElementById("settings-modal");
    if (settingsModal) settingsModal.classList.remove("hidden");
  };
  const tabBtnSettings = document.getElementById("tab-btn-settings");
  if (tabBtnSettings) tabBtnSettings.onclick = showSettingsHandler;
  
  window.showSettingsModal = showSettingsHandler;

  const btnCloseSettings = document.getElementById("btn-close-settings");
  if (btnCloseSettings) {
    btnCloseSettings.onclick = () => {
      const settingsModal = document.getElementById("settings-modal");
      if (settingsModal) settingsModal.classList.add("hidden");
    };
  }

  const settingsPinForm = document.getElementById("settings-pin-form");
  if (settingsPinForm) {
    settingsPinForm.onsubmit = (e) => {
      e.preventDefault();
      const pinInput = document.getElementById("settings-pin-input");
      const timeoutSelect = document.getElementById("settings-timeout-select");
      
      const pin = pinInput ? pinInput.value : "";
      const timeout = timeoutSelect ? timeoutSelect.value : 1;
      
      fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({
          display_name: currentUser.display_name,
          pin_code: pin || null,
          pin_timeout: parseInt(timeout)
        })
      })
      .then(res => res.json())
      .then(data => {
        currentUser = data.user;
        alert("ÄÃ£ lÆ°u mÃ£ PIN an toÃ n báº£o máº­t!");
        const settingsModal = document.getElementById("settings-modal");
        if (settingsModal) settingsModal.classList.add("hidden");
      });
    };
  }

  const lockTrigger = () => { triggerLockScreen(); };
  const btnLockSidebar = document.getElementById("btn-lock-sidebar");
  if (btnLockSidebar) btnLockSidebar.onclick = lockTrigger;
  const tabBtnLockMobile = document.getElementById("tab-btn-lock-mobile");
  if (tabBtnLockMobile) tabBtnLockMobile.onclick = lockTrigger;

  const logoutTrigger = () => {
    localStorage.removeItem("alonha_token");
    localStorage.removeItem("alonha_active_room_id");
    location.reload();
  };
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.onclick = logoutTrigger;

  // QUAY Láº I Tá»ª MÃ€N HÃŒNH CHAT TRÃŠN DI Äá»˜NG
  const btnBackToRooms = document.getElementById("btn-back-to-rooms");
  if (btnBackToRooms) {
    btnBackToRooms.onclick = () => {
      activeRoomId = null;
      const roomsSidebar = document.getElementById("rooms-sidebar");
      if (roomsSidebar) roomsSidebar.classList.remove("hidden");
      const navigationSidebar = document.getElementById("navigation-sidebar");
      if (navigationSidebar) navigationSidebar.classList.remove("hidden"); 
      const chatAreaContainer = document.getElementById("chat-area-container");
      if (chatAreaContainer) {
        chatAreaContainer.classList.add("hidden");
        chatAreaContainer.classList.remove("flex");
      }
      loadRooms();
    };
  }

  const searchRooms = document.getElementById("search-rooms");
  if (searchRooms) {
    searchRooms.oninput = function(e) {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderRoomsList(roomsList);
        return;
      }
      const filtered = roomsList.filter(r => r.name.toLowerCase().includes(q));
      renderRoomsList(filtered);
    };
  }

  const filterAll = document.getElementById("filter-all");
  if (filterAll) {
    filterAll.onclick = () => {
      filterAll.className = "flex-1 py-3 text-center border-b-2 border-zalo-primary text-zalo-primary";
      const filterUnread = document.getElementById("filter-unread");
      if (filterUnread) filterUnread.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-slate-600";
      renderRoomsList(roomsList);
    };
  }

  const filterUnread = document.getElementById("filter-unread");
  if (filterUnread) {
    filterUnread.onclick = () => {
      filterUnread.className = "flex-1 py-3 text-center border-b-2 border-zalo-primary text-zalo-primary";
      const filterAll = document.getElementById("filter-all");
      if (filterAll) filterAll.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-slate-600";
      const unread = roomsList.filter(r => r.unread_count > 0);
      renderRoomsList(unread);
    };
  }

  const btnToggleInfo = document.getElementById("btn-toggle-info");
  if (btnToggleInfo) {
    btnToggleInfo.onclick = () => {
      const sidebar = document.getElementById("info-sidebar");
      if (sidebar) sidebar.classList.toggle("hidden");
    };
  }

  const btnCloseInfo = document.getElementById("btn-close-info");
  if (btnCloseInfo) {
    btnCloseInfo.onclick = () => {
      const sidebar = document.getElementById("info-sidebar");
      if (sidebar) sidebar.classList.add("hidden");
    };
  }

  const bindAccordion = (btnId, contentId, key) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.onclick = () => {
        const content = document.getElementById(contentId);
        const icon = btn.querySelector(".fa-chevron-down");
        accordionStates[key] = !accordionStates[key];
        
        if (content) {
          if (accordionStates[key]) {
            content.classList.remove("hidden");
            if (icon) icon.style.transform = "rotate(0deg)";
          } else {
            content.classList.add("hidden");
            if (icon) icon.style.transform = "rotate(-90deg)";
          }
        }
      };
    }
  };

  bindAccordion("btn-toggle-members-accordion", "members-accordion-content", "members");
  bindAccordion("btn-toggle-notes-accordion", "notes-accordion-content", "notes");
  bindAccordion("btn-toggle-media-accordion", "media-accordion-content", "media");
  bindAccordion("btn-toggle-files-accordion", "files-accordion-content", "files");

  const btnTriggerRename = document.getElementById("btn-trigger-rename");
  if (btnTriggerRename) {
    btnTriggerRename.onclick = () => {
      const box = document.getElementById("group-rename-container");
      const nameEl = document.getElementById("info-name");
      if (box && nameEl) {
        box.classList.remove("hidden");
        const groupRenameInput = document.getElementById("group-rename-input");
        if (groupRenameInput) groupRenameInput.value = nameEl.textContent;
      }
    };
  }

  const btnCancelGroupRename = document.getElementById("btn-cancel-group-rename");
  if (btnCancelGroupRename) {
    btnCancelGroupRename.onclick = () => {
      const box = document.getElementById("group-rename-container");
      if (box) box.classList.add("hidden");
    };
  }

  const btnSaveGroupRename = document.getElementById("btn-save-group-rename");
  if (btnSaveGroupRename) {
    btnSaveGroupRename.onclick = () => {
      const groupRenameInput = document.getElementById("group-rename-input");
      const newName = groupRenameInput ? groupRenameInput.value.trim() : "";
      if (!newName) return;
      
      fetch(`/api/rooms/${activeRoomId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({ name: newName })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          const box = document.getElementById("group-rename-container");
          if (box) box.classList.add("hidden");
        }
      });
    };
  }

  const btnEditGroupProfile = document.getElementById("btn-edit-group-profile");
  if (btnEditGroupProfile) {
    btnEditGroupProfile.onclick = () => {
      const inputGroupAvatarFile = document.getElementById("input-group-avatar-file");
      if (inputGroupAvatarFile) inputGroupAvatarFile.click();
    };
  }

  const inputGroupAvatarFile = document.getElementById("input-group-avatar-file");
  if (inputGroupAvatarFile) {
    inputGroupAvatarFile.onchange = function() {
      const file = this.files[0];
      if (!file || !activeRoomId) return;

      const formData = new FormData();
      formData.append("avatar", file);

      fetch(`/api/rooms/${activeRoomId}/profile`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) alert(data.error);
        else {
          alert("Cáº­p nháº­t áº£nh Ä‘áº¡i diá»‡n nhÃ³m thÃ nh cÃ´ng!");
          loadGroupDetails(activeRoomId);
        }
      });
    };
  }

  const executeCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert("ÄÃ£ sao chÃ©p liÃªn káº¿t vÃ o bá»™ nhá»› táº¡m thÃ nh cÃ´ng!");
    });
  };

  const btnCopyGroupLink = document.getElementById("btn-copy-group-link");
  if (btnCopyGroupLink) {
    btnCopyGroupLink.onclick = () => {
      const textbox = document.getElementById("group-link-textbox");
      if (textbox) executeCopy(textbox.value);
    };
  }
  
  const btnManageCopyGroupLink = document.getElementById("btn-manage-copy-group-link");
  if (btnManageCopyGroupLink) {
    btnManageCopyGroupLink.onclick = () => {
      const textbox = document.getElementById("manage-group-link-textbox");
      if (textbox) executeCopy(textbox.value);
    };
  }

  const shareLinkInChat = (textboxId) => {
    const textbox = document.getElementById(textboxId);
    const link = textbox ? textbox.value : "";
    if (!activeRoomId || !link) return;
    socket.emit("send_message", {
      room_id: activeRoomId,
      sender_id: currentUser.id,
      message_text: `ðŸ”” Má»i tham gia nhÃ³m chat thÃ´ng qua liÃªn káº¿t: ${link}`
    });
    alert("ÄÃ£ gá»­i liÃªn káº¿t tham gia vÃ o cuá»™c há»™i thoáº¡i thÃ nh cÃ´ng!");
  };

  const btnShareGroupLink = document.getElementById("btn-share-group-link");
  if (btnShareGroupLink) {
    btnShareGroupLink.onclick = () => {
      shareLinkInChat("group-link-textbox");
    };
  }

  const btnInfoManageGroup = document.getElementById("btn-info-manage-group");
  if (btnInfoManageGroup) {
    btnInfoManageGroup.onclick = () => {
      const infoView = document.getElementById("sidebar-info-view");
      if (infoView) infoView.classList.add("hidden");
      const manageView = document.getElementById("sidebar-manage-view");
      if (manageView) manageView.classList.remove("hidden");
    };
  }

  const btnBackToInfo = document.getElementById("btn-back-to-info");
  if (btnBackToInfo) {
    btnBackToInfo.onclick = () => {
      const manageView = document.getElementById("sidebar-manage-view");
      if (manageView) manageView.classList.add("hidden");
      const infoView = document.getElementById("sidebar-info-view");
      if (infoView) infoView.classList.remove("hidden");
    };
  }

  const bindToggleSave = (id) => {
    const cb = document.getElementById(id);
    if (cb) {
      cb.onchange = () => {
        saveGroupSettingsToServer();
      };
    }
  };

  bindToggleSave("opt-allow-edit-profile");
  bindToggleSave("opt-allow-pin");
  bindToggleSave("opt-allow-note");
  bindToggleSave("opt-allow-poll");
  bindToggleSave("opt-allow-send-message");
  bindToggleSave("opt-approval-mode");
  bindToggleSave("opt-mark-admin-messages");
  bindToggleSave("opt-allow-new-members-read-recent");
  bindToggleSave("opt-allow-join-via-link");
  bindToggleSave("opt-moderation-mode");
  const btnInfoPinRoom = document.getElementById("btn-info-pin-room");
  if (btnInfoPinRoom) {
    btnInfoPinRoom.onclick = () => {
      const room = roomsList.find(r => r.id == activeRoomId);
      if (!room) return;
      const nextPinState = !room.is_pinned;
      
      fetch(`/api/rooms/${activeRoomId}/member-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({ is_pinned: nextPinState })
      })
      .then(res => res.json())
      .then(() => {
        loadRooms();
      });
    };
  }

  const btnInfoMute = document.getElementById("btn-info-mute");
  if (btnInfoMute) {
    btnInfoMute.onclick = () => {
      const room = roomsList.find(r => r.id == activeRoomId);
      if (!room) return;
      const nextMuteState = !room.is_muted;

      fetch(`/api/rooms/${activeRoomId}/member-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({ is_muted: nextMuteState })
      })
      .then(res => res.json())
      .then(() => {
        loadRooms().then(() => {
          loadGroupDetails(activeRoomId);
        });
      });
    };
  }

  const btnInfoAddMember = document.getElementById("btn-info-add-member");
  if (btnInfoAddMember) {
    btnInfoAddMember.onclick = () => {
      fetch(`/api/rooms/${activeRoomId}/members`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
      })
      .then(res => res.json())
      .then(data => {
        const activeMemberIds = data.members.map(m => m.user_id);
        const list = document.getElementById("add-member-list");
        if (!list) return;
        list.innerHTML = "";
        
        const nonMembers = usersList.filter(u => !activeMemberIds.includes(u.id));
        const btnSubmitAddMember = document.getElementById("btn-submit-add-member");
        
        if (nonMembers.length === 0) {
          list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none">Má»i thÃ nh viÃªn há»‡ thá»‘ng Ä‘Ã£ tham gia nhÃ³m nÃ y!</p>`;
          if (btnSubmitAddMember) btnSubmitAddMember.disabled = true;
        } else {
          if (btnSubmitAddMember) btnSubmitAddMember.disabled = false;
          nonMembers.forEach(u => {
            const label = document.createElement("label");
            label.className = "flex items-center justify-between p-2 hover:bg-slate-100 rounded-lg cursor-pointer text-xs select-none";
            label.innerHTML = `
              <div class="flex items-center gap-2.5">
                <img src="${u.avatar_url || '/logo.png'}" class="w-8 h-8 rounded-full object-cover">
                <span class="font-bold text-slate-700">${u.display_name}</span>
              </div>
              <input type="checkbox" name="add-member-item" value="${u.id}" class="w-4 h-4 rounded text-zalo-primary focus:ring-zalo-primary">
            `;
            list.appendChild(label);
          });
        }
        const addMemberModal = document.getElementById("add-member-modal");
        if (addMemberModal) addMemberModal.classList.remove("hidden");
      });
    };
  }

  const btnCloseAddMember = document.getElementById("btn-close-add-member");
  if (btnCloseAddMember) {
    btnCloseAddMember.onclick = () => {
      const addMemberModal = document.getElementById("add-member-modal");
      if (addMemberModal) addMemberModal.classList.add("hidden");
    };
  }

  const btnSubmitAddMember = document.getElementById("btn-submit-add-member");
  if (btnSubmitAddMember) {
    btnSubmitAddMember.onclick = () => {
      const checked = document.querySelectorAll('input[name="add-member-item"]:checked');
      const memberIds = Array.from(checked).map(el => parseInt(el.value));

      if (memberIds.length === 0) {
        alert("HÃ£y chá»n tá»‘i thiá»ƒu 1 thÃ nh viÃªn Ä‘á»ƒ thÃªm!");
        return;
      }

      fetch(`/api/rooms/${activeRoomId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
        body: JSON.stringify({ user_ids: memberIds })
      })
      .then(res => res.json())
      .then(data => {
        const addMemberModal = document.getElementById("add-member-modal");
        if (addMemberModal) addMemberModal.classList.add("hidden");
        if (data.error) alert(data.error);
        else {
          loadGroupDetails(activeRoomId);
        }
      });
    };
  }

  const btnGroupLeave = document.getElementById("btn-group-leave");
  if (btnGroupLeave) {
    btnGroupLeave.onclick = () => {
      if (confirm("Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n rá»i khá»i nhÃ³m nÃ y?")) {
        fetch(`/api/rooms/${activeRoomId}/members/${currentUser.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) alert(data.error);
          else {
            alert("Báº¡n Ä‘Ã£ rá»i nhÃ³m thÃ nh cÃ´ng.");
            location.reload();
          }
        });
      }
    };
  }

  const btnGroupDissolve = document.getElementById("btn-group-dissolve");
  if (btnGroupDissolve) {
    btnGroupDissolve.onclick = () => {
      if (confirm("Cáº¢NH BÃO: HÃ nh Ä‘á»™ng nÃ y sáº½ GIáº¢I TÃN nhÃ³m vÄ©nh viá»…n vÃ  xÃ³a toÃ n bá»™ dá»¯ liá»‡u Ä‘á»‘i vá»›i má»i thÃ nh viÃªn. Báº¡n cháº¯c cháº¯n chá»©?")) {
        fetch(`/api/rooms/${activeRoomId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) alert(data.error);
          else {
            alert("ÄÃ£ giáº£i tÃ¡n nhÃ³m thÃ nh cÃ´ng.");
            location.reload();
          }
        });
      }
    };
  }

  const tabBtnCloud = document.getElementById("tab-btn-cloud");
  if (tabBtnCloud) {
    tabBtnCloud.onclick = () => {
      fetch('/api/rooms/cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` }
      })
      .then(res => res.json())
      .then(room => {
        switchView('chat');
        handleRoomSelection(room.id);
      });
    };
  }

  const btnCloseTimer = document.getElementById("btn-close-timer");
  if (btnCloseTimer) {
    btnCloseTimer.onclick = () => {
      const timerModalOverlay = document.getElementById("timer-modal-overlay");
      if (timerModalOverlay) timerModalOverlay.classList.add("hidden");
    };
  }

  const btnCloseConfirmJoin = document.getElementById("btn-close-confirm-join");
  if (btnCloseConfirmJoin) {
    btnCloseConfirmJoin.onclick = () => {
      const confirmJoinModal = document.getElementById("confirm-join-modal");
      if (confirmJoinModal) confirmJoinModal.classList.add("hidden");
    };
  }

  const btnTimerSelfDestruct = document.getElementById("btn-timer-self-destruct");
  if (btnTimerSelfDestruct) {
    btnTimerSelfDestruct.onclick = () => {
      const timerModalOverlay = document.getElementById("timer-modal-overlay");
      if (timerModalOverlay) timerModalOverlay.classList.remove("hidden");
    };
  }
}

window.setSelfDestructTimer = function(seconds) {
  fetch(`/api/rooms/${activeRoomId}/self-destruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` },
    body: JSON.stringify({ seconds })
  })
  .then(res => res.json())
  .then(data => {
    const timerModalOverlay = document.getElementById("timer-modal-overlay");
    if (timerModalOverlay) timerModalOverlay.classList.add("hidden");
    socket.emit("send_message", {
      room_id: activeRoomId,
      sender_id: currentUser.id,
      message_text: data.system_message.message_text,
      is_system: true
    });
  });
};

function openPinLockOverlay() {
  currentPinInput = "";
  updatePinDots();
  const pinLockOverlay = document.getElementById("pin-lock-overlay");
  if (pinLockOverlay) pinLockOverlay.classList.remove("hidden");
}

function updatePinDots() {
  const dots = document.querySelectorAll(".pin-dot");
  dots.forEach((dot, idx) => {
    if (idx < currentPinInput.length) {
      dot.className = "pin-dot w-3.5 h-3.5 rounded-full bg-white border-2 border-slate-500 transition-colors";
    } else {
      dot.className = "pin-dot w-3.5 h-3.5 rounded-full border-2 border-slate-500 transition-colors";
    }
  });
}

window.pressPinKey = function(num) {
  if (currentPinInput.length < 6) {
    currentPinInput += num;
    updatePinDots();
  }
  if (currentPinInput.length === 6) {
    if (currentPinInput === currentUser.pin_code) {
      const pinLockOverlay = document.getElementById("pin-lock-overlay");
      if (pinLockOverlay) pinLockOverlay.classList.add("hidden");
      if (tempRoomToUnlock) {
        unlockedRooms.add(tempRoomToUnlock);
        handleRoomSelection(tempRoomToUnlock);
        tempRoomToUnlock = null;
      }
    } else {
      alert("MÃ£ PIN báº£o máº­t khÃ´ng chÃ­nh xÃ¡c!");
      currentPinInput = "";
      updatePinDots();
    }
  }
};

window.clearPin = function() {
  currentPinInput = "";
  updatePinDots();
};

window.cancelPinInput = function() {
  const pinLockOverlay = document.getElementById("pin-lock-overlay");
  if (pinLockOverlay) pinLockOverlay.classList.add("hidden");
  tempRoomToUnlock = null;
};

function updateMyProfileUI() {
  const avatar = currentUser.avatar_url || "/logo.png";
  const myAvatarEl = document.getElementById("user-my-avatar");
  if (myAvatarEl) myAvatarEl.src = avatar;
  const displayNameMenu = document.getElementById("profile-display-name-menu");
  if (displayNameMenu) displayNameMenu.textContent = currentUser.display_name;
  const adminPanelBtn = document.getElementById('btn-open-admin-panel');
  if (adminPanelBtn) {
    adminPanelBtn.classList.toggle('hidden', !isSuperAdmin());
  }
}

function updateChatHeaderStatus() {
  const status = document.getElementById("chat-header-status");
  const dot = document.getElementById("chat-header-status-dot");
  const room = roomsList.find(r => r.id == activeRoomId);

  if (room && status && dot) {
    if (room.is_group) {
      status.textContent = "NhÃ³m lÃ m viá»‡c chung";
      dot.className = "absolute bottom-0 right-0 w-3 h-3 bg-blue-500 border-2 border-white rounded-full";
    } else if (room.name === 'Cloud cá»§a tÃ´i') {
      status.textContent = "Kho lÆ°u trá»¯ dá»¯ liá»‡u cÃ¡ nhÃ¢n";
      dot.className = "absolute bottom-0 right-0 w-3 h-3 bg-blue-500 border-2 border-white rounded-full";
    } else {
      status.textContent = "Káº¿t ná»‘i báº£o máº­t";
      dot.className = "absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full";
    }
    dot.classList.remove("hidden");
  }
}

function scrollToBottom() {
  const container = document.getElementById("chat-messages-container");
  if (container) container.scrollTop = container.scrollHeight;
}

function showTypingIndicator(name) {
  let indicator = document.getElementById("typing-indicator");
  if (!indicator) return;
  const usernameEl = indicator.querySelector("#typing-username");
  if (usernameEl) usernameEl.textContent = name;
  indicator.classList.remove("hidden");
  
  clearTimeout(window.typingTimer);
  window.typingTimer = setTimeout(() => {
    indicator.classList.add("hidden");
  }, 3000);
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// =========================================================================
// ðŸ“ CHIA Sáºº Vá»Š TRÃ (LOCATION SHARING)
// =========================================================================
let locationPickerMap = null;
let locationPickerMarker = null;
let selectedLocation = null;

function sendLocationMessage(lat, lng, name, address) {
  if (!activeRoomId) return;
  
  const locationData = JSON.stringify({ lat, lng, name, address });
  
  socket.emit("send_message", {
    room_id: activeRoomId,
    sender_id: currentUser.id,
    message_text: locationData,
    file_type: 'location',
    reply_to_id: replyingToMessageId
  });
  
  clearReplyState();
  closeLocationPicker();
}

function closeLocationPicker() {
  const modal = document.getElementById("location-picker-modal");
  if (modal) modal.classList.add("hidden");
  
  const miniMap = document.getElementById("location-mini-map");
  if (miniMap) miniMap.classList.add("hidden");
  
  const loading = document.getElementById("location-loading");
  if (loading) loading.classList.add("hidden");
  
  const error = document.getElementById("location-error");
  if (error) error.classList.add("hidden");
  
  const selectedInfo = document.getElementById("location-selected-info");
  if (selectedInfo) selectedInfo.classList.add("hidden");
  
  const confirmBtn = document.getElementById("btn-loc-confirm-pick");
  if (confirmBtn) confirmBtn.classList.add("hidden");
  
  // Cleanup map
  if (locationPickerMap) {
    locationPickerMap.remove();
    locationPickerMap = null;
    locationPickerMarker = null;
  }
  selectedLocation = null;
}

function initLocationPicker(lat, lng) {
  const mapContainer = document.getElementById("location-picker-map");
  if (!mapContainer) return;
  
  if (locationPickerMap) {
    locationPickerMap.remove();
    locationPickerMap = null;
    locationPickerMarker = null;
  }
  
  locationPickerMap = L.map('location-picker-map', {
    center: [lat, lng],
    zoom: 15,
    zoomControl: true
  });
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Â© OpenStreetMap'
  }).addTo(locationPickerMap);
  
  locationPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(locationPickerMap);
  
  // Reverse geocode on marker drag
  locationPickerMarker.on('dragend', async function() {
    const pos = this.getLatLng();
    await reverseGeocode(pos.lat, pos.lng);
  });
  
  locationPickerMap.on('click', async function(e) {
    if (locationPickerMarker) {
      locationPickerMarker.setLatLng(e.latlng);
    } else {
      locationPickerMarker = L.marker(e.latlng, { draggable: true }).addTo(locationPickerMap);
      locationPickerMarker.on('dragend', async function() {
        const pos = this.getLatLng();
        await reverseGeocode(pos.lat, pos.lng);
      });
    }
    await reverseGeocode(e.latlng.lat, e.latlng.lng);
  });
  
  // Trigger reverse geocode for initial position
  reverseGeocode(lat, lng);
}

async function reverseGeocode(lat, lng) {
  const selectedInfo = document.getElementById("location-selected-info");
  const nameEl = document.getElementById("loc-selected-name");
  const addressEl = document.getElementById("loc-selected-address");
  const confirmBtn = document.getElementById("btn-loc-confirm-pick");
  
  if (selectedInfo) selectedInfo.classList.remove("hidden");
  if (nameEl) nameEl.textContent = "Äang xÃ¡c Ä‘á»‹nh Ä‘á»‹a chá»‰...";
  if (addressEl) addressEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  
  selectedLocation = { lat, lng, name: "Vá»‹ trÃ­ Ä‘Ã£ chá»n", address: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
  if (confirmBtn) confirmBtn.classList.remove("hidden");
  
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=vi`);
    const data = await res.json();
    if (data && data.display_name) {
      const displayName = data.name || data.address?.road || "Vá»‹ trÃ­";
      if (nameEl) nameEl.textContent = displayName;
      if (addressEl) addressEl.textContent = data.display_name;
      selectedLocation = { lat, lng, name: displayName, address: data.display_name };
    }
  } catch (err) {
    console.warn("Reverse geocode error:", err);
  }
}

// Init location picker button
const btnShareLocation = document.getElementById("btn-share-location");
if (btnShareLocation) {
  btnShareLocation.onclick = () => {
    if (!activeRoomId) return;
    
    const modal = document.getElementById("location-picker-modal");
    if (modal) modal.classList.remove("hidden");
    
    const miniMap = document.getElementById("location-mini-map");
    const loading = document.getElementById("location-loading");
    const error = document.getElementById("location-error");
    
    // Reset UI
    if (miniMap) miniMap.classList.add("hidden");
    if (loading) loading.classList.remove("hidden");
    if (error) error.classList.add("hidden");
    
    const selectedInfo = document.getElementById("location-selected-info");
    if (selectedInfo) selectedInfo.classList.add("hidden");
    const confirmBtn = document.getElementById("btn-loc-confirm-pick");
    if (confirmBtn) confirmBtn.classList.add("hidden");
    
    selectedLocation = null;
    
    // Try getting current position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (loading) loading.classList.add("hidden");
          if (miniMap) miniMap.classList.remove("hidden");
          initLocationPicker(position.coords.latitude, position.coords.longitude);
        },
        (err) => {
          if (loading) loading.classList.add("hidden");
          if (error) {
            error.classList.remove("hidden");
            error.textContent = "KhÃ´ng thá»ƒ láº¥y vá»‹ trÃ­ cá»§a báº¡n. HÃ£y thá»­ chá»n trÃªn báº£n Ä‘á»“ hoáº·c kiá»ƒm tra quyá»n truy cáº­p vá»‹ trÃ­.";
          }
          // Still show map at a default location (Vietnam)
          if (miniMap) miniMap.classList.remove("hidden");
          initLocationPicker(21.0285, 105.8542);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      if (loading) loading.classList.add("hidden");
      if (miniMap) miniMap.classList.remove("hidden");
      initLocationPicker(21.0285, 105.8542);
    }
  };
}

// Close location picker
const btnCloseLocationPicker = document.getElementById("btn-close-location-picker");
if (btnCloseLocationPicker) {
  btnCloseLocationPicker.onclick = closeLocationPicker;
}

// Send current location
const btnLocSendCurrent = document.getElementById("btn-loc-send-current");
if (btnLocSendCurrent) {
  btnLocSendCurrent.onclick = () => {
    const loading = document.getElementById("location-loading");
    const error = document.getElementById("location-error");
    if (loading) loading.classList.remove("hidden");
    if (error) error.classList.add("hidden");
    
    if (!navigator.geolocation) {
      if (error) {
        error.classList.remove("hidden");
        error.textContent = "TrÃ¬nh duyá»‡t khÃ´ng há»— trá»£ Ä‘á»‹nh vá»‹ GPS.";
      }
      if (loading) loading.classList.add("hidden");
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Try to get address
        let name = "Vá»‹ trÃ­ hiá»‡n táº¡i";
        let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=vi`);
          const data = await res.json();
          if (data && data.display_name) {
            name = data.name || "Vá»‹ trÃ­ hiá»‡n táº¡i";
            address = data.display_name;
          }
        } catch (e) {}
        
        if (loading) loading.classList.add("hidden");
        sendLocationMessage(latitude, longitude, name, address);
      },
      (err) => {
        if (loading) loading.classList.add("hidden");
        if (error) {
          error.classList.remove("hidden");
          error.textContent = "KhÃ´ng thá»ƒ láº¥y vá»‹ trÃ­ cá»§a báº¡n. HÃ£y kiá»ƒm tra quyá»n truy cáº­p vá»‹ trÃ­ vÃ  thá»­ láº¡i.";
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };
}

// Pick on map and send
const btnLocConfirmPick = document.getElementById("btn-loc-confirm-pick");
if (btnLocConfirmPick) {
  btnLocConfirmPick.onclick = () => {
    if (selectedLocation) {
      sendLocationMessage(selectedLocation.lat, selectedLocation.lng, selectedLocation.name, selectedLocation.address);
    }
  };
}

// View location on map (click on received location message)
window.openLocationView = function(lat, lng, name, address) {
  const modal = document.getElementById("location-view-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  
  const titleEl = document.getElementById("loc-view-title");
  const nameEl = document.getElementById("loc-view-name");
  const addressEl = document.getElementById("loc-view-address");
  const linkEl = document.getElementById("loc-view-open-link");
  
  if (titleEl) titleEl.textContent = name;
  if (nameEl) nameEl.textContent = name;
  if (addressEl) addressEl.textContent = address;
  if (linkEl) {
    linkEl.href = `https://www.google.com/maps?q=${lat},${lng}`;
  }
  
  // Delay to let modal render
  setTimeout(() => {
    const mapContainer = document.getElementById("location-view-map");
    if (!mapContainer) return;
    
    const map = L.map('location-view-map', {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true
    });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'Â© OpenStreetMap'
    }).addTo(map);
    
    L.marker([lat, lng]).addTo(map)
      .bindPopup(`<b>${name}</b><br>${address}`)
      .openPopup();
    
    // Cleanup when closing
    const closeBtn = document.getElementById("btn-close-location-view");
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.add("hidden");
        map.remove();
      };
    }
    modal.addEventListener('click', function handler(e) {
      if (e.target === modal) {
        modal.classList.add("hidden");
        map.remove();
        modal.removeEventListener('click', handler);
      }
    });
  }, 200);
};

const btnCloseLocationView = document.getElementById("btn-close-location-view");
if (btnCloseLocationView) {
  btnCloseLocationView.onclick = () => {
    const modal = document.getElementById("location-view-modal");
    if (modal) modal.classList.add("hidden");
  };
}

// =========================================================================
// ðŸŽ¤ VOICE MESSAGE LOGIC
// =========================================================================
let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let recordingSeconds = 0;
let activeRecordingStream = null;
let activeRecordingMimeType = '';
function formatRecordTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getSupportedAudioMimeType() {
  if (!window.MediaRecorder) return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp3',
    'audio/wav'
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function getVoiceFileExtension(mimeType = '') {
  if (mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

function stopActiveRecording() {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  if (activeRecordingStream) {
    activeRecordingStream.getTracks().forEach(track => track.stop());
    activeRecordingStream = null;
  }
  if (recordingUI) recordingUI.classList.add("hidden");
  mediaRecorder = null;
  activeRecordingMimeType = '';
  audioChunks = [];
}

const btnStartRecord = document.getElementById("btn-start-record");
const btnCancelRecord = document.getElementById("btn-cancel-record");
const btnSendRecord = document.getElementById("btn-send-record");
const recordingUI = document.getElementById("recording-ui");
const recordingTimeLabel = document.getElementById("recording-time");

if (btnStartRecord) {
  btnStartRecord.onclick = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('TrÃ¬nh duyá»‡t khÃ´ng há»— trá»£ ghi Ã¢m');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMimeType();
      activeRecordingStream = stream;
      activeRecordingMimeType = mimeType;
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      // KhÃ´ng gÃ¡n onstop á»Ÿ Ä‘Ã¢y ná»¯a - nÃ³ sáº½ bá»‹ ghi Ä‘Ã¨ khi nháº¥n Gá»­i.
      // Dá»¯ liá»‡u audio Ä‘Æ°á»£c thu tháº­p qua ondataavailable vÃ o máº£ng audioChunks.
      // TrÆ°á»ng há»£p nháº¥n Há»§y, chá»‰ cáº§n dá»«ng recorder vÃ  reset.
      mediaRecorder.onstop = null;

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error || event);
        alert('Ghi Ã¢m bá»‹ lá»—i. Vui lÃ²ng thá»­ láº¡i.');
        stopActiveRecording();
      };

      mediaRecorder.start(200);
      
      if (recordingUI) recordingUI.classList.remove("hidden");
      recordingSeconds = 0;
      if (recordingTimeLabel) recordingTimeLabel.textContent = "00:00";
      
      recordingInterval = setInterval(() => {
        recordingSeconds++;
        if (recordingTimeLabel) recordingTimeLabel.textContent = formatRecordTime(recordingSeconds);
      }, 1000);

    } catch (err) {
      alert("KhÃ´ng thá»ƒ truy cáº­p Micro. Vui lÃ²ng cáº¥p quyá»n Microphone trÃªn trÃ¬nh duyá»‡t!");
      console.error(err);
    }
  };
}

if (btnCancelRecord) {
  btnCancelRecord.onclick = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    stopActiveRecording();
  };
}

if (btnSendRecord) {
  btnSendRecord.onclick = () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      alert("ChÆ°a cÃ³ Ä‘oáº¡n ghi Ã¢m há»£p lá»‡ Ä‘á»ƒ gá»­i. Vui lÃ²ng thu láº¡i.");
      return;
    }

    const recorder = mediaRecorder;
    const mimeType = recorder.mimeType || activeRecordingMimeType || 'audio/webm';

    // Gá»i requestData() Ä‘á»ƒ láº¥y chunk cuá»‘i cÃ¹ng trÆ°á»›c khi stop
    try {
      recorder.requestData();
    } catch (e) {
      console.warn('[voice-debug] requestData() failed:', e);
    }

    recorder.onstop = () => {
      // Táº¡o blob TRá»°C TIáº¾P tá»« audioChunks (Ä‘Ã£ cÃ³ Ä‘á»§ data nhá» requestData + ondataavailable)
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      console.log('[voice-debug] final blob', {
        chunks: audioChunks.length,
        size: audioBlob.size,
        mimeType
      });
      
      // Táº¡o File tá»« blob vÃ  gá»­i ngay, KHÃ”NG gá»i stopActiveRecording trÆ°á»›c
      const extension = getVoiceFileExtension(mimeType);
      const audioFile = new File([audioBlob], `voice_${Date.now()}.${extension}`, { type: mimeType });
      
      // Dá»n dáº¹p resources recording trÆ°á»›c
      stopActiveRecording();
      
      // Upload file qua API
      uploadFile(audioFile);
    };

    // Dá»«ng recorder
    if (recorder.state !== 'inactive') recorder.stop();
  };
}

// =========================================================================
// ðŸš€ KHá»I LOGIC Sá»¬A Lá»–I Táº O NHÃ“M & LIá»†T NÃšT Há»† THá»NG MÆ¯á»¢T MÃ€
// =========================================================================

const openCreateGroupBtn = document.getElementById("btn-open-create-group");
if (openCreateGroupBtn) {
  openCreateGroupBtn.onclick = (e) => {
    if (e) e.stopPropagation();
    const list = document.getElementById("create-group-members-list");
    if (!list) return;
    
    list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none"><i class="fa-solid fa-spinner animate-spin mr-1"></i> Äang náº¡p danh báº¡...</p>`;
    
    fetch('/api/friends', { 
      headers: { 'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` } 
    })
    .then(res => res.json())
    .then(friends => {
      list.innerHTML = "";
      if (!friends || friends.length === 0) {
        list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4 select-none">Báº¡n cáº§n káº¿t báº¡n trÆ°á»›c khi khá»Ÿi táº¡o nhÃ³m trÃ² chuyá»‡n.</p>`;
        return;
      }
      friends.forEach(u => {
        const label = document.createElement("label");
        label.className = "flex items-center justify-between p-2.5 hover:bg-slate-100 rounded-lg cursor-pointer text-xs select-none transition-colors";
        label.innerHTML = `
          <div class="flex items-center gap-2.5">
            <img src="${u.avatar_url || '/logo.png'}" class="w-8 h-8 rounded-full object-cover border border-slate-200">
            <span class="font-bold text-slate-700">${u.display_name}</span>
          </div>
          <input type="checkbox" name="group-member" value="${u.id}" class="w-4 h-4 rounded text-zalo-primary focus:ring-zalo-primary">
        `;
        list.appendChild(label);
      });
    })
    .catch(err => {
      list.innerHTML = `<p class="text-xs text-red-500 text-center py-4 select-none">KhÃ´ng thá»ƒ náº¡p danh sÃ¡ch Ä‘á»“ng nghiá»‡p.</p>`;
      console.error(err);
    });
    
    const modal = document.getElementById("create-group-modal");
    if (modal) modal.classList.remove("hidden");
  };
}

const closeCreateGroupBtn = document.getElementById("btn-close-create-group");
if (closeCreateGroupBtn) {
  closeCreateGroupBtn.onclick = (e) => {
    if (e) e.stopPropagation();
    const modal = document.getElementById("create-group-modal");
    if (modal) modal.classList.add("hidden");
  };
}

const submitCreateGroupBtn = document.getElementById("btn-submit-create-group");
if (submitCreateGroupBtn) {
  submitCreateGroupBtn.onclick = (e) => {
    if (e) e.stopPropagation();
    const nameInput = document.getElementById("create-group-name");
    const name = nameInput ? nameInput.value.trim() : "";
    const checked = document.querySelectorAll('input[name="group-member"]:checked');
    const memberIds = Array.from(checked).map(el => parseInt(el.value));

    if (!name) { 
      alert("Vui lÃ²ng Ä‘iá»n tÃªn nhÃ³m chat!"); 
      return; 
    }

    fetch('/api/rooms', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${localStorage.getItem("alonha_token")}` 
      },
      body: JSON.stringify({ name, is_group: true, members: memberIds })
    })
    .then(res => res.json())
    .then(room => {
      if (room.error) {
        alert("Lá»—i tá»« há»‡ thá»‘ng: " + room.error);
        return;
      }
      const modal = document.getElementById("create-group-modal");
      if (modal) modal.classList.add("hidden");
      if (nameInput) nameInput.value = "";
      loadRooms().then(() => handleRoomSelection(room.id));
    })
    .catch(err => {
      alert("Gáº·p sá»± cá»‘ Ä‘Æ°á»ng truyá»n khi khá»Ÿi táº¡o nhÃ³m!");
      console.error(err);
    });
  };
}
// =========================================================================
// ðŸ”„ CHUYá»‚N TIáº¾P TIN NHáº®N (FORWARD)
// =========================================================================
let forwardMessageData = null;

// Sá»­a hÃ m openMessageActionMenu Ä‘á»ƒ lÆ°u dá»¯ liá»‡u Forward
const originalOpenMessageActionMenu = window.openMessageActionMenu;
window.openMessageActionMenu = function(messageId, encodedText, isMe, encodedName, encodedFileUrl) {
  // Láº¥y raw file_url tá»« dataset cá»§a message div
  const msgDiv = document.getElementById("msg-" + messageId);
  const rawFileUrl = msgDiv ? msgDiv.dataset.rawFileUrl : null;
  forwardMessageData = {
    messageId,
    text: decodeURIComponent(encodedText),
    isMe,
    displayName: decodeURIComponent(encodedName || "ThÃ nh viÃªn"),
    fileUrl: rawFileUrl
  };
  if (originalOpenMessageActionMenu) {
    originalOpenMessageActionMenu(messageId, encodedText, isMe, encodedName, encodedFileUrl);
  }
};

// Xá»­ lÃ½ nÃºt Forward trong context menu
document.getElementById("ctx-btn-forward")?.addEventListener("click", function() {
  document.getElementById("msg-context-menu")?.classList.add("hidden");
  if (!forwardMessageData) {
    alert("KhÃ´ng tÃ¬m tháº¥y tin nháº¯n Ä‘á»ƒ chuyá»ƒn tiáº¿p.");
    return;
  }
  openForwardModal(forwardMessageData);
});

function openForwardModal(data) {
  const modal = document.getElementById("forward-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  
  const previewContent = document.getElementById("forward-msg-content");
  if (previewContent) {
    let text = data.text || "[File/HÃ¬nh áº£nh]";
    if (data.fileUrl) {
      text = "[TÃ i liá»‡u] " + (data.fileUrl.split('/').pop() || "File Ä‘Ã­nh kÃ¨m");
    }
    previewContent.textContent = text;
  }
  
  document.getElementById("btn-confirm-forward").disabled = true;
  loadForwardTargets();
}

function loadForwardTargets() {
  const targetsList = document.getElementById("forward-targets-list");
  if (!targetsList) return;
  targetsList.innerHTML = '<p class="text-xs text-slate-400 text-center py-8">Äang táº£i...</p>';

  fetch('/api/rooms', {
    headers: { 'Authorization': 'Bearer ' + localStorage.getItem("alonha_token") }
  })
  .then(function(res) { return res.json(); })
  .then(function(rooms) {
    const otherRooms = rooms.filter(function(r) { return r.id != activeRoomId; });
    if (otherRooms.length === 0) {
      targetsList.innerHTML = '<p class="text-xs text-slate-400 text-center py-8">KhÃ´ng cÃ³ há»™i thoáº¡i nÃ o khÃ¡c.</p>';
      return;
    }
    targetsList.innerHTML = "";
    otherRooms.forEach(function(room) {
      const avatar = room.partner_avatar || "/logo.png";
      const div = document.createElement("div");
      div.className = "flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-slate-100 forward-room-item";
      div.dataset.roomId = room.id;
      div.dataset.roomName = room.name;
      div.innerHTML = '<div class="relative shrink-0"><img src="' + avatar + '" class="w-10 h-10 rounded-full object-cover border border-slate-100"></div><div class="min-w-0 flex-1"><h4 class="font-bold text-slate-800 text-sm truncate">' + room.name + '</h4><p class="text-xs text-slate-400 truncate">' + (room.is_group ? "NhÃ³m chat" : "Há»™i thoáº¡i cÃ¡ nhÃ¢n") + '</p></div><div class="forward-radio shrink-0"><div class="w-5 h-5 rounded-full border-2 border-slate-300 flex items-center justify-center"><div class="w-2.5 h-2.5 rounded-full hidden bg-blue-500"></div></div></div>';
      
      div.addEventListener("click", function() {
        document.querySelectorAll(".forward-room-item").forEach(function(item) {
          item.classList.remove("bg-blue-50", "border-blue-200");
          const radio = item.querySelector(".forward-radio div div");
          if (radio) radio.classList.add("hidden");
        });
        div.classList.add("bg-blue-50", "border-blue-200");
        const radio = div.querySelector(".forward-radio div div");
        if (radio) radio.classList.remove("hidden");
        
        const confirmBtn = document.getElementById("btn-confirm-forward");
        confirmBtn.disabled = false;
        confirmBtn.dataset.targetRoomId = room.id;
        confirmBtn.dataset.targetRoomName = room.name;
      });
      targetsList.appendChild(div);
    });
  })
  .catch(function() {
    targetsList.innerHTML = '<p class="text-xs text-red-500 text-center py-8">Lá»—i táº£i danh sÃ¡ch há»™i thoáº¡i.</p>';
  });
}

// TÃ¬m kiáº¿m há»™i thoáº¡i
document.getElementById("forward-search-input")?.addEventListener("input", function(e) {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll(".forward-room-item").forEach(function(item) {
    const name = (item.dataset.roomName || "").toLowerCase();
    if (!q || name.includes(q)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
});

// XÃ¡c nháº­n chuyá»ƒn tiáº¿p
document.getElementById("btn-confirm-forward")?.addEventListener("click", function() {
  const targetId = this.dataset.targetRoomId;
  const targetName = this.dataset.targetRoomName;
  
  if (!targetId || !forwardMessageData) {
    alert("Vui lÃ²ng chá»n há»™i thoáº¡i Ä‘á»ƒ chuyá»ƒn tiáº¿p.");
    return;
  }
  if (!confirm("Chuyá»ƒn tiáº¿p tin nháº¯n Ä‘áº¿n \"" + targetName + "\"?")) return;

  // Láº¥y file_url vÃ  dÃ¹ng getLocalFileUrl Ä‘á»ƒ xá»­ lÃ½
  let forwardFileUrl = forwardMessageData.fileUrl || "";
  if (forwardFileUrl) {
    forwardFileUrl = getLocalFileUrl(forwardFileUrl);
  }
  
  let forwardText = forwardMessageData.text || "[File/HÃ¬nh áº£nh]";
  let forwardFileType = "";
  let forwardFileName = "";
  
  if (forwardFileUrl) {
    // XÃ¡c Ä‘á»‹nh loáº¡i file tá»« local path (pháº§n trÆ°á»›c ||)
    const rawUrl = forwardMessageData.fileUrl || "";
    let localPath = rawUrl;
    if (rawUrl.indexOf("||") !== -1) {
      localPath = rawUrl.split("||")[0];
    }
    const rawFileName = localPath.split('/').pop() || "File";
    const extParts = rawFileName.split('.');
    const ext = (extParts.length > 1 ? extParts[extParts.length - 1] : "").toLowerCase();
    const imageExts = ["jpg","jpeg","png","gif","webp","bmp","svg"];
    const audioExts = ["mp3","wav","ogg","webm","m4a","aac"];
    forwardFileName = rawFileName;
    
    if (imageExts.indexOf(ext) !== -1) {
      forwardFileType = "media";
      forwardText = "[HÃ¬nh áº£nh Ä‘Æ°á»£c chuyá»ƒn tiáº¿p]";
    } else if (audioExts.indexOf(ext) !== -1) {
      forwardFileType = "audio";
      forwardText = "[Ghi Ã¢m Ä‘Æ°á»£c chuyá»ƒn tiáº¿p]";
    } else {
      forwardFileType = "file";
      forwardText = "[Tá»‡p] " + forwardFileName;
    }
  }
  
  // Gá»­i file_url á»Ÿ dáº¡ng local_path||drive_url Ä‘á»ƒ renderSingleMessage xá»­ lÃ½ Ä‘Ãºng
  let fileUrlToSend = forwardMessageData.fileUrl || "";
  // Giá»¯ nguyÃªn format local_path||drive_url (getLocalFileUrl sáº½ chuyá»ƒn thÃ nh thumbnail)
  // Náº¿u chá»‰ cÃ³ local_path, thÃªm || Ä‘á»ƒ Ä‘Ã¡nh dáº¥u
  if (fileUrlToSend && fileUrlToSend.indexOf("||") === -1) {
    fileUrlToSend = fileUrlToSend;
  }
  
  socket.emit("send_message", {
    room_id: parseInt(targetId),
    sender_id: currentUser.id,
    message_text: "ðŸ“¨ [ÄÃ£ chuyá»ƒn tiáº¿p tá»« " + currentUser.display_name + "]: " + forwardText,
    file_url: fileUrlToSend,
    file_type: forwardFileType,
    file_name: forwardFileName,
    reply_to_id: null
  });
  
  closeForwardModal();
  
  // Toast notification
  const toastMsg = document.createElement("div");
  toastMsg.className = "fixed top-4 right-4 bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-xl z-[100] text-xs font-bold animate-bounce select-none";
  toastMsg.textContent = "âœ… ÄÃ£ chuyá»ƒn tiáº¿p Ä‘áº¿n \"" + targetName + "\"!";
  document.body.appendChild(toastMsg);
  setTimeout(function() { toastMsg.remove(); }, 2500);
});

// ÄÃ³ng modal
document.getElementById("btn-cancel-forward")?.addEventListener("click", closeForwardModal);
document.getElementById("btn-close-forward")?.addEventListener("click", closeForwardModal);
document.getElementById("forward-modal")?.addEventListener("click", function(e) {
  if (e.target === this) closeForwardModal();
});

function closeForwardModal() {
  const modal = document.getElementById("forward-modal");
  if (modal) modal.classList.add("hidden");
  
  const confirmBtn = document.getElementById("btn-confirm-forward");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    delete confirmBtn.dataset.targetRoomId;
    delete confirmBtn.dataset.targetRoomName;
  }
  
  const searchInput = document.getElementById("forward-search-input");
  if (searchInput) searchInput.value = "";
  forwardMessageData = null;
}

