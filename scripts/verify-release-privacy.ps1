[CmdletBinding()]
param(
    [string]$ExePath
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "target\release"))
$distRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "apps\desktop\dist"))
if (-not $ExePath) {
    $ExePath = Join-Path $releaseRoot "CodexHalo.exe"
}
$ExePath = [IO.Path]::GetFullPath($ExePath)

if (-not $ExePath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The audited executable must be inside the CodexHalo repository."
}
if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
    throw "Release executable not found: $ExePath"
}

$pdbs = @(Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Filter "*.pdb" -ErrorAction SilentlyContinue)
if ($pdbs.Count -ne 0) {
    throw "Release tree contains $($pdbs.Count) PDB file(s)."
}

$forbiddenInputs = @(Get-ChildItem -LiteralPath $distRoot -Recurse -File -ErrorAction Stop | Where-Object {
    $_.Name -match "(?i)^(auth\.json|\.env(?:\..*)?)$" -or
    $_.Extension -match "(?i)^\.(jsonl|log|pem|key|pfx|sqlite|db)$"
})
if ($forbiddenInputs.Count -ne 0) {
    throw "Production frontend contains forbidden private-data-shaped inputs."
}

function Read-SearchableText([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    [Text.Encoding]::ASCII.GetString($bytes) + "`n" + [Text.Encoding]::Unicode.GetString($bytes)
}

function Assert-NeedleAbsent([string]$Text, [string]$Needle, [string]$Label) {
    if ($Needle -and $Text.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Privacy verification found forbidden marker: $Label"
    }
}

$exeText = Read-SearchableText $ExePath
$profileRoot = [Environment]::GetFolderPath("UserProfile")
$versionInfo = (Get-Item -LiteralPath $ExePath).VersionInfo
$peMetadata = @(
    $versionInfo.Comments,
    $versionInfo.CompanyName,
    $versionInfo.FileDescription,
    $versionInfo.InternalName,
    $versionInfo.LegalCopyright,
    $versionInfo.OriginalFilename,
    $versionInfo.ProductName
) -join "`n"
Assert-NeedleAbsent $peMetadata $env:USERNAME 'build username in PE metadata'
Assert-NeedleAbsent $peMetadata $env:COMPUTERNAME 'build machine name in PE metadata'
$windowsUsersRoot = [IO.Path]::Combine('C:\', 'Users') + [IO.Path]::DirectorySeparatorChar
$needles = @(
    [pscustomobject]@{ Value = $env:USERNAME; Label = 'build username' },
    [pscustomobject]@{ Value = $env:COMPUTERNAME; Label = 'build machine name' },
    [pscustomobject]@{ Value = $profileRoot; Label = 'build user profile path' },
    [pscustomobject]@{ Value = $windowsUsersRoot; Label = 'Windows user-profile path' },
    [pscustomobject]@{ Value = $repoRoot; Label = 'absolute repository path' },
    [pscustomobject]@{ Value = 'http://localhost:1420'; Label = 'Tauri development URL' },
    [pscustomobject]@{ Value = 'auth.json'; Label = 'Codex auth filename' },
    [pscustomobject]@{ Value = '.codex\sessions'; Label = 'Codex session path' },
    [pscustomobject]@{ Value = '.codex/sessions'; Label = 'Codex session path' },
    [pscustomobject]@{ Value = 'OPENAI_API_KEY'; Label = 'API-key environment marker' },
    [pscustomobject]@{ Value = 'BEGIN PRIVATE KEY'; Label = 'private key material' }
)
if ($env:COMPUTERNAME -and $env:COMPUTERNAME.Length -ge 6) {
    $machineShare = ([IO.Path]::DirectorySeparatorChar.ToString() * 2) +
        $env:COMPUTERNAME + [IO.Path]::DirectorySeparatorChar
    $needles += [pscustomobject]@{ Value = $machineShare; Label = 'build machine UNC path' }
}
foreach ($needle in $needles) {
    Assert-NeedleAbsent $exeText $needle.Value $needle.Label
}
if ($exeText -match '(?i)sk-[a-z0-9_-]{20,}') {
    throw 'Privacy verification found API-key-shaped material.'
}

foreach ($asset in Get-ChildItem -LiteralPath $distRoot -Recurse -File) {
    $assetText = Read-SearchableText $asset.FullName
    Assert-NeedleAbsent $assetText $env:USERNAME 'build username in frontend asset'
    Assert-NeedleAbsent $assetText $env:COMPUTERNAME 'build machine name in frontend asset'
    Assert-NeedleAbsent $assetText $profileRoot 'build user profile path in frontend asset'
    Assert-NeedleAbsent $assetText $windowsUsersRoot 'Windows user-profile path in frontend asset'
    Assert-NeedleAbsent $assetText $repoRoot 'absolute repository path in frontend asset'
    Assert-NeedleAbsent $assetText 'http://localhost:1420' 'development URL in frontend asset'
    if ($assetText -match '(?i)sk-[a-z0-9_-]{20,}') {
        throw 'Frontend asset contains API-key-shaped material.'
    }
}

$file = Get-Item -LiteralPath $ExePath
$hash = Get-FileHash -LiteralPath $ExePath -Algorithm SHA256
Write-Output 'PRIVACY_SCAN=PASS'
Write-Output ('EXE=' + $file.FullName)
Write-Output ('SIZE=' + $file.Length)
Write-Output ('SHA256=' + $hash.Hash)
