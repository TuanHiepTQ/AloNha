# ==================================================
# 🚀 AloNha Launcher - Chạy server và mở trình duyệt
# ==================================================
Write-Host "🚀 Đang khởi động AloNha Server..." -ForegroundColor Green

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Kiểm tra port 3000
$portCheck = netstat -ano | Select-String ":3000"
if ($portCheck) {
    Write-Host "⚠️ Port 3000 đang được sử dụng. Đang dọn dẹp..." -ForegroundColor Yellow
    $processes = netstat -ano | Select-String ":3000"
    foreach ($p in $processes) {
        $parts = $p -split '\s+'
        $pid = $parts[$parts.Count - 1]
        if ($pid -match '^\d+$') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
}

# Chạy server
try {
    $serverJob = Start-Job -ScriptBlock {
        param($scriptPath)
        Set-Location $scriptPath
        node server-fixed.js 2>&1
    } -ArgumentList $scriptPath

    Write-Host "⏳ Đợi server khởi động..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8

    # Kiểm tra server
    try {
        $response = Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ Server đã sẵn sàng!" -ForegroundColor Green
            Write-Host "📝 Tài khoản: SuperAdmin / 123456" -ForegroundColor Cyan
            Write-Host "🌐 Mở trình duyệt tại: http://localhost:3000" -ForegroundColor Green
            
            # Mở trình duyệt
            Start-Process "http://localhost:3000"
            
            # Hiển thị console để theo dõi
            Write-Host "`n📋 Nhấn Ctrl+C để dừng server" -ForegroundColor Yellow
            Write-Host "Hoặc đóng cửa sổ này để tắt`n" -ForegroundColor Yellow
            
            # Giữ cửa sổ mở
            while ($true) {
                $jobState = Receive-Job -Job $serverJob -Keep
                if ($jobState) { Write-Host $jobState }
                Start-Sleep -Seconds 5
            }
        }
    } catch {
        Write-Host "❌ Server không phản hồi. Đang thử lại..." -ForegroundColor Red
        Start-Sleep -Seconds 5
        Start-Process "http://localhost:3000"
        
        while ($true) {
            $jobState = Receive-Job -Job $serverJob -Keep
            if ($jobState) { Write-Host $jobState }
            Start-Sleep -Seconds 5
        }
    }
} catch {
    Write-Host "❌ Lỗi: $_" -ForegroundColor Red
    Read-Host "Nhấn Enter để thoát"
}
