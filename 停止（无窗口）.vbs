Option Explicit
' Silently stop bridge + brain + pet.
Dim sh, fso, here, cmd, ret
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

ret = MsgBox("Stop bridge, brain and desktop pet?" & vbCrLf & "NapCat (QQ) will keep running.", 4 + 32, "DSH QQ Bot")
If ret <> 6 Then WScript.Quit

cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & here & "\silent-stop.ps1"""
sh.Run cmd, 0, True
MsgBox "Stopped. NapCat is still running.", 64, "DSH QQ Bot"
