[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "target\release"))
$tauri = Join-Path $repoRoot "node_modules\.bin\tauri.cmd"

if ($env:RUSTFLAGS -or $env:CARGO_ENCODED_RUSTFLAGS) {
    throw "Release builds require a clean RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS environment."
}
if (-not (Test-Path -LiteralPath $tauri -PathType Leaf)) {
    throw "Tauri CLI is unavailable. Run npm install before building."
}

$profileRoot = [Environment]::GetFolderPath("UserProfile")
$cargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $profileRoot ".cargo" }
$rustupRoot = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { Join-Path $profileRoot ".rustup" }
$remaps = @(
    [pscustomobject]@{ Source = [IO.Path]::GetFullPath($cargoRoot); Target = "/build/cargo" },
    [pscustomobject]@{ Source = [IO.Path]::GetFullPath($rustupRoot); Target = "/build/rustup" },
    [pscustomobject]@{ Source = [IO.Path]::GetFullPath($repoRoot); Target = "/src/codexhalo" },
    [pscustomobject]@{ Source = [IO.Path]::GetFullPath($profileRoot); Target = "/build/user" }
) | Sort-Object { $_.Source.Length } -Descending -Unique

$rustFlags = foreach ($remap in $remaps) {
    "--remap-path-prefix=$($remap.Source)=$($remap.Target)"
}
$env:CARGO_ENCODED_RUSTFLAGS = $rustFlags -join [char]0x1f

try {
    Push-Location $desktopRoot
    try {
        & $tauri build --no-bundle --config "src-tauri/tauri.release.conf.json"
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri release build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    if (-not $releaseRoot.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean symbols outside the repository release directory."
    }
    Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Filter "*.pdb" -ErrorAction SilentlyContinue |
        Remove-Item -Force

    & (Join-Path $PSScriptRoot "verify-release-privacy.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Release privacy verification failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue
}
