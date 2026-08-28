[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$InstalledDirectory
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nsisRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "target\release\bundle\nsis"))

if (-not $InstallerPath) {
    $installers = @(Get-ChildItem -LiteralPath $nsisRoot -File -Filter "*.exe" -ErrorAction Stop)
    if ($installers.Count -ne 1) {
        throw "Expected exactly one NSIS installer, found $($installers.Count)."
    }
    $InstallerPath = $installers[0].FullName
}
$InstallerPath = [IO.Path]::GetFullPath($InstallerPath)

function Assert-InRepository([string]$Path, [string]$Label) {
    if (-not $Path.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must be inside the CodexHalo repository."
    }
}

function Read-SearchableText([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    [Text.Encoding]::ASCII.GetString($bytes) + "`n" + [Text.Encoding]::Unicode.GetString($bytes)
}

function Assert-NeedleAbsent([string]$Text, [string]$Needle, [string]$Label, [string]$Path) {
    if ($Needle -and $Text.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Privacy verification found $Label in $Path"
    }
}

function Test-ReleaseFile([IO.FileInfo]$File) {
    if ($File.Extension -match "(?i)^\.(pdb|jsonl|log|pem|key|pfx|env)$" -or
        $File.Name -match "(?i)^(auth\.json|\.env(?:\..*)?)$") {
        throw "Forbidden release file: $($File.FullName)"
    }

    $text = Read-SearchableText $File.FullName
    $profileRoot = [Environment]::GetFolderPath("UserProfile")
    $windowsUsersRoot = [IO.Path]::Combine('C:\', 'Users') + [IO.Path]::DirectorySeparatorChar
    $needles = @(
        [pscustomobject]@{ Value = $env:USERNAME; Label = "developer username" },
        [pscustomobject]@{ Value = $env:COMPUTERNAME; Label = "developer machine name" },
        [pscustomobject]@{ Value = $profileRoot; Label = "developer profile path" },
        [pscustomobject]@{ Value = $windowsUsersRoot; Label = "developer-specific C:\Users path" },
        [pscustomobject]@{ Value = $repoRoot; Label = "repository path" },
        [pscustomobject]@{ Value = "http://localhost:1420"; Label = "development URL" },
        [pscustomobject]@{ Value = "auth.json"; Label = "Codex auth filename" },
        [pscustomobject]@{ Value = ".codex\sessions"; Label = "Codex session path" },
        [pscustomobject]@{ Value = ".codex/sessions"; Label = "Codex session path" },
        [pscustomobject]@{ Value = "OPENAI_API_KEY"; Label = "API-key environment marker" },
        [pscustomobject]@{ Value = "BEGIN PRIVATE KEY"; Label = "private key material" }
    )
    foreach ($needle in $needles) {
        Assert-NeedleAbsent $text $needle.Value $needle.Label $File.FullName
    }
    if ($text -match "(?i)sk-[a-z0-9_-]{20,}") {
        throw "Privacy verification found API-key-shaped material in $($File.FullName)"
    }
}

Assert-InRepository $InstallerPath "Installer"
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Installer not found: $InstallerPath"
}
Test-ReleaseFile (Get-Item -LiteralPath $InstallerPath)

$auditedFiles = 1
if ($InstalledDirectory) {
    $InstalledDirectory = [IO.Path]::GetFullPath($InstalledDirectory)
    Assert-InRepository $InstalledDirectory "Installed-directory audit target"
    if (-not (Test-Path -LiteralPath $InstalledDirectory -PathType Container)) {
        throw "Installed directory not found: $InstalledDirectory"
    }
    $installedFiles = @(Get-ChildItem -LiteralPath $InstalledDirectory -Recurse -File)
    if ($installedFiles.Count -eq 0) {
        throw "Installed directory is empty."
    }
    foreach ($file in $installedFiles) {
        Test-ReleaseFile $file
    }
    $auditedFiles += $installedFiles.Count
}

$installer = Get-Item -LiteralPath $InstallerPath
$hash = Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256
Write-Output "INSTALLER_PRIVACY_SCAN=PASS"
Write-Output ("INSTALLER=" + $installer.FullName)
Write-Output ("SIZE=" + $installer.Length)
Write-Output ("SHA256=" + $hash.Hash)
Write-Output ("FILES_AUDITED=" + $auditedFiles)
