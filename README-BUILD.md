# 🚀 Hướng dẫn đóng gói AloNha thành ứng dụng Native

## Yêu cầu cài đặt trước

### 1. Cài Node.js (bắt buộc)
Tải và cài Node.js (v18+): https://nodejs.org/
Sau khi cài, kiểm tra:
```bash
node -v
npm -v
```

### 2. Cài các dependencies của server
Mở Terminal (CMD/PowerShell) tại thư mục `E:\AloNha` và chạy:
```bash
cd E:\AloNha
npm init -y
npm install express socket.io cors pg multer jsonwebtoken bcryptjs googleapis
```

---

## 🪟 WINDOWS - Tạo file .exE Desktop

### Cách 1: Dùng Electron (Có giao diện - Khuyên dùng)

```bash
# Cài Electron
npm install --save-dev electron electron-builder

# Tạo thư mục electron-app
mkdir electron-app
```

Tạo file `electron-app/main.js` (xem nội dung bên dưới)
Tạo file `electron-app/preload.js` (xem nội dung bên dưới)

### Build file .EXE:
```bash
# Build ra file cài đặt Windows
npx electron-builder --win --x64
```

File .exe sẽ được tạo trong thư mục `dist-electron/`

### Cách 2: Dùng pkg (Chạy server + tự động mở browser - Nhẹ hơn)
```bash
npm install -g pkg
pkg server.js --targets node18-win-x64 --output AloNha-Server.exe
```

---

## 📱 ANDROID - Tạo file .APK

### Bước 1: Cài đặt môi trường Android
- Tải Android Studio: https://developer.android.com/studio
- Vào SDK Manager, cài Android SDK 33+
- Set biến môi trường `ANDROID_HOME`

### Bước 2: Cài Capacitor và build
```bash
# Cài Capacitor
npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android

# Khởi tạo Capacitor
npx cap init AloNha com.alonha.app

# Đồng bộ web vào Android project
npx cap add android
npx cap copy android

# Mở Android Studio để build APK
npx cap open android
```

Trong Android Studio:
1. Vào menu **Build > Build Bundle(s) / APK(s) > Build APK(s)**
2. File APK sẽ nằm ở: `mobile-app/android/app/build/outputs/apk/debug/`

### Hoặc build bằng command line:
```bash
cd mobile-app/android
./gradlew assembleDebug
```

---

## 🍎 iOS (iPhone/iPad) - Tạo file .IPA

### Yêu cầu: Chỉ build được trên macOS

```bash
# Cài Capacitor iOS
npm install --save-dev @capacitor/ios

# Thêm iOS platform
npx cap add ios
npx cap copy ios

# Mở Xcode
npx cap open ios
```

Trong Xcode:
1. Chọn device là "Any iOS Device"
2. Vào **Product > Archive**
3. Distribute App

---

## 📦 Cấu trúc thư mục sau khi hoàn tất

```
E:\AloNha\
│
├── app.js                 # Client-side JavaScript
├── index.html             # Giao diện người dùng
├── server.js              # Server backend (chạy trên localhost:3000)
├── package.json           # Cấu hình npm
│
├── electron-app/          # 🪟 Windows Electron
│   ├── main.js
│   └── preload.js
│
├── mobile-app/            # 📱 Android/iOS (Capacitor)
│   ├── android/
│   └── ios/
│
├── dist-electron/         # File .exe sau khi build
│   └── AloNha Setup x.x.x.exe
│
└── node_modules/          # Thư viện (tự sinh khi npm install)
```

---

## ⚙️ Cấu hình PORT

Server mặc định chạy ở port **3000**.
Để thay đổi, tạo file `.env`:
```
PORT=8080
```
