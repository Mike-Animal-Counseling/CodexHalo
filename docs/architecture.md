# Architecture

CodexHalo is a Tauri 2 Windows desktop utility. React renders the HUD but does
not receive filesystem or shell capability. Rust exposes typed commands for
settings, consent, refresh/login, and native-window behavior.

    React HUD -> narrow Tauri IPC -> backend consent gate
                                  -> official Codex app-server quota adapter
                                  -> local Codex session token parser
                                  -> local versioned pricing engine

Quota, token parsing, model attribution, and pricing are separate modules. A
refresh returns one coherent dashboard snapshot and the prior snapshot may be
shown as stale when an upstream operation fails.

Quota uses account/rateLimits/read after the official Codex app-server
initialize and account/read flow. Every structured window containing a numeric
duration and used percentage is normalized; unknown future durations are
preserved rather than discarded.

Token aggregation scans only sessions and archived_sessions under the effective
Codex home. JSONL and JSONL.ZST rollouts are normalized into ordered per-thread
events before cumulative deltas are calculated. This allows active, archived,
resumed, concurrent, and subagent streams to share one attribution algorithm
without depending on VS Code, CLI, or desktop process identity.

Portable parsing, pricing, and shared data crates remain separate from
Windows-specific Tauri window, tray, startup, and process-detection code.

The public price catalog is bundled independently of the executable and can
be refreshed daily/manual from a fixed HTTPS GitHub endpoint. Rust validates
and saves a local fallback; frontend code retains its narrow IPC-only network
policy. A read-only scheduled repository workflow checks official pricing and
produces a candidate artifact for maintainers to review and publish.

A native 15-second reminder ticker observes quota reset cycles and dispatches
Windows notifications once per cycle at a configurable lead time (0 means at
reset). It preserves an observed cycle briefly after the quota API advances,
checks the consent generation before dispatch, and refreshes quota while hidden.
