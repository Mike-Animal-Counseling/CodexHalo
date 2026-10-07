$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "privacy-public-text.ps1")

$known = 'https://raw.githubusercontent.com/Mike-Animal-Counseling/CodexHalo/main/data/pricing.json Vector Permutation AES for x86_64/SSSE3, Mike Hamburg (Stanford University)'
if ((Remove-PublicReleaseAttributions $known).Contains('Mike')) {
    throw 'Reviewed complete public strings were not excluded.'
}

$privateText = 'builder=Mike; C:\Users\Mike\secret.key; unknown-host/Mike; Mike local identity'
if ((Remove-PublicReleaseAttributions $privateText) -cne $privateText) {
    throw 'A build identity, private path, or unrelated URL was incorrectly removed.'
}

$nearMatch = 'https://raw.githubusercontent.com/Mike-Animal-Counseling/Other/main/data/pricing.json Vector Permutation AES for x86_64/SSSE3, Mike Other'
if ((Remove-PublicReleaseAttributions $nearMatch) -cne $nearMatch) {
    throw 'A similar but unreviewed string was incorrectly excluded.'
}

$combined = $known + '; ' + $privateText
if (-not (Remove-PublicReleaseAttributions $combined).Contains($privateText)) {
    throw 'Removing public attribution also removed adjacent private data.'
}
Write-Output 'PUBLIC_ATTRIBUTION_REGRESSION=PASS'
