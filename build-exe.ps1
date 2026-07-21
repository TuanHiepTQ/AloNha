# ===========================================
# T?o file EXE t? BAT b?ng IExpress (Win10+)
# ===========================================
Write-Host "Dang tao file EXE..." -ForegroundColor Green

$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%EXTRACT_DIR%
DisplayLicense=None
FinishMessage=AloNha Desktop
TargetName=AloNhaDesktop.exe
FriendlyName=AloNha Desktop
AppLaunched=AloNha.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=.
[SourceFiles0]
%FILE0%=AloNha.bat
"@

$sedContent | Out-File -FilePath "alonha-ie.sed" -Encoding ASCII

Write-Host "Mo IExpress de tao EXE..." -ForegroundColor Yellow
Write-Host "1. Trong IExpress, chon 'Open existing SED file'" -ForegroundColor Cyan
Write-Host "2. Chon file 'alonha-ie.sed'" -ForegroundColor Cyan  
Write-Host "3. Nhan Next de hoan tat" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hoac don gian: chay 'AloNha.bat' truc tiep!" -ForegroundColor Green

Start-Process iexpress.exe
