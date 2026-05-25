Set o=CreateObject("WScript.Shell") 
Set f=CreateObject("Scripting.FileSystemObject") 
p=f.GetParentFolderName(WScript.ScriptFullName) 
o.Run """" & p & "\BWPScaleBridge.exe""", 0, False 
