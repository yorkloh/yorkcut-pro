// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * 面板中英文切换（默认中文；系统语言非中文时自动切英文，也可用右下角按钮手动切换）。
 *
 * 设计原则：**不改动面板原有结构与逻辑**。
 *   - 以"中文原文 → 英文"字典，遍历 DOM 文本节点与 title/placeholder 属性做替换；
 *   - MutationObserver 监听动态插入的节点（对话框、日志等）自动翻译；
 *   - 语言选择存 localStorage，重启面板后保持；
 *   - 字典里没有的文案保持原样（不会出现空白）。
 */
(function (root) {
    "use strict";

    var LS_KEY = "yorkcut.lang";

    /* ---------------- 字典：中文 → English ---------------- */
    var TEXT = {
        "YorkCut 批量混剪": "YorkCut Batch Editor",
        "卸载…": "Uninstall…",
        "工具栏已分行 · 去重/转场可浮出拖拽 · 点标题栏拖动，点「停靠」收回。":
            "Toolbars are split into rows. Dedupe / transition blocks can float; drag by the title bar, click Dock to put back.",
        "+ 脚本": "+ Script",
        "预设": "Presets",
        "无 ▾": "None ▾",
        "无": "None",
        "保存当前为…": "Save current as…",
        "另存到…": "Save to…",
        "浏览打开…": "Browse…",
        "设置预设文件夹…": "Set preset folder…",
        "段": "Segments",
        "添加一段": "Add segment",
        "复制段": "Copy",
        "粘贴段": "Paste",
        "合并": "Merge",
        "拆分": "Split",
        "清除无效链": "Clear invalid",
        "重置浮层": "Reset floats",
        "下方功能块可「浮出」后在面板内拖动；点「停靠」收回原位。":
            "Blocks below can be floated and dragged inside the panel; click Dock to return them.",
        "生成设置": "Output",
        "浮出": "Float",
        "停靠": "Dock",
        "生成条数": "Sequences",
        "帧率": "Frame rate",
        "24帧保护": "24 fps guard",
        "序列名前缀": "Name prefix",
        "产能粗估 —": "Est. capacity —",
        "去重 / 转场": "Dedupe / Transitions",
        "去重": "Dedupe",
        "关": "Off",
        "单条内": "Per sequence",
        "整批": "Per batch",
        "最多": "Max",
        "转场": "Transition",
        "固定": "Fixed",
        "随机": "Random",
        "转场名": "Name",
        "帧数": "Frames",
        "转场库…": "Transition library…",
        "高光 / 缩放": "Highlight / Zoom",
        "高光图形": "Highlight graphic",
        "浏览": "Browse",
        "清": "Clear",
        "界面缩放": "UI scale",
        "额外：把新建序列嵌到当前时间轴播放头": "Also nest new sequences at the playhead",
        "新建序列": "New sequences",
        "终止生成": "Abort",
        "日志": "Log",
        "日志 ▸": "Log ▸",
        "日志 ▾": "Log ▾",
        "就绪": "Ready",
        "诊断": "Diagnostics",
        "日志文件夹": "Log folder",
        "卸载 YorkCut": "Uninstall YorkCut Pro",
        "将删除本机 CEP 扩展目录。清除数据会一并删除时长缓存、加密日志与面板本地设置。":
            "Deletes the local CEP extension folder. Checking the box also removes the duration cache, logs and panel settings.",
        "同时清除本机 YorkCutPro 数据": "Also delete local YorkCut data",
        "取消": "Cancel",
        "确认卸载": "Confirm",
        "抽取权重": "Pick weights",
        "勾选要参与抽签的文件夹。同级不足 100% 会等比放大，超过 100% 则这一层改为均分。不勾选则整层均分。":
            "Check the folders to include. Below 100% the weights scale up; above 100% that level falls back to an even split. Nothing checked = even split.",
        "锁定策略": "Lock strategy",
        "保存预设": "Save preset",
        "自定义预设名称（同名将覆盖）。": "Custom preset name (same name overwrites).",
        "保存": "Save",
        "一键铺段": "Auto-fill segments",
        "父级下第一层子文件夹将作为段（自然序）。": "First-level subfolders become segments (natural order).",
        "同步到该轨已有的其它层（默认关，确认后才改）": "Sync to other levels of this track (off by default)",
        "只填已有段": "Fill existing only",
        "追加段并铺满": "Append and fill",
        "按子文件夹铺段": "Fill from subfolders",
        "转场库（Premiere）": "Transition library (Premiere)",
        "勾选参与「库内随机」的转场。名称需与本机 Premiere 已安装转场一致。":
            "Check transitions used by \"random from library\". Names must match those installed in your Premiere.",
        "确定": "OK",
        "生成前确认": "Confirm generation",
        "返回修改": "Back",
        "确认写入 Premiere": "Write to Premiere",
        "口播": "Voice",
        "画面": "Video",
        "音效": "SFX",
        "文案": "Text",
        "字幕": "Subtitles",
        "高光": "Highlight"
    };

    var ATTR = {
        "删除本机 YorkCut 扩展；可选清除缓存/日志": "Remove the local YorkCut extension; optionally clear cache and logs",
        "复制当前选中段": "Copy the selected segment",
        "粘贴到选中段后方": "Paste after the selected segment",
        "与下一段合并": "Merge with the next segment",
        "拆出副本": "Split out a copy",
        "只清除标红的无效链接，不会自动执行": "Only clears red (invalid) links; does not run anything",
        "收回所有浮出块": "Dock all floated blocks",
        "在面板内浮出可拖拽": "Float and drag inside the panel",
        "停回原位": "Dock back",
        "同文件在成片中的复用限制；不够时自动放宽并警告":
            "Reuse limit for the same file; relaxed automatically with a warning when short",
        "同文件复用限制": "Reuse limit for the same file",
        "每文件最多出现次数": "Max appearances per file",
        "Premiere 画面转场（QE）": "Premiere video transition (QE)",
        "勾选参与随机的转场": "Choose transitions used by random",
        "高光铺到画面轨顶层的 Motion Graphics 模板": "MOGRT placed on top of the video track",
        "拖中间：纵向滚动\n拖上下两端灰块：拉伸缩放段板高度（与底栏左右把手同类）":
            "Drag middle: scroll; drag the grey ends: resize the segment panel height",
        "拖中间滚动；拖上下两端缩放高度": "Drag middle to scroll; drag the ends to resize",
        "向上/下拖：缩放段板高度": "Drag up/down: resize segment panel height",
        "拖中间滚动；拖左右把手缩放列宽": "Drag middle to scroll; drag handles to resize columns",
        "在分片间隙终止；当前 Premiere 脚本片段结束后生效":
            "Aborts between chunks; takes effect after the current script chunk",
        "浮出后可拖动": "Float it to drag",
        "展开/收起日志": "Expand / collapse log",
        "显示调用原始返回等诊断信息": "Show raw script returns and other diagnostics",
        "打开加密日志目录": "Open the log folder",
        "长按 1 秒切换诊断模式": "Long-press 1 s to toggle diagnostics",
        "Premiere 2021 及以上 · 窗口 > 扩展 > YorkCut":
            "Premiere 2021+ · Window > Extensions > YorkCut Pro",
        "口播文件夹里的视频会先抽出 wav 再抽签。留空则尝试用 ffprobe 同目录的 ffmpeg。":
            "Videos in the voice folder are converted to wav before picking. Leave empty to use ffprobe/ffmpeg next to it.",
        "可选。留空则只用 Premiere 探针。": "Optional. Leave empty to use only the Premiere probe.",
        "拖中间：纵向滚动\n拖上下两端灰块：拉伸缩放段板高度（与底栏左右把手同类）":
            "Drag middle: scroll. Drag the grey ends: resize the segment panel height (same as the bottom handles)."
    };

    var PH = {
        "选择 .mogrt": "Choose a .mogrt",
        "可选路径": "optional path",
        "例如：口播双轨竖屏": "e.g. two-voice vertical"
    };

    /* ---------------- 语言状态 ---------------- */
    var lang = "zh";

    function detect() {
        try {
            var saved = root.localStorage && localStorage.getItem(LS_KEY);
            if (saved === "zh" || saved === "en") return saved;
        } catch (e) {}
        try {
            var nav = (root.navigator && root.navigator.language) || "";
            if (nav && nav.toLowerCase().indexOf("zh") !== 0) return "en";
        } catch (e2) {}
        return "zh";
    }

    function lookup(text) {
        if (lang !== "en") return null;
        var key = String(text == null ? "" : text);
        var trimmed = key.replace(/^\s+|\s+$/g, "");
        if (!trimmed) return null;
        if (TEXT[trimmed]) return TEXT[trimmed];
        return null;
    }

    /* ---------------- DOM 翻译 ---------------- */
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };

    function translateTextNode(node) {
        var v = node.nodeValue;
        if (!v) return;
        if (lang === "en") {
            var en = lookup(v);
            if (en === null) return;
            if (node.__ycZh === undefined) node.__ycZh = v;
            node.nodeValue = en;
        } else if (node.__ycZh !== undefined) {
            node.nodeValue = node.__ycZh;
            delete node.__ycZh;
        }
    }

    function translateAttr(el, name, table) {
        var v = el.getAttribute(name);
        if (v == null) return;
        if (lang === "en") {
            var en = table[v] || table[v.replace(/^\s+|\s+$/g, "")];
            if (!en) return;
            if (!el.__ycAttr) el.__ycAttr = {};
            if (el.__ycAttr[name] === undefined) el.__ycAttr[name] = v;
            el.setAttribute(name, en);
        } else if (el.__ycAttr && el.__ycAttr[name] !== undefined) {
            el.setAttribute(name, el.__ycAttr[name]);
            delete el.__ycAttr[name];
        }
    }

    function walk(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            if (node.parentNode && SKIP_TAGS[node.parentNode.tagName]) return;
            translateTextNode(node);
            return;
        }
        if (node.nodeType !== 1) return;
        if (SKIP_TAGS[node.tagName]) return;
        translateAttr(node, "title", ATTR);
        translateAttr(node, "placeholder", PH);
        var i;
        for (i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }

    function apply() {
        if (root.document && root.document.body) walk(root.document.body);
    }

    function setLang(next) {
        lang = (next === "en") ? "en" : "zh";
        try { if (root.localStorage) localStorage.setItem(LS_KEY, lang); } catch (e) {}
        apply();
        updateButton();
    }

    /* ---------------- 右下角切换按钮 ---------------- */
    var btn = null;

    function updateButton() {
        if (!btn) return;
        btn.textContent = (lang === "en") ? "中文" : "EN";
        btn.title = (lang === "en") ? "切换到中文 / Switch to Chinese" : "Switch to English / 切换到英文";
    }

    function ensureButton() {
        if (btn && btn.parentNode) return;
        btn = document.createElement("button");
        btn.type = "button";
        btn.id = "ycLangBtn";
        btn.setAttribute("style", [
            "position:fixed", "right:8px", "bottom:8px", "z-index:99999",
            "padding:2px 8px", "font-size:11px", "line-height:16px",
            "background:#3a3a3a", "color:#ddd", "border:1px solid #555",
            "border-radius:10px", "cursor:pointer", "opacity:0.85"
        ].join(";"));
        btn.addEventListener("click", function () {
            setLang(lang === "en" ? "zh" : "en");
        });
        var host = document.body || document.documentElement;
        if (host) host.appendChild(btn);
        updateButton();
    }

    /* ---------------- 启动 ---------------- */
    function boot() {
        lang = detect();
        ensureButton();
        apply();
        try {
            var mo = new MutationObserver(function (muts) {
                for (var i = 0; i < muts.length; i++) {
                    var m = muts[i];
                    if (m.type === "characterData") { walk(m.target); }
                    else if (m.addedNodes) {
                        for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
                    }
                }
            });
            mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
    }

    root.YorkCutI18n = {
        t: function (s) {
            if (lang !== "en") return s;
            return lookup(s) || s;
        },
        setLang: setLang,
        getLang: function () { return lang; },
        apply: apply,
        detect: detect
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})(typeof window !== "undefined" ? window : this);
