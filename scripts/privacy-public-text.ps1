# Exact public strings that can coincide with a short local build username.
# Keep legal attribution and the product's public catalog URL in distributed bytes.
# This helper is used only for the build-username comparison; all path, machine,
# private-file, credential-shaped, and PE-metadata checks still scan the original text.
function Remove-PublicReleaseAttributions([string]$Text) {
    $publicStrings = @(
        'https://raw.githubusercontent.com/Mike-Animal-Counseling/CodexHalo/main/data/pricing.json',
        'Vector Permutation AES for x86_64/SSSE3, Mike Hamburg (Stanford University)'
    )
    foreach ($publicString in $publicStrings) {
        $Text = $Text.Replace($publicString, '')
    }
    return $Text
}
