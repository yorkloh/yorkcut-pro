# YorkCut Pro

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Commercial](https://img.shields.io/badge/Commercial-license%20available-green.svg)](COMMERCIAL.md)

> 面向 Adobe Premiere Pro 的批量混剪插件（CEP 扩展）：按段的素材库随机抽签，自动排轨、变速、
> 生成字幕轨与高光图形，一次产出多条成片序列。

| | |
|---|---|
| **版本** | 1.0.0 |
| **许可证** | **AGPL-3.0-or-later**（见 [LICENSE](LICENSE)） |
| **商业许可** | **闭源分发/闭源商用需另行授权** — 罗永康 · 1141673084@qq.com（见 [COMMERCIAL.md](COMMERCIAL.md)） |
| **作者** | 罗永康 |

> **双许可摘要**：任何人可以自由使用、修改、分发本项目（含商用），但**衍生作品必须以 AGPL-3.0 开源**；
> 若你想**闭源**发布或闭源集成，请购买商业许可。详见 [COMMERCIAL.md](COMMERCIAL.md)。

**从哪里开始**

- 📦 **[安装教程 INSTALL.md](INSTALL.md)** — 人类和 AI 助手都能照做的安装流程（含无人值守脚本与校验命令）
- 📘 **[使用教程 USAGE.md](USAGE.md)** — 素材目录结构、文案格式、生成流程、日志与排错
- 📄 [COMMERCIAL.md](COMMERCIAL.md) — 商业许可 | [CONTRIBUTING.md](CONTRIBUTING.md) — 贡献与 CLA | [TRADEMARK.md](TRADEMARK.md) — 名称使用规则

---

## 功能

- **多段编排**：按"段"配置素材文件夹，每段独立抽签，支持权重/池抽模式
- **自动排轨**：视频轨 / 口播 / 音效 / BGM 各自落轨，静音、循环、淡入淡出
- **变速自检**：QE 实测片长与计划比对，避免速度参数错位
- **字幕轨**：用 Premiere 原生字幕轨（`Sequence.createCaptionTrack` 读 SRT）
- **高光图形**：按文案生成打好补丁的 `.mogrt` 模板插入画面轨（文字一定渲染）
- **文案格式**：`.txt` 一个文件 = 一条字幕/图形，行内换行保留，空行保留为空行
- **完全离线**：不联网、不校验账号、日志完全明文

## 环境要求

- Premiere Pro 23.0+（字幕轨与图形功能建议 **25.1+**，本项目在该版本实测）
- 安装时若未检测到 ffmpeg，安装脚本会提示下载（ffmpeg 由官方分发）

## 安装

1. 双击 `安装到Premiere.bat`
2. 按提示选择 ffmpeg（已有则指定路径，没有则自动下载）
3. 完全退出 Premiere，重新打开
4. 菜单：**窗口 → 扩展 → YorkCut Pro**

卸载：双击 `卸载.bat`，或删除
`%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro`

## 高光图形模板

本仓库**不附带**任何 `.mogrt`（Adobe 自带模板不可再分发）。请自行制作模板放进
`assets\`，或直接在面板里选择你自己的 `.mogrt`。详见 `assets/README.md`。

## 许可证

本项目采用 **AGPL-3.0-or-later**（见 `LICENSE`）。

- 个人使用、修改、分发、商用均可，但**衍生作品必须同样以 AGPL-3.0 开源**；
- 想把本项目（或其衍生作品）**闭源**发布或闭源商用，必须获得**商业许可**（见 `COMMERCIAL.md`）；
- 商业许可联系：**罗永康 · 1141673084@qq.com**

名称与标识的使用规则见 `TRADEMARK.md`，贡献方式见 `CONTRIBUTING.md`。

## 作者签名

代码中留有一处「字母藏头」签名（`YorkCutmadebyLuoYongkang`），
`js/selftest.js` 会校验它是否被破坏。这是作者身份标识，请保留。
