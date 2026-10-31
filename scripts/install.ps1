param(
    # Install the newest release, including prereleases.
    [switch]$Prerelease,
    # Install a specific release tag (e.g. v0.3.0), or "prerelease".
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoOwner = "sloshy"
$repoName = "ritual"

if (-not $Prerelease -and $env:RITUAL_PRERELEASE -eq "1") {
    $Prerelease = $true
}
if (-not $Version -and $env:RITUAL_VERSION) {
    $Version = $env:RITUAL_VERSION
}
if ($Version -eq "prerelease") {
    $Prerelease = $true
    $Version = ""
}

function Normalize-PathEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathEntry
    )

    return $PathEntry.Trim().TrimEnd("\")
}

$installDir = if ($env:RITUAL_INSTALL_DIR) {
    $env:RITUAL_INSTALL_DIR
} else {
    Join-Path $env:LOCALAPPDATA "Programs\ritual\bin"
}

$osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($osArch) {
    "X64" {
        $assetName = "ritual-windows-x86_64.exe"
    }
    "Arm64" {
        $assetName = "ritual-windows-arm64.exe"
    }
    default {
        throw "Unsupported architecture: $osArch"
    }
}

if ($Prerelease -and -not $Version) {
    Write-Host "Resolving the newest release (prereleases included)..."
    # The unauthenticated releases API omits drafts and lists newest first.
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoOwner/$repoName/releases?per_page=20" -Headers @{ Accept = "application/vnd.github+json" }
    $latest = @($releases)[0]
    if (-not $latest) {
        throw "No releases found for $repoOwner/$repoName."
    }
    $Version = $latest.tag_name
    Write-Host "Using release $Version."
}

$baseUrl = if ($Version) {
    "https://github.com/$repoOwner/$repoName/releases/download/$Version"
} else {
    "https://github.com/$repoOwner/$repoName/releases/latest/download"
}

# Each release publishes the binary compressed: <asset>.zip, holding just
# ritual.exe, with a .sha256 of the archive.
$archiveName = [System.IO.Path]::ChangeExtension($assetName, ".zip")
$installPath = Join-Path $installDir "ritual.exe"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ritual-" + [Guid]::NewGuid().ToString())

# Download the release's <name> and check it against <name>.sha256, which
# hashes that file as published. Returns the downloaded path.
function Get-VerifiedAsset {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $path = Join-Path $tempDir $Name
    Invoke-WebRequest -Uri "$baseUrl/$Name" -OutFile $path
    Invoke-WebRequest -Uri "$baseUrl/$Name.sha256" -OutFile "$path.sha256"

    Write-Host "Verifying checksum..."
    $expectedHash = (Get-Content "$path.sha256" -Raw).Trim().Split(" ")[0]
    $actualHash = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
    if ($actualHash -ne $expectedHash) {
        throw "Checksum mismatch for ${Name}!`n  expected: $expectedHash`n  actual:   $actualHash"
    }
    return $path
}

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $ProgressPreference = 'SilentlyContinue'

    Write-Host "Downloading $archiveName..."
    try {
        $archivePath = Get-VerifiedAsset -Name $archiveName
    }
    catch {
        # An HTTP error means the release has no archive; say why that may be.
        # Anything else, a checksum mismatch included, is reported as it is.
        # (StrictMode forbids reading a property an exception does not have.)
        $response = $_.Exception.PSObject.Properties["Response"]
        if ($response -and $response.Value) {
            if ($Version) {
                Write-Warning "Releases before v0.1.0-rc4 publish no archive, and this script cannot install them."
            }
            else {
                Write-Warning "If $repoOwner/$repoName has only prereleases so far, re-run with -Prerelease."
            }
        }
        throw
    }

    $unpacked = Join-Path $tempDir "unpacked"
    Expand-Archive -LiteralPath $archivePath -DestinationPath $unpacked
    # The archive must hold exactly ritual.exe, and nothing else.
    $entries = @(Get-ChildItem -LiteralPath $unpacked -Force -Recurse)
    if ($entries.Count -ne 1 -or $entries[0].Name -ne "ritual.exe" -or $entries[0].PSIsContainer) {
        throw "$archiveName does not hold just ritual.exe."
    }
    $binaryPath = $entries[0].FullName

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Move-Item -Path $binaryPath -Destination $installPath -Force
}
finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}

Write-Host "Installed ritual to $installPath"

$normalizedInstallDir = Normalize-PathEntry -PathEntry $installDir
$currentPathEntries = @($env:Path -split ";" | Where-Object { $_ -and $_.Trim() -ne "" })
$currentPathNormalized = @($currentPathEntries | ForEach-Object { Normalize-PathEntry -PathEntry $_ })

if ($currentPathNormalized -contains $normalizedInstallDir) {
    return
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$userPathEntries = if ($userPath) {
    @($userPath -split ";" | Where-Object { $_ -and $_.Trim() -ne "" })
}
else {
    @()
}

$userPathNormalized = @($userPathEntries | ForEach-Object { Normalize-PathEntry -PathEntry $_ })
if ($userPathNormalized -contains $normalizedInstallDir) {
    Write-Host "$installDir is not in this session PATH, but it is already configured in your user PATH."
    Write-Host "Open a new terminal window to use ritual."
    return
}

$newUserPath = if ($userPath -and $userPath.Trim() -ne "") {
    "$userPath;$installDir"
}
else {
    $installDir
}

[Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
Write-Host "Added $installDir to your user PATH."
Write-Host "Open a new terminal window to use ritual."
