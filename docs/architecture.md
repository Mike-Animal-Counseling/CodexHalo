# Architecture

CodexHalo is a Tauri 2 desktop utility. React renders the HUD but receives no filesystem capability. Rust exposes only typed commands for settings, refresh, login launch, and window position.

```text
React HUD -> narrow Tauri IPC -> consent gate
                              -> Codex app-server quota client
                              -> local session token parser
                              -> local pricing engine
```

The services are intentionally independent. Quota does not depend on token parsing, and pricing does not influence quota. Cached status is process-local; durable history can be added later without changing the UI contract.

The app-server method currently used is `account/rateLimits/read`, after `initialize` and `account/read`. Unknown window durations remain generic in the normalized model.
