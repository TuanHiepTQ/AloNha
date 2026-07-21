// ==================================================
// 🚀 AloNha Desktop - Ch?y server trong cùng ti?n trình
// ==================================================

const http = require('http');
const path = require('path');
const cp = require('child_process');

const PORT = 3000;
const APP_ROOT = __dirname;

console.log('================================================');
console.log('      ?? AloNha - ?ng d?ng nh?n tin b?o m?t');
console.log('================================================');
console.log('');
console.log('? ??ang kh?i ??ng AloNha Server...');

try {
  process.title = 'AloNha Server';
  process.env.PORT = PORT.toString();
  
  // Load server-fixed.js tr?c ti?p (ch?y trong cùng process)
  require(path.join(APP_ROOT, 'server-fixed.js'));
  
  console.log('? AloNha Server ?ã s?n sàng!');
  console.log('? Tài kho?n: SuperAdmin / 123456');
  console.log('');
} catch (err) {
  console.error('? L?i kh?i ??ng server:', err.message);
  console.error(err.stack);
  process.exit(1);
}

function waitAndOpenBrowser() {
  const checkServer = () => {
    try {
      const req = http.get('http://localhost:' + PORT, (res) => {
        if (res.statusCode === 200) {
          openBrowser('http://localhost:' + PORT);
        } else {
          setTimeout(checkServer, 1000);
        }
        res.resume();
      });
      req.on('error', () => setTimeout(checkServer, 1000));
      req.setTimeout(3000, () => { req.destroy(); setTimeout(checkServer, 1000); });
    } catch(e) {
      setTimeout(checkServer, 1000);
    }
  };
  setTimeout(checkServer, 4000);
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      cp.exec('start "" "' + url + '"', { shell: true });
    } else if (process.platform === 'darwin') {
      cp.exec('open "' + url + '"');
    } else {
      cp.exec('xdg-open "' + url + '"');
    }
    console.log('? ??ang m? trình duy?t...');
    console.log('');
    console.log('? ?óng c?a s? này ?? d?ng server');
  } catch(e) {
    console.log('? Vui lòng truy c?p: http://localhost:' + PORT);
  }
}

waitAndOpenBrowser();
