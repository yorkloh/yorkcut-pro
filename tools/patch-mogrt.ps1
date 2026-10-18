param(
    [Parameter(Mandatory = $true)][string]$Template,
    [string]$TextFile,
    [string]$Out,
    [string]$ListFile
)
# Patch .mogrt templates so their *default* text (what Premiere renders on insert) carries the
# target text.  Two modes:
#   single : -Template x.mogrt -TextFile t.txt -Out y.mogrt
#   batch  : -Template x.mogrt -ListFile list.json      (list = [{"text":"..","out":".."}, ..])
# Batch mode extracts the template ONCE and only rewrites definition.json per item, which keeps
# 15 items down to a few seconds instead of one process per item.
#
# NOTE: keep this file ASCII-only.  Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI and
# non-ASCII comments get mangled (they can swallow the following code line).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Set-DefaultText {
    param([string]$Work, [string]$Text)
    $defPath = Join-Path $Work "definition.json"
    if (-not (Test-Path -LiteralPath $defPath)) { return 0 }
    $json = [System.IO.File]::ReadAllText($defPath, [System.Text.Encoding]::UTF8)
    $obj = $json | ConvertFrom-Json
    $n = 0
    foreach ($c in @($obj.clientControls)) {
        if ($null -eq $c) { continue }
        if ($null -eq $c.value) { continue }
        $db = $c.value.strDB
        if ($null -eq $db) { continue }
        foreach ($s in @($db)) {
            if ($null -eq $s) { continue }
            $s.str = $Text
            $n = $n + 1
        }
    }
    if ($n -le 0) { return 0 }
    $newJson = $obj | ConvertTo-Json -Depth 100 -Compress
    [System.IO.File]::WriteAllText($defPath, $newJson, (New-Object System.Text.UTF8Encoding($false)))
    return $n
}

function Copy-WorkTo {
    param([string]$Work, [string]$Dest, [string]$Scratch)
    $zip = Join-Path $Scratch ("z-" + [guid]::NewGuid().ToString("N") + ".zip")
    [System.IO.Compression.ZipFile]::CreateFromDirectory($Work, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $dir = [System.IO.Path]::GetDirectoryName($Dest)
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force }
    Copy-Item -LiteralPath $zip -Destination $Dest -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
}

function Clean-Text {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $t = $Text -replace "`r`n", "`n"
    $t = $t -replace "`r", "`n"
    $t = $t.TrimEnd("`n")
    # Premiere / After Effects text layers use CR (0x0D) as the line separator.
    # Writing \n instead makes the graphic render every line glued together (verified on 25.1).
    $t = $t -replace "`n", "`r"
    return $t
}

$scratch = Join-Path $env:TEMP ("mogrtpatch-" + [guid]::NewGuid().ToString("N"))
$work = Join-Path $scratch "w"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Template, $work)

    if ($ListFile) {
        $raw = [System.IO.File]::ReadAllText($ListFile, [System.Text.Encoding]::UTF8)
        $items = $raw | ConvertFrom-Json
        $ok = 0
        $fail = 0
        foreach ($it in @($items)) {
            $dest = [string]$it.out
            $text = Clean-Text ([string]$it.text)
            if (-not $dest) { $fail = $fail + 1; continue }
            try {
                $n = Set-DefaultText -Work $work -Text $text
                if ($n -le 0) { $fail = $fail + 1; continue }
                Copy-WorkTo -Work $work -Dest $dest -Scratch $scratch
                $ok = $ok + 1
            } catch {
                $fail = $fail + 1
            }
        }
        Write-Host ("batch done: ok=" + $ok + " fail=" + $fail)
        exit 0
    }

    if (-not $Out) { Write-Host "Out is required in single mode"; exit 1 }
    $text2 = Clean-Text ([System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8))
    $n2 = Set-DefaultText -Work $work -Text $text2
    if ($n2 -le 0) { Write-Host "no exposed text control found"; exit 2 }
    Copy-WorkTo -Work $work -Dest $Out -Scratch $scratch
    Write-Host ("patched entries: " + $n2)
    exit 0
} catch {
    Write-Host ("patch failed: " + $_.Exception.Message)
    exit 1
} finally {
    if (Test-Path -LiteralPath $scratch) {
        try { Remove-Item -LiteralPath $scratch -Recurse -Force } catch { }
    }
}
