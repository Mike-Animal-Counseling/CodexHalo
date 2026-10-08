# Releasing CodexHalo

This checklist is for maintainers publishing the Windows x64 app. Catalog-only
updates to `data/pricing.json` can be reviewed and merged independently;
installed apps receive them on their next daily or manual check without a binary
release. See [pricing maintenance](pricing.md).

## Prepare the release

1. Choose the next version based on the delivered changes. Keep in-progress
   work in CHANGELOG's Unreleased section; do not announce a planned release
   as published in either README.
2. Update `package.json`, `apps/desktop/package.json`,
   `Cargo.toml` (workspace version), and
   `apps/desktop/src-tauri/tauri.conf.json`. Synchronize the root/workspace
   package entries in `package-lock.json` and all CodexHalo workspace
   package versions in `Cargo.lock`. Keep dependency updates separate
   unless they are required for the release.
3. Preserve the application identifier `com.codexhalo.desktop`, product
   name, and settings migration behavior so the installer upgrades the existing
   app. Do not invent a publisher identity or claim a signature the build lacks.
4. Move delivered Unreleased notes into a versioned CHANGELOG entry. Update
   download links and News in both `README.md` and
   `README.zh-CN.md`. News should link to the actual
   `/releases/tag/vX.Y.Z` page, use newest-first order, and summarize what
   users can experience. Use the release's actual calendar date in
   America/Los_Angeles for News and CHANGELOG; confirm it if publication spans
   midnight. Keep the two languages consistent.
5. Write release notes with changes, upgrade instructions, supported platform,
   relevant limitations, and validation. Capture preview images and a short demo
   using synthetic data only. Show changed behavior such as navigation, history,
   edge reveal, or settings; do not expose real usage, conversations, usernames,
   or machine paths. Identify a browser preview as a demo rather than a native
   Windows test.

## Validate and build

Use the Windows prerequisites in [CONTRIBUTING.md](../CONTRIBUTING.md), including
Node 22.12+ and stable Rust/MSVC. Run from the repository root:

```powershell
npm ci
npm test
npm run build
cargo test --workspace --locked
node --test scripts/update-pricing.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/privacy-public-text.test.ps1
npm run release:windows
```

The release script remaps development paths, removes debug symbols, scans the
executable/frontend, creates the NSIS installer, and scans the final bundled
executable and installer. Fix a failed privacy check rather than bypassing it.
Keep `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` unset before building;
the script supplies its own flags. The current installer is unsigned.

The installer is written to
`target/release/bundle/nsis/CodexHalo_X.Y.Z_x64-setup.exe`.
On a test Windows account, quit the previous app through the tray and verify
an upgrade preserves settings and consent. Check the delivered UI, all changed
edge interactions, tray/shortcut recovery, and an installed test notification
when reminders change. Record which native checks were performed; frontend
preview tests alone do not verify Windows notification delivery.

## Stage and verify a GitHub draft

Confirm you are on `main` and it is synchronized with the remote, commit the
reviewed source and documentation, then create an annotated tag
pointing to that release commit and push both main and the tag. For example,
replace `X.Y.Z` below with the version being prepared:

```powershell
$releaseVersion = "X.Y.Z"
$releaseTag = "v$releaseVersion"
git tag -a $releaseTag -m "CodexHalo $releaseTag"
git push --atomic origin main $releaseTag
```

Use an authenticated GitHub CLI account with release permissions. Stage notes
and checksums in the ignored `.test-tmp` directory:

```powershell
$releaseDir = ".test-tmp/release-$releaseVersion"
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$installerName = "CodexHalo_${releaseVersion}_x64-setup.exe"
$installer = "target/release/bundle/nsis/$installerName"
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$releaseDir/SHA256SUMS.txt"
Set-Content -LiteralPath $checksumPath -Encoding ascii -Value "$installerHash  $installerName"
$notesPath = "$releaseDir/release-notes.md"
```

Write the reviewed release notes to `$notesPath`. Add any attached demo
or preview files to SHA256SUMS as well. Then create the draft and upload those
optional assets with `gh release upload`:

```powershell
gh release create $releaseTag $installer $checksumPath --repo Mike-Animal-Counseling/CodexHalo --draft --verify-tag --title "CodexHalo $releaseTag" --notes-file $notesPath
gh release view $releaseTag --repo Mike-Animal-Counseling/CodexHalo --json tagName,isDraft,assets,targetCommitish
$downloadDir = "$releaseDir/download-check"
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
gh release download $releaseTag --repo Mike-Animal-Counseling/CodexHalo --pattern $installerName --dir $downloadDir
$downloadHash = (Get-FileHash -LiteralPath "$downloadDir/$installerName" -Algorithm SHA256).Hash.ToLowerInvariant()
if ($downloadHash -ne $installerHash) { throw "Uploaded installer checksum mismatch" }
```

Confirm the tag's commit, installer filename/version, checksum, release notes,
and preview links. Resolve any discrepancy while the release remains a draft.

## Publish and check the public download

For a stable release, publish the verified draft as latest:

```powershell
gh release edit $releaseTag --repo Mike-Animal-Counseling/CodexHalo --draft=false --latest
gh release view $releaseTag --repo Mike-Animal-Counseling/CodexHalo --json tagName,isDraft,isPrerelease,url,publishedAt,assets
$publicUrl = "https://github.com/Mike-Animal-Counseling/CodexHalo/releases/download/$releaseTag/$installerName"
$publicCopy = "$releaseDir/public-download-check.exe"
Invoke-WebRequest -UseBasicParsing -Uri $publicUrl -OutFile $publicCopy
$publicHash = (Get-FileHash -LiteralPath $publicCopy -Algorithm SHA256).Hash.ToLowerInvariant()
if ($publicHash -ne $installerHash) { throw "Public installer checksum mismatch" }
```

Check the README links as a signed-out visitor, including the current installer,
checksum file, News, and demo. Verify main/tag synchronization and the fixed
[public pricing endpoint](https://raw.githubusercontent.com/Mike-Animal-Counseling/CodexHalo/main/data/pricing.json).
The repository's scheduled price check only creates a candidate artifact;
maintainers must review and publish catalog changes.

Keep the installed-binary version separate from the catalog version. Users
upgrade the app by quitting the old tray process and running the new installer;
CodexHalo currently has no executable auto-updater.

GitHub CLI command reference: [create](https://cli.github.com/manual/gh_release_create),
[download](https://cli.github.com/manual/gh_release_download), and
[edit](https://cli.github.com/manual/gh_release_edit).
