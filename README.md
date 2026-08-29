<div align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" width="96" height="96" alt="CodexHalo logo">
  <h1>CodexHalo</h1>
  <p><strong>Your Codex limits and local usage, always in sight.</strong></p>
  <p>A small, privacy-first floating HUD for Windows.</p>
  <p>
    <a href="https://github.com/Mike-Animal-Counseling/CodexHalo/releases/latest"><strong>Download CodexHalo v1.0.0</strong></a>
  </p>
</div>

CodexHalo keeps the information you check most often in a compact desktop
capsule. Click it for details, drag it anywhere, or tuck it against a screen
edge when you want it out of the way.

CodexHalo is an independent community utility and is not an official OpenAI
product.

## What it shows

- Current Codex quota and reset time
- Today's input, cached-input, output, reasoning, and total tokens
- Usage grouped by model
- API-equivalent value for models with published pricing

The HUD stays on top, remembers its position, supports multiple monitors, and
can always be restored from the tray or your configured shortcut.

## Install

CodexHalo v1 supports 64-bit Windows 10 and Windows 11.

1. Download
   [CodexHalo_1.0.0_x64-setup.exe](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/download/v1.0.0/CodexHalo_1.0.0_x64-setup.exe).
2. Run the installer.
3. Open CodexHalo from the Start menu.
4. Enable Codex access in the app when you are ready to connect this Windows
   user's Codex environment.

SHA-256:

~~~text
27A35F79FAC9E0B938E6669D0039E87D9D36CE8A8A81D2A86AE59572EBC903F5
~~~

> **Windows signing notice:** v1.0.0 is unsigned. Windows SmartScreen may show
> a reputation warning. Confirm the installer name and verify the SHA-256
> above before running it.

Microsoft Edge WebView2 Runtime is required and is already included with most
current Windows installations.

## How it works

Codex access is off on first launch. After you enable it, CodexHalo reads the
supported Codex account and session data owned by the current Windows user.
Quota data and local token data refresh independently.

Supported Codex entry points include:

- Codex in the VS Code extension
- The official Codex CLI
- The official Codex Windows app when it uses the same Codex data
  infrastructure

Concurrent, resumed, and branched sessions are deduplicated using structured
Codex metadata rather than process names.

## Privacy

- Codex access is disabled by default and enforced by the Rust backend.
- Before you enable access, CodexHalo does not scan Codex sessions or request
  account and quota data.
- Session files are processed locally for structured token and model fields.
  Prompt content is not retained or uploaded by CodexHalo.
- There is no telemetry, analytics SDK, updater, or developer-controlled
  backend.
- Disabling Codex access stops future reads, clears cached status, and rejects
  any refresh already in progress.

CodexHalo does not read browser cookies, passwords, browser history, terminal
history, unrelated workspaces, or process memory.

## Build from source

Requirements: Node.js 20+, Rust stable with the Windows MSVC target, Visual
Studio C++ build tools, and WebView2 development prerequisites.

~~~powershell
npm ci
npm test
npm run build
cargo test --workspace --locked
npm run release:windows
~~~

The release script builds bundled frontend assets, removes public debug symbols,
remaps developer source paths, and runs privacy checks on the EXE and installer.

## Notes

- Windows x64 is the only v1 target.
- API-equivalent value is an informational base-rate estimate, not a bill.
- Models without published pricing remain visible but are excluded from the
  estimated value.
- A custom <code>CODEX_HOME</code> is used only when CodexHalo is launched with
  that same environment.

## License

CodexHalo is available under the [MIT License](LICENSE). Third-party notices are
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
