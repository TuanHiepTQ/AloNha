// ======================================================
// 🪟 AloNha Windows Desktop - Preload Script (Bảo mật)
// ======================================================
// File này chạy trước khi trang web load, cho phép
// truyền an toàn một số API của Electron sang renderer

const { contextBridge, ipcRenderer } = require('electron');

// Bridge các API an toàn từ Electron sang Web App
contextBridge.exposeInMainWorld('electronAPI', {
  // Kiểm tra có đang chạy trong Electron không
  isElectron: true,

  // Lấy thông tin ứng dụng
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Điều khiển cửa sổ
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Thông báo native
  showNotification: (title, body) => {
    const notification = new Notification(title, { body });
  }
});
