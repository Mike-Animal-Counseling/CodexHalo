# Production security requirements

The supported application target is Windows. Build with the locked Rust/npm dependencies, a supported Rust toolchain and Node 24 or later. The restrictive Tauri capabilities/CSP are part of the security boundary; do not add shell/filesystem permissions broadly. Local Codex data and diagnostic exports can contain private user information and must remain private.

The all-platform Cargo lock includes Linux GTK dependencies even though the public application is Windows-only. Any Linux-only advisory must be evaluated against the actual Windows dependency graph; it is not evidence that a Windows binary includes the affected code. Linux/macOS builds are unsupported and must not be distributed until their dependency findings and platform permissions are resolved. The security workflow retains the full advisory report and checks the supported Windows dependency graph.
