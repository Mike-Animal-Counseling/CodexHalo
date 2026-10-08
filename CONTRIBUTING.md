# Contributing to CodexHalo

CodexHalo is a Windows companion for Codex. Contributions should keep the HUD
small, the desktop behavior predictable, and Codex data on the user's computer.

## Before you start

Use [GitHub Issues](https://github.com/Mike-Animal-Counseling/CodexHalo/issues)
for reproducible bugs or focused feature proposals. For a substantial behavior
change, describe the problem and intended experience before opening a large PR.
Report vulnerabilities through [SECURITY.md](SECURITY.md); never attach Codex
credentials, conversations, or raw session files to a public issue.

## Development setup

Use Windows 10/11 x64 for native development and release verification. Install
Node.js 22.12 or newer (Node 22 LTS recommended), npm, stable Rust with the MSVC
toolchain, Microsoft C++ Build Tools with Desktop development with C++, and
Microsoft Edge WebView2. See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows).
The frontend uses Vite; its [Node requirement](https://vite.dev/guide/#scaffolding-your-first-vite-project)
is stricter than older Node 20 releases.

From the repository root:

```powershell
npm ci
npm run tauri -- dev
```

For frontend-only work, run `npm run dev` and open
`http://localhost:1420`. This browser preview uses synthetic sample data;
it does not read your Codex files or exercise native dragging, tray behavior,
Windows startup, or notifications. Native access remains off until you choose
Enable Codex. CodexHalo does not install Codex for you.

## Project layout

- `apps/desktop/src`: React HUD, native bridge, and frontend tests.
- `apps/desktop/src-tauri`: consent, settings, windows, tray, reminders, and price downloads.
- `crates/codex-client`: official Codex app-server integration.
- `crates/token-usage`: local rollout parsing and daily aggregation.
- `crates/pricing` and `data/pricing.json`: estimates and the public catalog.
- `crates/shared`: shared quota and token types.
- `docs` and `scripts`: design notes, maintenance, and release checks.

Read [architecture](docs/architecture.md), [data model](docs/data-model.md), and
[privacy invariants](docs/security.md) before changing backend behavior. Price
catalog maintenance is described in [docs/pricing.md](docs/pricing.md).

## Validation

Run the checks affected by your change. Before requesting review of application
changes, run the following from the repository root:

```powershell
npm test
npm run build
cargo test --workspace --locked
node --test scripts/update-pricing.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/privacy-public-text.test.ps1
```

Use synthetic, repository-local temporary fixtures in parser and integration
tests. Tests must not scan the contributor's real Codex home. Add regression
coverage for changed behavior; documentation-only changes need link and command
review. For native UI changes, check Windows dragging, all affected edges, tray
recovery, keyboard access, light/dark themes, and reduced motion as applicable.

## Pull requests

Keep each PR focused. Explain the concrete problem, resulting behavior, and
validation; include a synthetic screenshot or short recording when the UI
changes. Update relevant documentation and the Unreleased section of
[CHANGELOG.md](CHANGELOG.md). README News entries describe published releases,
so add them when a release is published rather than for planned work.

Preserve the Rust consent gate, narrow Tauri permissions, and local processing.
Do not add telemetry, upload user data, expose frontend filesystem/shell access,
or broaden the public pricing request with user information. Redact personal
paths and account details from diagnostics and recordings. New dependencies
should have a clear purpose and update lockfiles and third-party notices when
needed. Contributions are distributed under the project's [MIT license](LICENSE).

Maintainers publish Windows releases using [docs/releasing.md](docs/releasing.md).
