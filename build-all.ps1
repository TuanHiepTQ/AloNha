# ======================================================
# 🏗️ AloNha Build Script - Tự động build cho mọi nền tảng
# ======================================================
# Cách dùng:
#   .\build-all.ps1          # Build tất cả
#   .\build-all.ps1 -win     # Chỉ build Windows
#   .\build-all.ps1 -android # Chỉ build Android
#   .\build-all.ps1 -setup   # Chỉ cài dependencies
# ======================================================

param(
    [switch]$win,
    [switch]$android,
    [switch]$ios,
    [switch]$setup
)

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🏗️  AloNha Build Script v1.0           ║" -ForegroundColor Cyan
Write-Host "║     Ứng dụng nhắn tin đa nền tảng          ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Kiểm tra Node.js
try {
    $nodeVersion = node -v
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js chưa được cài đặt!" -ForegroundColor Red
    Write-Host "👉 Tải tại: https://nodejs.org (v18+)" -ForegroundColor Yellow
    exit 1
}

# Kiểm tra npm
try {
    $npmVersion = npm -v
    Write-Host "✅ npm: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm chưa được cài đặt!" -ForegroundColor Red
    exit 1
}

# Kiểm tra package.json tồn tại
if (-not (Test-Path "package.json")) {
    Write-Host "📦 Khởi tạo package.json..." -ForegroundColor Yellow
    npm init -y
}

# Cài dependencies
if ($setup -or (-not (Test-Path "node_modules"))) {
    Write-Host ""
    Write-Host "📥 Đang cài dependencies..." -ForegroundColor Yellow
    
    Write-Host "  → Server dependencies..." -ForegroundColor Gray
    npm install express socket.io cors
    
    Write-Host "✅ Dependencies đã cài xong!" -ForegroundColor Green
}

# Build Windows
if ($win -or (-not $android -and -not $ios -and -not $setup)) {
    Write-Host ""
    Write-Host "🪟 BUILD CHO WINDOWS" -ForegroundColor Cyan
    Write-Host "────────────────" -ForegroundColor Cyan
    
    # Kiểm tra electron và electron-builder
    if (-not (Test-Path "node_modules/electron")) {
        Write-Host "📥 Cài Electron..." -ForegroundColor Yellow
        npm install --save-dev electron electron-builder
    }
    
    Write-Host "🔨 Đang build file .exe..." -ForegroundColor Yellow
    npx electron-builder --win --x64
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Build Windows thành công!" -ForegroundColor Green
        Write-Host "📁 File .exe nằm trong thư mục: dist-electron/" -ForegroundColor Green
    } else {
        Write-Host "❌ Build Windows thất bại!" -ForegroundColor Red
    }
}

# Build Android
if ($android -or (-not $win -and -not $ios -and -not $setup)) {
    Write-Host ""
    Write-Host "📱 BUILD CHO ANDROID" -ForegroundColor Cyan
    Write-Host "────────────────" -ForegroundColor Cyan
    
    # Kiểm tra Capacitor
    if (-not (Test-Path "node_modules/@capacitor/core")) {
        Write-Host "📥 Cài Capacitor..." -ForegroundColor Yellow
        npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android
    }
    
    # Kiểm tra capacitor.config.json
    if (-not (Test-Path "capacitor.config.json")) {
        Write-Host "❌ Thiếu file capacitor.config.json!" -ForegroundColor Red
        exit 1
    }
    
    # Kiểm tra Android project
    if (-not (Test-Path "android")) {
        Write-Host "📂 Khởi tạo Android project..." -ForegroundColor Yellow
        npx cap init AloNha com.alonha.app
        npx cap add android
    }
    
    Write-Host "📂 Copy web files vào Android project..." -ForegroundColor Yellow
    npx cap copy android
    
    Write-Host "🔨 Đang build APK..." -ForegroundColor Yellow
    Push-Location android
    ./gradlew assembleDebug
    Pop-Location
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Build Android thành công!" -ForegroundColor Green
        Write-Host "📁 File APK nằm tại: android/app/build/outputs/apk/debug/app-debug.apk" -ForegroundColor Green
    } else {
        Write-Host "❌ Build Android thất bại!" -ForegroundColor Red
        Write-Host "👉 Hãy đảm bảo bạn đã cài Android Studio và SDK" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🎉 Hoàn tất quá trình build!           ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
