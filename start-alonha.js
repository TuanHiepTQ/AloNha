// ==================================================
// 🚀 AloNha Desktop Launcher (NO PKG NEEDED)
// ==================================================
// File này chạy server và mở trình duyệt
// Dùng node.exe để chạy: node start-alonha.js

const http = require('http');

const PORT = 3000;

console.log('================================================');
console.log('      ?? AloNha - ?ng d?ng nh?n tin b?o m?t');
console.log('================================================');
console.log('');

// Set env
process.env.PORT = PORT.toString();
process.title = 'AloNha Server';

console.log('? ??ang kh?i ??ng AloNha Server...');

// Load server tr?c ti?p
require('./server-fixed.js');

// Ð?i server s?n sàng r?i m? trình duy?t
function openBrowserWhenReady() {
  const checkAgain = () => {
    try {
      const req = http.get('http://localhost:' + PORT, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          openBrowser();
        } else {
          setTimeout(checkAgain, 1000);
        }
      });
      req.on('error', () => setTimeout(checkAgain, 1000));
      req.setTimeout(3000, () => { req.destroy(); setTimeout(checkAgain, 1000); });
    } catch(e) {
      setTimeout(checkAgain, 1000);
    }
  };
  setTimeout(checkAgain, 5000);
}

function openBrowser() {
  const { exec } = require('child_process');
  try {
    exec('start http://localhost:' + PORT, { shell: true });
    console.log('? AloNha Server ?ã s?n sàng!');
    console.log('? Tài kho?n: SuperAdmin / 123456');
    console.log('');
    console.log('??ang m? trình duy?t...');
    console.log('');
    console.log('? ?óng c?a s? này ?? d?ng server');
  } catch(e) {
    console.log('? Vui lòng truy c?p: http://localhost:' + PORT);
  }
}

openBrowserWhenReady();
