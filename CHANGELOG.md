# Changelog

## 1.0.0 — 2026-10-19

首个公开版本。

**功能**

- 多段编排：每段独立素材池，池抽 / 权重抽
- 自动排轨：视频 / 口播 / 音效 / BGM 分轨，静音、循环、淡入淡出
- 变速自检：写轨后用 QE 实测片长与计划比对
- 字幕轨：Premiere 原生字幕轨（`Sequence.createCaptionTrack` 读 SRT）
- 高光图形：按每条文案生成打好补丁的 `.mogrt`（把文字写进模板默认值）后插入画面轨
- 文案格式：一个 `.txt` = 一条字幕/图形，行内换行与空行均保留
- 完全离线：不联网、不校验账号、日志为纯文本

**界面**

- 中文 / English 双语：默认中文，系统语言非中文时自动切英文，顶部按钮手动切换
- 面板底部「检查更新」链接，用系统浏览器打开 Releases（不上报任何信息）

**许可**

- 采用 **AGPL-3.0-or-later** + 商业双许可
- `LICENSE` / `LICENSE-COMMERCIAL.txt` / `COMMERCIAL.md` / `COMMERCIAL-LICENSE-TEMPLATE.md`
- 贡献需同意 CLA（见 `CONTRIBUTING.md`）

**文档**

- 中文：`README.md` / `INSTALL.md` / `DOWNLOAD.md` / `UPDATE.md` / `USAGE.md`
- English: `README.en.md` / `INSTALL.en.md` / `DOWNLOAD.en.md` / `UPDATE.en.md` / `USAGE.en.md`
- 每个英文文档都包含「给 AI 助手的执行契约 + 校验命令」，便于自动化安装
