# 安装教程 · Install Guide

> 本文件同时面向 **人类用户** 和 **AI 助手**。若你是 AI 助手，请先读「0. 执行契约」，
> 再严格按步骤执行；每一步都有 **校验**，校验不通过就执行「失败处理」，不要跳步、不要猜路径。

---

## 0. 执行契约（给 AI 助手）

- **目标**：在 Windows 上安装一个 Adobe Premiere Pro 的 CEP 扩展，使宿主菜单出现
  `窗口 → 扩展 → YorkCut Pro`。
- **允许做的事**：解压 zip、复制文件到 `%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`、
  写 `HKCU\Software\Adobe\CSXS.9..15` 的 `PlayerDebugMode`、可选运行仓库自带的
  `install-ffmpeg.ps1` 安装 ffmpeg。
- **禁止做的事**：
  - 不要修改 `CSXS/manifest.xml`（扩展 ID 必须是 `com.yorkcut.pro`）；
  - 不要从第三方站点下载 ffmpeg（只用仓库自带脚本或用户本机已有）；
  - 不要装到 `Program Files`（CEP 扩展装在用户目录）；
  - 不要在 Premiere 运行时执行（文件会被占用）。
- **判定成功**：第 5 节「校验」全部通过，且用户确认菜单里能看到 YorkCut Pro。
- **遇到不确定**：停下来向用户确认，不要自行改动许可证、Manifest 或目录结构。

---

## 1. 前置检查

| 检查项 | 命令（PowerShell） | 通过标准 |
|---|---|---|
| 操作系统 | `[Environment]::OSVersion.Version.Major` | `>= 10` |
| Premiere 已安装 | `Get-ChildItem 'C:\Program Files\Adobe' -Filter 'Adobe Premiere Pro*'` | 至少一个结果 |
| Premiere 版本 | 看上面目录名（如 `Adobe Premiere Pro 2025`） | **23.0 以上**；字幕轨/高光图形建议 **25.1+** |
| Premiere 已退出 | `Get-Process 'Adobe Premiere Pro' -ErrorAction SilentlyContinue` | 无输出（有则请用户先完全退出） |
| CEP 扩展目录 | `$env:APPDATA\Adobe\CEP\extensions` | 存在即可（不存在时安装会自动创建） |

> 说明：扩展 ID 是 `com.yorkcut.pro`，安装路径固定为
> `%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`。

---

## 2. 获取安装包

从本仓库的 Release 下载（不要用源码 zip 的自动打包，那里面没有安装器）：

```
https://github.com/yorkloh/yorkcut-pro/releases/download/v1.0.0/YorkCut-Pro-1.0.0.zip
```

- 文件名：`YorkCut-Pro-1.0.0.zip`
- 大小：约 **107 KB**
- 校验（可选）：解压后顶层目录应叫 `YorkCut-Pro-1.0.0`，里面有 18 个文件，包含
  `index.html`、`CSXS\manifest.xml`、`js\panel.js`、`jsx\host.jsx`、
  `tools\patch-mogrt.ps1`、`安装到Premiere.bat`。

---

## 3. 解压

```powershell
$zip = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"   # 改成实际路径
$tmp = Join-Path $env:TEMP ("yc-unzip-" + [guid]::NewGuid().ToString("N"))
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$payload = Join-Path $tmp "YorkCut-Pro-1.0.0"
Test-Path (Join-Path $payload "CSXS\manifest.xml")     # 期望 True
```

**校验**：`CSXS\manifest.xml` 存在。

---

## 4. 安装（二选一）

### 4A 交互式安装（人工，推荐给普通用户）

双击 `YorkCut-Pro-1.0.0\安装到Premiere.bat`，按提示操作。脚本会：

1. 写入 `PlayerDebugMode=1`（CSXS.9 ~ CSXS.15）——未签名扩展必须开这个；
2. 把文件复制到 `%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`；
3. 打印 `Plugin installed.`；
4. 询问 **`Is ffmpeg already installed on this PC?`**
   - 按 **Y** → 弹出文件选择框，选中你机器上的 `ffmpeg.exe`（会被复制进插件目录）；
   - 按 **N** → 自动下载安装 ffmpeg 到插件目录（需要联网）；
   - 也可以直接关掉窗口跳过（不装 ffmpeg 只影响"从视频里抽音频"这一功能）。
