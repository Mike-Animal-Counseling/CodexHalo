# Changelog

This file records user-visible changes. README News links to published releases;
maintenance-only changes can remain under Unreleased until the next app release.
Release dates use America/Los_Angeles.

## Unreleased

No unreleased changes yet.

## [1.1.3](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.3) - 2026-10-08

- Prevent truncated or corrupt compressed history files from stalling usage refresh.
- Bound each Codex request with a single deadline and reject oversized response lines.
- Stop revoked session scans between reads; discard stale frontend responses after access changes.
- Send only quota fields to the transition window and clear its state after transitions or disabling access.
- Upgrade development dependencies to patched versions and add weekly/lockfile-change security audits.

## [1.1.2](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.2) - 2026-10-07

- Match the retracted screen-edge handle to the selected quota progress palette, including its grip, border, hover glow, and focus outline.
- Keep colors synchronized when quota data or the preferred limit changes; preserve connection and unavailable-data colors.

## [1.1.1](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.1) - 2026-10-07

### Changed

- Move History into a dedicated page reached through a dashboard icon; enlarge the chart and show the selected period's token breakdown.
- Move token pricing into a compact page with model rates, estimates, and catalog version.
- Split Settings into General, Reminders, and Prices tabs so each page fits the HUD.
- Paginate longer quota and model lists instead of extending the panel; remove scrolling tracks.
- Honor the API-equivalent visibility preference in the overview and preserve keyboard focus when navigating pages.
- Document price synchronization separately from application upgrades.

### Project

- Add README News, Chinese documentation, and a new synthetic-data video demo.
- Add contribution and release guides, security reporting, a code of conduct, issue forms, and a pull request template.
- Add read-only Windows CI for frontend, Rust, pricing-parser, and privacy-regression checks.
- Align the Node.js engine requirement with the locked frontend toolchain.

## [1.1.0](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.1.0) - 2026-10-06

- Replace the retracted arrow tile with a rounded edge handle and smooth reveal on all four edges.
- Add 7-day, 30-day, and yearly local token trends with keyboard navigation.
- Add configurable quota-reset notifications, including reminders at reset and while the HUD is hidden.
- Add an independently published token-price catalog with daily/manual downloads, verified local caching, and offline fallback.
- Show per-model token/rate/value breakdowns and mark unknown or partial prices explicitly.
- Improve light-theme contrast and scrollable details/settings within the existing HUD size.

## [1.0.0](https://github.com/Mike-Animal-Counseling/CodexHalo/releases/tag/v1.0.0) - 2026-08-29

- Initial Windows release with floating Codex quota, today's local token usage, and API-equivalent estimates.
