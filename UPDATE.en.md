# Update Guide

## 1. Which version do I have?

The panel status bar shows `… · v1.0.0`, or check `CSXS/manifest.xml`
(`ExtensionBundleVersion="1.0.0"`).

## 2. Check for updates

- The panel footer has a **"检查更新 / Check updates"** link that opens the Releases page in your
  default browser — nothing is sent anywhere, it is purely manual
- Or visit https://github.com/yorkloh/yorkcut-pro/releases
- Version differences: see [CHANGELOG.md](CHANGELOG.md)

## 3. Upgrade (settings preserved)

1. **Fully quit Premiere** (files are locked otherwise)
2. Download and unzip the new `YorkCut-Pro-x.y.z.zip` (see [DOWNLOAD.en.md](DOWNLOAD.en.md))
3. Run `安装到Premiere.bat` from the new package — it overwrites the old files
4. Reopen Premiere → Window → Extensions → YorkCut Pro

Settings, duration cache and logs live in `%APPDATA%\\YorkCutPro\\`, separate from the extension
folder, so upgrading keeps them.

## 4. Rollback

Download any older release and run the same installer. If the older build used a different bundle id
(e.g. `com.newcut.premiere.trial`), delete that old folder first so you do not end up with two menu
entries.

## 5. Clean reinstall

```powershell
Remove-Item (Join-Path $env:APPDATA "Adobe\\CEP\\extensions\\com.yorkcut.pro") -Recurse -Force
Remove-Item (Join-Path $env:APPDATA "YorkCutPro") -Recurse -Force   # removes settings/cache/logs
```

## 6. Compatibility

The bundle id stays `com.yorkcut.pro`, so a plain overwrite upgrade works. Premiere 23.0+ required;
25.1+ recommended for caption tracks and highlight graphics.
