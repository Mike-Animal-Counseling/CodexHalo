# CodexHalo

**A lightweight, local-first floating Codex usage HUD for Windows.**

![CodexHalo icon](apps/desktop/src-tauri/icons/128x128.png)

CodexHalo keeps quota, reset times, local token usage, and per-model attribution
in a small always-on-top desktop object. It is an independent community utility
and is not an official OpenAI product.

## Demo

    floating capsule -> click -> compact detail panel
      current limit      quota + reset + today's tokens + models
             drag to an edge -> retract to a recoverable handle

The tray menu and the global shortcut can restore the HUD at any time.

## Windows v1 features

- Frameless transparent HUD with always-on-top, native drag, saved position,
  multi-monitor recovery, edge snap/retract, and expand/collapse
- Dynamic quota windows and reset times exactly as reported by Codex
- Today's input, cached-input, output, reasoning, total, and per-model tokens
- Versioned API-equivalent estimate for models with published prices
- Tray recovery and a configurable global show/hide shortcut
- System, light, and dark appearance plus reduced-motion support
- Startup modes: Off, Start with Windows, and Show when Codex starts

## Requirements and installation

CodexHalo v1 supports 64-bit Windows 10/11. Microsoft Edge WebView2 Runtime is
required. Current Windows versions normally include it; when it is missing, the
installer may use Microsoft's official WebView2 bootstrapper.

1. Download the CodexHalo 1.0.0 NSIS setup executable from the eventual release.
2. Verify its SHA-256 against the hash published with that release.
3. Run the current-user installer, then launch CodexHalo from the Start menu.
4. Codex access is off on first launch. Enable it only when you want the app to
   read this Windows user's Codex environment.

The current candidate is unsigned, so Windows SmartScreen may display a
reputation warning until a production signing identity and reputation exist.

## Supported Codex entry points

Windows v1 consumes Codex-owned shared account/session data rather than
classifying usage by frontend. The same aggregation path supports:

- Codex in the VS Code extension
- the official Codex CLI
- the official Codex Windows desktop app where it uses the same supported Codex
  account and session infrastructure

Concurrent and resumed sessions are grouped by structured thread metadata and
cumulative counters, so a frontend or process is not itself a billable event.
A process-specific custom CODEX_HOME is visible only when CodexHalo is launched
with that same effective CODEX_HOME; multiple unrelated Codex homes are not
automatically combined.

## Quotas, tokens, and pricing

Quota is server-reported allowance and reset data from the official Codex
app-server. Token usage is a local aggregation of structured counters in the
current user's Codex session rollouts. They are different measurements and may
refresh or fail independently upstream.

The HUD renders only valid quota windows returned by Codex. When more than one
is available, the user can choose which returned duration is primary; a stale
preference safely falls back to the longest currently available window.

Model identity comes from structured per-turn Codex metadata. Unknown future
model IDs are preserved. Unclassified is used only when no reliable model
metadata exists.

API equivalent is an informational estimate, not the user's ChatGPT Plus bill
and not a charge. It uses the versioned published base API token rates in the
pricing crate, calculates only models with known pricing, and identifies
unpriced models separately. Aggregate session counters cannot reconstruct
request-specific long-context, service-tier, regional, or tool charges, so the
displayed value is a base-rate subtotal.

## Privacy and network behavior

- Codex access is disabled by default and enforced in the Rust backend.
- Before consent, CodexHalo does not resolve the Codex home, scan sessions,
  query account/quota state, or start the Codex app-server.
- After consent, it resolves the current process's CODEX_HOME, or otherwise the
  current Windows user's .codex directory.
- Session records are parsed locally for structured model/token fields. Prompt
  content is not retained, persisted, or uploaded by CodexHalo.
- Disabling access clears the in-memory status cache, blocks new reads, and
  invalidates any refresh that was already in flight.
- CodexHalo does not read browser profiles, cookies, passwords, history,
  terminal history, unrelated workspaces, or process memory.
- CodexHalo contains no telemetry, analytics SDK, updater, or
  developer-controlled backend.

CodexHalo itself has no general-purpose network client. After consent, the
official Codex CLI may connect to OpenAI for login and quota operations. On a
machine without WebView2, the Windows installer may connect to Microsoft to
install that runtime. Those are not CodexHalo telemetry paths.

## Startup and uninstall behavior

- **Off:** no Windows startup registration
- **Start with Windows:** starts the installed executable at sign-in
- **Show when Codex starts:** starts hidden and uses lightweight process-name
  and executable-path detection to reveal the HUD when a supported Codex client
  appears; this monitor does not read Codex content

Uninstall removes the installed app, shortcuts, uninstall registration, and the
CodexHalo startup entry. Codex account, authentication, and session files are
never uninstall targets. CodexHalo's own per-user settings may remain so a
reinstall can retain preferences.

## Build from source

Requirements: Node.js 20 or newer, Rust stable with the MSVC Windows target,
Visual Studio C++ build tools, WebView2 development prerequisites, and NSIS
support installed by the Tauri tooling.

~~~powershell
npm ci
npm test
npm run build
cargo test --workspace --locked
npm run release:windows
~~~

The Windows release script builds from bundled frontend assets, remaps local
source paths out of Rust output, removes PDB files, and runs executable and
installer privacy checks. Build only from a clean checkout and publish only the
explicit final installer and hash, never the working directory or Git metadata.

## Known limitations

- Windows x64 is the only v1 release target; macOS is not supported.
- The current release candidate is unsigned.
- Custom isolated Codex homes are not auto-discovered or merged.
- API-equivalent values are base-rate estimates and may be partial when a model
  has no published price.
- Real mixed-DPI, multi-monitor, and clean-user behavior should be verified on
  the exact final signed or unsigned candidate before public distribution.

## License and attribution

CodexHalo is available under the [MIT License](LICENSE). Third-party licensing
and attribution are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The audited project-local
design skill retains its original license and pinned provenance in
[docs/skill-provenance.md](docs/skill-provenance.md).
