' =============================================
' 🚀 AloNha Launcher (VBScript)
' =============================================
' Chạy server ẩn (không hiện console) + mở trình duyệt
' =============================================

Dim objShell, strCmd, strNodePath, strScriptPath

Set objShell = CreateObject("WScript.Shell")

' Lấy thư mục hiện tại
strScriptPath = CreateObject("Scripting.FileSystemObject").GetAbsolutePathName(".")
strNodePath = strScriptPath & "\node.exe"

' Kiểm tra xem node.exe có tồn tại không
Dim fso, nodeExists
Set fso = CreateObject("Scripting.FileSystemObject")
nodeExists = fso.FileExists(strNodePath)

If nodeExists Then
    ' Chạy server với cửa sổ ẩn
    objShell.Run """" & strNodePath & """ """ & strScriptPath & "\start-alonha.js""", 0, False
    
    ' Đợi server khởi động
    WScript.Sleep 10000
    
    ' Mở trình duyệt
    objShell.Run "http://localhost:3000", 1, False
    
    ' Hiện thông báo
    MsgBox "AloNha Server da san sang!" & vbCrLf & vbCrLf & _
           "Tai khoan: SuperAdmin" & vbCrLf & _
           "Mat khau: 123456" & vbCrLf & vbCrLf & _
           "Trinh duyet da duoc mo tu dong." & vbCrLf & _
           "De dung server, mo Task Manager va ket thuc node.exe", _
           64, "AloNha - Nhan tin bao mat"
Else
    ' Không có node.exe, thử dùng node từ PATH
    objShell.Run "node """ & strScriptPath & "\start-alonha.js""", 1, False
    WScript.Sleep 10000
    objShell.Run "http://localhost:3000", 1, False
    
    MsgBox "AloNha Server da san sang!" & vbCrLf & vbCrLf & _
           "Tai khoan: SuperAdmin / 123456", _
           64, "AloNha"
End If
