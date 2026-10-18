param(
    [Parameter(Mandatory = $true)][ValidateSet("Download", "Pick")][string]$Mode,
    [string]$Dest,
    [string]$PluginRoot
)
# NOTE: keep this file ASCII-only.  Windows PowerShell 5.1 reads a BOM-less
# .ps1 as ANSI; non-ASCII comments get mangled and can swallow line breaks,
# which silently comments out the following code line.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Save-WithPercent {
    param([string]$Url, [string]$OutFile)
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.UserAgent = "YorkCut-Installer"
    $response = $request.GetResponse()
    $total = $response.ContentLength
    $input = $response.GetResponseStream()
    $output = [System.IO.File]::Create($OutFile)
    try {
        $buffer = New-Object byte[] 262144
        $readTotal = [int64]0
        $last = -1
        while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $output.Write($buffer, 0, $count)
            $readTotal += $count
            if ($total -gt 0) {
                $pct = [int](($readTotal * 100) / $total)
                if ($pct -ne $last) {
                    Write-Host ("Downloading ffmpeg... {0}%" -f $pct)
                    $last = $pct
                }
            } else {
                Write-Host ("Downloading ffmpeg... {0} MB" -f [int]($readTotal / 1MB))
            }
        }
    } finally {
        $output.Close()
        $input.Close()
        $response.Close()
    }
}

function Test-FfmpegExe {
    param([string]$Path)
    try {
        $out = & $Path -hide_banner -version 2>&1 | Out-String
        return ($out -match "ffmpeg version")
    } catch {
        return $false
    }
}

function Clear-LegacyPathPointer {
    param([string]$TargetDir)
    # Older builds only wrote tools\ffmpeg-path.txt (a pointer, no copy).
    # The panel's resolveFfmpeg() reads that file FIRST, so a stale pointer
    # would win over the exe we are about to copy in. Remove it.
    $tools = [System.IO.Path]::GetDirectoryName($TargetDir)
    if (-not $tools) { return }
    $pathFile = Join-Path $tools "ffmpeg-path.txt"
    if (Test-Path -LiteralPath $pathFile) {
        Remove-Item -LiteralPath $pathFile -Force -ErrorAction SilentlyContinue
    }
}

function Copy-FfmpegInto {
    param([string]$SourceExe, [string]$TargetDir)
    if (-not (Test-Path -LiteralPath $SourceExe)) {
        throw "ffmpeg.exe not found: $SourceExe"
    }
    $leaf = [System.IO.Path]::GetFileName($SourceExe)
    if ($leaf -match "^ffprobe") {
        throw "That is ffprobe.exe, not ffmpeg.exe. Please choose ffmpeg.exe."
    }
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    $target = Join-Path $TargetDir "ffmpeg.exe"
    if (-not ($SourceExe -ieq $target)) {
        try {
            Copy-Item -LiteralPath $SourceExe -Destination $target -Force
        } catch {
            throw ("Could not copy ffmpeg.exe (is it in use?): " + $_.Exception.Message)
        }
    }
    # Copy ffprobe.exe from the same source folder when present (optional).
    $srcDir = [System.IO.Path]::GetDirectoryName($SourceExe)
    $probeSrc = Join-Path $srcDir "ffprobe.exe"
    $probeDst = Join-Path $TargetDir "ffprobe.exe"
    if ((Test-Path -LiteralPath $probeSrc) -and (-not ($probeSrc -ieq $probeDst))) {
        try { Copy-Item -LiteralPath $probeSrc -Destination $probeDst -Force } catch { }
    }
    Clear-LegacyPathPointer -TargetDir $TargetDir
    return $target
}

if ($Mode -eq "Pick") {
    if (-not $PluginRoot) { throw "PluginRoot is required." }
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select the ffmpeg.exe you already have (it will be COPIED into the plugin folder)"
    $dialog.Filter = "ffmpeg.exe|ffmpeg.exe|Programs|*.exe"
    $dialog.FileName = "ffmpeg.exe"
    $dialog.CheckFileExists = $true
    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host "No file selected."
        exit 2
    }
    $chosen = $dialog.FileName
    if (-not (Test-Path -LiteralPath $chosen)) {
        Write-Host "File does not exist:"
        Write-Host $chosen
        exit 1
    }
    $targetDir = Join-Path $PluginRoot "tools\ffmpeg"
    $copied = $null
    try {
        $copied = Copy-FfmpegInto -SourceExe $chosen -TargetDir $targetDir
    } catch {
        Write-Host ([string]$_.Exception.Message)
        exit 1
    }
    Write-Host "ffmpeg copied into the plugin folder:"
    Write-Host $copied
    if (-not (Test-FfmpegExe -Path $copied)) {
        Write-Host "WARNING: the copied file did not print an 'ffmpeg version' banner."
        Write-Host "         Please pick another ffmpeg.exe (a normal build of at least a few MB)."
        exit 1
    }
    Write-Host "ffmpeg looks OK (version banner verified)."
    exit 0
}

# ---------------- Download mode: fetch and install directly ----------------
if (-not $Dest) { throw "Dest is required." }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$zip = Join-Path $env:TEMP "yorkcut-ffmpeg-essentials.zip"
$unpack = Join-Path $env:TEMP "yorkcut-ffmpeg-unpack"
$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
Save-WithPercent -Url $url -OutFile $zip
Write-Host "Download complete. Extracting..."
if (Test-Path $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
$exe = Get-ChildItem -LiteralPath $unpack -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $exe) { throw "ffmpeg.exe was not found in the downloaded archive." }
Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $Dest "ffmpeg.exe") -Force
$probe = Get-ChildItem -LiteralPath $unpack -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
if ($probe) {
    Copy-Item -LiteralPath $probe.FullName -Destination (Join-Path $Dest "ffprobe.exe") -Force
}
Clear-LegacyPathPointer -TargetDir $Dest
Write-Host "ffmpeg installed:"
Write-Host (Join-Path $Dest "ffmpeg.exe")
$installed = Join-Path $Dest "ffmpeg.exe"
if (-not (Test-FfmpegExe -Path $installed)) {
    Write-Host "WARNING: the installed ffmpeg.exe did not print an 'ffmpeg version' banner."
    exit 1
}
Write-Host "ffmpeg looks OK (version banner verified)."
exit 0
