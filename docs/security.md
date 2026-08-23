# Security and privacy

The critical invariant is enforced in Rust: `status::refresh` checks persisted consent before resolving a Codex path, starting the Codex CLI, or reading sessions.

- Codex is disabled by default.
- Disabling clears the in-process status cache.
- The frontend has no filesystem permission.
- The CSP permits bundled content and Tauri IPC only.
- External authentication is delegated to the official Codex CLI.
- Browser cookies and manually pasted tokens are never used.
- Unknown model prices produce unavailable; they are never guessed.
- Automated parser tests use temporary roots, never the developer's Codex home.

Click-through mode remains recoverable through the tray and global shortcut.
