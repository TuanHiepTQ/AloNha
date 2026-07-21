# 🏗️ HƯỚNG DẪN BUILD FILE CÀI ĐẶT NATIVE

## 📋 Tổng quan

Dự án AloNha đã được cấu trúc sẵn để đóng gói thành:
- 🪟 **Windows**: File `.exe` cài đặt (Electron)
- 📱 **Android**: File `.apk` / `.aab` (Capacitor)
- 🍎 **iPhone/iPad**: File `.ipa` (Capacitor + Xcode - macOS required)

---

## 🪟 1. BUILD CHO WINDOWS (.exe)

### Yêu cầu:
- Node.js 18+ (tải tại: https://nodejs.org)
- Git (tải tại: https://git-scm.com)

### Các bước thực hiện:

```bash
# Mở Terminal (CMD/PowerShell) tại thư mục E:\AloNha

# Bước 1: Cài dependencies
npm init -y
npm install express socket.io cors pg multer jsonwebtoken bcryptjs googleapis

# Bước 2: Cài Electron và Electron Builder
npm install --save-dev electron electron-builder

# Bước 3: Build file .exe
npx electron-builder --win --x64
```

### Kết quả:
- File cài đặt `.exe` sẽ nằm trong thư mục `dist-electron/`
- Tên file: `AloNha Setup 1.3.0.exe`
- Dung lượng: khoảng 80-120MB (bao gồm cả Node.js runtime)

### Tính năng của bản Windows Desktop:
- ✅ Giao diện native, không cần trình duyệt
- ✅ Khởi động server tự động khi mở app
- ✅ System tray (thu nhỏ xuống khay hệ thống)
- ✅ Thông báo desktop native
- ✅ Menu chuẩn Windows
- ✅ Có thể cài đặt và gỡ bỏ như phần mềm thường

---

## 📱 2. BUILD CHO ANDROID (.apk)

### Yêu cầu:
- Node.js 18+
- **Android Studio** (tải tại: https://developer.android.com/studio)
  - Khi cài, chọn "Android SDK", "Android SDK Platform 33+"
  - "Android Virtual Device" (nếu muốn chạy giả lập)

### Các bước thực hiện:

```bash
# Bước 1: Cài dependencies server
npm init -y
npm install express socket.io cors pg multer jsonwebtoken bcryptjs googleapis

# Bước 2: Cài Capacitor
npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android

# Bước 3: Khởi tạo Capacitor project
npx cap init AloNha com.alonha.app

# Bước 4: Thêm Android platform
npx cap add android

# Bước 5: Copy web files vào Android project
npx cap copy android

# Bước 6: Mở Android Studio (NẾU muốn chỉnh sửa thêm)
npx cap open android

# Bước 7: Build APK từ command line (không cần mở Android Studio)
cd android
./gradlew assembleDebug
```

### Kết quả:
- File `.apk` nằm tại: `android/app/build/outputs/apk/debug/app-debug.apk`

### Lưu ý cho Android:
- Ứng dụng này chạy server ngay trên điện thoại (dùng được localhost)
- Cấp quyền: Internet, Location, Camera, Microphone
- Server chạy ngầm trên Android (dùng foreground service)

---

## 🍎 3. BUILD CHO iOS / iPhone (.ipa)

### ⚠️ Yêu cầu BẮT BUỘC:
- **Mac computer** (MacBook, iMac, Mac mini)
- **Xcode 14+** (tải từ App Store)
- **Apple Developer Account** (phí $99/năm để publish lên App Store)

### Các bước thực hiện (trên macOS):

```bash
# Bước 1-4 giống Android (dùng Terminal trên macOS)

# Thêm iOS platform
npx cap add ios

# Copy web files
npx cap copy ios

# Mở Xcode project
npx cap open ios
```

Trong Xcode:
1. Chọn team signing (Apple Developer Account)
2. Chọn device là "Any iOS Device"
3. **Product > Archive**
4. Distribute App: chọn "App Store Connect" (để publish) hoặc "Development" (để cài test)

### Kết quả:
- File `.ipa` được tạo sau khi Archive

---

## 🖥️ 4. CHẠY THỬ TRÊN MÁY TÍNH (KHÔNG CẦN BUILD)

Nếu chỉ muốn chạy thử trên localhost:

```bash
# Cài dependencies
npm init -y
npm install express socket.io cors pg multer jsonwebtoken bcryptjs googleapis

# Chạy server
node server.js
```

Mở trình duyệt vào: **http://localhost:3000**

---

## ❌ Khắc phục lỗi thường gặp

### Lỗi: "npm không được nhận diện"
👉 Cài Node.js từ https://nodejs.org, khởi động lại Terminal

### Lỗi: "Không tìm thấy module 'xxx'"
👉 Chạy: `npm install`

### Lỗi: "gradlew không chạy được trên Windows"
👉 Cài JDK 17+ từ: https://adoptium.net/

### Lỗi: "Android SDK not found"
👉 Mở Android Studio → SDK Manager → Cài Android SDK 33

### Lỗi: "Electron build fail"
👉 Cài Python 3.x và Visual Studio Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/

---

## 📞 Hỗ trợ

Liên hệ: https://alonha.io.vn