5. 最后 `pause`，按任意键关闭。

> ⚠️ 安装前必须**完全退出 Premiere**。

### 4B 无人值守安装（AI 助手 / 自动化）

```powershell
# 变量：按实际路径替换 $zip
$zip     = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"
$tmp     = Join-Path $env:TEMP ("yc-unzip-" + [guid]::NewGuid().ToString("N"))
$dest    = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro"

Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$payload = Join-Path $tmp "YorkCut-Pro-1.0.0"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
# 这 5 个是安装器/说明文件，不复制进扩展目录
$skip = @("安装到Premiere.bat", "卸载.bat", "使用说明.txt", "install-exclude.txt", "install-ffmpeg.ps1")
Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
    if ($skip -contains $_.Name) { return }
    $rel = $_.FullName.Substring($payload.Length).TrimStart('\')
    $out = Join-Path $dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $out) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $out -Force
}
# 未签名 CEP 扩展必须开启调试模式
foreach ($v in 9..15) {
    reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f | Out-Null
}
```

可选 —— 同时安装 ffmpeg（需要联网）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $payload "install-ffmpeg.ps1") `
    -Mode Download -Dest (Join-Path $dest "tools\ffmpeg")
```

**校验**：见第 5 节。

---

## 5. 校验（AI 必须执行）

```powershell
$dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro"

Test-Path (Join-Path $dest "CSXS\manifest.xml")                                  # 期望 True
(Get-Content (Join-Path $dest "CSXS\manifest.xml") -Raw) -match 'com\.yorkcut\.pro'      # 期望 True
(Get-Content (Join-Path $dest "CSXS\manifest.xml") -Raw) -match 'ExtensionBundleVersion="1\.0\.0"'  # 期望 True
(Get-ChildItem -LiteralPath $dest -Recurse -File).Count                            # 期望 >= 13
Test-Path (Join-Path $dest "js\panel.js")                                         # 期望 True
Test-Path (Join-Path $dest "jsx\host.jsx")                                        # 期望 True
(Get-ItemProperty "HKCU:\Software\Adobe\CSXS.15" -ErrorAction SilentlyContinue).PlayerDebugMode   # 期望 1
```

全部通过后，告诉用户：**完全退出 Premiere 再重新打开**，然后
`窗口（Window） → 扩展（Extensions） → YorkCut Pro`。

---

## 6. 关于 ffmpeg（可选）

- 作用：把**声音轨里的视频文件**抽成音频（口播/音效/BGM 三个文件夹里的 mp4、mov 等）。
- 不装也不影响画面轨；只是这三个轨道只能用现成的音频文件（mp3/wav/m4a）。
- 检测：面板日志里会有 `ffmpeg：<路径>` 或提示找不到。

---

## 7. 卸载

```powershell
Remove-Item -LiteralPath (Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yorkcut.pro") -Recurse -Force
```

或双击安装包里的 `卸载.bat`。用户数据（设置、日志、时长缓存）在 `%APPDATA%\YorkCutPro\`，
如需彻底清理一并删除。

---

## 8. 失败处理

| 现象 | 原因 | 处置 |
|---|---|---|
| 菜单里没有 YorkCut Pro | Premiere 没重启 / PlayerDebugMode 未生效 | 完全退出重开；重跑第 4 步的 reg 命令；确认路径是 `com.yorkcut.pro` |
| 面板空白 / 白屏 | 文件缺失（少了 `js/` 或 `css/`） | 重新解压安装，核对第 5 节的 13 个文件 |
| 提示 `EvalScript` 失败 | 宿主 `jsx/host.jsx` 缺失或损坏 | 确认 `jsx/host.jsx` 存在且大小 > 60 KB |
| 安装时提示文件被占用 | Premiere 还开着 | 完全退出 Premiere 后重试 |
| 两个 YorkCut 菜单项 | 装了两份（appdata 里和 Program Files 里） | 只保留 `%APPDATA%` 下那份 |
| ffmpeg 相关报错 | 未安装 / 路径含中文空格 | 用 `-Mode Download` 重装，或把 ffmpeg.exe 放到 `tools\ffmpeg\` |
