!macro NSIS_HOOK_POSTINSTALL
  ; No production publisher identity is configured; do not invent one.
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexHalo" "Publisher"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; CodexHalo owns only this value. Never touch Codex/OpenAI data or other Run entries.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CodexHalo"
!macroend
