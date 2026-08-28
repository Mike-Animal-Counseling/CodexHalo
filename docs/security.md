# Security and privacy

The primary invariant is enforced in Rust: persisted consent is checked before
Codex path discovery, process launch, app-server access, or session reads.

- Codex access is disabled by default.
- Disabling increments a consent generation, clears the process-local status
  cache, and prevents an older in-flight refresh from committing data.
- The backend login command independently requires consent.
- The frontend has no filesystem or shell command and only the Tauri event and
  window-visibility permissions it uses.
- Production CSP allows bundled content and Tauri IPC, blocks external script,
  object, frame, form, and connection destinations, and permits inline styles
  only because the HUD uses runtime style variables.
- External authentication and quota networking are delegated to the official
  Codex executable with fixed arguments and no shell interpolation.
- Browser profiles, cookies, credentials, manually pasted tokens, terminal
  history, unrelated workspaces, and process memory are never used.
- Automated parser tests use repository-local temporary roots, never the
  developer's Codex home.

After consent, session JSON lines are parsed locally to find structured model
and token fields. Other payload fields may transiently exist in parser memory
while a JSON record is decoded, but CodexHalo does not retain, persist, log, or
upload prompt/conversation content.

CodexHalo has no telemetry, analytics, updater, or developer-controlled network
service. The official Codex process may connect to OpenAI after consent. The
NSIS installer may use Microsoft's official WebView2 bootstrapper if WebView2
is missing. Show when Codex starts performs a lightweight process-name and
executable-path check; it does not inspect process command lines, content, or
memory.

Hidden and edge-retracted states remain recoverable through the tray and global
shortcut. The explicit HUD close control hides the native window rather than
destroying it.
