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
        Write-Warning "ARM64 detected; installing x86_64 binary."
        $assetName = "ritual-windows-x86_64.exe"
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

$downloadUrl = "$baseUrl/$assetName"
$checksumUrl = "$downloadUrl.sha256"
$installPath = Join-Path $installDir "ritual.exe"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ritual-" + [Guid]::NewGuid().ToString())
$tempPath = Join-Path $tempDir $assetName
$tempChecksumPath = Join-Path $tempDir "$assetName.sha256"

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Write-Host "Downloading $assetName..."
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath
    }
    catch {
        if (-not $Version) {
            Write-Warning "If $repoOwner/$repoName has only prereleases so far, re-run with -Prerelease."
        }
        throw
    }
    Invoke-WebRequest -Uri $checksumUrl -OutFile $tempChecksumPath

    Write-Host "Verifying checksum..."
    $expectedHash = (Get-Content $tempChecksumPath -Raw).Trim().Split(" ")[0]
    $actualHash = (Get-FileHash -Path $tempPath -Algorithm SHA256).Hash.ToLower()

    if ($actualHash -ne $expectedHash) {
        throw "Checksum mismatch!`n  expected: $expectedHash`n  actual:   $actualHash"
    }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Move-Item -Path $tempPath -Destination $installPath -Force
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
