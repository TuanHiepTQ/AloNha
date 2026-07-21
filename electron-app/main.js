// ======================================================
// 🪟 AloNha Windows Desktop App - Electron Main Process
// ======================================================
// Chạy server ngay trong cùng tiến trình Electron

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let serverInstance = null;
const PORT = 3000;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Đang khởi động server AloNha...');
    try {
      // Nạp server-fixed.js, nó sẽ tự động listen
      serverInstance = require('../server-fixed.js');
      console.log('✅ Server đã được khởi động!');
      // Đợi server sẵn sàng
      setTimeout(() => resolve(), 3000);
    } catch (err) {
      console.error('❌ Lỗi khởi động server:', err);
      reject(err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 600,
    title: 'AloNha - Nhắn tin bảo mật',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    show: false,
    frame: true,
    backgroundColor: '#f1f2f4'
  });

  // Menu
  const menuTemplate = [
    {
      label: 'AloNha',
      submenu: [
        { 
          label: 'Về AloNha', 
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Về AloNha',
              message: 'AloNha v1.3.0',
              detail: 'Ứng dụng nhắn tin bảo mật, đa nền tảng.\nPhát triển bởi Phạm Tuấn Hiệp.'
            });
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát' }
      ]
    },
    {
      label: 'Xem',
      submenu: [
        { role: 'reload', label: 'Tải lại' },
        { role: 'forceReload', label: 'Tải lại (Xóa cache)' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Công cụ phát triển' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { role: 'resetZoom', label: 'Mặc định' }
      ]
    },
    {
      label: 'Cửa sổ',
      submenu: [
        { role: 'minimize', label: 'Thu nhỏ' },
        { role: 'close', label: 'Đóng' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Load giao diện từ localhost
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Khi load hoàn tất thì hiện cửa sổ
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Giao diện đã load xong!');
    mainWindow.show();
  });

  // Nếu load thất bại, thử lại
  mainWindow.webContents.on('did-fail-load', () => {
    console.log('⚠️ Load thất bại, thử lại sau 3 giây...');
    setTimeout(() => {
      mainWindow.loadURL(`http://localhost:${PORT}`);
    }, 3000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Xử lý link ngoài
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// 🚀 App Lifecycle
app.whenReady().then(async () => {
  console.log('🚀 AloNha Desktop đang khởi động...');
  
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error('❌ Lỗi:', err);
    // Vẫn thử tạo cửa sổ
    createWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
