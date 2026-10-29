Option Explicit
' Silently start NapCat + brain + bridge + pet (no console windows).
' Manual start also clears the "paused" flag, so the watchdog resumes too.
Dim sh, fso, here, cmd, flag
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

flag = here & "\state\paused.flag"
If fso.FileExists(flag) Then fso.DeleteFile flag, True

cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & here & "\silent-launch.ps1"""
sh.Run cmd, 0, False
