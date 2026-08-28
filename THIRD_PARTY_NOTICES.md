# Third-party notices

CodexHalo is built with third-party open-source software. The exact dependency
graph and versions used for a build are recorded in Cargo.lock and
package-lock.json.

The complete dependency set includes software under permissive licenses such as
MIT, Apache-2.0, BSD, ISC, Unicode-3.0, Zlib, CC-BY-4.0, MPL-2.0, and the
Unlicense. Principal runtime components include Tauri, React, Tokio, Serde,
windows-rs, zstd-rs, and walkdir. Copyright and license terms remain with their
respective authors. Package identities, exact versions, sources, and integrity
checksums are preserved in the lockfiles; complete license texts are available
in the corresponding upstream packages.

The project-local Anthropic frontend-design skill is a development-only
resource and is not application runtime code. Its pinned provenance is recorded
in docs/skill-provenance.md, and its original Apache-2.0 license is preserved at
.agents/skills/frontend-design/LICENSE.txt.

CodexHalo itself is licensed under the MIT License; see LICENSE.
