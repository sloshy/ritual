Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoOwner = "sloshy"
$repoName = "ritual"

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

$downloadUrl = "https://github.com/$repoOwner/$repoName/releases/latest/download/$assetName"
$checksumUrl = "$downloadUrl.sha256"
$installPath = Join-Path $installDir "ritual.exe"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ritual-" + [Guid]::NewGuid().ToString())
$tempPath = Join-Path $tempDir $assetName
$tempChecksumPath = Join-Path $tempDir "$assetName.sha256"

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Write-Host "Downloading $assetName..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath
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
