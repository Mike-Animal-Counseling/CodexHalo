# CodexHalo

A local-first floating desktop HUD for Codex quota and token usage.

## What is implemented

- One-time Codex consent, disabled by default
- Official Codex CLI app-server quota adapter
- Today token aggregation from local Codex JSONL sessions
- Versioned API-equivalent pricing with safe unknown-model handling
- Capsule and signature double-ring Halo HUDs
- Expanded usage panel and intentionally small settings surface
- Tray recovery, global show/hide shortcut, always-on-top, click-through
- Position persistence, multi-monitor validation, edge auto-hide
- System/light/dark appearance and reduced-motion support

## Development

Requirements: Node 20+, Rust stable, platform prerequisites for Tauri 2, and Codex CLI for live data.

```powershell
npm install
npm test
npm run build
npm run tauri dev
```

Browser development shows clearly labeled preview data. The packaged Tauri app uses the Rust boundary and never accesses Codex data until the user enables Codex.

## Repository

- `apps/desktop`  React/TypeScript HUD and Tauri shell
- `crates/codex-client`  narrow app-server quota client
- `crates/token-usage`  local JSONL token aggregation
- `crates/pricing`  versioned API-equivalent calculation
- `crates/shared`  normalized data models
- `docs`  architecture, privacy, security, and provenance

This project has no telemetry, cloud service, browser-cookie extraction, or API-key management.
