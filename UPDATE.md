# 更新教程 · Update Guide

## 1. 先看自己是什么版本

- 面板**底部状态栏**右侧：`… · v1.0.0`
- 或看扩展目录里的 `CSXS\\manifest.xml`：`ExtensionBundleVersion="1.0.0"`

## 2. 检查更新

- 面板底部有 **「检查更新」** 链接（英文界面为 *Check updates*），点击直接用系统浏览器打开
  Releases 页面 —— **不会联网上报，纯手动**
- 或直接访问：https://github.com/yorkloh/yorkcut-pro/releases
- 版本差异看 [CHANGELOG.md](CHANGELOG.md)

## 3. 升级（保留全部设置）

1. **完全退出 Premiere**（重要：文件被占用会装不上）
2. 下载新版 `YorkCut-Pro-x.y.z.zip` 并解压（见 [DOWNLOAD.md](DOWNLOAD.md)）
3. 双击新版里的 `安装到Premiere.bat` —— 它会**覆盖**旧版本文件
4. 重新打开 Premiere → 窗口 → 扩展 → YorkCut Pro

**设置不会丢**：面板设置、时长缓存、日志都在 `%APPDATA%\\YorkCutPro\\`，与扩展目录分离，
升级不会动它们。

> 无人值守升级：把 [INSTALL.md](INSTALL.md) 第 4B 节的 PowerShell 再跑一次即可（先退出 Premiere）。

## 4. 回滚到旧版本

Releases 里下载任意旧版 zip → 同样的覆盖安装步骤。若旧版扩展 ID 不同（例如更早的
`com.newcut.premiere.trial`），需要**先删除**对应旧目录，避免菜单里出现两个插件：

```powershell
$root = Join-Path $env:APPDATA "Adobe\\CEP\\extensions"
Get-ChildItem $root -Directory | Where-Object { $_.Name -like "*yorkcut*" -or $_.Name -like "*newcut*" }
# 确认后删除不再使用的那一个
```

## 5. 彻底重装（清空设置）

```powershell
Remove-Item (Join-Path $env:APPDATA "Adobe\\CEP\\extensions\\com.yorkcut.pro") -Recurse -Force
Remove-Item (Join-Path $env:APPDATA "YorkCutPro") -Recurse -Force   # ← 会删掉设置/缓存/日志
```
然后重新安装。**不要**只删扩展目录而不删 `YorkCutPro` 数据目录——那样设置会保留（这通常是你想要的）。

## 6. 兼容性

- 扩展 ID 保持不变（`com.yorkcut.pro`），所以**可以直接覆盖升级**
- 跨大版本升级（如以后 2.x）如果改了 ID，`INSTALL.md` 与 Release 说明会特别提示
- 需要 Premiere 23.0+；字幕轨与高光图形建议 25.1+
