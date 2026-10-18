# Download Guide

> For humans and AI agents. This page only covers getting the installer; see [INSTALL.en.md](INSTALL.en.md).

## 1. Official source

```
https://github.com/yorkloh/yorkcut-pro/releases
```

Open the latest release (currently **v1.0.0**) and download from **Assets**:

| File | Size | Note |
|---|---|---|
| **`YorkCut-Pro-1.0.0.zip`** | ~**116 KB** | ✅ the installer — this is the one |
| `Source code (zip)` | ~60 KB | ❌ no installer inside |

> Do not use `Code → Download ZIP` on the repo home page: that is the source tree without the batch installer.

## 2. Command line (AI agents can run this)

```powershell
$url = "https://github.com/yorkloh/yorkcut-pro/releases/download/v1.0.0/YorkCut-Pro-1.0.0.zip"
$out = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"
Invoke-WebRequest -Uri $url -OutFile $out
(Get-Item $out).Length        # expect ~116444 bytes
```

## 3. Verify

```powershell
(Get-Item $out).Length                                              # ~116444
Get-FileHash $out -Algorithm SHA256 | Format-List                   # compare with the release page
Expand-Archive $out "$env:TEMP\yc-check" -Force
(Get-ChildItem "$env:TEMP\yc-check\YorkCut-Pro-1.0.0" -Recurse -File).Count  # expect 19
```

## 4. Slow or blocked download

1. Set a proxy for the shell (`$env:HTTPS_PROXY`), or
2. Use a third-party mirror prefix (e.g. `https://ghproxy.net/` + the release URL) — **verify trust yourself**, or
3. Download in the browser.

## 5. What you should get

Unzip → folder `YorkCut-Pro-1.0.0` containing `index.html`, `css/`, `CSXS/`, `js/`, `jsx/`, `tools/`,
`assets/`, `安装到Premiere.bat` (the installer), `卸载.bat`, `使用说明.txt`, `install-ffmpeg.ps1`,
`install-exclude.txt`.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 404 | wrong tag (`v1.0` vs `v1.0.0`) | pick the tag from the Releases list |
| got `Source code.zip` | wrong asset | download `YorkCut-Pro-*.zip` |
| no `安装到Premiere.bat` after unzip | source archive | same |
| antivirus removed the file | batch file flagged | restore/whitelist, or use the unattended script in [INSTALL.en.md](INSTALL.en.md) |
