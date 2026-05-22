' BWP Scale Bridge - Run hidden background
' รัน BWPScaleBridge.exe โดยไม่เปิด console window

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & strPath & "\BWPScaleBridge.exe""", 0, False
