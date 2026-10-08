<div align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" width="80" height="80" alt="CodexHalo">
  <h1>CodexHalo</h1>
  <p>Your Codex limits, quietly in sight.</p>
  <p>
    <a href="https://github.com/Mike-Animal-Counseling/CodexHalo/releases/latest"><strong>Download for Windows</strong></a>
    &nbsp;&middot;&nbsp; <a href="#news">News</a>
    &nbsp;&middot;&nbsp; <a href="CONTRIBUTING.md">Contribute</a>
    &nbsp;&middot;&nbsp; <a href="README.zh-CN.md">&#31616;&#20307;&#20013;&#25991;</a>
  </p>
  <img src="docs/assets/codexhalo-preview.svg" width="900" alt="High-resolution CodexHalo walkthrough: quota, history trends, reset reminders, token pricing, price updates, and edge hide/reveal using synthetic data">
</div>

[![CI](https://github.com/Mike-Animal-Counseling/CodexHalo/actions/workflows/ci.yml/badge.svg)](https://github.com/Mike-Animal-Counseling/CodexHalo/actions/workflows/ci.yml)

CodexHalo is a lightweight Windows companion for Codex. A small floating halo
shows your remaining quota; click it for today's usage, or open History to
explore past activity. Built with Tauri 2, React, TypeScript, and Rust.

## News

- **2026-10-07 &middot; [v1.1.2](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.2)** Hidden screen-edge handles now match the selected quota progress color, including hover, focus, and unavailable-data states.
- **2026-10-07 &middot; [v1.1.1](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.1)** Separate History and token-price pages; compact settings tabs and model pagination replace long scrolling panels. Add a new demo, bilingual documentation, contribution guides, issue forms, and CI.
- **2026-10-06 &middot; [v1.1.0](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.0)** Smooth screen-edge handles; 7-day, 30-day, and yearly usage trends; customizable quota-reset reminders; independently updated model prices and per-model estimates.
- **2026-08-29 &middot; [v1.0.0](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.0.0)** First Windows release with a floating quota monitor, local daily token usage, and API-equivalent estimates.

See the [full changelog](CHANGELOG.md) and [all releases](https://github.com/Mike-Animal-Counseling/CodexHalo/releases). To follow releases, use GitHub's **Watch > Custom > Releases**.

[Overview screenshot](docs/assets/codexhalo-overview.png) &middot; [History screenshot](docs/assets/codexhalo-history.png)

## Features

- **Quota at a glance.** View the limit windows and reset times returned by Codex, commonly five-hour and weekly limits.
- **Today and History.** Input, cached input, output, and per-model usage today; separate 7-day, 30-day, and yearly charts with keyboard navigation.
- **Compact pages.** History and token pricing have their own buttons. Settings are grouped into General, Reminders, and Prices; longer lists use pagination.
- **Reset reminders.** Choose how many minutes before reset to be notified, including 0 for a reminder at reset. Works while the HUD is hidden, with the app running.
- **Model prices.** Per-model API estimates in USD; daily or manual catalog synchronization, local caching, and offline fallback. Unknown model prices remain unavailable.
- **Desktop controls.** Drag to a screen edge for auto-hide, restore from the tray or **Ctrl + Shift + H**, and choose light, dark, or system appearance.

Works with supported official Codex CLI and VS Code installations. CodexHalo
does not install Codex for you. The shipped desktop app currently supports
**Windows 10/11, x64**.

## Install or upgrade

1. Download the installer from the [latest release](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/latest).
2. If CodexHalo is already running, quit it from the system tray.
3. Run the installer and launch CodexHalo. Installing over the previous version preserves settings unless you explicitly choose to remove app data.
4. Enable **Enable Codex** when ready. Open or sign in to your Codex installation if the app cannot connect.

The installer is currently unsigned; Windows may show a SmartScreen prompt.
Each release provides its installer SHA-256 and a checksum file. Verify a
local download with PowerShell:

```powershell
Get-FileHash .\CodexHalo_1.1.2_x64-setup.exe -Algorithm SHA256
```

Compare the result with [v1.1.2 SHA256SUMS.txt](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/download/v1.1.2/SHA256SUMS.txt).
Application upgrades are installed from GitHub Releases; there is no executable auto-updater.

## Try it

- Click the halo to open the overview, then use the **History** icon to switch between **7d / 30d / 1y**. Use Back to return.
- Open **Token pricing** for compact per-model rates and estimates.
- In **Settings > General**, choose **Edge auto-hide**, drag the halo to a screen edge, then hover over the handle to reveal it.
- In **Settings > Reminders**, enable **Notify before reset**, choose a lead time, and use **Send test reminder**. Windows controls notification delivery; notifications require the installed app.
- In **Settings > Prices**, choose daily synchronization or use **Check for price updates**.

## Price updates

Prices live in [data/pricing.json](data/pricing.json), separately from the app.
Once a maintainer publishes a reviewed catalog on the repository's main branch,
installed apps can download it on their next daily check or immediately through
a manual check. **A price-only update does not require reinstalling CodexHalo.**

The repository's daily check reads official OpenAI pricing and produces a
candidate catalog for review. It does not automatically publish prices. API
equivalents use published Standard token rates and are informational; they are
not subscription bills. Historical estimates use the current catalog.
See [pricing details and maintenance](docs/pricing.md).

## Privacy

Codex access is off until you enable it. Session files are parsed locally;
CodexHalo does not upload prompts, account credentials, or usage data and has
no telemetry. Disabling access clears in-memory usage caches and prevents
older in-flight reads from updating the dashboard.

Price checks download only a public JSON catalog and send no Codex data. The
official Codex process handles its own authentication and quota requests.
See [security and privacy](docs/security.md), or [report a vulnerability privately](SECURITY.md).

## Build from source

Use Windows with Node.js **22.12+** (22 LTS recommended), stable Rust, Microsoft
C++ Build Tools, and WebView2. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup.

```powershell
git clone https://github.com/Mike-Animal-Counseling/CodexHalo.git
cd CodexHalo
npm ci
npm run tauri -- dev
```

For a browser preview with synthetic data, run `npm run dev`.
To build the Windows installer with privacy checks, run `npm run release:windows`.

## Project documentation

| Document | Purpose |
| --- | --- |
| [Contributing](CONTRIBUTING.md) | Development setup, tests, and pull requests |
| [Changelog](CHANGELOG.md) | Detailed release history and unreleased changes |
| [Release checklist](docs/releasing.md) | Versions, demos, checksums, and publication |
| [Architecture](docs/architecture.md) | Desktop/frontend boundaries and Codex integration |
| [Data model](docs/data-model.md) | Token aggregation, history, and estimates |
| [Pricing](docs/pricing.md) | Rates, assumptions, and catalog maintenance |
| [Security policy](SECURITY.md) | Supported release and private vulnerability reports |
| [Security and privacy](docs/security.md) | Consent, local data, and network behavior |

For bugs or feature requests, use the [issue forms](https://github.com/Mike-Animal-Counseling/CodexHalo/issues/new/choose).
Sanitize screenshots and logs before sharing. Contributions follow the
[project code of conduct](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE). Dependency notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

CodexHalo is an independent community utility and is not an official OpenAI product.
