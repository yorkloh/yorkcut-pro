# Install Guide

> For humans **and** AI agents. If you are an AI, read section 0 first, then follow the steps in
> order. Every step has a **check**; if a check fails, follow "If it fails" — do not skip ahead.

---

## 0. Contract for AI agents

- **Goal**: install a CEP extension so that `Window → Extensions → YorkCut Pro` appears in Premiere.
- **Allowed**: unzip, copy files to `%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`, set
  `PlayerDebugMode` under `HKCU\Software\Adobe\CSXS.9..15`, optionally run the bundled
  `install-ffmpeg.ps1`.
- **Forbidden**: editing `CSXS/manifest.xml` (the bundle id must stay `com.yorkcut.pro`),
  downloading ffmpeg from third-party sites, installing under `Program Files`, running while
  Premiere is open.
- **Success** = every check in section 5 passes and the user confirms the menu entry exists.
- **When unsure**: ask the user. Do not modify license files or folder structure.

---

## 1. Pre-flight checks

| Check | Command (PowerShell) | Pass |
|---|---|---|
| OS | `[Environment]::OSVersion.Version.Major` | `>= 10` |
| Premiere installed | `Get-ChildItem 'C:\Program Files\Adobe' -Filter 'Adobe Premiere Pro*'` | at least one |
| Premiere version | folder name (e.g. `Adobe Premiere Pro 2025`) | **23.0+**, 25.1+ recommended |
| Premiere closed | `Get-Process 'Adobe Premiere Pro' -ErrorAction SilentlyContinue` | no output |
| CEP folder | `$env:APPDATA\Adobe\CEP\extensions` | created automatically if missing |

---

## 2. Download

```
https://github.com/yorkloh/yorkcut-pro/releases/download/v1.0.0/YorkCut-Pro-1.0.0.zip
```

About 107 KB. After unzipping the top folder is `YorkCut-Pro-1.0.0` with 18 files, including
`index.html`, `CSXS\manifest.xml`, `js\panel.js`, `jsx\host.jsx`, `tools\patch-mogrt.ps1`.

---

## 3. Unzip

```powershell
$zip = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"   # adjust
$tmp = Join-Path $env:TEMP ("yc-unzip-" + [guid]::NewGuid().ToString("N"))
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$payload = Join-Path $tmp "YorkCut-Pro-1.0.0"
Test-Path (Join-Path $payload "CSXS\manifest.xml")      # expect True
```

---

## 4. Install (pick one)

### 4A Interactive (recommended for humans)

Double-click `安装到Premiere.bat`. It will:

1. write `PlayerDebugMode=1` for CSXS.9 … CSXS.15 (required for unsigned extensions);
2. copy the extension to `%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`;
3. print `Plugin installed.`;
4. ask **`Is ffmpeg already installed on this PC?`**
   - **Y** → file picker, choose your `ffmpeg.exe` (it is copied into the plugin folder);
   - **N** → download ffmpeg from the official source into the plugin folder;
   - closing the window skips ffmpeg (only affects extracting audio from videos);
5. `pause` at the end.

> Quit Premiere completely before installing.

### 4B Unattended (AI agents / automation)

```powershell
$zip     = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"
$tmp     = Join-Path $env:TEMP ("yc-unzip-" + [guid]::NewGuid().ToString("N"))
$dest    = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro"

Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$payload = Join-Path $tmp "YorkCut-Pro-1.0.0"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$skip = @("安装到Premiere.bat", "卸载.bat", "使用说明.txt", "install-exclude.txt", "install-ffmpeg.ps1")
Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
    if ($skip -contains $_.Name) { return }
    $rel = $_.FullName.Substring($payload.Length).TrimStart('\')
    $out = Join-Path $dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $out) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $out -Force
}
foreach ($v in 9..15) {
    reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f | Out-Null
}
```

Optional ffmpeg (needs network):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $payload "install-ffmpeg.ps1") `
    -Mode Download -Dest (Join-Path $dest "tools\ffmpeg")
```

---

## 5. Verify (required for AI agents)

```powershell
$dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro"
Test-Path (Join-Path $dest "CSXS\manifest.xml")                                                     # True
(Get-Content (Join-Path $dest "CSXS\manifest.xml") -Raw) -match 'com\.yorkcut\.pro'                    # True
(Get-Content (Join-Path $dest "CSXS\manifest.xml") -Raw) -match 'ExtensionBundleVersion="1\.0\.0"'   # True
(Get-ChildItem -LiteralPath $dest -Recurse -File).Count                                             # >= 14
Test-Path (Join-Path $dest "js\i18n.js")                                                            # True
(Get-ItemProperty "HKCU:\Software\Adobe\CSXS.15" -ErrorAction SilentlyContinue).PlayerDebugMode    # 1
```

Then tell the user to **fully quit and reopen Premiere** and open
`Window → Extensions → YorkCut Pro`.

---

## 6. ffmpeg (optional)

Used to extract audio from videos placed in the voice / SFX / BGM folders. Without it those three
tracks can only use plain audio files (mp3 / wav / m4a). Picture tracks are unaffected.

---

## 7. Uninstall

```powershell
Remove-Item -LiteralPath (Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro") -Recurse -Force
```

User data lives in `%APPDATA%\YorkCutPro\` (settings, logs, duration cache) and can be deleted too.

---

## 8. If it fails

| Symptom | Cause | Fix |
|---|---|---|
| No YorkCut Pro in the menu | Premiere not restarted / PlayerDebugMode missing | restart; rerun the reg loop; verify the folder name |
| Blank panel | missing `js/` or `css/` files | reinstall, check section 5 |
| `EvalScript` failure | `jsx/host.jsx` missing or damaged | ensure it exists and is > 60 KB |
| "file in use" during install | Premiere still running | quit Premiere, retry |
| Two YorkCut entries | two installs (appdata + Program Files) | keep only the one under `%APPDATA%` |
| ffmpeg errors | not installed / path contains spaces | reinstall with `-Mode Download` |
