# 下载教程 · Download Guide

> 面向人类用户与 AI 助手。只讲"怎么拿到安装包"，安装见 [INSTALL.md](INSTALL.md)。

---

## 1. 唯一官方来源

```
https://github.com/yorkloh/yorkcut-pro/releases
```

打开后选最新版本（当前 **v1.0.0**），在页面底部 **Assets** 里下载：

| 文件 | 大小 | 说明 |
|---|---|---|
| **`YorkCut-Pro-1.0.0.zip`** | 约 **116 KB** | ✅ **就下这个** —— 安装包 |
| `Source code (zip)` | ~60 KB | ❌ 不要下，那是源码，**没有安装器** |

> 千万不要在仓库首页点 `Code → Download ZIP`，那是源码包，不含 `安装到Premiere.bat`。

## 2. 命令行下载（AI 助手可直接执行）

```powershell
$url = "https://github.com/yorkloh/yorkcut-pro/releases/download/v1.0.0/YorkCut-Pro-1.0.0.zip"
$out = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"
Invoke-WebRequest -Uri $url -OutFile $out
(Get-Item $out).Length        # 期望 ≈ 116444 字节
```

## 3. 校验（推荐）

```powershell
$out = "$env:USERPROFILE\Downloads\YorkCut-Pro-1.0.0.zip"
(Get-Item $out).Length                                  # ≈ 116444
Get-FileHash $out -Algorithm SHA256 | Format-List       # 与 Release 页对比
Expand-Archive $out "$env:TEMP\yc-check" -Force
(Get-ChildItem "$env:TEMP\yc-check\YorkCut-Pro-1.0.0" -Recurse -File).Count   # 期望 19
Test-Path "$env:TEMP\yc-check\YorkCut-Pro-1.0.0\安装到Premiere.bat"            # 期望 True
```

## 4. 国内下载慢 / 打不开

按顺序试：

1. **开启代理**（浏览器能打开 GitHub 时，命令行也设代理）：
   ```powershell
   $env:HTTPS_PROXY = "http://127.0.0.1:10808"   # 换成你自己的代理端口
   ```
2. **使用加速镜像**（把域名换成镜像站，例如 `https://ghproxy.net/` 前缀）：
   ```
   https://ghproxy.net/https://github.com/yorkloh/yorkcut-pro/releases/download/v1.0.0/YorkCut-Pro-1.0.0.zip
   ```
   > 镜像站由第三方提供，**请自行确认可信度**；官方来源只有上面的 GitHub 链接。
3. **用浏览器下载**：GitHub 页面里点资产名，浏览器会走你自己的网络/代理。

## 5. 下载后的样子

解压 `YorkCut-Pro-1.0.0.zip` → 得到文件夹 `YorkCut-Pro-1.0.0`，里面有：

```
index.html            cs/ CSXS/ js/ jsx/ tools/ assets/
安装到Premiere.bat      ← 双击它安装
卸载.bat                ← 双击它卸载
使用说明.txt
install-ffmpeg.ps1  install-exclude.txt
```

## 6. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面 404 | 版本号写错（如 v1.0 少了 `.0`） | 回 Releases 首页选正确的 tag |
| 下载到的是 `Source code.zip` | 点错了资产 | 重新下 `YorkCut-Pro-*.zip` |
| 解压后没有 `安装到Premiere.bat` | 下的是源码包 | 同上 |
| 文件被杀软删掉 | 批处理被误判 | 恢复并加白名单，或改用 [INSTALL.md](INSTALL.md) 的无人值守 PowerShell 方式 |
| 下载很慢/中断 | 网络 | 见第 4 节 |
