<div align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" width="80" height="80" alt="CodexHalo">
  <h1>CodexHalo</h1>
  <p>Your Codex limits, quietly in sight.</p>
  <p>
    <a href="https://github.com/Mike-Animal-Counseling/codex-halo/releases/latest"><strong>Download for Windows</strong></a>
    &nbsp;&middot;&nbsp; <a href="#build-from-source">Build from source</a>
    &nbsp;&middot;&nbsp; <a href="CHANGELOG.md">Changelog</a>
    &nbsp;&middot;&nbsp; <a href="README.zh-CN.md">&#31616;&#20307;&#20013;&#25991;</a>
  </p>
  <img src="docs/assets/codexhalo-preview.svg" width="900" alt="CodexHalo walkthrough: quota, history trends, reset reminders, token pricing, and edge hide/reveal using synthetic data">
</div>

[![CI](https://github.com/Mike-Animal-Counseling/codex-halo/actions/workflows/ci.yml/badge.svg)](https://github.com/Mike-Animal-Counseling/codex-halo/actions/workflows/ci.yml)

A lightweight Windows companion for Codex. A floating halo shows your remaining quota;
click it for today's usage, or open History for trends and API-equivalent cost estimates.
Built with Tauri 2, React, TypeScript, and Rust.

## Features

- **Quota at a glance** — the limit windows and reset times returned by Codex, commonly five-hour and weekly limits.
- **Usage and trends** — today's input, cached input, output, and per-model usage, plus 7-day, 30-day, and yearly charts.
- **Reset reminders** — notify a chosen number of minutes before reset, even while the halo is hidden.
- **Cost estimates** — per-model API-equivalent estimates in USD with a separately updatable price catalog and offline fallback.
- **Desktop controls** — edge auto-hide, tray restore, **Ctrl + Shift + H**, and light, dark, or system appearance.

Works with installed official Codex CLI and VS Code set-ups; it does not install Codex for you.
The desktop app currently supports **Windows 10/11, x64**.

## Install or upgrade

1. Download the installer from [Releases](https://github.com/Mike-Animal-Counseling/codex-halo/releases/latest).
2. Quit any running CodexHalo from the system tray.
3. Run the installer and launch the app. Upgrading keeps your settings.
4. Enable **Enable Codex**; sign in to Codex if the app cannot connect.

The installer is unsigned, so Windows may show a SmartScreen prompt. Verify a download with:

```powershell
Get-FileHash .\CodexHalo_1.1.3_x64-setup.exe -Algorithm SHA256
```

Compare it with [SHA256SUMS.txt](https://github.com/Mike-Animal-Counseling/codex-halo/releases/download/v1.1.3/SHA256SUMS.txt).
There is no executable auto-updater; upgrades come from GitHub Releases.

## Privacy

Codex access is off until you enable it. Session files are parsed locally; CodexHalo
does not upload prompts, credentials, or usage data and has no telemetry. Price checks
download only a public JSON catalog. See [security and privacy](docs/security.md).

## Build from source

Windows with Node.js **22.12+**, stable Rust, Microsoft C++ Build Tools, and WebView2.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup.

```powershell
git clone https://github.com/Mike-Animal-Counseling/codex-halo.git
cd codex-halo
npm ci
npm run tauri -- dev
```

`npm run dev` opens a browser preview with synthetic data. `npm run release:windows`
builds the installer with privacy checks.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Desktop/frontend boundaries and Codex integration |
| [Data model](docs/data-model.md) | Token aggregation, history, and estimates |
| [Pricing](docs/pricing.md) | Rates, assumptions, and catalog maintenance |
| [Releasing](docs/releasing.md) | Versions, checksums, and publication |
| [Changelog](CHANGELOG.md) | Release history |
| [Security](SECURITY.md) | Supported release and private vulnerability reports |

Bugs and feature requests: [issue forms](https://github.com/Mike-Animal-Counseling/codex-halo/issues/new/choose).
Sanitize screenshots and logs before posting.

## License

[MIT](LICENSE). Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
CodexHalo is an independent community utility and is not an official OpenAI product.
