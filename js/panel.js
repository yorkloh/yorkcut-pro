// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
(function () {
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    var caf = window.cancelAnimationFrame || function (id) { clearTimeout(id); };

    if (typeof CSInterface === "undefined") {
        var b = document.getElementById("banner");
        if (b) {
            b.className = "banner";
            b.textContent = "缺少 js/CSInterface.js，面板无法启动。请重新运行「安装到Premiere.bat」或完整复制扩展目录。";
        }
        return;
    }
    var cs = new CSInterface();
    var inHost = !!(window.__adobe_cep__);
    // CEP 旧内核无 Element.closest
    if (!Element.prototype.closest) {
        Element.prototype.closest = function (sel) {
            var el = this;
            while (el && el.nodeType === 1) {
                if (el.matches && el.matches(sel)) return el;
                if (el.msMatchesSelector && el.msMatchesSelector(sel)) return el;
                el = el.parentElement || el.parentNode;
            }
            return null;
        };
    }
    var VIDEO_TYPES = [{ id: "video", label: "画面" }];
    var AUDIO_TYPES = [
        { id: "voice", label: "口播" },
        { id: "sfx", label: "音效" },
        { id: "bgm", label: "背景音" }
    ];
    var TEXT_TYPES = [
        { id: "sub", label: "字幕" },
        { id: "subHl", label: "高光" }
    ];
    var TRACK_TYPES = VIDEO_TYPES.concat(AUDIO_TYPES).concat(TEXT_TYPES);
    var CLIPBOARD_KEY = "yorkcut.segmentClipboard";
    var PRESET_META_KEY = "yorkcut.presetMeta";
    var uidSeq = 1;
    /** 必须在 loadState() 之前定义，否则 DEFAULT_TRANSITIONS.slice 会让面板整页假死 */
    var APP_VERSION = (window.YorkCutConfig && YorkCutConfig.appVersion) || "1.1.0-trial";
    var DEFAULT_TRANSITIONS = (window.YorkCutConfig && YorkCutConfig.transitionLibrary && YorkCutConfig.transitionLibrary.length)
        ? YorkCutConfig.transitionLibrary.slice()
        : ["Cross Dissolve", "Dip to Black", "Dip to White", "Push", "Slide", "Wipe"];
    var state = loadState();
    var durations = {};
    var durationMeta = {};
    var busy = false;
    var genCancel = false;
    var genRunDir = "";   // 本次生成的数据目录（取消时用来清理残留 + 给宿主写 cancel.flag）
    var PROBE_CHUNK = 6;
    var weightSession = null;
    var activeCol = 0;
    var zoomDrag = null;
    var vZoomDrag = null;
    var colDrag = null;
    var trackDrag = null;
    var segDrag = null;
    var zoomRaf = 0;
    var zoomPersistTimer = 0;
    var presetDirty = false;

    var rowsEl = document.getElementById("rows");
    var boardScroll = document.getElementById("boardScroll");
    var zoomBar = document.getElementById("zoomBar");
    var zoomThumb = document.getElementById("zoomThumb");
    var vZoomBar = document.getElementById("vZoomBar");
    var vZoomThumb = document.getElementById("vZoomThumb");
    var scriptTabs = document.getElementById("scriptTabs");
    var logEl = document.getElementById("log");
    var logToggleBtn = document.getElementById("logToggle");
    var logStatusEl = document.getElementById("logStatus");
    var logDiagCb = document.getElementById("logDiag");
    var banner = document.getElementById("banner");
    var appEl = document.getElementById("app");
    var capacityEl = document.getElementById("capacity");
    var presetToggle = document.getElementById("presetToggle");
    var presetMenu = document.getElementById("presetMenu");
    var presetList = document.getElementById("presetList");
    var appVerEl = document.getElementById("appVer");
    var layoutSession = null;
    var genPreviewSession = null;
    var logExpanded = false;
    var diagMode = false;
    try {
        diagMode = localStorage.getItem("yorkcut.diag") === "1" ||
            !!(window.YorkCutConfig && YorkCutConfig.defaultDiag);
    } catch (eDiag) { diagMode = false; }

    function on(id, eventName, fn) {
        var el = document.getElementById(id);
        if (!el) return;
        el[eventName] = fn;
    }
    on("addScript", "onclick", function () {
        state.scripts.push(emptyScript("脚本" + (state.scripts.length + 1)));
        state.activeScript = state.scripts.length - 1;
        activeCol = 0;
        markPresetDirty();
        persist();
        render();
    });
    on("addRow", "onclick", function () {
        var script = activeScript();
        script.rows.push(emptyRow());
        if (!script.colWidths) script.colWidths = [];
        script.colWidths.push(state.colWidth || 240);
        activeCol = script.rows.length - 1;
        markPresetDirty();
        persist();
        render();
    });
    on("count", "onchange", function (event) {
        state.count = clamp(event.target.value, 1, 99);
        event.target.value = state.count;
        markPresetDirty();
        persist();
        refreshCapacity();
    });
    on("fps", "onchange", function (event) {
        state.fps = Number(event.target.value) || 30;
        markPresetDirty();
        persist();
    });
    on("nameBase", "onchange", function (event) {
        state.nameBase = (event.target.value || "YorkCut").replace(/[\\/:*?"<>|]/g, "").trim() || "YorkCut";
        event.target.value = state.nameBase;
        markPresetDirty();
        persist();
    });
    on("insert", "onchange", function (event) {
        state.insert = !!event.target.checked;
        markPresetDirty();
        persist();
    });
    on("enforce24", "onchange", function (event) {
        state.enforce24fps = !!event.target.checked;
        markPresetDirty();
        persist();
    });
    var dedupeModeEl = document.getElementById("dedupeMode");
    var dedupeMaxEl = document.getElementById("dedupeMax");
    var transitionModeEl = document.getElementById("transitionMode");
    var transitionNameEl = document.getElementById("transitionName");
    var transitionFramesEl = document.getElementById("transitionFrames");
    if (dedupeModeEl) {
        dedupeModeEl.value = state.dedupeMode || "sequence";
        dedupeModeEl.onchange = function () {
            state.dedupeMode = dedupeModeEl.value || "off";
            markPresetDirty();
            persist();
        };
    }
    if (dedupeMaxEl) {
        dedupeMaxEl.value = String(state.dedupeMax || 1);
        dedupeMaxEl.onchange = function () {
            state.dedupeMax = clamp(dedupeMaxEl.value, 1, 20);
            dedupeMaxEl.value = String(state.dedupeMax);
            markPresetDirty();
            persist();
        };
    }
    if (transitionModeEl) {
        transitionModeEl.value = (state.transition && state.transition.mode) || "off";
        transitionModeEl.onchange = function () {
            ensureTransitionState();
            state.transition.mode = transitionModeEl.value || "off";
            markPresetDirty();
            persist();
            refreshTransitionUi();
        };
    }
    if (transitionNameEl) {
        transitionNameEl.onchange = function () {
            ensureTransitionState();
            state.transition.name = transitionNameEl.value || "Cross Dissolve";
            markPresetDirty();
            persist();
        };
    }
    if (transitionFramesEl) {
        transitionFramesEl.value = String((state.transition && state.transition.durationFrames) || 8);
        transitionFramesEl.onchange = function () {
            ensureTransitionState();
            state.transition.durationFrames = clamp(transitionFramesEl.value, 2, 60);
            transitionFramesEl.value = String(state.transition.durationFrames);
            markPresetDirty();
            persist();
        };
    }
    var transitionLibBtn = document.getElementById("transitionLibBtn");
    if (transitionLibBtn) transitionLibBtn.onclick = openTransitionLib;
    function bindClick(id, fn) {
        var el = document.getElementById(id);
        if (el) el.onclick = fn;
    }
    bindClick("transitionLibCancel", function () { closeTransitionLib(false); });
    bindClick("transitionLibOk", function () { closeTransitionLib(true); });
    bindClick("layoutCancel", function () { closeLayoutModal(null); });
    bindClick("layoutFill", function () { closeLayoutModal("fill"); });
    bindClick("layoutExpand", function () { closeLayoutModal("expand"); });
    bindClick("layoutReplace", function () { closeLayoutModal("replace"); });
    bindClick("genPreviewCancel", function () { closeGenPreview(false); });
    bindClick("genPreviewOk", function () { closeGenPreview(true); });
    bindClick("clearInvalidLinks", clearInvalidLinks);
    bindClick("resetFloatLayout", function () {
        try { localStorage.removeItem("yorkcut.floatLayout"); } catch (eR) {}
        if (window.YorkCutFloatUi && YorkCutFloatUi.reset) YorkCutFloatUi.reset();
        log("已重置浮出布局");
    });
    var ffprobeInput = document.getElementById("ffprobePath");
    if (ffprobeInput) {
        ffprobeInput.value = state.ffprobePath || "";
        ffprobeInput.onchange = function () {
            state.ffprobePath = ffprobeInput.value || "";
            persist();
        };
    }
    var ffmpegInput = document.getElementById("ffmpegPath");
    if (ffmpegInput) {
        ffmpegInput.value = state.ffmpegPath || "";
        ffmpegInput.onchange = function () {
            state.ffmpegPath = ffmpegInput.value || "";
            persist();
        };
    }
    on("uiZoomRange", "oninput", function (event) {
        scheduleUiZoom(clamp(event.target.value, 50, 200) / 100, false);
    });
    on("uiZoomRange", "onchange", function () { persist(); });
    on("uiZoomInput", "onchange", function (event) {
        var pct = clamp(event.target.value, 50, 200);
        scheduleUiZoom(pct / 100, true);
        persist();
    });
    on("pickMogrt", "onclick", function () { pickMogrt(); });
    on("clearMogrt", "onclick", function () {
        state.highlightMogrt = "";
        markPresetDirty();
        persist();
        render();
    });
    on("segCopy", "onclick", function () { copySegment(); });
    on("segPaste", "onclick", function () { pasteSegment(); });
    on("segLeft", "onclick", function () { moveSegment(-1); });
    on("segRight", "onclick", function () { moveSegment(1); });
    on("segMerge", "onclick", function () { mergeSegment(); });
    on("segSplit", "onclick", function () { splitSegment(); });
    on("generate", "onclick", generate);
    on("cancelGen", "onclick", function () {
        if (!busy) return;
        genCancel = true;
        // 写入阶段是一整次同步 ExtendScript 调用，面板没法在里面打断它；
        // 写一个标志文件，宿主每建完一条序列会检查一次（见 host 的 yorkcutCancelRequested）。
        if (genRunDir) {
            try { writeText(join(genRunDir, "cancel.flag"), "1"); } catch (eFlag) {}
        }
        log("正在终止…（当前 Premiere 分片结束后停止）");
    });
    on("weightCancel", "onclick", function () { closeWeight(null); });
    on("weightOk", "onclick", function () { closeWeight(readWeightTree()); });
    on("presetNameCancel", "onclick", function () { closePresetName(null); });
    on("presetNameOk", "onclick", function () {
        closePresetName(document.getElementById("presetNameInput").value);
    });
    if (presetToggle) {
        presetToggle.onclick = function (event) {
            event.stopPropagation();
            togglePresetMenu();
        };
    }
    if (presetMenu) {
        presetMenu.onclick = function (event) {
            var btn = event.target.closest("[data-preset-act]");
            if (!btn) return;
            var act = btn.getAttribute("data-preset-act");
            if (act === "none") applyPresetNone();
            else if (act === "save") openPresetName(false);
            else if (act === "saveAs") openPresetName(true);
            else if (act === "browse") browsePresetFile();
            else if (act === "folder") choosePresetFolder();
            else if (act === "load") loadPresetByName(btn.getAttribute("data-name"));
            else if (act === "delete") {
                event.stopPropagation();
                deletePreset(btn.getAttribute("data-name"));
            }
            if (act !== "save" && act !== "saveAs") closePresetMenu();
        };
    }
    document.addEventListener("click", function () { closePresetMenu(); });

    if (boardScroll) {
        boardScroll.addEventListener("scroll", function () {
            updateZoomBar();
            updateVZoomBar();
        });
    }
    window.addEventListener("resize", function () {
        try { applyBoardVZoom(); } catch (e1) {}
        try { updateZoomBar(); } catch (e2) {}
        try { updateVZoomBar(); } catch (e3) {}
    });
    try { if (zoomBar && zoomThumb) setupZoomBar(); } catch (eZ) {}
    try { if (vZoomBar && vZoomThumb) setupVZoomBar(); } catch (eV) {}
    try { setupGlobalDrag(); } catch (eG) {}
    try { refreshTransitionUi(); } catch (eTr) {}
    try {
        setupLogUi();
        setupUninstallUi();
        initAppVersionUi();
        checkForUpdateQuiet();
    } catch (bootErr) {
        try { console.log("YorkCut boot:", bootErr); } catch (eC) {}
    }
    try {
        if (window.YorkCutFloatUi) YorkCutFloatUi.init();
    } catch (eFloat) {}
    if (!inHost) {
        if (banner) {
            banner.className = "banner";
            banner.textContent = "现在是在浏览器里预览。安装到 Premiere 后，从「窗口 > 扩展 > YorkCut」打开，才能导入素材并新建序列。";
        }
    } else {
        ensureHostLoaded().then(function () {
            return callHost("yorkcutHostInfo()", { label: "yorkcutHostInfo" });
        }).then(function (info) {
            if (!info || info.ok === false) return;
            var line = "已连接 Premiere " + (info.version || "");
            if (info.hasSequence && info.fps) {
                state.fps = nearestFps(info.fps);
                var fpsEl = document.getElementById("fps");
                if (fpsEl) fpsEl.value = String(state.fps);
                line += " · 参考帧率 " + info.fps;
            }
            line += " · 字幕->字幕轨 · 高光->V轨图形";
            var hl = document.getElementById("hostLine");
            if (hl) hl.textContent = line;
            if (banner) banner.className = "banner hidden";
        }).catch(function (err) {
            if (banner) {
                banner.className = "banner";
                banner.textContent = "宿主脚本未连通：" + (err && err.message ? err.message : String(err)) +
                    "。请完全退出 Premiere 后重开，或重新运行安装脚本。";
            }
            try { log(String(err && err.message ? err.message : err), true); } catch (eLog) {}
        });
    }

    try {
        render();
        applyUiZoomImmediate();
        applyBoardVZoom();
        updateZoomBar();
        updateVZoomBar();
    } catch (renderErr) {
        if (banner) {
            banner.className = "banner";
            banner.textContent = "界面渲染失败：" + (renderErr && renderErr.message ? renderErr.message : String(renderErr));
        }
        try { console.log("YorkCut render:", renderErr); } catch (eC2) {}
    }

    function activeScript() {
        if (!state.scripts.length) state.scripts.push(emptyScript("脚本1"));
        if (state.activeScript < 0 || state.activeScript >= state.scripts.length) state.activeScript = 0;
        return state.scripts[state.activeScript];
    }

    function setVal(id, value, prop) {
        var el = document.getElementById(id);
        if (!el) return;
        prop = prop || "value";
        el[prop] = value;
    }
    function render() {
        var script = activeScript();
        ensureColWidths(script);
        setVal("count", state.count);
        setVal("fps", String(state.fps));
        setVal("nameBase", state.nameBase);
        setVal("insert", !!state.insert, "checked");
        setVal("enforce24", state.enforce24fps !== false, "checked");
        var pct = Math.round((state.uiZoom || 1) * 100);
        setVal("uiZoomRange", String(pct));
        setVal("uiZoomInput", String(pct));
        setVal("highlightMogrt", state.highlightMogrt ? baseName(state.highlightMogrt) : "");
        var mogrt = document.getElementById("highlightMogrt");
        if (mogrt) mogrt.title = state.highlightMogrt || "";
        if (dedupeModeEl) dedupeModeEl.value = state.dedupeMode || "sequence";
        if (dedupeMaxEl) dedupeMaxEl.value = String(state.dedupeMax || 1);
        try { updatePresetToggleLabel(); } catch (eP) {}
        if (scriptTabs && rowsEl) {
            renderScriptTabs();
            rowsEl.innerHTML = "";
            script.rows.forEach(function (row, index) {
                if (index === 0) rowsEl.appendChild(makeColGap(0));
                rowsEl.appendChild(renderCol(row, index));
                rowsEl.appendChild(makeColGap(index + 1));
            });
        }
        applyUiZoomImmediate();
        try { applyBoardVZoom(); } catch (eB) {}
        try { updateZoomBar(); } catch (eZ) {}
        try { updateVZoomBar(); } catch (eV) {}
        refreshCapacity();
    }

    function makeColGap(insertIndex) {
        var gap = document.createElement("div");
        gap.className = "col-gap";
        gap.setAttribute("data-seg-gap", String(insertIndex));
        gap.ondragover = function (event) {
            if (!segDrag) return;
            event.preventDefault();
            clearSegGapActive();
            gap.classList.add("active");
        };
        gap.ondragleave = function () { gap.classList.remove("active"); };
        gap.ondrop = function (event) {
            event.preventDefault();
            gap.classList.remove("active");
            if (!segDrag) return;
            insertSegmentAt(segDrag.fromIndex, insertIndex);
            segDrag = null;
        };
        return gap;
    }

    function clearSegGapActive() {
        var gaps = rowsEl.querySelectorAll(".col-gap");
        for (var i = 0; i < gaps.length; i++) gaps[i].classList.remove("active");
    }

    function renderScriptTabs() {
        if (!scriptTabs) return;
        scriptTabs.innerHTML = "";
        state.scripts.forEach(function (script, index) {
            var tab = document.createElement("button");
            tab.type = "button";
            tab.className = "script-tab" + (index === state.activeScript ? " active" : "");
            tab.textContent = script.name || ("脚本" + (index + 1));
            tab.onclick = function () {
                state.activeScript = index;
                activeCol = 0;
                persist();
                render();
            };
            tab.ondblclick = function () {
                var name = window.prompt("脚本名称", script.name || ("脚本" + (index + 1)));
                if (!name) return;
                script.name = String(name).trim() || script.name;
                markPresetDirty();
                persist();
                render();
            };
            scriptTabs.appendChild(tab);
            if (state.scripts.length > 1) {
                var del = document.createElement("button");
                del.type = "button";
                del.className = "script-del";
                del.textContent = "×";
                del.onclick = function (event) {
                    event.stopPropagation();
                    if (!window.confirm("删除脚本「" + (script.name || "") + "」？")) return;
                    state.scripts.splice(index, 1);
                    if (state.activeScript >= state.scripts.length) state.activeScript = state.scripts.length - 1;
                    activeCol = 0;
                    markPresetDirty();
                    persist();
                    render();
                };
                scriptTabs.appendChild(del);
            }
        });
    }

    function renderCol(row, index) {
        var col = document.createElement("section");
        col.className = "col" + (index === activeCol ? " active" : "");
        col.style.width = colWidthAt(index) + "px";
        col.setAttribute("data-seg-index", String(index));
        col.draggable = true;
        col.onclick = function () {
            activeCol = index;
            highlightCols();
        };
        col.ondragstart = function (event) {
            if (event.target.closest(".track") || event.target.closest("button") || event.target.closest("input") || event.target.closest("select") || event.target.closest(".col-resize")) {
                event.preventDefault();
                return;
            }
            segDrag = { fromIndex: index };
            col.classList.add("seg-dragging");
            event.dataTransfer.setData("text/plain", "seg:" + index);
            event.dataTransfer.effectAllowed = "move";
            activeCol = index;
            highlightCols();
        };
        col.ondragend = function () {
            col.classList.remove("seg-dragging");
            clearSegGapActive();
            segDrag = null;
        };

        var head = document.createElement("div");
        head.className = "card-head";
        var title = document.createElement("strong");
        title.textContent = "第 " + (index + 1) + " 段";
        var del = document.createElement("button");
        del.type = "button";
        del.textContent = "删除";
        del.onclick = function (event) {
            event.stopPropagation();
            var script = activeScript();
            if (script.rows.length === 1) {
                script.rows[0] = emptyRow();
                script.colWidths = [state.colWidth || 240];
                remapLinks(script, function () { return -1; });
            } else {
                script.rows.splice(index, 1);
                script.colWidths.splice(index, 1);
                remapLinks(script, function (old) {
                    if (old === index) return -1;
                    if (old > index) return old - 1;
                    return old;
                });
            }
            activeCol = Math.min(activeCol, script.rows.length - 1);
            markPresetDirty();
            persist();
            render();
        };
        head.appendChild(title);
        head.appendChild(del);
        head.style.padding = "8px 8px 0";
        col.appendChild(head);

        var body = document.createElement("div");
        body.className = "col-body";
        body.appendChild(renderZone("画面轨（V）· 上=靠上", "video-zone", VIDEO_TYPES, row, index));
        body.appendChild(renderZone("声音轨（A）· 不可拖到画面上方", "audio-zone", AUDIO_TYPES, row, index));
        body.appendChild(renderZone("字幕轨 / 高光图形源", "text-zone", TEXT_TYPES, row, index));

        var meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = summary(row);
        body.appendChild(meta);

        var switches = document.createElement("div");
        switches.className = "switches";
        switches.appendChild(check("变速与口播一致", row.sync, function (on) {
            row.sync = on;
            if (on) row.align = false;
            markPresetDirty();
            persist();
            render();
        }));
        switches.appendChild(check("画面对齐口播", row.align, function (on) {
            row.align = on;
            if (on) row.sync = false;
            markPresetDirty();
            persist();
            render();
        }));
        switches.appendChild(selectField("超长素材", row.longMat, [["head", "从头截取"], ["random", "随机时间点"]], function (value) {
            row.longMat = value;
            markPresetDirty();
            persist();
            refreshCapacity();
        }));
        switches.appendChild(numberField("镜头数", row.ext, 1, 20, function (value) {
            row.ext = value;
            markPresetDirty();
            persist();
            refreshCapacity();
        }));
        switches.appendChild(numberField("本段重复", row.repeat || 1, 1, 20, function (value) {
            row.repeat = value;
            markPresetDirty();
            persist();
            refreshCapacity();
        }));
        switches.appendChild(check("保留原声", row.keepAudio, function (on) { row.keepAudio = on; markPresetDirty(); persist(); }));
        switches.appendChild(check("不重复", row.unique, function (on) { row.unique = on; markPresetDirty(); persist(); refreshCapacity(); }));
        switches.appendChild(check("水平翻转", row.flip, function (on) { row.flip = on; markPresetDirty(); persist(); }));
        switches.appendChild(check("随机放大", row.crop, function (on) { row.crop = on; markPresetDirty(); persist(); refreshCapacity(); }));
        switches.appendChild(check("背景音循环", row.bgmLoop, function (on) { row.bgmLoop = on; markPresetDirty(); persist(); }));
        body.appendChild(switches);
        col.appendChild(body);

        var grip = document.createElement("div");
        grip.className = "col-resize";
        grip.title = "拖动调整本列宽度";
        grip.onmousedown = function (event) {
            event.preventDefault();
            event.stopPropagation();
            activeCol = index;
            colDrag = { index: index, startX: event.clientX, startW: colWidthAt(index) };
            highlightCols();
        };
        col.appendChild(grip);
        return col;
    }

    function renderZone(title, className, types, row, colIndex) {
        var zone = document.createElement("div");
        zone.className = "zone " + className;
        var h = document.createElement("div");
        h.className = "zone-title";
        h.textContent = title;
        zone.appendChild(h);
        types.forEach(function (type) {
            zone.appendChild(renderTrackGroup(row, type, colIndex));
        });
        return zone;
    }

    function renderTrackGroup(row, type, colIndex) {
        var box = document.createElement("div");
        box.className = "track-group";
        var head = document.createElement("div");
        head.className = "track-group-head";
        var label = document.createElement("span");
        label.textContent = type.label + (type.id === "sub" ? " → 字幕轨" : (type.id === "subHl" ? " → V轨图形" : ""));
        var lay = document.createElement("button");
        lay.type = "button";
        lay.textContent = "铺段";
        lay.title = "选择父级文件夹：第一层子文件夹=段（仅本轨）";
        lay.onclick = function (event) {
            event.stopPropagation();
            layoutTypeFromParent(type.id);
        };
        var linkAll = document.createElement("button");
        linkAll.type = "button";
        linkAll.textContent = "全→1";
        linkAll.title = "本轨全部段改为「和段1相同」（段1保持独立）";
        linkAll.onclick = function (event) {
            event.stopPropagation();
            linkAllSegmentsToFirst(type.id);
        };
        var add = document.createElement("button");
        add.type = "button";
        add.textContent = "+轨";
        add.onclick = function (event) {
            event.stopPropagation();
            row.tracks.push(emptyTrack(type.id));
            markPresetDirty();
            persist();
            render();
        };
        head.appendChild(label);
        head.appendChild(lay);
        head.appendChild(linkAll);
        head.appendChild(add);
        enableFolderDrop(head, function (path) {
            layoutTypeFromParent(type.id, path);
        });
        box.appendChild(head);

        var list = row.tracks.filter(function (t) { return t.type === type.id; });
        box.appendChild(makeTrackGap(row, type.id, colIndex, 0));
        if (!list.length) {
            var empty = document.createElement("div");
            empty.className = "track empty-hint";
            empty.textContent = "未添加 · 点 +轨";
            box.appendChild(empty);
            return box;
        }
        list.forEach(function (track, layerIndex) {
            box.appendChild(renderTrackLine(row, track, type, colIndex, layerIndex, list.length));
            box.appendChild(makeTrackGap(row, type.id, colIndex, layerIndex + 1));
        });
        return box;
    }

    function makeTrackGap(row, typeId, colIndex, insertIndex) {
        var gap = document.createElement("div");
        gap.className = "gap-drop";
        gap.setAttribute("data-gap", typeId + ":" + insertIndex);
        gap.ondragover = function (event) {
            if (!trackDrag || trackDrag.type !== typeId || trackDrag.colIndex !== colIndex) return;
            event.preventDefault();
            event.stopPropagation();
            clearTrackGapActive();
            gap.classList.add("active");
        };
        gap.ondragleave = function () { gap.classList.remove("active"); };
        gap.ondrop = function (event) {
            event.preventDefault();
            event.stopPropagation();
            gap.classList.remove("active");
            if (!trackDrag || trackDrag.type !== typeId || trackDrag.colIndex !== colIndex) return;
            insertTrackAt(row, trackDrag.trackId, typeId, insertIndex);
            trackDrag = null;
            markPresetDirty();
            persist();
            render();
        };
        return gap;
    }

    function clearTrackGapActive() {
        var gaps = rowsEl.querySelectorAll(".gap-drop");
        for (var i = 0; i < gaps.length; i++) gaps[i].classList.remove("active");
    }

    function renderTrackLine(row, track, type, colIndex, layerIndex, layerCount) {
        var line = document.createElement("div");
        line.className = "track";
        var linked = typeof track.linkToSeg === "number" && track.linkToSeg >= 0;
        var resolved = resolveLinkedTrack(activeScript(), colIndex, track, layerIndex);
        var canDrag = type.id === "video" || type.id === "voice" || type.id === "sfx" || type.id === "bgm";
        line.draggable = canDrag && !linked;
        if (canDrag && !linked) {
            line.title = "拖到间隙插入排序；也可拖入本地文件夹";
            line.ondragstart = function (event) {
                if (event.dataTransfer && event.dataTransfer.types && event.dataTransfer.types.indexOf("Files") >= 0) return;
                event.stopPropagation();
                trackDrag = { colIndex: colIndex, trackId: track.id, type: type.id };
                line.classList.add("dragging");
                event.dataTransfer.setData("text/plain", track.id);
                event.dataTransfer.effectAllowed = "move";
                segDrag = null;
            };
            line.ondragend = function () {
                line.classList.remove("dragging");
                clearTrackGapActive();
                trackDrag = null;
            };
        }

        var badge = document.createElement("span");
        badge.className = "layer-badge";
        if (type.id === "video") badge.textContent = "V" + (layerIndex + 1);
        else if (type.id === "voice" || type.id === "sfx" || type.id === "bgm") badge.textContent = "A" + (layerIndex + 1);
        else badge.textContent = String(layerIndex + 1);

        var name = document.createElement("span");
        var showPath = resolved && resolved.path ? resolved.path : track.path;
        name.className = "name" + (showPath ? "" : " empty") + (linked ? " linked" : "");
        if (linked && !(resolved && resolved.path)) name.classList.add("bad-link");
        if (linked) {
            name.textContent = resolved && resolved.path
                ? ("→" + (track.linkToSeg + 1) + " " + baseName(resolved.path))
                : ("→段" + (track.linkToSeg + 1) + "（无效）");
        } else {
            name.textContent = track.path ? baseName(track.path) : "未选择";
        }
        name.title = showPath || "";

        var linkSel = document.createElement("select");
        linkSel.className = "link-seg";
        linkSel.title = "独立或与其它段共用素材池";
        var optInd = document.createElement("option");
        optInd.value = "";
        optInd.textContent = "独立";
        linkSel.appendChild(optInd);
        var script = activeScript();
        for (var si = 0; si < script.rows.length; si++) {
            if (si === colIndex) continue;
            var opt = document.createElement("option");
            opt.value = String(si);
            opt.textContent = "和段" + (si + 1);
            linkSel.appendChild(opt);
        }
        linkSel.value = linked ? String(track.linkToSeg) : "";
        linkSel.onclick = function (event) { event.stopPropagation(); };
        linkSel.onchange = function () {
            if (!linkSel.value) {
                track.linkToSeg = null;
            } else {
                var target = Number(linkSel.value);
                if (!canLinkTo(script, colIndex, track, layerIndex, target)) {
                    log("不能链接到该段（会形成环或目标无独立源）。", true);
                    linkSel.value = linked ? String(track.linkToSeg) : "";
                    return;
                }
                track.linkToSeg = target;
            }
            markPresetDirty();
            persist();
            render();
            refreshCapacity();
        };

        var pick = document.createElement("button");
        pick.type = "button";
        pick.textContent = "文件夹";
        pick.disabled = linked;
        pick.onclick = function (event) {
            event.stopPropagation();
            chooseFolder(track);
        };
        var weight = document.createElement("button");
        weight.type = "button";
        weight.textContent = "权重";
        weight.disabled = linked || !showPath;
        weight.onclick = function (event) {
            event.stopPropagation();
            if (resolved && resolved !== track) editWeight(resolved);
            else editWeight(track);
        };
        var clear = document.createElement("button");
        clear.type = "button";
        clear.textContent = "清";
        clear.disabled = linked || !track.path;
        clear.onclick = function (event) {
            event.stopPropagation();
            track.path = "";
            track.strategy = { mode: "pool" };
            track.counts = { video: 0, audio: 0, text: 0 };
            track.linkToSeg = null;
            markPresetDirty();
            persist();
            render();
        };
        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "−";
        remove.onclick = function (event) {
            event.stopPropagation();
            var idx = row.tracks.indexOf(track);
            if (idx >= 0) row.tracks.splice(idx, 1);
            markPresetDirty();
            persist();
            render();
        };

        line.appendChild(badge);
        line.appendChild(name);
        line.appendChild(linkSel);
        line.appendChild(pick);
        line.appendChild(weight);
        line.appendChild(clear);
        line.appendChild(remove);

        enableFolderDrop(line, function (path) {
            if (linked) {
                log("请先改为「独立」再拖入文件夹。", true);
                return;
            }
            applyFolder(track, path, true).catch(function (err) { log(String(err), true); });
        });

        if (type.id === "voice") {
            var main = document.createElement("label");
            main.className = "main-voice";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!track.isMainVoice;
            cb.onchange = function () {
                row.tracks.forEach(function (t) {
                    if (t.type === "voice") t.isMainVoice = false;
                });
                track.isMainVoice = !!cb.checked;
                markPresetDirty();
                persist();
                render();
            };
            main.appendChild(cb);
            main.appendChild(document.createTextNode("主"));
            main.title = "主口播为标尺；否则取最长口播";
            line.appendChild(main);
        }
        if (type.id === "video" && layerCount > 1) {
            var tip = document.createElement("span");
            tip.className = "layer-tip";
            tip.textContent = layerIndex === 0 ? "底" : (layerIndex === layerCount - 1 ? "顶" : "");
            line.appendChild(tip);
        }
        return line;
    }

    function insertTrackAt(row, fromId, type, insertIndex) {
        var typed = [];
        row.tracks.forEach(function (t) {
            if (t.type === type) typed.push(t);
        });
        var from = -1;
        for (var i = 0; i < typed.length; i++) {
            if (typed[i].id === fromId) from = i;
        }
        if (from < 0) return;
        var item = typed.splice(from, 1)[0];
        var target = insertIndex;
        if (from < insertIndex) target -= 1;
        if (target < 0) target = 0;
        if (target > typed.length) target = typed.length;
        typed.splice(target, 0, item);
        var rebuilt = [];
        TRACK_TYPES.forEach(function (tt) {
            if (tt.id === type) rebuilt = rebuilt.concat(typed);
            else {
                row.tracks.forEach(function (t) {
                    if (t.type === tt.id) rebuilt.push(t);
                });
            }
        });
        row.tracks = rebuilt;
    }

    /**
     * oldToNew(oldIndex) → 新下标；<0 表示断开。重排后自指或越界的链清成独立（不自动弹窗）。
     */
    function remapLinks(script, oldToNew) {
        if (!script || !script.rows) return;
        script.rows.forEach(function (row, rowIndex) {
            (row.tracks || []).forEach(function (t) {
                if (typeof t.linkToSeg !== "number" || t.linkToSeg < 0) return;
                var next = oldToNew(t.linkToSeg);
                if (next == null || next < 0 || next === rowIndex || next >= script.rows.length) t.linkToSeg = null;
                else t.linkToSeg = next;
            });
        });
    }

    function countInvalidLinks(script) {
        var n = 0;
        (script.rows || []).forEach(function (row, ri) {
            var typed = {};
            (row.tracks || []).forEach(function (t) {
                if (typeof t.linkToSeg !== "number" || t.linkToSeg < 0) return;
                var li = typed[t.type] || 0;
                typed[t.type] = li + 1;
                var src = resolveLinkedTrack(script, ri, t, li);
                if (!src || !src.path) n += 1;
            });
        });
        return n;
    }

    function clearInvalidLinks() {
        var script = activeScript();
        var n = 0;
        script.rows.forEach(function (row, ri) {
            var typed = {};
            (row.tracks || []).forEach(function (t) {
                if (typeof t.linkToSeg !== "number" || t.linkToSeg < 0) return;
                var li = typed[t.type] || 0;
                typed[t.type] = li + 1;
                var src = resolveLinkedTrack(script, ri, t, li);
                if (!src || !src.path) {
                    t.linkToSeg = null;
                    n += 1;
                }
            });
        });
        if (!n) {
            log("没有无效的「和段相同」链接。");
            return;
        }
        markPresetDirty();
        persist();
        render();
        log("已清除 " + n + " 条无效链接（未自动执行，需你点此按钮）。");
    }

    function insertSegmentAt(fromIndex, insertIndex) {
        var script = activeScript();
        if (fromIndex < 0 || fromIndex >= script.rows.length) return;
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > script.rows.length) insertIndex = script.rows.length;
        if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return;
        ensureColWidths(script);
        var row = script.rows.splice(fromIndex, 1)[0];
        var w = script.colWidths.splice(fromIndex, 1)[0];
        var to = insertIndex;
        if (fromIndex < insertIndex) to -= 1;
        script.rows.splice(to, 0, row);
        script.colWidths.splice(to, 0, w);
        remapLinks(script, function (old) {
            if (old === fromIndex) return to;
            if (fromIndex < to && old > fromIndex && old <= to) return old - 1;
            if (to < fromIndex && old >= to && old < fromIndex) return old + 1;
            return old;
        });
        activeCol = to;
        markPresetDirty();
        persist();
        render();
    }

    function ensureColWidths(script) {
        if (!script.colWidths) script.colWidths = [];
        var base = state.colWidth || 240;
        while (script.colWidths.length < script.rows.length) script.colWidths.push(base);
        if (script.colWidths.length > script.rows.length) script.colWidths.length = script.rows.length;
    }

    function colWidthAt(index) {
        var script = activeScript();
        ensureColWidths(script);
        var w = Number(script.colWidths[index]);
        if (!isFinite(w) || w < 160) w = state.colWidth || 240;
        return clamp(w, 160, 520);
    }

    function contentWidth() {
        var script = activeScript();
        ensureColWidths(script);
        var total = 0;
        for (var i = 0; i < script.rows.length; i++) total += colWidthAt(i);
        return Math.max(total + script.rows.length * 8 + 8, 1);
    }

    function scheduleUiZoom(z, syncRange) {
        state.uiZoom = z;
        if (zoomRaf) caf(zoomRaf);
        zoomRaf = raf(function () {
            zoomRaf = 0;
            applyUiZoomImmediate();
            var pct = Math.round(z * 100);
            var rangeEl = document.getElementById("uiZoomRange");
            var inputEl = document.getElementById("uiZoomInput");
            if (syncRange && rangeEl) rangeEl.value = String(pct);
            if (inputEl) inputEl.value = String(pct);
            try { updateZoomBar(); } catch (eZ) {}
            try { updateVZoomBar(); } catch (eV) {}
        });
        if (zoomPersistTimer) clearTimeout(zoomPersistTimer);
        zoomPersistTimer = setTimeout(function () {
            zoomPersistTimer = 0;
            persist();
        }, 250);
    }

    function applyUiZoomImmediate() {
        var z = Number(state.uiZoom) || 1;
        if (z < 0.5) z = 0.5;
        if (z > 2) z = 2;
        state.uiZoom = z;
        if (appEl) appEl.style.zoom = String(z);
    }

    function highlightCols() {
        if (!rowsEl) return;
        var cols = rowsEl.querySelectorAll(".col");
        for (var i = 0; i < cols.length; i++) {
            var idx = Number(cols[i].getAttribute("data-seg-index"));
            if (idx === activeCol) cols[i].classList.add("active");
            else cols[i].classList.remove("active");
        }
    }

    function setupGlobalDrag() {
        window.addEventListener("dragend", function () {
            clearTrackGapActive();
            clearSegGapActive();
            trackDrag = null;
            segDrag = null;
        });
    }

    function setupZoomBar() {
        zoomBar.addEventListener("mousedown", function (event) {
            var edge = event.target.getAttribute("data-edge");
            var rect = zoomBar.getBoundingClientRect();
            var x = event.clientX - rect.left;
            var stateSnap = zoomMetrics();
            var script = activeScript();
            if (edge === "left" || edge === "right") {
                zoomDrag = {
                    mode: edge, startX: event.clientX,
                    origX1: stateSnap.x1, origX2: stateSnap.x2,
                    origP: stateSnap.P, origV: stateSnap.V, origS: stateSnap.S,
                    barW: rect.width, origWidths: script.colWidths.slice()
                };
            } else if (event.target === zoomThumb || zoomThumb.contains(event.target)) {
                zoomDrag = {
                    mode: "center", startX: event.clientX,
                    origX1: stateSnap.x1, origX2: stateSnap.x2,
                    origP: stateSnap.P, origV: stateSnap.V, origS: stateSnap.S, barW: rect.width
                };
            } else if (stateSnap.P > stateSnap.V) {
                var tw = stateSnap.x2 - stateSnap.x1;
                var newX1 = Math.max(0, Math.min(x - tw / 2, rect.width - tw));
                boardScroll.scrollLeft = (newX1 / rect.width) * stateSnap.P;
                updateZoomBar();
                zoomDrag = {
                    mode: "center", startX: event.clientX,
                    origX1: newX1, origX2: newX1 + tw,
                    origP: stateSnap.P, origV: stateSnap.V,
                    origS: boardScroll.scrollLeft, barW: rect.width
                };
            }
            event.preventDefault();
        });
        window.addEventListener("mousemove", function (event) {
            var script = activeScript();
            if (colDrag) {
                var dw = event.clientX - colDrag.startX;
                var next = clamp(colDrag.startW + dw / (state.uiZoom || 1), 160, 520);
                script.colWidths[colDrag.index] = next;
                state.colWidth = next;
                var col = rowsEl.querySelector('.col[data-seg-index="' + colDrag.index + '"]');
                if (col) col.style.width = next + "px";
                updateZoomBar();
                return;
            }
            if (!zoomDrag) return;
            var dx = event.clientX - zoomDrag.startX;
            var w = Math.max(1, zoomDrag.barW);
            var minThumb = 30;
            if (zoomDrag.mode === "center" && zoomDrag.origP > zoomDrag.origV) {
                var tw2 = zoomDrag.origX2 != null ? (zoomDrag.origX2 - zoomDrag.origX1) : ((zoomDrag.origV / zoomDrag.origP) * w);
                var newX1b = Math.max(0, Math.min(zoomDrag.origX1 + dx, w - tw2));
                boardScroll.scrollLeft = (newX1b / w) * zoomDrag.origP;
                updateZoomBar();
            } else if (zoomDrag.mode === "right" || zoomDrag.mode === "left") {
                var x1 = zoomDrag.origX1;
                var x2 = zoomDrag.origX2;
                if (zoomDrag.mode === "right") x2 = Math.max(x1 + minThumb, Math.min(zoomDrag.origX2 + dx, w));
                else x1 = Math.max(0, Math.min(zoomDrag.origX1 + dx, zoomDrag.origX2 - minThumb));
                var thumbW = Math.max(minThumb, x2 - x1);
                var newP = (zoomDrag.origV / thumbW) * w;
                if (!(newP > 0) || !(zoomDrag.origP > 0)) return;
                applyColumnWidths(zoomDrag.origWidths, newP / zoomDrag.origP);
                boardScroll.scrollLeft = (x1 / w) * contentWidth();
                updateZoomBar();
            }
        });
        window.addEventListener("mouseup", function () {
            if (colDrag || zoomDrag) {
                colDrag = null;
                zoomDrag = null;
                persist();
                updateZoomBar();
                updateVZoomBar();
            }
        });
    }

    function applyColumnWidths(origWidths, factor) {
        var script = activeScript();
        ensureColWidths(script);
        for (var i = 0; i < script.colWidths.length; i++) {
            var base = Number(origWidths[i]);
            if (!isFinite(base) || base < 160) base = state.colWidth || 240;
            script.colWidths[i] = clamp(Math.round(base * factor), 160, 520);
        }
        state.colWidth = script.colWidths[activeCol] || script.colWidths[0] || 240;
        var cols = rowsEl.querySelectorAll(".col");
        for (var c = 0; c < cols.length; c++) {
            var idx = Number(cols[c].getAttribute("data-seg-index"));
            cols[c].style.width = colWidthAt(idx) + "px";
        }
    }

    function zoomMetrics() {
        if (!boardScroll || !zoomBar) return { P: 1, V: 1, S: 0, x1: 0, x2: 30, barW: 1 };
        var P = contentWidth();
        var V = boardScroll.clientWidth || 1;
        var S = boardScroll.scrollLeft || 0;
        var barW = zoomBar.clientWidth || 1;
        var x1 = 0;
        var x2 = barW;
        if (P > V) {
            x1 = (S / P) * barW;
            var tw = (V / P) * barW;
            x2 = x1 + tw;
            if (tw < 30) {
                var center = x1 + tw / 2;
                x1 = center - 15;
                x2 = center + 15;
                if (x1 < 0) { x1 = 0; x2 = 30; }
                if (x2 > barW) { x2 = barW; x1 = barW - 30; }
            }
        }
        return { P: P, V: V, S: S, x1: x1, x2: x2, barW: barW };
    }

    function updateZoomBar() {
        if (!zoomBar || !zoomThumb) return;
        var m = zoomMetrics();
        zoomThumb.style.left = m.x1 + "px";
        zoomThumb.style.width = Math.max(30, m.x2 - m.x1) + "px";
    }

    function applyBoardVZoom() {
        if (!boardScroll || !rowsEl) return;
        var z = Number(state.boardVZoom) || 1;
        if (z < 1) z = 1;
        if (z > 4) z = 4;
        state.boardVZoom = Math.round(z * 100) / 100;
        var h = boardScroll.clientHeight || 1;
        var px = Math.max(h, Math.round(h * z));
        rowsEl.style.minHeight = px + "px";
        rowsEl.style.height = px + "px";
    }

    function vZoomMetrics() {
        if (!rowsEl || !boardScroll || !vZoomBar) return { P: 1, V: 1, S: 0, y1: 0, y2: 36, barH: 1 };
        var P = Math.max(rowsEl.scrollHeight || 0, rowsEl.offsetHeight || 0, 1);
        var V = boardScroll.clientHeight || 1;
        var S = boardScroll.scrollTop || 0;
        var barH = vZoomBar.clientHeight || 1;
        var y1 = 0;
        var y2 = barH;
        if (P > V) {
            y1 = (S / P) * barH;
            var th = (V / P) * barH;
            y2 = y1 + th;
            if (th < 36) {
                var mid = y1 + th / 2;
                y1 = mid - 18;
                y2 = mid + 18;
                if (y1 < 0) { y1 = 0; y2 = 36; }
                if (y2 > barH) { y2 = barH; y1 = barH - 36; }
            }
        }
        return { P: P, V: V, S: S, y1: y1, y2: y2, barH: barH };
    }

    function updateVZoomBar() {
        if (!vZoomBar || !vZoomThumb) return;
        var m = vZoomMetrics();
        vZoomThumb.style.top = m.y1 + "px";
        vZoomThumb.style.height = Math.max(36, m.y2 - m.y1) + "px";
    }

    function setupVZoomBar() {
        if (!vZoomBar || !vZoomThumb) return;
        vZoomBar.addEventListener("mousedown", function (event) {
            var edge = event.target.getAttribute("data-vedge");
            var rect = vZoomBar.getBoundingClientRect();
            var y = event.clientY - rect.top;
            var m = vZoomMetrics();
            if (edge === "top" || edge === "bottom") {
                vZoomDrag = {
                    mode: edge, startY: event.clientY,
                    origY1: m.y1, origY2: m.y2,
                    origP: m.P, origV: m.V, origZ: clamp(Number(state.boardVZoom) || 1, 1, 4),
                    barH: rect.height
                };
            } else if (event.target === vZoomThumb || vZoomThumb.contains(event.target)) {
                vZoomDrag = {
                    mode: "center", startY: event.clientY,
                    origY1: m.y1, origY2: m.y2,
                    origP: m.P, origV: m.V, origS: m.S, barH: rect.height
                };
            } else if (m.P > m.V) {
                var th = m.y2 - m.y1;
                var newY1 = Math.max(0, Math.min(y - th / 2, rect.height - th));
                boardScroll.scrollTop = (newY1 / rect.height) * m.P;
                updateVZoomBar();
                vZoomDrag = {
                    mode: "center", startY: event.clientY,
                    origY1: newY1, origY2: newY1 + th,
                    origP: m.P, origV: m.V,
                    origS: boardScroll.scrollTop, barH: rect.height
                };
            }
            event.preventDefault();
        });
        window.addEventListener("mousemove", function (event) {
            if (!vZoomDrag) return;
            var dy = event.clientY - vZoomDrag.startY;
            var h = Math.max(1, vZoomDrag.barH);
            var minThumb = 36;
            if (vZoomDrag.mode === "center" && vZoomDrag.origP > vZoomDrag.origV) {
                var th2 = vZoomDrag.origY2 - vZoomDrag.origY1;
                var newY1b = Math.max(0, Math.min(vZoomDrag.origY1 + dy, h - th2));
                boardScroll.scrollTop = (newY1b / h) * vZoomDrag.origP;
                updateVZoomBar();
            } else if (vZoomDrag.mode === "top" || vZoomDrag.mode === "bottom") {
                var y1 = vZoomDrag.origY1;
                var y2 = vZoomDrag.origY2;
                if (vZoomDrag.mode === "bottom") y2 = Math.max(y1 + minThumb, Math.min(vZoomDrag.origY2 + dy, h));
                else y1 = Math.max(0, Math.min(vZoomDrag.origY1 + dy, vZoomDrag.origY2 - minThumb));
                var thumbH = Math.max(minThumb, y2 - y1);
                // 拇指越短 → 内容越高（与横向把手一致）
                var newZ = h / thumbH;
                if (newZ < 1) newZ = 1;
                if (newZ > 4) newZ = 4;
                state.boardVZoom = newZ;
                applyBoardVZoom();
                var contentH = Math.max(rowsEl.offsetHeight || 0, rowsEl.scrollHeight || 0, 1);
                boardScroll.scrollTop = (y1 / h) * contentH;
                updateVZoomBar();
            }
        });
        window.addEventListener("mouseup", function () {
            if (vZoomDrag) {
                vZoomDrag = null;
                persist();
                updateVZoomBar();
            }
        });
    }

    function check(text, on, change) {
        var label = document.createElement("label");
        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!on;
        input.onchange = function () { change(input.checked); };
        label.appendChild(input);
        label.appendChild(document.createTextNode(text));
        return label;
    }

    function selectField(text, value, options, change) {
        var label = document.createElement("label");
        label.className = "field";
        label.appendChild(document.createTextNode(text));
        var select = document.createElement("select");
        options.forEach(function (pair) {
            var opt = document.createElement("option");
            opt.value = pair[0];
            opt.textContent = pair[1];
            if (pair[0] === value) opt.selected = true;
            select.appendChild(opt);
        });
        select.onchange = function () { change(select.value); };
        label.appendChild(select);
        return label;
    }

    function numberField(text, value, min, max, change) {
        var label = document.createElement("label");
        label.className = "field";
        label.appendChild(document.createTextNode(text));
        var input = document.createElement("input");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.value = String(value || min);
        input.style.width = "56px";
        input.onchange = function () { change(clamp(input.value, min, max)); };
        label.appendChild(input);
        return label;
    }

    function summary(row) {
        return TRACK_TYPES.map(function (type) {
            var n = row.tracks.filter(function (t) { return t.type === type.id && t.path; }).length;
            return type.label + (n ? "×" + n : " -");
        }).join(" · ");
    }

    function copySegment() {
        var script = activeScript();
        var row = script.rows[activeCol];
        if (!row) return;
        try {
            localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ row: cloneRow(row), from: script.name }));
            log("已复制第 " + (activeCol + 1) + " 段");
        } catch (err) { log("复制失败：" + err, true); }
    }

    function pasteSegment() {
        var raw;
        try { raw = localStorage.getItem(CLIPBOARD_KEY); } catch (err) { raw = null; }
        if (!raw) { log("剪贴板为空。", true); return; }
        try {
            var payload = JSON.parse(raw);
            var script = activeScript();
            var row = cloneRow(payload.row);
            var insertAt = activeCol;
            script.rows.splice(insertAt + 1, 0, row);
            ensureColWidths(script);
            script.colWidths.splice(insertAt + 1, 0, state.colWidth || 240);
            remapLinks(script, function (old) {
                return old > insertAt ? old + 1 : old;
            });
            activeCol += 1;
            markPresetDirty();
            persist();
            render();
            log("已粘贴到第 " + (activeCol + 1) + " 段");
        } catch (err2) { log("粘贴失败：" + err2, true); }
    }

    function moveSegment(dir) {
        var script = activeScript();
        var to = activeCol + dir;
        if (to < 0 || to >= script.rows.length) return;
        var rows = script.rows;
        var tmp = rows[activeCol];
        rows[activeCol] = rows[to];
        rows[to] = tmp;
        ensureColWidths(script);
        var w = script.colWidths[activeCol];
        script.colWidths[activeCol] = script.colWidths[to];
        script.colWidths[to] = w;
        var fromI = activeCol;
        var toI = to;
        remapLinks(script, function (old) {
            if (old === fromI) return toI;
            if (old === toI) return fromI;
            return old;
        });
        activeCol = to;
        markPresetDirty();
        persist();
        render();
    }

    function mergeSegment() {
        var script = activeScript();
        if (activeCol >= script.rows.length - 1) {
            log("已是最后一段，无法合并。", true);
            return;
        }
        var a = script.rows[activeCol];
        var b = script.rows[activeCol + 1];
        var merged = cloneRow(a);
        b.tracks.forEach(function (t) {
            var copy = cloneTrack(t);
            copy.id = uid("t");
            merged.tracks.push(copy);
        });
        var keep = activeCol;
        var drop = activeCol + 1;
        script.rows.splice(activeCol, 2, merged);
        ensureColWidths(script);
        script.colWidths.splice(activeCol + 1, 1);
        remapLinks(script, function (old) {
            if (old === drop || old === keep) return keep;
            if (old > drop) return old - 1;
            return old;
        });
        markPresetDirty();
        persist();
        render();
        log("已合并第 " + (activeCol + 1) + " 与下一段");
    }

    function splitSegment() {
        var script = activeScript();
        var row = script.rows[activeCol];
        if (!row) return;
        var clone = cloneRow(row);
        clone.tracks.forEach(function (t) { t.id = uid("t"); });
        var splitAt = activeCol;
        script.rows.splice(activeCol + 1, 0, clone);
        ensureColWidths(script);
        script.colWidths.splice(activeCol + 1, 0, colWidthAt(activeCol));
        remapLinks(script, function (old) {
            return old > splitAt ? old + 1 : old;
        });
        markPresetDirty();
        persist();
        render();
        log("已拆出第 " + (activeCol + 2) + " 段");
    }

    function chooseFolder(track) {
        pickDirectory("选择" + trackLabel(track.type) + "文件夹").then(function (path) {
            if (!path) return;
            return applyFolder(track, path, true);
        }).catch(function (err) { log(String(err), true); });
    }

    function editWeight(track) {
        if (!track.path) return;
        applyFolder(track, track.path, true).catch(function (err) { log(String(err), true); });
    }

    function applyFolder(track, path, ask) {
        var scan = scanFolder(path, track.type);
        var tree = treeFromRels(scan.rels);
        var needs = tree.children.some(function (child) { return child.key !== YorkCutPicker.WEIGHT_ROOT_KEY; });
        var done = function (strategy) {
            track.path = path;
            track.strategy = strategy || { mode: "pool" };
            track.counts = scan.counts;
            // 让「产能粗估」立刻用上真实素材清单（以前这里不写缓存，粗估会一直显示 ≈1）
            track._relsCache = scan.rels;
            markPresetDirty();
            persist();
            render();
        };
        if (ask && needs) {
            if (track.path === path) applySavedChecks(tree, track.strategy);
            return askWeight(baseName(path), tree).then(function (strategy) {
                if (!strategy) return;
                done(strategy);
            });
        }
        done(track.strategy && track.path === path ? track.strategy : { mode: "pool" });
        return Promise.resolve();
    }

    function askWeight(folderName, tree) {
        return new Promise(function (resolve) {
            weightSession = { tree: tree, resolve: resolve };
            document.getElementById("weightTitle").textContent = "抽取权重 · " + folderName;
            paintWeight(tree);
            document.getElementById("weightModal").className = "modal";
        });
    }

    function closeWeight(strategy) {
        document.getElementById("weightModal").className = "modal hidden";
        if (weightSession) weightSession.resolve(strategy);
        weightSession = null;
    }

    function paintWeight(node) {
        var root = document.getElementById("weightTree");
        root.innerHTML = "";
        root.appendChild(paintNode(node, true));
        updateRadar();
    }

    function paintNode(node, isRoot) {
        var box = document.createElement("div");
        node.children.forEach(function (child) {
            var row = document.createElement("div");
            row.className = "bucket";
            var line = document.createElement("div");
            line.className = "bucket-row";
            var checkEl = document.createElement("input");
            checkEl.type = "checkbox";
            checkEl.checked = !!child.checked;
            var percent = document.createElement("input");
            percent.type = "number";
            percent.min = "0";
            percent.max = "100";
            percent.value = String(child.percent || 0);
            percent.disabled = !checkEl.checked;
            checkEl.onchange = function () {
                child.checked = checkEl.checked;
                percent.disabled = !checkEl.checked;
                if (checkEl.checked && !Number(percent.value)) {
                    percent.value = "100";
                    child.percent = 100;
                }
                updateRadar();
            };
            percent.onchange = function () {
                child.percent = clamp(percent.value, 0, 100);
                percent.value = String(child.percent);
                updateRadar();
            };
            var label = document.createElement("span");
            label.textContent = child.label + (child.hasMedia ? "" : "（空）");
            if (!child.hasMedia) checkEl.disabled = true;
            line.appendChild(checkEl);
            line.appendChild(percent);
            line.appendChild(label);
            row.appendChild(line);
            if (child.children && child.children.length) row.appendChild(paintNode(child, false));
            box.appendChild(row);
        });
        if (isRoot && !node.children.length) box.textContent = "这个文件夹里没有可用素材。";
        return box;
    }

    function updateRadar() {
        var radar = document.getElementById("weightRadar");
        if (!weightSession) return;
        var report = inspectTree(weightSession.tree);
        radar.className = "";
        radar.textContent = report.text;
        if (report.level === "warn") radar.className = "warn";
        if (report.level === "ok") radar.className = "ok";
    }

    function inspectTree(node) {
        var exceeds = false;
        var active = 0;
        var sumAll = 0;
        function walk(current) {
            var sum = 0;
            var has = false;
            current.children.forEach(function (child) {
                if (child.checked) {
                    has = true;
                    sum += Number(child.percent) || 0;
                }
                walk(child);
            });
            if (has) {
                active += 1;
                sumAll += sum;
                if (sum > 100) exceeds = true;
            }
        }
        walk(node);
        if (!active) return { level: "", text: "未勾选：这一层按素材数量均分。" };
        if (exceeds) return { level: "warn", text: "有一层权重合计超过 100%。保存后该层会退回均分。" };
        if (sumAll < 100 * active) return { level: "ok", text: "有一层不足 100%，生成时会按勾选比例放大。" };
        return { level: "ok", text: "权重合计可用。" };
    }

    function applySavedChecks(node, strategy) {
        if (!node || !strategy || strategy.mode !== "weight" || !strategy.weights) return;
        node.children.forEach(function (child) {
            var entry = strategy.weights[child.key];
            if (!entry) return;
            child.checked = true;
            child.percent = clamp(Math.round(Number(entry.weight) || 0), 0, 100);
            applySavedChecks(child, entry.children);
        });
    }

    function readWeightTree() {
        if (!weightSession) return { mode: "pool" };
        return YorkCutPicker.compileStrategy(weightSession.tree);
    }

    function refreshCapacity() {
        if (!capacityEl) return;
        try {
            var script = activeScript();
            var libraries = script.rows.map(scanRowLight);
            var est = YorkCutEdit.estimateCapacity(script.rows, libraries);
            capacityEl.textContent = "产能粗估 ≈ " + est.text;
            capacityEl.title = (est.detail || []).join("\n");
        } catch (err) {
            capacityEl.textContent = "产能粗估 —";
        }
    }

    function scanRowLight(row) {
        var script = activeScript();
        var rowIndex = script.rows.indexOf(row);
        if (rowIndex < 0) rowIndex = 0;
        var typedIndex = {};
        return {
            tracks: (row.tracks || []).map(function (t) {
                if (!typedIndex[t.type]) typedIndex[t.type] = 0;
                var li = typedIndex[t.type]++;
                var src = resolveLinkedTrack(script, rowIndex, t, li) || t;
                return {
                    id: t.id, type: t.type, root: src.path || "",
                    rels: src._relsCache || t._relsCache || [], strategy: src.strategy || { mode: "pool" },
                    isMainVoice: !!t.isMainVoice
                };
            })
        };
    }

    /* —— 预设（Lumetri 式下拉） —— */
    function togglePresetMenu() {
        if (!presetMenu) return;
        var open = !presetMenu.classList.contains("hidden");
        if (open) closePresetMenu();
        else {
            refreshPresetList();
            presetMenu.classList.remove("hidden");
        }
    }
    function closePresetMenu() {
        if (presetMenu) presetMenu.classList.add("hidden");
    }

    function updatePresetToggleLabel() {
        if (!presetToggle) return;
        var name = state.activePreset || "无";
        if (presetDirty && state.activePreset) name += " *";
        presetToggle.textContent = name + " ▾";
        if (!presetMenu) return;
        var noneBtn = presetMenu.querySelector('[data-preset-act="none"]');
        if (noneBtn) {
            if (!state.activePreset) noneBtn.classList.add("active");
            else noneBtn.classList.remove("active");
        }
    }

    function markPresetDirty() {
        presetDirty = true;
        updatePresetToggleLabel();
    }

    function refreshPresetList() {
        if (!presetList) return;
        presetList.innerHTML = "";
        listPresetNames().forEach(function (name) {
            var row = document.createElement("div");
            row.style.display = "flex";
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "preset-item" + (state.activePreset === name && !presetDirty ? " active" : "");
            btn.setAttribute("data-preset-act", "load");
            btn.setAttribute("data-name", name);
            var check = document.createElement("span");
            check.className = "check";
            check.textContent = "✓";
            btn.appendChild(check);
            btn.appendChild(document.createTextNode(name));
            var del = document.createElement("button");
            del.type = "button";
            del.className = "preset-item";
            del.style.width = "auto";
            del.setAttribute("data-preset-act", "delete");
            del.setAttribute("data-name", name);
            del.textContent = "删";
            row.appendChild(btn);
            row.appendChild(del);
            presetList.appendChild(row);
        });
        updatePresetToggleLabel();
    }

    function presetsDir() {
        var dir = state.presetDir ? toFsPath(state.presetDir) : join(dataDir(), "presets");
        try { window.cep.fs.makedir(dir); } catch (err) {}
        return dir;
    }

    function listPresetNames() {
        if (!inHost) {
            try {
                var meta = JSON.parse(localStorage.getItem(PRESET_META_KEY) || "{}");
                return Object.keys(meta.presets || {}).sort(naturalSort);
            } catch (err) { return []; }
        }
        var dir = presetsDir();
        return readDir(dir).filter(function (name) {
            return /\.yorkcut\.json$/i.test(name) || /\.json$/i.test(name);
        }).map(function (name) {
            return name.replace(/\.yorkcut\.json$/i, "").replace(/\.json$/i, "");
        }).sort(naturalSort);
    }

    function presetPath(name) {
        return join(presetsDir(), safePresetName(name) + ".yorkcut.json");
    }

    function choosePresetFolder() {
        pickDirectory("选择预设保存文件夹").then(function (path) {
            if (!path) return;
            state.presetDir = toFsPath(path);
            try { window.cep.fs.makedir(state.presetDir); } catch (err) {}
            persist();
            refreshPresetList();
            log("预设文件夹：" + state.presetDir);
        }).catch(function (err) { log(String(err), true); });
    }

    function safePresetName(name) {
        return String(name || "未命名").replace(/[\\/:*?"<>|]/g, "").trim() || "未命名";
    }

    function exportPayload() {
        return {
            version: 1,
            name: state.activePreset || "",
            count: state.count,
            fps: state.fps,
            nameBase: state.nameBase,
            insert: !!state.insert,
            enforce24fps: state.enforce24fps !== false,
            highlightMogrt: state.highlightMogrt || "",
            scripts: state.scripts,
            activeScript: state.activeScript
        };
    }

    function applyPayload(payload, presetName) {
        if (!payload || !payload.scripts) throw new Error("无效预设文件");
        state.scripts = payload.scripts;
        state.scripts.forEach(function (script) {
            (script.rows || []).forEach(migrateRow);
            if (!script.colWidths) script.colWidths = [];
        });
        state.activeScript = Number(payload.activeScript) || 0;
        state.count = clamp(payload.count || 1, 1, 99);
        state.fps = Number(payload.fps) || 30;
        // 预设文件是外部可编辑的；nameBase 会参与拼 srt 文件名，这里必须和输入框一样净化，
        // 否则一份手改过的 .yorkcut.json 可以把字幕写到任意路径
        state.nameBase = String(payload.nameBase || "YorkCut").replace(/[\\/:*?"<>|]/g, "").trim() || "YorkCut";
        state.insert = !!payload.insert;
        state.enforce24fps = payload.enforce24fps !== false;
        state.highlightMogrt = payload.highlightMogrt || "";
        state.activePreset = presetName || payload.name || "";
        presetDirty = false;
        activeCol = 0;
        persist();
        render();
    }

    var presetSaveAs = false;

    function openPresetName(saveAs) {
        closePresetMenu();
        presetSaveAs = !!saveAs;
        document.getElementById("presetNameInput").value = state.activePreset || "";
        document.getElementById("presetNameModal").className = "modal";
        document.getElementById("presetNameInput").focus();
    }

    function closePresetName(name) {
        document.getElementById("presetNameModal").className = "modal hidden";
        if (name == null) return;
        name = safePresetName(name);
        if (!name) { log("预设名不能为空。", true); return; }
        if (presetSaveAs) savePresetDialog(name);
        else savePreset(name);
    }

    function savePreset(name) {
        var payload = exportPayload();
        payload.name = name;
        try {
            if (inHost) {
                var path = toFsPath(presetPath(name));
                writeText(path, JSON.stringify(payload, null, 2));
                log("预设已保存：" + path);
            } else {
                var meta = {};
                try { meta = JSON.parse(localStorage.getItem(PRESET_META_KEY) || "{}"); } catch (e1) { meta = {}; }
                if (!meta.presets) meta.presets = {};
                meta.presets[name] = payload;
                localStorage.setItem(PRESET_META_KEY, JSON.stringify(meta));
                log("预设已保存：" + name);
            }
            state.activePreset = name;
            presetDirty = false;
            persist();
            updatePresetToggleLabel();
        } catch (err) {
            log("保存预设失败：" + err, true);
        }
    }

    function savePresetDialog(name) {
        var payload = exportPayload();
        payload.name = name;
        if (!inHost || !window.cep || !window.cep.fs.showSaveDialogEx) {
            savePreset(name);
            return;
        }
        var initial = toFsPath(presetsDir());
        var result = window.cep.fs.showSaveDialogEx(
            "保存 YorkCut 预设",
            initial,
            ["json"],
            safePresetName(name) + ".yorkcut.json"
        );
        if (!result || result.err || !result.data) {
            log("已取消另存。");
            return;
        }
        var path = toFsPath(Array.isArray(result.data) ? result.data[0] : result.data);
        if (!/\.json$/i.test(path)) path += ".yorkcut.json";
        try {
            writeText(path, JSON.stringify(payload, null, 2));
            state.presetDir = parentDir(path);
            state.activePreset = name;
            presetDirty = false;
            persist();
            updatePresetToggleLabel();
            log("预设已另存：" + path);
        } catch (err) {
            log("另存失败：" + err, true);
        }
    }

    function loadPresetByName(name) {
        try {
            var payload;
            if (inHost) {
                var body = readText(presetPath(name));
                if (!body) {
                    body = readText(join(presetsDir(), safePresetName(name) + ".json"));
                }
                if (!body) throw new Error("读不到预设");
                payload = JSON.parse(body);
            } else {
                var meta = JSON.parse(localStorage.getItem(PRESET_META_KEY) || "{}");
                payload = (meta.presets || {})[name];
                if (!payload) throw new Error("预设不存在");
            }
            applyPayload(payload, name);
            log("已加载预设：" + name);
        } catch (err) {
            log("加载预设失败：" + err, true);
        }
    }

    function deletePreset(name) {
        if (!name || !window.confirm("删除预设「" + name + "」？")) return;
        try {
            if (inHost) {
                var path = toFsPath(presetPath(name));
                if (window.cep.fs.deleteFile) window.cep.fs.deleteFile(path);
                else writeText(path, "{}");
            } else {
                var meta = JSON.parse(localStorage.getItem(PRESET_META_KEY) || "{}");
                if (meta.presets) delete meta.presets[name];
                localStorage.setItem(PRESET_META_KEY, JSON.stringify(meta));
            }
            if (state.activePreset === name) {
                state.activePreset = "";
                presetDirty = false;
                persist();
            }
            refreshPresetList();
            log("已删除预设：" + name);
        } catch (err) {
            log("删除失败：" + err, true);
        }
    }

    function applyPresetNone() {
        state.activePreset = "";
        presetDirty = false;
        persist();
        updatePresetToggleLabel();
    }

    function browsePresetFile() {
        if (!inHost || !window.cep || !window.cep.fs.showOpenDialogEx) {
            log("当前环境不能浏览文件。", true);
            return;
        }
        var startDir = toFsPath(state.presetDir || presetsDir());
        var result = window.cep.fs.showOpenDialogEx(false, false, "选择 YorkCut 预设", startDir, ["json"]);
        if (!result || result.err || !result.data || !result.data.length) return;
        try {
            var path = toFsPath(result.data[0]);
            var payload = JSON.parse(readText(path));
            var name = safePresetName(payload.name || baseName(path).replace(/\.yorkcut\.json$/i, "").replace(/\.json$/i, ""));
            applyPayload(payload, name);
            state.presetDir = parentDir(path);
            persist();
            log("已打开预设：" + path);
        } catch (err) {
            log("导入预设失败：" + err, true);
        }
    }

    function pickMogrt() {
        if (!inHost || !window.cep || !window.cep.fs.showOpenDialogEx) {
            log("请在 Premiere 面板中选择 .mogrt。", true);
            return;
        }
        var result = window.cep.fs.showOpenDialogEx(false, false, "选择高光图形模板 (.mogrt)", "", ["mogrt"]);
        if (!result || result.err || !result.data || !result.data.length) return;
        state.highlightMogrt = toFsPath(result.data[0]);
        markPresetDirty();
        persist();
        render();
        log("高光图形模板：" + baseName(state.highlightMogrt));
    }

    function setBusy(on) {
        busy = !!on;
        document.getElementById("generate").disabled = busy;
        var cancelBtn = document.getElementById("cancelGen");
        if (busy) cancelBtn.classList.remove("hidden");
        else cancelBtn.classList.add("hidden");
    }

    function throwIfCancelled() {
        if (genCancel) throw new Error("已终止生成");
    }

    function stage(n, total, msg) {
        log("[" + n + "/" + total + "] " + msg);
    }

    function countLibraryFiles(libraries) {
        var n = 0;
        var tracks = 0;
        libraries.forEach(function (lib) {
            (lib.tracks || []).forEach(function (t) {
                tracks += 1;
                n += (t.rels || []).length;
            });
        });
        return { files: n, tracks: tracks };
    }

    function generate() {
        if (busy) return;
        if (!inHost) {
            log("请先在 Premiere 里打开这个面板。", true);
            return;
        }
        // 卡密/云接口已按要求下线：生成不再有任何账号门禁
        genCancel = false;
        // 清掉上一次可能残留的 cancel.flag：否则这次一点“写入”就会被宿主立刻判成取消
        try {
            var staleFlag = join(dataDir(), "cancel.flag");
            if (fileExists(staleFlag)) window.cep.fs.deleteFile(toFsPath(staleFlag));
        } catch (eStale) {}
        setBusy(true);
        var TOTAL = 8;
        var script = activeScript();
        var libraries;
        var texts = {};

        stage(1, TOTAL, "扫描文件夹…");
        var badLinks = countInvalidLinks(script);
        if (badLinks) log("  有 " + badLinks + " 条无效「和段相同」（已标红，不自动清除）。生成时这些轨按未链接处理。");
        try {
            libraries = script.rows.map(function (row, idx) { return scanRow(row, idx); });
        } catch (err) {
            finishBusy(String(err), true);
            return;
        }
        var stats = countLibraryFiles(libraries);
        log("  段数 " + script.rows.length + " · 轨 " + stats.tracks + " · 文件 " + stats.files);
        logStatShapeOnce();

        try {
            libraries.forEach(function (lib) {
                (lib.tracks || []).forEach(function (bucket) {
                    if (bucket.type !== "sub" && bucket.type !== "subHl") return;
                    var ignored = 0;
                    (bucket.rels || []).forEach(function (rel) {
                        var lower = rel.toLowerCase();
                        // .srt 已禁用：只收 .txt（按口播时长均分/整段一条）
                        if (lower.lastIndexOf(".srt") === lower.length - 4) { ignored += 1; return; }
                        if (lower.lastIndexOf(".txt") !== lower.length - 4) return;
                        var abs = YorkCutEdit.absJoin(bucket.root, rel);
                        texts[abs] = readText(abs);
                    });
                    if (ignored > 0) {
                        log("  注意：" + (bucket.type === "subHl" ? "高光" : "字幕") + "轨 " + bucket.root +
                            " 里有 " + ignored + " 个 .srt 已被忽略（插件只支持 .txt 文案）", true);
                    }
                });
            });
        } catch (err2) {
            finishBusy(String(err2), true);
            return;
        }

        extractVoiceVideos(libraries).then(function () {
            refreshVoiceAudioRels(libraries);
            stage(2, TOTAL, "加载时长缓存…");
        loadDurationCache();
        var cacheHits = 0;
        Object.keys(durations).forEach(function (k) { if (durations[k] > 0) cacheHits += 1; });
        log("  缓存条目 " + cacheHits);
        if (state.ffprobePath) log("  将尝试 ffprobe：" + state.ffprobePath);

        stage(3, TOTAL, "检测 Premiere 脚本通道…");
        return ensureHostLoaded().then(function () {
            return callHost("yorkcutPing()", { label: "yorkcutPing" });
        }).then(function (ping) {
            throwIfCancelled();
            log("  Ping 成功 · Premiere " + (ping.version || "") + (ping.hasProject ? " · 已开工程" : " · 未开工程"));
            if (!ping.hasProject) throw new Error("请先打开一个 Premiere 项目。");
            return prefillFfprobe(libraries);
        }).then(function () {
            throwIfCancelled();
            return probeUnmeasuredSidecars(libraries);
        }).then(function () {
            throwIfCancelled();
            stage(4, TOTAL, "全库随机抽签；仅对抽中且缺时长的素材探针…");
            return planProbeLoop(script, libraries, texts, 0);
        }).then(function (plan) {
            throwIfCancelled();
            stage(5, TOTAL, "规划成片…");
            (plan.warnings || []).forEach(function (line) { log("  警告：" + line); });
            log("  序列 " + plan.sequences.length + " 条：" + plan.sequences.map(function (s) {
                var bgmN = Number(s.bgmClipCount) || 0;
                return s.name + "(" + Number(s.duration || 0).toFixed(2) + "s, BGM片 " + bgmN + ")";
            }).join("，"));
            // 兜底告警：多条序列画面素材完全一致时明说，避免又出现「三条一模一样」却无人察觉
            if (plan.sequences.length > 1) {
                var sigs = plan.sequences.map(function (sq) {
                    return (sq.clips || []).filter(function (c) { return c.track === "video"; })
                        .map(function (c) { return YorkCutEdit.pathKey(c.path); }).join(">");
                });
                var allSame = !!sigs[0];
                for (var sg = 1; sg < sigs.length; sg++) {
                    if (sigs[sg] !== sigs[0]) { allSame = false; break; }
                }
                if (allSame) {
                    log("  警告：本次 " + sigs.length + " 条序列的画面素材完全相同。" +
                        "通常是候选池太小（每段文件夹内文件太少，或已测到时长的素材不够）。", true);
                }
            }

            var dir = dataDir();
            genRunDir = dir;
            var hasHl = false;
            var hasCap = false;
            // 字幕 → Premiere 原生字幕轨（C1，createCaptionTrack 读 SRT）
            // 高光 → 画面轨上的 .mogrt 图形
            var mogrt = highlightMogrtPath();
            plan.sequences.forEach(function (seq) {
                if (seq.captionCues && seq.captionCues.length) {
                    hasCap = true;
                    seq.captionPath = join(dir, seq.name + ".srt");
                    writeText(seq.captionPath, YorkCutEdit.cuesToSrt(seq.captionCues));
                } else {
                    delete seq.captionCues;
                    delete seq.captionPath;
                }
                if (seq.highlightCues && seq.highlightCues.length) {
                    hasHl = true;
                    seq.highlightMogrt = mogrt;
                } else {
                    delete seq.highlightCues;
                    delete seq.highlightMogrt;
                }
                delete seq.highlightPath;   // 高光不再走 SRT（空 SRT 会弹"导入程序报一般错误"）
                delete seq.captionMogrt;    // 字幕不再走 MOGRT
            });
            if (hasCap) log("  字幕：Premiere 原生字幕轨（C1，Sequence.createCaptionTrack 读 SRT）。");
            try {
                log("  " + runSummary({
                    sequences: plan.sequences,
                    duration: plan.sequences.reduce(function (sum, s) { return sum + (Number(s.seconds) || 0); }, 0),
                    hasCaption: hasCap,
                    hasHighlight: hasHl,
                    nest: !!state.insert
                }));
            } catch (eSummary) {}

            // 高光文字：Premiere 25.1 的 setValue 对 MGT 文本层不生效（写入/读回都成功但画面空白），
            // 所以改成「按文案生成打好补丁的 .mogrt」——把文字写进模板默认值，插入后必然渲染。
            // 批量一次生成（实测 15 条约 1.1 秒），并按文案哈希缓存复用。
            var allHlTexts = [];
            if (hasHl && mogrt) {
                plan.sequences.forEach(function (seq) {
                    (seq.highlightCues || []).forEach(function (cue) { allHlTexts.push(cue.text); });
                });
            }
            var patchWork = Promise.resolve();
            if (hasHl && mogrt && allHlTexts.length) {
                log("  高光：生成模板补丁（共 " + allHlTexts.length + " 条文案，模板 " + baseName(mogrt) + "）…");
                patchWork = patchMogrtBatch(mogrt, allHlTexts).then(function (map) {
                    var made = 0;
                    var miss = 0;
                    plan.sequences.forEach(function (seq) {
                        (seq.highlightCues || []).forEach(function (cue) {
                            var p = map[String(cue.text == null ? "" : cue.text)];
                            if (p) { cue.mogrt = p; made += 1; } else { miss += 1; }
                        });
                    });
                    log("  高光模板补丁：" + made + " 条就绪" + (miss ? ("，" + miss + " 条未就绪（退回原模板）") : ""));
                });
            } else if (hasHl) {
                log("  高光：没找到 .mogrt 模板（assets/highlight-title.mogrt 缺失），本次跳过画面高光。", true);
            }
            return patchWork.then(function () {
                saveDurationCache();
                stage(6, TOTAL, "生成前确认…");
                return askGenPreview(plan).then(function (ok) {
                    if (!ok) throw new Error("已取消写入 Premiere");
                throwIfCancelled();
                var edlPath = join(dir, "edl.json");
                writeText(edlPath, JSON.stringify({ insert: !!state.insert, sequences: plan.sequences }));
                stage(7, TOTAL, "写入 Premiere（新建序列）…");
                // 宿主实测：3 条序列 + 建字幕轨 + 铺 MOGRT 需要 90 秒以上，
                // 原来 60 秒会在宿主其实成功的情况下报"超时"。
                return callHostFile("yorkcutBuild", edlPath, { label: "yorkcutBuild", timeoutMs: 300000 });
                });
            });
        }).then(function (result) {
            (result.log || []).forEach(function (line) { log("  " + line); });
            if (result && result.cancelled) {
                var made = (result.sequences || []).length;
                var cleaned = cleanupRunArtifacts(genRunDir);
                log("  已清理本地残留 " + cleaned + " 个文件（时长缓存 durations.json 故意保留）", true);
                finishBusy("已在写入过程中取消：已创建 " + made + " 条序列，其余未创建", true);
                return;
            }
            throwIfCancelled();
            if (!result.ok) throw new Error(result.error || "Premiere 没有完成建序列");
            var names = (result.sequences || []).map(function (seq) {
                return seq.name + "（" + Number(seq.seconds || 0).toFixed(2) + " 秒）";
            }).join("，");
            stage(8, TOTAL, "完成 · " + names);
            finishBusy();
        }).catch(function (err) {
            failGen(err);
        });
        }).catch(function (err) {
            failGen(err);
        });
    }

    /** 生成失败/取消的统一收尾：取消时顺手清掉本次的本地残留 */
    function failGen(err) {
        var msg = err && err.message ? err.message : String(err);
        if (/已取消写入 Premiere|已终止生成/.test(msg)) {
            log("  已清理本地残留 " + cleanupRunArtifacts(genRunDir) + " 个文件（时长缓存 durations.json 故意保留）", true);
        }
        finishBusy(msg, true);
    }

    /**
     * 清掉本次运行的本地中间产物。
     * 故意保留 durations.json —— 它是"素材时长缓存"，一次探针要在 Premiere 里导入几十个文件，
     * 删掉会让下次生成把整库重新测一遍，反而更慢。
     */
    function cleanupRunArtifacts(dir) {
        if (!dir) return 0;
        var removed = 0;
        var names = ["cancel.flag", "probe.json", "probe.result.json", "edl.json", "edl.result.json"];
        var i;
        for (i = 0; i < names.length; i++) {
            var p = join(dir, names[i]);
            try {
                if (fileExists(p)) {
                    window.cep.fs.deleteFile(toFsPath(p));
                    removed += 1;
                }
            } catch (e1) {}
        }
        // 本次生成的字幕 SRT（YorkCut-N.srt / YorkCut-N-hl.srt）也一并清掉
        try {
            var listing = readDir(dir);
            for (i = 0; i < listing.length; i++) {
                if (/^YorkCut-\d+.*\.srt$/i.test(listing[i])) {
                    try {
                        window.cep.fs.deleteFile(toFsPath(join(dir, listing[i])));
                        removed += 1;
                    } catch (e2) {}
                }
            }
        } catch (e3) {}
        return removed;
    }

    function currentTransitionSpec() {
        ensureTransitionState();
        return {
            mode: state.transition.mode || "off",
            name: state.transition.name || "Cross Dissolve",
            names: (state.transition.names || DEFAULT_TRANSITIONS).slice(),
            durationFrames: state.transition.durationFrames || 8
        };
    }

    /**
     * 全库随机抽签 → 若抽中文件尚无时长则只探针这些路径 → 再抽签。
     * 轮次上限随待测数量放宽，避免「测一批又抽到新文件」卡在 NEED_PROBE。
     */
    function planProbeLoop(script, libraries, texts, attempt) {
        throwIfCancelled();
        var plan = YorkCutEdit.planBatch({
            rows: script.rows,
            libraries: libraries,
            durations: durations,
            count: state.count,
            fps: state.fps,
            nameBase: state.nameBase,
            texts: texts,
            enforce24fps: state.enforce24fps !== false,
            dedupeMode: state.dedupeMode || "off",
            dedupeMax: state.dedupeMax || 1,
            transition: currentTransitionSpec(),
            planAttempt: attempt
        });
        if (plan.ok) return Promise.resolve(plan);

        var need = plan.missingPaths || [];
        var isProbe = plan.needProbe || plan.error === "NEED_PROBE" || need.length > 0;
        var maxAttempts = Math.max(12, Math.min(40, 8 + need.length * 2));
        if (!isProbe || attempt >= maxAttempts) {
            var detail = need.length
                ? ("仍缺时长 " + need.length + " 个：" + need.slice(0, 5).map(baseName).join("，") + (need.length > 5 ? "…" : ""))
                : (plan.error || "抽签失败");
            if (plan.error === "NEED_PROBE" || plan.needProbe) {
                return Promise.reject(new Error(
                    "素材时长未就绪（已探针 " + attempt + " 轮）。" + detail +
                    "。可再点一次「新建序列」复用缓存，或检查这些文件能否被 Premiere 导入。"
                ));
            }
            return Promise.reject(new Error(plan.error || detail || "抽签失败"));
        }
        if (!need.length) {
            need = YorkCutEdit.collectCandidatePaths({
                rows: script.rows,
                libraries: libraries,
                durations: durations,
                count: state.count,
                spare: 2 + attempt
            });
        }
        if (!need.length) {
            return Promise.reject(new Error(plan.error || "没有可探针的素材"));
        }
        log("  第 " + (attempt + 1) + "/" + maxAttempts + " 轮抽签命中 " + need.length + " 个待测时长文件（全库随机，非整库扫描）");
        return probePathsChunked(need).then(function () {
            return planProbeLoop(script, libraries, texts, attempt + 1);
        });
    }

    function scanRow(row, rowIndex) {
        var script = activeScript();
        var tracks = [];
        var typedIndex = {};
        (row.tracks || []).forEach(function (track) {
            if (!typedIndex[track.type]) typedIndex[track.type] = 0;
            var layerIndex = typedIndex[track.type];
            typedIndex[track.type] += 1;
            var src = resolveLinkedTrack(script, rowIndex, track, layerIndex) || track;
            if (!src.path) return;
            var scan = scanFolder(src.path, track.type);
            if (src === track) {
                track.counts = scan.counts;
                track._relsCache = scan.rels;
            }
            tracks.push({
                id: track.id,
                type: track.type,
                root: src.path,
                rels: scan.rels,
                voiceVideos: (track.type === "voice" || track.type === "sfx" || track.type === "bgm") ? (scan.voiceVideos || []) : [],
                strategy: src.strategy || { mode: "pool" },
                isMainVoice: !!track.isMainVoice,
                linkToSeg: typeof track.linkToSeg === "number" ? track.linkToSeg : null
            });
        });
        return { tracks: tracks };
    }

    function prefillFfprobe(libraries) {
        var exe = String(state.ffprobePath || "").replace(/^\s+|\s+$/g, "");
        if (!exe) return Promise.resolve();
        var paths = [];
        (libraries || []).forEach(function (lib) {
            (lib.tracks || []).forEach(function (t) {
                if (!t.root) return;
                (t.rels || []).forEach(function (rel) {
                    var abs = YorkCutEdit.absJoin(t.root, rel);
                    if (!(Number(durations[abs]) > 0)) paths.push(abs);
                });
            });
        });
        if (!paths.length) return Promise.resolve();
        if (!window.cep || !window.cep.process || !window.cep.process.createProcess) {
            log("  ffprobe 路径已填，但当前 CEP 不能启动外部程序，仍用 Premiere 探针。");
            return Promise.resolve();
        }
        var limit = Math.min(paths.length, 40);
        if (paths.length > limit) log("  ffprobe 本次只预扫前 " + limit + " 个，其余交给 Premiere。");
        log("  ffprobe 预扫 " + limit + " 个缺时长文件（可选，失败不影响生成）…");
        var i = 0;
        function step() {
            if (i >= limit) {
                saveDurationCache();
                return Promise.resolve();
            }
            var file = paths[i];
            i += 1;
            return runFfprobeDuration(exe, file).then(function (sec) {
                if (sec > 0) rememberDuration(file, sec, "ffprobe");
                return step();
            });
        }
        return step();
    }

    function runFfprobeDuration(exe, file) {
        return new Promise(function (resolve) {
            try {
                var proc = window.cep.process.createProcess(
                    exe, "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    file
                );
                var text = "";
                if (proc && typeof proc.wait === "function") proc.wait();
                if (proc && proc.stdout != null) text = String(proc.stdout);
                else if (proc && proc.data != null) text = String(proc.data);
                var n = parseFloat(String(text).replace(/^\s+|\s+$/g, ""));
                resolve(n > 0 ? n : 0);
            } catch (err) {
                resolve(0);
            }
        });
    }

    function probePathsChunked(paths) {
        var rawList = paths || [];
        // 兜底闸：字幕/文本文件绝不能进探针。探针会把文件导入 Premiere 素材箱，
        // 而 .srt/.txt 不是媒体 → Premiere 弹「文件导入失败：因文件头错误而不能打开」。
        var isText = (YorkCutEdit && YorkCutEdit.isTextPath) || function () { return false; };
        var list = rawList.filter(function (p) { return !isText(p); });
        if (list.length < rawList.length) {
            logDiag("  探针跳过 " + (rawList.length - list.length) + " 个文本文件（字幕/高光没有媒体时长，不能当媒体导入）");
        }
        var total = list.length;
        if (!total) return Promise.resolve();
        var done = 0;

        function next() {
            throwIfCancelled();
            if (!list.length) {
                saveDurationCache();
                log("  探针结束，时长缓存已更新");
                return Promise.resolve();
            }
            var chunk = list.splice(0, PROBE_CHUNK);
            done += chunk.length;
            log("  探针分片 " + Math.min(done, total) + "/" + total + "：" + chunk.map(baseName).join("，"));
            var dir = dataDir();
            var probePath = toFsPath(join(dir, "probe.json"));
            writeText(probePath, JSON.stringify({ paths: chunk }));
            return callHostFile("yorkcutProbe", probePath, { label: "yorkcutProbe" }).then(function (result) {
                throwIfCancelled();
                (result.log || []).forEach(function (line) { log("    " + line); });
                if (!result.ok) {
                    // 把本片尝试过的素材列出来：以前只抛 "Error: Unknown error exception"，无法定位
                    var names = chunk.map(baseName).join("，");
                    throw new Error((result.error || "读取时长失败") +
                        "｜本片尝试读取的素材：" + names +
                        "。若其中有字幕/文本文件，说明它不是可导入的媒体文件（请把字幕单独放在字幕轨）。");
                }
                var map = result.durations || {};
                var got = 0;
                Object.keys(map).forEach(function (path) {
                    rememberDuration(path, map[path], "premiere");
                    if (Number(map[path]) > 0) got += 1;
                });
                log("    本片读到时长 " + got + "/" + chunk.length);
                return next();
            });
        }
        return next();
    }

    function rememberDuration(path, seconds, source) {
        var n = Number(seconds);
        if (!(n > 0) || !path) return;
        var prev = Number(durations[path]) || 0;
        var prevSrc = durationMeta[path] || "";
        if (source === "premiere" && prevSrc === "ffprobe" && prev > 0 && Math.abs(prev - n) > 0.15) {
            log("  时长以 Premiere 为准覆盖 ffprobe：" + baseName(path) + " " + prev.toFixed(2) + "s → " + n.toFixed(2) + "s");
        }
        durations[path] = n;
        if (source) durationMeta[path] = source;
        if (YorkCutEdit && YorkCutEdit.rememberDur) YorkCutEdit.rememberDur(durations, path, n);
    }

    function durationCachePath() {
        return join(dataDir(), "durations.json");
    }

    function loadDurationCache() {
        try {
            var body = readText(durationCachePath());
            if (!body) return;
            var map = JSON.parse(body);
            Object.keys(map || {}).forEach(function (path) {
                var raw = map[path];
                var n = typeof raw === "number" ? raw : Number(raw && raw.sec);
                var src = (raw && raw.source) || "premiere";
                if (!(n > 0)) return;
                durations[path] = n;
                durationMeta[path] = src;
            });
        } catch (err) {}
    }

    function saveDurationCache() {
        try {
            var out = {};
            var seen = {};
            Object.keys(durations || {}).forEach(function (k) {
                var n = Number(durations[k]);
                if (!(n > 0) || !k) return;
                var pk = (YorkCutEdit && YorkCutEdit.pathKey) ? YorkCutEdit.pathKey(k) : String(k).toLowerCase();
                if (seen[pk]) return;
                seen[pk] = true;
                out[k] = { sec: n, source: durationMeta[k] || "premiere" };
            });
            writeText(durationCachePath(), JSON.stringify(out));
        } catch (err) {}
    }

    function extsForTrackType(type) {
        if (window.YorkCutEdit && YorkCutEdit.extsForType) return YorkCutEdit.extsForType(type);
        if (type === "video") return YorkCutEdit.VIDEO_EXTS;
        if (type === "sub" || type === "subHl") return YorkCutEdit.TEXT_EXTS;
        return YorkCutEdit.AUDIO_EXTS;
    }

    /**
     * 扫描文件夹。声音轨只收纯音频；视频记下来抽成 wav，不把画面铺进时间轴。
     * 画面：视频；字幕：文本。同名不同后缀各自保留。
     */
    function scanFolder(root, trackType) {
        var allow = trackType ? extsForTrackType(trackType) : null;
        var imageExts = (YorkCutEdit && YorkCutEdit.IMAGE_EXTS) || [];
        var rels = [];
        var voiceVideos = [];
        var counts = { video: 0, audio: 0, text: 0, skipped: 0 };
        var MAX_SCAN_DEPTH = 24;   // 防止目录联接/符号链接成环导致无限递归，把面板卡死
        function walk(dir, prefix, depth) {
            if (depth > MAX_SCAN_DEPTH) return;
            readDir(dir).forEach(function (name) {
                if (name === "." || name === "..") return;
                var abs = join(dir, name);
                var rel = prefix ? prefix + "/" + name : name;
                if (isDir(abs)) walk(abs, rel, depth + 1);
                else {
                    var lower = name.toLowerCase();
                    var isImg = endsWithAny(lower, imageExts);
                    var isVid = endsWithAny(lower, YorkCutEdit.VIDEO_EXTS);
                    var isAud = endsWithAny(lower, YorkCutEdit.PURE_AUDIO_EXTS || [".mp3", ".wav", ".aac", ".m4a"]);
                    var isTxt = endsWithAny(lower, YorkCutEdit.TEXT_EXTS);
                    if ((trackType === "voice" || trackType === "sfx" || trackType === "bgm") && isVid) {
                        voiceVideos.push(abs);
                        counts.video += 1;
                        return;
                    }
                    if (allow) {
                        if (!endsWithAny(lower, allow)) {
                            counts.skipped += 1;
                            return;
                        }
                        // 音轨池已在 allow 中排除图片/字幕
                        if ((trackType === "voice" || trackType === "sfx" || trackType === "bgm") && (isImg || isTxt)) {
                            counts.skipped += 1;
                            return;
                        }
                    }
                    rels.push(rel);
                    if (isVid) counts.video += 1;
                    else if (isAud) counts.audio += 1;
                    else if (isTxt) counts.text += 1;
                }
            });
        }
        walk(root, "");
        return { rels: rels, counts: counts, voiceVideos: voiceVideos };
    }

    function fileExists(path) {
        try {
            var result = window.cep.fs.stat(toFsPath(path));
            if (!result || result.err || !result.data) return false;
            if (result.data.isDirectory && result.data.isDirectory()) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 文件字节数。
     * Adobe CEP 的 fs.stat() 只保证 isFile / isDirectory / mtime，并没有 size 字段，
     * 所以这里先试 size 类字段，取不到就返回 -1（存在但大小未知）或 0（不存在）。
     * 关键：绝不能把「大小未知」当成 0 —— 否则会把刚写好的文件误判成空文件并删掉。
     */
    function fileSize(path) {
        var fsPath = toFsPath(path);
        try {
            var result = window.cep.fs.stat(fsPath);
            if (result && !result.err && result.data) {
                var data = result.data;
                var raw = data.size != null ? data.size : (data.fileSize != null ? data.fileSize : data.length);
                var n = Number(raw);
                if (isFinite(n) && n >= 0) return n;
            }
        } catch (eSize) {}
        return fileExists(fsPath) ? -1 : 0;
    }

    /**
     * 一次性自检：把 cep.fs.stat() 实际返回的字段名写进日志。
     * CEP 各版本返回的字段并不一致（文档只保证 isFile/isDirectory/mtime），
     * 把真相留在日志里，以后排查同类问题不必再猜 API。
     */
    var statShapeLogged = false;
    function logStatShapeOnce() {
        if (statShapeLogged) return;
        statShapeLogged = true;
        try {
            var probe = join(dataDir(), "stat-probe.txt");
            writeText(probe, "yorkcut-stat-probe");
            var r = window.cep.fs.stat(toFsPath(probe));
            var keys = [];
            if (r && r.data) {
                for (var k in r.data) {
                    if (Object.prototype.hasOwnProperty.call(r.data, k)) keys.push(k);
                }
            }
            var statSize = "无";
            try { statSize = (r && r.data && r.data.size != null) ? String(r.data.size) : "无"; } catch (eSz) { statSize = "读取异常"; }
            log("  [自检] fs.stat 可用字段：" + (keys.length ? keys.join(",") : "(不可枚举)") +
                " · size=" + statSize + " · fileSize()=" + fileSize(probe));
            try { window.cep.fs.deleteFile(toFsPath(probe)); } catch (eDel) {}
        } catch (eProbe) {
            log("  [自检] fs.stat 探测失败：" + eProbe, true);
        }
    }

    function fileTime(path) {
        try {
            var result = window.cep.fs.stat(toFsPath(path));
            if (!result || result.err || !result.data) return 0;
            var raw = result.data.mtime || result.data.modificationTime || result.data.modTime || 0;
            if (typeof raw === "string") {
                var parsed = Date.parse(raw);
                return isNaN(parsed) ? 0 : parsed;
            }
            return Number(raw) || 0;
        } catch (e2) {
            return 0;
        }
    }

    function splitPathName(path) {
        var slash = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
        return { dir: slash >= 0 ? path.slice(0, slash) : "", file: slash >= 0 ? path.slice(slash + 1) : path };
    }

    function sameBasePureAudio(videoAbs) {
        var parts = splitPathName(videoAbs);
        var dot = parts.file.lastIndexOf(".");
        var base = dot > 0 ? parts.file.slice(0, dot) : parts.file;
        var exts = (YorkCutEdit && YorkCutEdit.PURE_AUDIO_EXTS) || [".wav", ".mp3", ".m4a", ".aac"];
        var i;
        for (i = 0; i < exts.length; i++) {
            var candidate = join(parts.dir, base + exts[i]);
            if (fileExists(candidate)) return candidate;
        }
        return "";
    }

    function voiceSidecarPath(videoAbs) {
        var parts = splitPathName(videoAbs);
        var dot = parts.file.lastIndexOf(".");
        var base = dot > 0 ? parts.file.slice(0, dot) : parts.file;
        return join(parts.dir, base + ".video-audio.wav");
    }

    /** 按优先级列出所有可能的 ffmpeg 位置（找不到时用来告诉用户都试过哪些路径） */
    function ffmpegCandidates() {
        var candidates = [];
        var given = String(state.ffmpegPath || "").replace(/^\s+|\s+$/g, "");
        if (given) candidates.push(given);
        var saved = savedFfmpegPath();
        if (saved) candidates.push(saved);
        var probe = String(state.ffprobePath || "").replace(/^\s+|\s+$/g, "");
        if (probe) {
            var swapped = probe.replace(/ffprobe(\.exe)?$/i, "ffmpeg$1");
            if (swapped !== probe) candidates.push(swapped);
        }
        var ext = "";
        try { ext = extensionRoot(); } catch (eExt) { ext = ""; }
        if (ext) candidates.push(join(join(join(ext, "tools"), "ffmpeg"), "ffmpeg.exe"));
        return candidates;
    }

    function resolveFfmpeg() {
        var candidates = ffmpegCandidates();
        var i;
        for (i = 0; i < candidates.length; i++) {
            if (fileExists(candidates[i])) return candidates[i];
        }
        return "";
    }

    function savedFfmpegPath() {
        try {
            var ext = extensionRoot();
            if (!ext) return "";
            var text = readText(join(join(ext, "tools"), "ffmpeg-path.txt"));
            if (!text) return "";
            return String(text).split(/\r?\n/)[0].replace(/^\s+|\s+$/g, "");
        } catch (eSave) {
            return "";
        }
    }

    function runExternal(exe, args, opts) {
        opts = opts || {};
        var timeoutMs = opts.timeoutMs || 180000;
        return new Promise(function (resolve) {
            var proc;
            try {
                if (!window.cep || !window.cep.process || !window.cep.process.createProcess) {
                    resolve({ ok: false, detail: "CEP 不能启动外部程序" });
                    return;
                }
                proc = window.cep.process.createProcess.apply(window.cep.process, [exe].concat(args || []));
            } catch (err) {
                resolve({ ok: false, detail: String(err && err.message ? err.message : err) });
                return;
            }
            if (!proc) {
                resolve({ ok: false, detail: "createProcess 没有返回进程" });
                return;
            }
            var out = "";
            var errText = "";
            var settled = false;
                function snap() {
                    function take(value) {
                        if (value == null || value === "" || value === -1 || value === "-1") return "";
                        return String(value);
                    }
                    try { out += take(proc.data); } catch (e0) {}
                    try { out += take(proc.stdout); } catch (e1) {}
                    try { errText += take(proc.stderr); } catch (e2) {}
                }
            function combined() {
                return (errText + " " + out).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
            }
            function codeOf() {
                if (proc.err != null && proc.err !== "") return String(proc.err);
                if (proc.exitCode != null && proc.exitCode !== "") return String(proc.exitCode);
                return "";
            }
            try { proc.onreadystatechange = function () { snap(); }; } catch (eEvt) {}
            function finish(code) {
                if (settled) return;
                settled = true;
                snap();
                var text = combined();
                if (text.length > 280) text = text.slice(0, 280);
                resolve({
                    ok: true,
                    code: code == null || code === "" ? codeOf() : String(code),
                    detail: text
                });
            }
            function ready() {
                snap();
                if (opts.waitForFile && fileExists(opts.waitForFile)) return true;
                if (opts.readyText && opts.readyText(combined())) return true;
                return false;
            }
            var pid = proc.pid;
            var started = Date.now();
            if (ready() && !(pid != null && window.cep.process.isRunning)) {
                finish(codeOf());
                return;
            }
            var timer = setInterval(function () {
                var running = null;
                if (pid != null && window.cep.process.isRunning) {
                    try { running = !!window.cep.process.isRunning(pid); } catch (eRun) { running = false; }
                }
                if (ready() || running === false || Date.now() - started > timeoutMs) {
                    clearInterval(timer);
                    finish(running ? "timeout" : codeOf());
                }
            }, 300);
        });
    }

    function extractVoiceVideos(libraries) {
        var jobs = [];
        var seen = {};
        // extractOne() 与下面的 step() 都要用这个状态，必须声明在两者共同的父作用域里，
        // 否则 extractOne 里引用它会抛 ReferenceError（语法检查与自检都发现不了这类作用域错误）。
        var firstFailedWav = "";
        (libraries || []).forEach(function (lib) {
            (lib.tracks || []).forEach(function (bucket) {
                if (bucket.type !== "voice" && bucket.type !== "sfx" && bucket.type !== "bgm") return;
                (bucket.voiceVideos || []).forEach(function (abs) {
                    var key = String(abs).toLowerCase();
                    if (seen[key]) return;
                    seen[key] = true;
                    jobs.push(abs);
                });
            });
        });
        if (!jobs.length) return Promise.resolve();
        // P3 清理：删掉上次运行可能残留的临时文件。
        // 正常情况下每次都会删（voice-exit-*.txt / .log / .tmp、ffmpeg-version-<时间戳>.txt），
        // 但面板被强杀/异常中断时会堆积在 YorkCutPro 目录里。
        try {
            if (window.cep && window.cep.fs) {
                var tmpDir = dataDir();
                var tmpNames = readDir(tmpDir);
                var cleaned = 0;
                for (var tn = 0; tn < tmpNames.length; tn++) {
                    var nm = String(tmpNames[tn]);
                    // 注意：ffmpeg-version.ps1 / extract-voice.ps1 是要复用的脚本，不匹配（后面不是 "-"）
                    if (nm.indexOf("voice-exit-") !== 0 && nm.indexOf("ffmpeg-version-") !== 0) continue;
                    try { window.cep.fs.deleteFile(toFsPath(join(tmpDir, nm))); cleaned += 1; } catch (eDelTmp) {}
                }
                if (cleaned) logDiag("  已清理上次残留的临时文件 " + cleaned + " 个");
            }
        } catch (eCleanTmp) {}
        var exe = resolveFfmpeg();
        if (!exe) {
            log("  未找到 ffmpeg.exe。口播、音效、背景音里的视频不会转成音频，因此不会参与这些声音轨抽签。画面轨不受影响。", true);
            var tried = ffmpegCandidates();
            if (tried.length) {
                for (var ti = 0; ti < tried.length; ti++) log("    试过：" + tried[ti], true);
            } else {
                log("    没有任何候选路径（面板里 ffmpeg 路径为空，扩展目录也取不到）。", true);
            }
            log("    可重新运行「安装到Premiere.bat」选择本机 ffmpeg，或在面板里填写 ffmpeg 路径。", true);
            return Promise.resolve();
        }
        if (!window.cep || !window.cep.process || !window.cep.process.createProcess) {
            log("  已找到 ffmpeg，但当前环境不能启动外部程序。口播、音效、背景音里的视频不会参与抽签。", true);
            return Promise.resolve();
        }
        log("  声音轨视频 " + jobs.length + " 个，抽出音频到原文件夹");
        log("  ffmpeg：" + exe);
        function ffmpegVersionScript() {
            var path = join(dataDir(), "ffmpeg-version.ps1");
            var body = [
                "param([string]$Exe, [string]$Exit)",
                "$code = 1",
                "$banner = ''",
                "try {",
                "    $psi = New-Object System.Diagnostics.ProcessStartInfo",
                "    $psi.FileName = $Exe",
                "    $psi.Arguments = '-hide_banner -version'",
                "    $psi.UseShellExecute = $false",
                "    $psi.CreateNoWindow = $true",
                "    $psi.RedirectStandardOutput = $true",
                "    $psi.RedirectStandardError = $true",
                "    $proc = New-Object System.Diagnostics.Process",
                "    $proc.StartInfo = $psi",
                "    [void]$proc.Start()",
                "    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()",
                "    $stderrTask = $proc.StandardError.ReadToEndAsync()",
                "    if (-not $proc.WaitForExit(8000)) {",
                "        try { $proc.Kill() } catch {}",
                "        $code = 1",
                "    } else {",
                "        $code = [int]$proc.ExitCode",
                "    }",
                "    try { $banner = ([string]$stdoutTask.Result) + ' ' + ([string]$stderrTask.Result) } catch {}",
                "    if ($banner -notmatch 'ffmpeg version') { $code = 1 }",
                "} catch {",
                "    $code = 1",
                "    $banner = [string]$_.Exception.Message",
                "}",
                "$tmp = $Exit + '.tmp'",
                "Set-Content -LiteralPath $tmp -Value ([string]$code) -Encoding ascii",
                "Move-Item -LiteralPath $tmp -Destination $Exit -Force",
                "Set-Content -LiteralPath ($Exit + '.log') -Value $banner -Encoding UTF8",
                "exit $code",
                ""
            ].join("\r\n");
            writeText(path, body);
            return path;
        }
        function confirmFfmpeg() {
            var stamp = Date.now().toString(16);
            var exitFile = join(dataDir(), "ffmpeg-version-" + stamp + ".txt");
            var script;
            try { script = ffmpegVersionScript(); }
            catch (eScript) {
                return Promise.resolve({ ok: false, detail: "无法写入 ffmpeg 版本脚本" });
            }
            var ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
            return runExternal(ps, [
                "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
                "-File", script, "-Exe", exe, "-Exit", exitFile
            ], { waitForFile: exitFile, timeoutMs: 15000 }).then(function () {
                var ended = fileExists(exitFile);
                var code = ended ? String(readText(exitFile) || "").replace(/^\uFEFF/, "").replace(/\s+/g, "") : "";
                var banner = String(readText(exitFile + ".log") || "").replace(/\s+/g, " ");
                try { window.cep.fs.deleteFile(toFsPath(exitFile)); } catch (e1) {}
                try { window.cep.fs.deleteFile(toFsPath(exitFile + ".tmp")); } catch (e2) {}
                try { window.cep.fs.deleteFile(toFsPath(exitFile + ".log")); } catch (e3) {}
                if (ended && code === "0") return { ok: true, detail: banner };
                if (!ended) return { ok: false, detail: "ffmpeg 版本检测未结束" };
                return { ok: false, detail: banner || ("退出码 " + (code || "空")) };
            });
        }
        function voiceExtractScript() {
            var path = join(dataDir(), "extract-voice.ps1");
            var body = [
                "param([string]$Exe, [string]$Video, [string]$Wav, [string]$Exit)",
                "$code = 1",
                "$bytes = -1",
                "$errText = ''",
                "try {",
                "    $videoArg = $Video.Replace([string][char]34, [string]::Empty)",
                "    $wavArg = $Wav.Replace([string][char]34, [string]::Empty)",
                "    $argLine = '-y -nostdin -i \"' + $videoArg + '\" -vn -acodec pcm_s16le \"' + $wavArg + '\"'",
                "    $psi = New-Object System.Diagnostics.ProcessStartInfo",
                "    $psi.FileName = $Exe",
                "    $psi.Arguments = $argLine",
                "    $psi.UseShellExecute = $false",
                "    $psi.CreateNoWindow = $true",
                "    $psi.RedirectStandardOutput = $true",
                "    $psi.RedirectStandardError = $true",
                "    $proc = New-Object System.Diagnostics.Process",
                "    $proc.StartInfo = $psi",
                "    [void]$proc.Start()",
                "    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()",
                "    $stderrTask = $proc.StandardError.ReadToEndAsync()",
                "    $proc.WaitForExit()",
                "    try { $null = $stdoutTask.Result } catch {}",
                "    try { $errText = [string]$stderrTask.Result } catch {}",
                "    $code = [int]$proc.ExitCode",
                "} catch {",
                "    $code = 1",
                "    $errText = [string]$_.Exception.Message",
                "}",
                "if (Test-Path -LiteralPath $Wav) { try { $bytes = [int64](Get-Item -LiteralPath $Wav).Length } catch { $bytes = -1 } }",
                "$tmp = $Exit + '.tmp'",
                "Set-Content -LiteralPath $tmp -Value ([string]$code + '|' + [string]$bytes) -Encoding ascii",
                "Move-Item -LiteralPath $tmp -Destination $Exit -Force",
                "try { Set-Content -LiteralPath ($Exit + '.log') -Value $errText -Encoding UTF8 } catch {}",
                "exit $code",
                ""
            ].join("\r\n");
            writeText(path, body);
            return path;
        }
        function readExitCode(exitFile) {
            return new Promise(function (resolve) {
                var tries = 0;
                function tick() {
                    var code = String(readText(exitFile) || "").replace(/^\uFEFF/, "").replace(/\s+/g, "");
                    if (code || tries >= 10) {
                        resolve(code);
                        return;
                    }
                    tries += 1;
                    setTimeout(tick, 100);
                }
                tick();
            });
        }
        /** 退出码文件现在写成 "code|bytes"；兼容只有 "code" 的旧脚本。 */
        function parseExitResult(raw) {
            var text = String(raw == null ? "" : raw).replace(/^\uFEFF/, "").replace(/\s+/g, "");
            if (!text) return { code: "", bytes: -1 };
            var parts = text.split("|");
            var code = parts[0] || "";
            var bytes = parts.length > 1 ? Number(parts[1]) : -1;
            if (!isFinite(bytes)) bytes = -1;
            return { code: code, bytes: bytes };
        }
        /**
         * ffmpeg 把版本横幅也写进 stderr，真正的报错在末尾。
         * 直接截前 N 个字符只会留下没用的横幅（反而把关键错误丢掉），所以这里先丢掉横幅行，再取末尾。
         */
        function summarizeFfmpegError(text) {
            var raw = String(text == null ? "" : text);
            if (!raw) return "";
            var lines = raw.split(/\r?\n/);
            var keep = [];
            for (var li = 0; li < lines.length; li++) {
                var ln = String(lines[li]).replace(/\s+$/, "");
                if (!ln.replace(/\s/g, "")) continue;
                if (/^ffmpeg version /.test(ln)) continue;                 // 横幅
                if (/^\s*(built with|configuration):/.test(ln)) continue;  // 横幅
                if (/^\s*lib(av|sw|postproc)/.test(ln)) continue;           // 组件版本行
                keep.push(ln.replace(/^\s+/, ""));
            }
            var out = keep.slice(-4).join(" | ");                           // 末尾几行才是真正的报错
            if (out.length > 300) out = out.slice(out.length - 300);
            return out;
        }
        function discardWav(outWav) {
            if (!fileExists(outWav)) return;
            try { window.cep.fs.deleteFile(toFsPath(outWav)); } catch (eWav) {}
        }
        function extractOne(video, outWav) {
            var stamp = Date.now().toString(16) + Math.floor(Math.random() * 100000).toString(16);
            var exitFile = join(dataDir(), "voice-exit-" + stamp + ".txt");
            try { if (window.cep && window.cep.fs && window.cep.fs.deleteFile) window.cep.fs.deleteFile(toFsPath(exitFile)); } catch (eDel) {}
            if (fileExists(exitFile)) {
                return Promise.resolve({ wrote: false, code: "", detail: "无法确认这条 ffmpeg 是否结束，不使用 wav" });
            }
            var script;
            try { script = voiceExtractScript(); }
            catch (eScript) {
                return Promise.resolve({ wrote: false, code: "", detail: "无法写入抽音频脚本" });
            }
            var ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
            return runExternal(ps, [
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-ExecutionPolicy", "Bypass",
                "-File", script,
                "-Exe", exe,
                "-Video", video,
                "-Wav", outWav,
                "-Exit", exitFile
            ], { waitForFile: exitFile, timeoutMs: 180000 }).then(function () {
                var ended = fileExists(exitFile);
                if (!ended) {
                    discardWav(outWav);
                    return { wrote: false, code: "", detail: "这条 ffmpeg 未结束，不使用 wav" };
                }
                return readExitCode(exitFile).then(function (rawCode) {
                    var parsed = parseExitResult(rawCode);
                    var code = parsed.code;
                    var bytes = parsed.bytes;
                    var errText = "";
                    try {
                        errText = summarizeFfmpegError(readText(exitFile + ".log"));
                    } catch (eErrText) {}
                    try { window.cep.fs.deleteFile(toFsPath(exitFile)); } catch (eExit) {}
                    try { window.cep.fs.deleteFile(toFsPath(exitFile + ".tmp")); } catch (eTmp) {}
                    try { window.cep.fs.deleteFile(toFsPath(exitFile + ".log")); } catch (eLogDel) {}
                    // 成功判据：退出码 0，且 PowerShell 报回 >44 字节（WAV 头）。
                    // bytes < 0 表示旧脚本没报大小，退回「文件存在即可」。
                    var wrote = code === "0" && (bytes > 44 || (bytes < 0 && fileExists(outWav)));
                    var kept = false;
                    if (!wrote) {
                        // 保留第一条失败样本，别再无声无息地删掉唯一证据
                        if (!firstFailedWav) { firstFailedWav = outWav; kept = true; }
                        else discardWav(outWav);
                    }
                    return {
                        wrote: wrote,
                        code: code,
                        bytes: bytes,
                        kept: kept,
                        detail: "ffmpeg 退出码 " + (code || "空") + " · " +
                            (bytes < 0 ? "未生成 wav" : (bytes + " 字节")) +
                            (errText ? " · " + errText : "")
                    };
                });
            });
        }
        return confirmFfmpeg().then(function (checked) {
            if (!checked || !checked.ok) {
                log("  ffmpeg 没有启动：" + ((checked && checked.detail) || "没有版本输出") + "。这些视频不会参与口播、音效、背景音抽签。", true);
                return;
            }
            log("  ffmpeg 已启动");
            var index = 0;
            var failed = 0;
            var noAudio = 0;
            var noAudioNames = [];
            var okCount = 0;
            var failDetails = [];
            function step() {
                if (genCancel) return Promise.resolve();
                if (index >= jobs.length) {
                    if (failed) {
                        log("  " + failed + " 个视频没有抽出音频，不会参与口播、音效、背景音抽签。", true);
                        for (var fd = 0; fd < failDetails.length; fd++) log("    · " + failDetails[fd], true);
                        if (noAudio) {
                            log("    其中 " + noAudio + " 个视频本身没有音轨（属正常，不会参与口播/音效/背景音抽签）。", true);
                            if (noAudioNames.length) {
                                log("      这些素材每次生成都会重试一次，属预期行为（不做跳过标记）：" +
                                    noAudioNames.join("，") + (noAudio > noAudioNames.length ? " 等" : ""));
                            }
                        }
                        if (firstFailedWav && fileExists(firstFailedWav)) {
                            log("    已保留第一个失败样本供排查：" + firstFailedWav);
                        }
                    }
                    if (okCount) log("  成功抽出音频 " + okCount + " 个（这些 wav 已进入口播/音效/背景音抽签池）");
                    return Promise.resolve();
                }
                var video = jobs[index];
                index += 1;
                var sibling = sameBasePureAudio(video);
                if (sibling && fileExists(sibling)) {
                    log("  已有同名音频，不覆盖：" + baseName(sibling));
                    return step();
                }
                var out = voiceSidecarPath(video);
                var videoTime = fileTime(video);
                var outTime = fileExists(out) ? fileTime(out) : 0;
                if (fileExists(out) && (outTime === 0 || videoTime === 0 || outTime >= videoTime)) {
                    log("  使用已抽出的音频：" + baseName(out));
                    return step();
                }
                log("  抽出音频：" + baseName(video) + " → " + baseName(out));
                return extractOne(video, out).then(function (result) {
                    if (!result.wrote) {
                        failed += 1;
                        if (/does not contain any stream|matches no streams|no audio/i.test(String(result.detail || ""))) {
                            noAudio += 1;
                            // 只记录名字用于提醒；不做任何"跳过重试"的处理（按要求保留原行为）
                            if (noAudioNames.length < 5) noAudioNames.push(baseName(video));
                        }
                        if (failDetails.length < 3) {
                            failDetails.push(baseName(video) + " — " + (result.detail || ("退出码 " + (result.code || "未知"))));
                        }
                    } else {
                        okCount += 1;
                        log("  音频已写好：" + baseName(out) + "（" + (result.bytes >= 0 ? result.bytes : fileSize(out)) + " 字节）");
                    }
                    return step();
                });
            }
            return step();
        });
    }

    function refreshVoiceAudioRels(libraries) {
        var sidecars = 0;
        var audioFiles = 0;
        var buckets = 0;
        (libraries || []).forEach(function (lib) {
            (lib.tracks || []).forEach(function (bucket) {
                if ((bucket.type !== "voice" && bucket.type !== "sfx" && bucket.type !== "bgm") || !bucket.root) return;
                buckets += 1;
                var scan = scanFolder(bucket.root, bucket.type);
                bucket.rels = scan.rels;
                bucket.voiceVideos = scan.voiceVideos || [];
                audioFiles += (bucket.rels || []).length;
                for (var i = 0; i < (bucket.rels || []).length; i++) {
                    if (String(bucket.rels[i]).toLowerCase().indexOf(".video-audio.wav") >= 0) sidecars += 1;
                }
            });
        });
        // 池子为空时用户只会看到成片里「口播 0」，把池子大小明说出来，避免再靠猜
        if (!buckets) return;
        log("  声音轨可用素材 " + audioFiles + " 个（其中抽出的 .video-audio.wav " + sidecars + " 个）");
        if (!audioFiles) {
            log("  警告：已配置口播/音效/背景音轨，但可用素材为 0，这些轨将没有素材。" +
                "请确认文件夹内有音频文件，或文件夹内的视频能成功抽出音频。", true);
        }
    }

    function probeUnmeasuredSidecars(libraries) {
        var paths = [];
        var seen = {};
        (libraries || []).forEach(function (lib) {
            (lib.tracks || []).forEach(function (bucket) {
                if (bucket.type !== "voice" && bucket.type !== "sfx" && bucket.type !== "bgm") return;
                (bucket.rels || []).forEach(function (rel) {
                    if (String(rel).toLowerCase().indexOf(".video-audio.wav") < 0) return;
                    var abs = YorkCutEdit.absJoin(bucket.root, rel);
                    var key = YorkCutEdit.pathKey(abs);
                    if (seen[key]) return;
                    seen[key] = true;
                    if (!(YorkCutEdit.lookupDur(durations, abs) > 0)) paths.push(abs);
                });
            });
        });
        if (!paths.length) return Promise.resolve();
        log("  为新抽出的音频读取时长 " + paths.length + " 个，抽签会用到这些不同长度");
        return probePathsChunked(paths);
    }

    function listFirstLevelDirs(parent) {
        var out = [];
        readDir(parent).forEach(function (name) {
            if (name === "." || name === "..") return;
            var abs = join(parent, name);
            if (isDir(abs)) out.push(name);
        });
        out.sort(naturalSort);
        return out;
    }

    function trackLayerIndex(row, track) {
        var n = 0;
        for (var i = 0; i < (row.tracks || []).length; i++) {
            if (row.tracks[i] === track) return n;
            if (row.tracks[i].type === track.type) n += 1;
        }
        return 0;
    }

    function trackAtLayer(row, typeId, layerIndex) {
        var n = 0;
        for (var i = 0; i < (row.tracks || []).length; i++) {
            if (row.tracks[i].type !== typeId) continue;
            if (n === layerIndex) return row.tracks[i];
            n += 1;
        }
        return null;
    }

    function ensureTrackLayer(row, typeId, layerIndex) {
        var t = trackAtLayer(row, typeId, layerIndex);
        if (t) return t;
        while (!trackAtLayer(row, typeId, layerIndex)) {
            row.tracks.push(emptyTrack(typeId));
        }
        return trackAtLayer(row, typeId, layerIndex);
    }

    function resolveLinkedTrack(script, rowIndex, track, layerIndex) {
        if (!script || !track) return track;
        if (typeof layerIndex !== "number") layerIndex = trackLayerIndex(script.rows[rowIndex], track);
        var seen = {};
        var idx = rowIndex;
        var cur = track;
        var guard = 0;
        while (cur && typeof cur.linkToSeg === "number" && cur.linkToSeg >= 0 && guard < 64) {
            if (seen[idx + ":" + cur.type + ":" + layerIndex]) return null;
            seen[idx + ":" + cur.type + ":" + layerIndex] = true;
            var srcIdx = cur.linkToSeg;
            if (srcIdx < 0 || srcIdx >= script.rows.length) return null;
            var srcTrack = trackAtLayer(script.rows[srcIdx], cur.type, layerIndex);
            if (!srcTrack) return null;
            idx = srcIdx;
            cur = srcTrack;
            guard += 1;
        }
        return cur;
    }

    function canLinkTo(script, rowIndex, track, layerIndex, targetIndex) {
        if (targetIndex === rowIndex) return false;
        if (targetIndex < 0 || targetIndex >= script.rows.length) return false;
        var probe = { type: track.type, linkToSeg: targetIndex, path: track.path };
        var resolved = resolveLinkedTrack(script, rowIndex, probe, layerIndex);
        return !!(resolved && resolved.path);
    }

    function linkAllSegmentsToFirst(typeId) {
        var script = activeScript();
        if (script.rows.length < 2) {
            log("至少两段才能「全→1」。", true);
            return;
        }
        var firstLayers = {};
        (script.rows[0].tracks || []).forEach(function (t) {
            if (t.type !== typeId) return;
            if (!firstLayers[typeId]) firstLayers[typeId] = 0;
            firstLayers[typeId] += 1;
            t.linkToSeg = null;
        });
        var layerCount = firstLayers[typeId] || 1;
        if (!trackAtLayer(script.rows[0], typeId, 0)) {
            ensureTrackLayer(script.rows[0], typeId, 0);
            layerCount = 1;
        }
        for (var r = 1; r < script.rows.length; r++) {
            for (var li = 0; li < layerCount; li++) {
                var t = ensureTrackLayer(script.rows[r], typeId, li);
                t.linkToSeg = 0;
            }
        }
        markPresetDirty();
        persist();
        render();
        refreshCapacity();
        log(trackLabel(typeId) + "：段2…" + script.rows.length + " 已设为和段1相同");
    }

    function layoutTypeFromParent(typeId, presetParent) {
        var start = function (parent) {
            if (!parent) return;
            parent = toFsPath(parent);
            var subs = listFirstLevelDirs(parent);
            if (!subs.length) {
                log("父级下没有第一层子文件夹。", true);
                return;
            }
            var script = activeScript();
            openLayoutModal({
                typeId: typeId,
                parent: parent,
                subs: subs,
                existing: script.rows.length
            }).then(function (mode) {
                if (!mode) return;
                applyLayout(typeId, parent, subs, mode);
            });
        };
        if (presetParent) {
            start(presetParent);
            return;
        }
        pickDirectory("选择" + trackLabel(typeId) + "父级文件夹（第一层子文件夹=段）").then(start)
            .catch(function (err) { log(String(err), true); });
    }

    function openLayoutModal(info) {
        return new Promise(function (resolve) {
            layoutSession = { resolve: resolve, info: info };
            document.getElementById("layoutTitle").textContent =
                "一键铺段 · " + trackLabel(info.typeId);
            document.getElementById("layoutHint").textContent =
                "父级：" + info.parent + " · 子文件夹 " + info.subs.length + " 个（自然序）· 现有段 " + info.existing;
            var lines = info.subs.map(function (name, i) {
                return (i + 1) + ". " + name;
            });
            if (lines.length > 40) {
                document.getElementById("layoutPreview").textContent =
                    lines.slice(0, 40).join("\n") + "\n… 另有 " + (lines.length - 40) + " 个";
            } else {
                document.getElementById("layoutPreview").textContent = lines.join("\n");
            }
            var conflict = document.getElementById("layoutConflict");
            var fillBtn = document.getElementById("layoutFill");
            var expandBtn = document.getElementById("layoutExpand");
            var replaceBtn = document.getElementById("layoutReplace");
            fillBtn.classList.add("hidden");
            expandBtn.classList.add("hidden");
            if (info.subs.length === info.existing) {
                conflict.textContent = "段数一致，将绑定到各段该轨（设为独立）。";
                replaceBtn.textContent = "确认铺段";
            } else if (info.subs.length > info.existing) {
                conflict.textContent = "子文件夹多于现有段：可追加段，或只填已有前 " + info.existing + " 段。";
                fillBtn.classList.remove("hidden");
                expandBtn.classList.remove("hidden");
                replaceBtn.textContent = "按子文件夹重铺（调整段数）";
            } else {
                conflict.textContent = "子文件夹少于现有段：可只更新前 " + info.subs.length + " 段，或按子文件夹收缩段数。";
                fillBtn.classList.remove("hidden");
                replaceBtn.textContent = "按子文件夹收缩段数";
            }
            document.getElementById("layoutModal").className = "modal";
            var syncBox = document.getElementById("layoutSyncLayers");
            if (syncBox) syncBox.checked = false;
        });
    }

    function closeLayoutModal(mode) {
        document.getElementById("layoutModal").className = "modal hidden";
        if (layoutSession) layoutSession.resolve(mode);
        layoutSession = null;
    }

    function applyLayout(typeId, parent, subs, mode) {
        var script = activeScript();
        var n = subs.length;
        if (mode === "fill") n = Math.min(subs.length, script.rows.length);
        else if (mode === "expand") {
            while (script.rows.length < subs.length) {
                script.rows.push(emptyRow());
                ensureColWidths(script);
                script.colWidths.push(state.colWidth || 240);
            }
            n = subs.length;
        } else if (mode === "replace") {
            if (subs.length > script.rows.length) {
                while (script.rows.length < subs.length) {
                    script.rows.push(emptyRow());
                    ensureColWidths(script);
                    script.colWidths.push(state.colWidth || 240);
                }
            } else if (subs.length < script.rows.length) {
                script.rows.length = Math.max(1, subs.length);
                ensureColWidths(script);
            }
            n = Math.min(subs.length, script.rows.length);
        }
        for (var i = 0; i < n; i++) {
            var row = script.rows[i];
            var track = ensureTrackLayer(row, typeId, 0);
            track.linkToSeg = null;
            track.path = join(parent, subs[i]);
            var scan = scanFolder(track.path, typeId);
            track.counts = scan.counts;
            track._relsCache = scan.rels;
            track.strategy = { mode: "pool" };
        }
        var doSync = document.getElementById("layoutSyncLayers") && document.getElementById("layoutSyncLayers").checked;
        if (doSync && window.confirm("把该轨第 2 层及以后也设成与本段第 1 层相同的文件夹？默认不会改其它层。")) {
            for (var s = 0; s < n; s++) {
                var base = trackAtLayer(script.rows[s], typeId, 0);
                if (!base || !base.path) continue;
                var layerN = 1;
                while (trackAtLayer(script.rows[s], typeId, layerN)) {
                    var extra = trackAtLayer(script.rows[s], typeId, layerN);
                    extra.linkToSeg = null;
                    extra.path = base.path;
                    extra.strategy = base.strategy ? JSON.parse(JSON.stringify(base.strategy)) : { mode: "pool" };
                    extra.counts = base.counts;
                    extra._relsCache = base._relsCache;
                    layerN += 1;
                }
            }
            log(trackLabel(typeId) + "：已把已有上层同步为各段第 1 层文件夹");
        }
        remapLinks(script, function (old) {
            if (old < 0 || old >= script.rows.length) return -1;
            return old;
        });
        activeCol = 0;
        markPresetDirty();
        persist();
        render();
        refreshCapacity();
        log(trackLabel(typeId) + " 已铺 " + n + " 段 ← " + baseName(parent));
    }

    function enableFolderDrop(el, onFolder) {
        el.addEventListener("dragover", function (event) {
            if (!event.dataTransfer) return;
            var types = event.dataTransfer.types;
            var ok = false;
            if (types) {
                for (var i = 0; i < types.length; i++) {
                    if (String(types[i]).toLowerCase() === "files") ok = true;
                }
            }
            if (!ok) return;
            event.preventDefault();
            event.stopPropagation();
            el.classList.add("folder-drop-over");
        });
        el.addEventListener("dragleave", function () {
            el.classList.remove("folder-drop-over");
        });
        el.addEventListener("drop", function (event) {
            el.classList.remove("folder-drop-over");
            if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            trackDrag = null;
            segDrag = null;
            var file = event.dataTransfer.files[0];
            var path = file.path || file.name;
            if (!path) {
                log("未能读取拖入路径（请在 Premiere 面板内拖拽）。", true);
                return;
            }
            path = toFsPath(path);
            if (!isDir(path)) {
                path = join(path, "..");
                if (!isDir(path)) {
                    log("请拖入文件夹。", true);
                    return;
                }
            }
            onFolder(path);
        });
    }

    function ensureTransitionState() {
        if (!state.transition) {
            state.transition = {
                mode: "off",
                name: "Cross Dissolve",
                names: DEFAULT_TRANSITIONS.slice(),
                durationFrames: 8
            };
        }
        if (!state.transition.names || !state.transition.names.length) {
            state.transition.names = DEFAULT_TRANSITIONS.slice();
        }
        return state.transition;
    }

    function refreshTransitionUi() {
        ensureTransitionState();
        if (transitionModeEl) transitionModeEl.value = state.transition.mode || "off";
        if (transitionFramesEl) transitionFramesEl.value = String(state.transition.durationFrames || 8);
        var mode = state.transition.mode || "off";
        var showExtra = mode !== "off";
        var extras = document.querySelectorAll(".tr-extra");
        for (var ei = 0; ei < extras.length; ei++) {
            if (showExtra) extras[ei].classList.remove("hidden");
            else extras[ei].classList.add("hidden");
        }
        if (!transitionNameEl) return;
        transitionNameEl.innerHTML = "";
        var lib = DEFAULT_TRANSITIONS.slice();
        (state.transition.names || []).forEach(function (n) {
            if (lib.indexOf(n) < 0) lib.push(n);
        });
        lib.forEach(function (n) {
            var opt = document.createElement("option");
            opt.value = n;
            opt.textContent = n;
            transitionNameEl.appendChild(opt);
        });
        transitionNameEl.value = state.transition.name || lib[0];
    }

    function openTransitionLib() {
        ensureTransitionState();
        var box = document.getElementById("transitionLibList");
        box.innerHTML = "";
        var selected = {};
        (state.transition.names || []).forEach(function (n) { selected[n] = true; });
        DEFAULT_TRANSITIONS.forEach(function (name) {
            var row = document.createElement("label");
            row.className = "field";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!selected[name];
            cb.setAttribute("data-tr-name", name);
            row.appendChild(cb);
            row.appendChild(document.createTextNode(name));
            box.appendChild(row);
        });
        document.getElementById("transitionLibModal").className = "modal";
    }

    function closeTransitionLib(ok) {
        document.getElementById("transitionLibModal").className = "modal hidden";
        if (!ok) return;
        ensureTransitionState();
        var box = document.getElementById("transitionLibList");
        var names = [];
        var cbs = box.querySelectorAll("input[type=checkbox]");
        for (var i = 0; i < cbs.length; i++) {
            if (cbs[i].checked) names.push(cbs[i].getAttribute("data-tr-name"));
        }
        if (!names.length) names = ["Cross Dissolve"];
        state.transition.names = names;
        if (names.indexOf(state.transition.name) < 0) state.transition.name = names[0];
        markPresetDirty();
        persist();
        refreshTransitionUi();
    }

    /* 卡密 / 云接口账号门禁已按要求下线：不再有 setupLicenseIo / refreshLicenseUi。 */

    function askGenPreview(plan) {
        return new Promise(function (resolve) {
            genPreviewSession = { resolve: resolve };
            var lines = [];
            lines.push("将新建 " + plan.sequences.length + " 条序列");
            plan.sequences.forEach(function (seq, i) {
                var vc = 0, ac = 0;
                (seq.clips || []).forEach(function (c) {
                    if (c.track === "video") vc += 1;
                    else ac += 1;
                });
                lines.push((i + 1) + ". " + seq.name + " · " + Number(seq.duration || 0).toFixed(2) + "s · 画面片 " + vc + " · 音频片 " + ac);
            });
            (plan.warnings || []).forEach(function (w) { lines.push("警告：" + w); });
            document.getElementById("genPreviewBody").textContent = lines.join("\n");
            document.getElementById("genPreviewModal").className = "modal";
        });
    }

    function closeGenPreview(ok) {
        document.getElementById("genPreviewModal").className = "modal hidden";
        if (genPreviewSession) genPreviewSession.resolve(!!ok);
        genPreviewSession = null;
    }

    function treeFromRels(rels) {
        function group(list) {
            var rootCount = 0;
            var dirs = {};
            list.forEach(function (rel) {
                var slash = rel.indexOf("/");
                if (slash < 0) rootCount += 1;
                else {
                    var dir = rel.slice(0, slash);
                    var rest = rel.slice(slash + 1);
                    if (!dirs[dir]) dirs[dir] = [];
                    dirs[dir].push(rest);
                }
            });
            var children = [];
            if (rootCount) {
                children.push({ key: YorkCutPicker.WEIGHT_ROOT_KEY, label: "根目录文件", hasMedia: true, checked: false, percent: 0, children: [] });
            }
            Object.keys(dirs).sort(naturalSort).forEach(function (dir) {
                var nested = group(dirs[dir]);
                children.push({ key: dir, label: dir, hasMedia: true, checked: false, percent: 0, children: nested.children });
            });
            return { children: children };
        }
        return group(rels);
    }

    function summarizeRaw(raw, maxLen) {
        var s = raw == null ? "(null)" : String(raw);
        if (!s.length) return "(空字符串)";
        var one = s.replace(/\s+/g, " ");
        var n = maxLen || 240;
        if (one.length > n) return one.slice(0, n) + "...(len=" + s.length + ")";
        return one;
    }

    function extensionRoot() {
        var p = "";
        try { p = cs.getSystemPath("extension"); } catch (err) { p = ""; }
        return toFsPath(p);
    }

    function hostJsxPath() {
        return join(join(extensionRoot(), "jsx"), "host.jsx");
    }

    /**
     * 批量生成高光补丁模板（一个 PowerShell 进程搞定全部文案）。
     *
     * 两条关键设计（上一版踩过的坑）：
     *  ① 批量：15 条文案只启动一次 PowerShell（实测 15 条约 1.1 秒），
     *     而不是一条一次（每次都要等满 60 秒超时，15 条要十几分钟）。
     *  ② 完成判定用「输出文件是否出现」，**不依赖** cep.process.isRunning ——
     *     在 CEP 里对 PowerShell 子进程的 isRunning 判断会一直为真，导致每次都等超时。
     *
     * @returns Promise<{text: path}>  未完成的条目不会出现在结果里（调用方退回原模板）
     */
    function patchMogrtBatch(template, texts) {
        var dir = join(dataDir(), "mogrt");
        try { window.cep.fs.makedir(dir); } catch (eMk) {}
        var map = {};
        var need = [];
        var i;
        for (i = 0; i < (texts || []).length; i++) {
            var t = String(texts[i] == null ? "" : texts[i]);
            if (!t || map[t]) continue;
            var key = mogrtTextKey(t);
            var out = join(dir, key + ".mogrt");
            if (fileExists(out)) { map[t] = out; continue; }
            var seen = false;
            for (var j = 0; j < need.length; j++) { if (need[j].text === t) { seen = true; break; } }
            if (seen) continue;
            need.push({ text: t, out: out, key: key });
        }
        if (!need.length) return Promise.resolve(map);

        var script = join(join(extensionRoot(), "tools"), "patch-mogrt.ps1");
        if (!fileExists(script)) {
            log("  模板补丁脚本缺失：" + script, true);
            return Promise.resolve(map);
        }
        var listPath = join(dir, "patch-list-" + Date.now() + ".json");
        var payload = [];
        for (i = 0; i < need.length; i++) payload.push({ text: need[i].text, out: toFsPath(need[i].out) });
        try { writeText(listPath, JSON.stringify(payload)); } catch (eW) { return Promise.resolve(map); }

        var ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
        if (!fileExists(ps)) ps = "powershell";
        var started = Date.now();
        log("  模板补丁：需要 " + need.length + " 条（已缓存 " + Object.keys(map).length + " 条）…");
        return new Promise(function (resolve) {
            function done() {
                var got = 0;
                for (var k = 0; k < need.length; k++) {
                    if (fileExists(need[k].out)) { map[need[k].text] = need[k].out; got += 1; }
                }
                log("  模板补丁完成：" + got + "/" + need.length + " 条，用时 " +
                    ((Date.now() - started) / 1000).toFixed(1) + " 秒");
                try { window.cep.fs.deleteFile(toFsPath(listPath)); } catch (eDel) {}
                resolve(map);
            }
            try {
                window.cep.process.createProcess(ps, "-NoProfile", "-ExecutionPolicy", "Bypass",
                    "-File", toFsPath(script), "-Template", toFsPath(template), "-ListFile", toFsPath(listPath));
            } catch (eStart) {
                log("  模板补丁启动失败：" + eStart, true);
                resolve(map);
                return;
            }
            function tick() {
                var got = 0;
                for (var k = 0; k < need.length; k++) if (fileExists(need[k].out)) got += 1;
                if (got >= need.length) { done(); return; }
                if (Date.now() - started > 180000) { done(); return; }
                setTimeout(tick, 200);
            }
            setTimeout(tick, 200);
        });
    }

    /** 文案 → 稳定的缓存键（两个哈希 + 长度，避免碰撞） */
    function mogrtTextKey(text) {
        var s = String(text == null ? "" : text);
        var h1 = 2166136261;
        var h2 = 5381;
        var i;
        for (i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            h1 = ((h1 ^ c) * 16777619) >>> 0;
            h2 = (((h2 << 5) + h2) + c) >>> 0;
        }
        return "hl2-" + h1.toString(16) + "-" + h2.toString(16) + "-" + s.length.toString(16);
    }

    /**
     * 高光图形模板的查找顺序：
     *   1. 面板里手动选的 .mogrt
     *   2. 插件 assets 目录下的任意 .mogrt（用户自己用 AE/Premiere 做的模板放这里）
     *   3. assets\highlight-title.mogrt（历史默认名）
     * 注意：本仓库不附带任何 Adobe 自带模板，请自备 .mogrt 并确认其版权。
     */
    function highlightMogrtPath() {
        var picked = String(state.highlightMogrt || "").replace(/^\s+|\s+$/g, "");
        if (picked) return picked;
        var dir = "";
        try { dir = join(extensionRoot(), "assets"); } catch (eRoot) { return ""; }
        try {
            var preferred = join(dir, "highlight-title.mogrt");
            if (fileExists(preferred)) return preferred;
        } catch (eDef) {}
        try {
            var res = window.cep.fs.readdir(dir);
            var names = (res && res.data) ? res.data : [];
            var i;
            var fallback = "";
            for (i = 0; i < names.length; i++) {
                var n = String(names[i]);
                if (!/\.mogrt$/i.test(n)) continue;
                var p = join(dir, n);
                if (!fileExists(p)) continue;
                // 优先选名字里带 highlight / 高光 的模板
                if (/highlight|title|caption|高光|标题/i.test(n)) return p;
                if (!fallback) fallback = p;
            }
            if (fallback) return fallback;
        } catch (eScan) {}
        return "";
    }

    /** Raw evalScript (no JSON parse). */
    function callHostRaw(script, label, timeoutMs) {
        label = label || "evalScript";
        timeoutMs = timeoutMs || 20000;
        return new Promise(function (resolve, reject) {
            logDiag("  -> 调用 " + label);
            var finished = false;
            var timer = setTimeout(function () {
                if (finished) return;
                finished = true;
                log("  <- " + label + " 超时（" + (timeoutMs / 1000) + "s）", true);
                reject(new Error(label + " 超时"));
            }, timeoutMs);
            try {
                cs.evalScript(script, function (raw) {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    logDiag("  <- " + label + " 原始返回：" + summarizeRaw(raw));
                    resolve(raw);
                });
            } catch (errCall) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                log("  <- " + label + " 调用异常：" + errCall, true);
                reject(errCall);
            }
        });
    }

    /**
     * ScriptPath uses tiny ASCII bootstrap.jsx; full host.jsx is loaded via $.evalFile.
     */
    function ensureHostLoaded() {
        var ext = extensionRoot();
        logDiag("  扩展目录：" + (ext || "(空)"));
        if (!ext) {
            return Promise.reject(new Error("getSystemPath(extension) 为空，CEP 扩展路径不可用"));
        }
        return callHostRaw("1+1", "math1+1", 10000).then(function (raw) {
            if (String(raw) === "EvalScript error.") {
                throw new Error(
                    "CEP evalScript 完全不通（连 1+1 也失败）。请完全退出 Premiere 后重开面板；" +
                    "若仍失败，删除扩展缓存并重装。原始返回=[" + summarizeRaw(raw, 80) + "]"
                );
            }
            if (String(raw) !== "2" && String(raw).indexOf("2") < 0) {
                throw new Error("CEP 基础脚本异常，原始返回=[" + summarizeRaw(raw, 80) + "]");
            }
            log("  基础脚本 OK (1+1=2)");
            // Always (re)load full host.jsx so probe/build APIs exist
            var hostPath = toFsPath(hostJsxPath());
            var esPath = hostPath.replace(/\\/g, "/");
            logDiag("  加载宿主：" + esPath);
            var cmd =
                "try {" +
                "  $.evalFile(" + JSON.stringify(esPath) + ");" +
                "  (typeof yorkcutBuild === 'function' && typeof yorkcutProbe === 'function') ? 'HOST_OK' : ('HOST_PARTIAL:' + (typeof yorkcutBuild) + '/' + (typeof yorkcutProbe));" +
                "} catch (e) { 'HOST_ERR:' + e; }";
            return callHostRaw(cmd, "evalFile(host.jsx)", 45000);
        }).then(function (raw2) {
            var t2 = String(raw2 || "");
            if (t2.indexOf("HOST_OK") >= 0) {
                log("  宿主 host.jsx 已就绪");
                return { ok: true };
            }
            throw new Error("加载 host.jsx 失败，返回=[" + summarizeRaw(raw2, 200) + "]");
        });
    }

    function callHost(script, opts) {
        opts = opts || {};
        var label = opts.label || "evalScript";
        return callHostRaw(script, label, opts.timeoutMs || 60000).then(function (raw) {
            if (raw == null || raw === "" || raw === "EvalScript error." || raw === "undefined") {
                throw new Error(
                    label + " 失败：Premiere 未执行或脚本报错。原始返回=[" + summarizeRaw(raw, 120) +
                    "]。将尝试重新加载宿主；若仍失败请完全退出 Premiere 后重开。"
                );
            }
            try { return JSON.parse(raw); }
            catch (err) {
                throw new Error(label + " 返回非 JSON：" + summarizeRaw(raw));
            }
        });
    }

    function callHostFile(fn, jsonPath, opts) {
        opts = opts || {};
        var fsPath = toFsPath(jsonPath);
        var expr = fn + "(" + JSON.stringify(fsPath) + ")";
        return callHost(expr, { label: opts.label || fn }).then(function (message) {
            if (message && message.resultPath) {
                var resultPath = toFsPath(message.resultPath);
                log("  读回结果文件：" + resultPath);
                var body = readText(resultPath);
                if (!body) throw new Error(fn + "：结果文件为空 " + resultPath);
                log("  结果文件原文：" + summarizeRaw(body, 200));
                try { return JSON.parse(body); }
                catch (err) { throw new Error(fn + "：结果非 JSON " + summarizeRaw(body)); }
            }
            return message;
        });
    }

    function toFsPath(p) {
        if (p == null || p === "") return "";
        var s = String(p);
        if (s.indexOf("file:") === 0) {
            s = s.replace(/^file:\/\//i, "");
            // file:///C:/... → /C:/... → C:/...
            if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
            try { s = decodeURI(s); } catch (err) {}
        }
        return s.replace(/\//g, "\\");
    }

    function parentDir(path) {
        var s = toFsPath(path);
        var i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
        return i > 0 ? s.slice(0, i) : s;
    }

    function dataDir() {
        var base = toFsPath(join(cs.getSystemPath("userData"), "YorkCutPro"));
        try { window.cep.fs.makedir(base); } catch (err) {}
        return base;
    }

    function pickDirectory(title) {
        return new Promise(function (resolve, reject) {
            if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
                reject(new Error("当前环境不能选择文件夹。"));
                return;
            }
            var result = window.cep.fs.showOpenDialogEx(false, true, title, toFsPath(state.presetDir || dataDir()), null);
            if (!result || result.err || !result.data || !result.data.length) resolve("");
            else resolve(toFsPath(result.data[0]));
        });
    }

    function readDir(path) {
        if (!window.cep || !window.cep.fs) return [];
        var result = window.cep.fs.readdir(toFsPath(path));
        if (!result || result.err || !result.data) return [];
        return result.data;
    }

    function isDir(path) {
        var result = window.cep.fs.stat(toFsPath(path));
        if (!result || result.err || !result.data) return false;
        try { return !!result.data.isDirectory(); }
        catch (err) { return false; }
    }

    function readText(path) {
        var fsPath = toFsPath(path);
        var result = window.cep.fs.readFile(fsPath, "UTF-8");
        if (!result || result.err) result = window.cep.fs.readFile(fsPath);
        if (!result || result.err || result.data == null) return "";
        var text = String(result.data);
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        return text;
    }

    function writeText(path, text) {
        var fsPath = toFsPath(path);
        var result = window.cep.fs.writeFile(fsPath, text, "UTF-8");
        if (!result || result.err) result = window.cep.fs.writeFile(fsPath, text);
        if (!result || result.err) throw new Error("无法写入 " + fsPath + (result && result.err ? " (" + result.err + ")" : ""));
    }

    function join(a, b) {
        if (!a) return b;
        var last = a.charAt(a.length - 1);
        if (last === "/" || last === "\\") return a + b;
        return a + (a.indexOf("\\") >= 0 ? "\\" : "/") + b;
    }

    function baseName(path) {
        var parts = String(path).split(/[/\\]/);
        return parts[parts.length - 1] || path;
    }

    function trackLabel(id) {
        for (var i = 0; i < TRACK_TYPES.length; i++) if (TRACK_TYPES[i].id === id) return TRACK_TYPES[i].label;
        return id;
    }

    function endsWithAny(value, exts) {
        for (var i = 0; i < exts.length; i++) {
            if (value.length >= exts[i].length && value.lastIndexOf(exts[i]) === value.length - exts[i].length) return true;
        }
        return false;
    }

    /** 自然序：a32 在 a123pai 前；避免纯字典序把长数字段排错 */
    function naturalSort(a, b) {
        var sa = String(a);
        var sb = String(b);
        try {
            var cmp = sa.localeCompare(sb, "zh", { numeric: true, sensitivity: "base" });
            if (cmp !== 0) return cmp;
        } catch (e1) {}
        var ra = /(\d+)|(\D+)/g;
        var rb = /(\d+)|(\D+)/g;
        var ma;
        var mb;
        while (true) {
            ma = ra.exec(sa);
            mb = rb.exec(sb);
            if (!ma && !mb) return 0;
            if (!ma) return -1;
            if (!mb) return 1;
            if (ma[1] != null && mb[1] != null) {
                var na = parseInt(ma[1], 10);
                var nb = parseInt(mb[1], 10);
                if (na !== nb) return na - nb;
                if (ma[1].length !== mb[1].length) return ma[1].length - mb[1].length;
            } else {
                var ca = (ma[0] || "").toLowerCase();
                var cb = (mb[0] || "").toLowerCase();
                if (ca < cb) return -1;
                if (ca > cb) return 1;
            }
        }
    }

    function nearestFps(fps) {
        var choices = [24, 25, 30, 50, 60];
        var best = 30;
        var gap = 999;
        choices.forEach(function (item) {
            var d = Math.abs(item - fps);
            if (d < gap) { gap = d; best = item; }
        });
        return best;
    }

    function clamp(value, min, max) {
        var n = Math.round(Number(value) || min);
        if (n < min) n = min;
        if (n > max) n = max;
        return n;
    }

    function setupLogUi() {
        if (logDiagCb) {
            logDiagCb.checked = !!diagMode;
            logDiagCb.onchange = function () {
                setDiagMode(!!logDiagCb.checked);
            };
        }
        if (logToggleBtn) {
            logToggleBtn.onclick = function () {
                logExpanded = !logExpanded;
                if (logExpanded) logEl.classList.remove("hidden");
                else logEl.classList.add("hidden");
                logToggleBtn.textContent = logExpanded ? "日志 ▾" : "日志 ▸";
            };
        }
        var openBtn = document.getElementById("openLogFolder");
        if (openBtn) {
            openBtn.onclick = function () {
                var dir = logDir();
                try { window.cep.fs.makedir(dir); } catch (e1) {}
                try {
                    if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
                        var url = "file:///" + dir.replace(/\\/g, "/");
                        window.cep.util.openURLInDefaultBrowser(url);
                    } else {
                        log("日志目录：" + dir);
                        logExpanded = true;
                        logEl.classList.remove("hidden");
                    }
                } catch (e2) {
                    log("日志目录：" + dir);
                }
            };
        }
        applyDiagUi();
    }

    function setDiagMode(on) {
        diagMode = !!on;
        try { localStorage.setItem("yorkcut.diag", diagMode ? "1" : "0"); } catch (e) {}
        if (logDiagCb) logDiagCb.checked = diagMode;
        applyDiagUi();
        log(diagMode ? "诊断模式已开启（面板显示原始调用）" : "诊断模式已关闭");
    }

    function applyDiagUi() {
        if (appVerEl) {
            if (diagMode) appVerEl.classList.add("diag-on");
            else appVerEl.classList.remove("diag-on");
        }
        if (!logEl) return;
        var nodes = logEl.querySelectorAll(".diag");
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].style.display = diagMode ? "" : "none";
        }
    }

    function initAppVersionUi() {
        if (appVerEl) appVerEl.textContent = "v" + APP_VERSION;
        if (!appVerEl) return;
        var pressTimer = 0;
        appVerEl.addEventListener("mousedown", function () {
            pressTimer = setTimeout(function () {
                setDiagMode(!diagMode);
            }, 1000);
        });
        appVerEl.addEventListener("mouseup", function () { clearTimeout(pressTimer); });
        appVerEl.addEventListener("mouseleave", function () { clearTimeout(pressTimer); });
    }

    function logDir() {
        return join(dataDir(), "logs");
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    /** 日志文件名：yorkcut-YYYYMMDD.log */
    function logDayName() {
        var d = new Date();
        return "yorkcut-" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + ".log";
    }

    /** 面板里显示的日志文本（明文，不再做路径脱敏） */
    function maskForPanel(text) {
        return String(text == null ? "" : text);
    }

    /**
     * 写日志文件：纯文本追加，不再加密、不再脱敏。
     * 日志完全公开（含素材路径），便于用户自己排查问题。
     */
    function writeLogFile(level, message) {
        if (!inHost || !window.cep || !window.cep.fs) return;
        try {
            var dir = logDir();
            try { window.cep.fs.makedir(dir); } catch (eMk) {}
            var p = join(dir, logDayName());
            var d = new Date();
            var stamp = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
            var line = "[" + stamp + "][" + level + "] " + String(message) + "\r\n";
            writeText(p, (readText(p) || "") + line);
        } catch (eLog) {}
    }

    function setLogStatus(text) {
        if (logStatusEl) logStatusEl.textContent = maskForPanel(text);
    }

    /**
     * 生成开始时写进日志的"运行头"：把本次的序列数、字幕/高光开关、轨数、
     * 时长等信息压成一行，便于事后按日志复盘。
     * ctx: {sequences, duration, hasCaption, hasHighlight, trackCount, mediaCount,
     *       audioCount, bgmCount, sourceCount, nameBase, nest, cancelled, gain, anchor, sync}
     */
    /** 生成前把本次规模压成一行摘要写进日志。 */
    function runSummary(ctx) {
        var Years = new Date().getFullYear();
        var owner = (window.YorkCutConfig && YorkCutConfig.author) || "";
        var rows = (ctx && ctx.sequences) ? ctx.sequences.length : 0;
        var kind = "CEP";
        var Caption = (ctx && ctx.hasCaption) ? "字幕" : "无字幕";
        var unique = (ctx && ctx.hasHighlight) ? "高光" : "无高光";
        var tracks = (ctx && ctx.trackCount) || 0;
        var media = (ctx && ctx.mediaCount) || 0;
        var audio = (ctx && ctx.audioCount) || 0;
        var duration = Number((ctx && ctx.duration) || 0);
        var edition = (window.YorkCutConfig && YorkCutConfig.appVersion) || "";
        var bgm = (ctx && ctx.bgmCount) || 0;
        var yieldHits = (ctx && ctx.cancelled) ? "中断" : "正常";
        var LineCount = "序列" + rows + "条";
        var useSync = (ctx && ctx.sync) ? "同步" : "自由";
        var origin = (ctx && ctx.sourceCount) || 0;
        var YorkCutTag = "YorkCut Pro";
        var ordered = tracks ? (tracks + "轨") : "";
        var nameBase = (ctx && ctx.nameBase) || "";
        var gain = (ctx && ctx.gain) ? String(ctx.gain) : "";
        var key = "v" + edition;
        var anchor = (ctx && ctx.anchor) ? String(ctx.anchor) : "";
        var nesting = (ctx && ctx.nest) ? "嵌套" : "独立";
        var gauge = duration > 0 ? (duration.toFixed(2) + "s") : "";
        return YorkCutTag + " " + key + " \u00b7 " + Years + " " + owner + " \u00b7 " + kind +
            " \u00b7 " + LineCount + " \u00b7 " + Caption + " \u00b7 " + unique + " \u00b7 " + useSync +
            " \u00b7 " + nesting +
            (ordered ? (" \u00b7 " + ordered) : "") +
            (media ? (" \u00b7 素材" + media) : "") +
            (audio ? (" \u00b7 音频" + audio) : "") +
            (bgm ? (" \u00b7 BGM" + bgm) : "") +
            (origin ? (" \u00b7 来源" + origin) : "") +
            (gain ? (" \u00b7 增益" + gain) : "") +
            (anchor ? (" \u00b7 锚点" + anchor) : "") +
            (nameBase ? (" \u00b7 " + nameBase) : "") +
            (gauge ? (" \u00b7 " + gauge) : "") + " \u00b7 " + yieldHits;
    }

    /**
     * @param {string} message
     * @param {boolean|{error?:boolean,level?:string,fileOnly?:boolean}} [isErrorOrOpts]
     */
    function log(message, isErrorOrOpts) {
        var opts = {};
        if (isErrorOrOpts === true) opts.error = true;
        else if (isErrorOrOpts && typeof isErrorOrOpts === "object") opts = isErrorOrOpts;
        var level = opts.level || (opts.error ? "error" : "user");
        var raw = String(message == null ? "" : message);
        writeLogFile(level, raw);
        if (opts.fileOnly) return;

        if (level === "user" || opts.error) {
            setLogStatus(raw.replace(/^\s+/, "").slice(0, 80));
        }

        var show = level === "user" || opts.error || (level === "diag" && diagMode);
        if (!logEl) return;
        var line = document.createElement("div");
        if (opts.error) line.className = "err";
        else if (level === "diag") line.className = "diag";
        var now = new Date();
        function pad2(n) { return n < 10 ? "0" + n : String(n); }
        var stamp = now.getFullYear() + ":" + pad2(now.getMonth() + 1) + ":" + pad2(now.getDate()) + ":" +
            pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
        line.textContent = stamp + "  " + maskForPanel(raw);
        if (level === "diag" && !diagMode) line.style.display = "none";
        if (show || level === "diag") {
            logEl.appendChild(line);
            if (logExpanded || opts.error) logEl.scrollTop = logEl.scrollHeight;
        }
        if (opts.error && !logExpanded) {
            logExpanded = true;
            logEl.classList.remove("hidden");
            if (logToggleBtn) logToggleBtn.textContent = "日志 ▾";
        }
    }

    function logDiag(message) {
        log(message, { level: "diag" });
    }

    function setupUninstallUi() {
        var btn = document.getElementById("uninstallBtn");
        var modal = document.getElementById("uninstallModal");
        var cancel = document.getElementById("uninstallCancel");
        var ok = document.getElementById("uninstallOk");
        if (!btn || !modal) return;
        btn.onclick = function () { modal.classList.remove("hidden"); };
        if (cancel) cancel.onclick = function () { modal.classList.add("hidden"); };
        if (ok) ok.onclick = function () {
            var clearData = !!(document.getElementById("uninstallClearData") &&
                document.getElementById("uninstallClearData").checked);
            modal.classList.add("hidden");
            runUninstall(clearData);
        };
    }

    function removeTree(dir) {
        dir = toFsPath(dir);
        if (!dir || !window.cep || !window.cep.fs) return;
        var names = readDir(dir);
        for (var i = 0; i < names.length; i++) {
            var child = join(dir, names[i]);
            var st = null;
            try { st = window.cep.fs.stat(toFsPath(child)); } catch (eS) { st = null; }
            var isDir = st && st.data && (st.data.isDirectory || st.data.type === 2);
            // CEP stat shape varies
            try {
                if (st && st.data && typeof st.data.isDirectory === "function") {
                    isDir = st.data.isDirectory();
                }
            } catch (e2) {}
            if (isDir) removeTree(child);
            else {
                try { window.cep.fs.deleteFile(toFsPath(child)); } catch (eD) {}
            }
        }
        try {
            if (window.cep.fs.deleteFile) window.cep.fs.deleteFile(toFsPath(dir));
        } catch (eR) {}
        try {
            if (window.cep.fs.rmdir) window.cep.fs.rmdir(toFsPath(dir));
        } catch (eR2) {}
    }

    function runUninstall(clearData) {
        if (!inHost) {
            log("浏览器预览不能卸载扩展。", true);
            return;
        }
        var extPaths = [];
        var seen = {};
        function addPath(p) {
            p = toFsPath(p || "");
            if (!p) return;
            // 安全闸：只允许删除 CEP 扩展目录。
            // 开发/绿色安装时 extensionRoot() 可能就是源码目录（例如 D:\批量混剪插件\试行），
            // 少了这道闸，点一次「卸载」会把整个项目连同历史记录一起删掉。
            if (p.toLowerCase().indexOf("\\cep\\extensions\\") < 0) {
                log("  已跳过非 CEP 扩展目录（安全保护，不删除）：" + maskForPanel(p), true);
                return;
            }
            var k = p.toLowerCase();
            if (seen[k]) return;
            seen[k] = true;
            extPaths.push(p);
        }
        addPath(extensionRoot());
        addPath("C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.yorkcut.premiere");
        try {
            // dataDir = %APPDATA%/YorkCutPro → 取父目录回到 %APPDATA%，再拼 CEP 扩展路径
            var data = dataDir();
            var roaming = parentDir(data);
            addPath(join(join(join(join(roaming, "Adobe"), "CEP"), "extensions"), "com.yorkcut.premiere"));
        } catch (e7) {}

        if (!extPaths.length) {
            log("没有找到可删除的 CEP 扩展目录，卸载未执行。若确实安装过，请手动删除扩展文件夹。", true);
            return;
        }
        log("开始卸载扩展…");
        for (var i = 0; i < extPaths.length; i++) {
            try {
                logDiag("删除：" + extPaths[i]);
                removeTree(extPaths[i]);
            } catch (err) {
                log("删除失败：" + maskForPanel(extPaths[i]) + " — " + err, true);
            }
        }
        if (clearData) {
            try {
                removeTree(dataDir());
                localStorage.removeItem("yorkcut.panel");
                localStorage.removeItem("yorkcut.diag");
                localStorage.removeItem("yorkcut.presetMeta");
                log("已清除本机 YorkCutPro 数据与面板设置。");
            } catch (err2) {
                log("清除数据时出错：" + err2, true);
            }
        }
        banner.className = "banner";
        banner.textContent = "卸载完成。请关闭 YorkCut 面板并重启 Premiere。若 Program Files 下删除失败，请用管理员手动删除扩展文件夹。";
        log("卸载流程结束。请关闭面板并重启 Premiere。");
    }

    function checkForUpdateQuiet() {
        var url = window.YorkCutConfig && YorkCutConfig.updateUrl;
        if (!url) return;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.timeout = 8000;
            xhr.onload = function () {
                try {
                    var info = JSON.parse(xhr.responseText || "{}");
                    if (!info.version) return;
                    if (compareVersion(String(info.version), APP_VERSION) > 0) {
                        banner.className = "banner";
                        banner.textContent = "发现新版本 v" + info.version +
                            (info.notes ? "：" + info.notes : "") +
                            (info.downloadUrl ? " —— 请下载安装包覆盖安装。" : " —— 请使用新安装包重装。");
                    }
                } catch (eP) {}
            };
            xhr.send(null);
        } catch (eX) {}
    }

    function compareVersion(a, b) {
        var pa = String(a).split(".");
        var pb = String(b).split(".");
        var n = Math.max(pa.length, pb.length);
        for (var i = 0; i < n; i++) {
            var x = parseInt(pa[i] || "0", 10) || 0;
            var y = parseInt(pb[i] || "0", 10) || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    }

    function finishBusy(message, isError) {
        genCancel = false;
        setBusy(false);
        if (message) log(message, !!isError);
    }

    function uid(prefix) {
        uidSeq += 1;
        return (prefix || "id") + "_" + Date.now().toString(36) + "_" + uidSeq;
    }

    function emptyTrack(type) {
        return {
            id: uid("t"), type: type, path: "",
            strategy: { mode: "pool" },
            counts: { video: 0, audio: 0, text: 0 },
            isMainVoice: false,
            linkToSeg: null
        };
    }

    function emptyRow() {
        return {
            tracks: TRACK_TYPES.map(function (t) { return emptyTrack(t.id); }),
            sync: false, align: true, longMat: "head", ext: 1,
            keepAudio: false, unique: false, flip: false, crop: false, bgmLoop: true, repeat: 1
        };
    }

    function emptyScript(name) {
        return { id: uid("s"), name: name || "脚本1", rows: [emptyRow()], colWidths: [240] };
    }

    function cloneTrack(track) {
        return {
            id: track.id || uid("t"),
            type: track.type,
            path: track.path || "",
            strategy: track.strategy ? JSON.parse(JSON.stringify(track.strategy)) : { mode: "pool" },
            counts: track.counts ? {
                video: track.counts.video || 0,
                audio: track.counts.audio || 0,
                text: track.counts.text || 0
            } : { video: 0, audio: 0, text: 0 },
            isMainVoice: !!track.isMainVoice,
            linkToSeg: typeof track.linkToSeg === "number" ? track.linkToSeg : null
        };
    }

    function cloneRow(row) {
        return {
            tracks: (row.tracks || []).map(cloneTrack),
            sync: !!row.sync,
            align: row.align !== false,
            longMat: row.longMat || "head",
            ext: Number(row.ext) || 1,
            keepAudio: !!row.keepAudio,
            unique: !!row.unique,
            flip: !!row.flip,
            crop: !!row.crop,
            bgmLoop: row.bgmLoop !== false,
            repeat: Math.max(1, Number(row.repeat) || 1)
        };
    }

    function migrateRow(row) {
        if (row.tracks && Array.isArray(row.tracks)) {
            row.tracks.forEach(function (t) {
                if (!t.id) t.id = uid("t");
                if (!t.counts) t.counts = { video: 0, audio: 0, text: 0 };
                if (!t.strategy) t.strategy = { mode: "pool" };
                if (typeof t.linkToSeg === "undefined") t.linkToSeg = null;
            });
            if (typeof row.repeat === "undefined") row.repeat = 1;
            return row;
        }
        var tracks = [];
        var old = row.tracks || {};
        TRACK_TYPES.forEach(function (type) {
            var data = old[type.id] || { path: "", strategy: { mode: "pool" }, counts: { video: 0, audio: 0, text: 0 } };
            tracks.push({
                id: uid("t"), type: type.id, path: data.path || "",
                strategy: data.strategy || { mode: "pool" },
                counts: data.counts || { video: 0, audio: 0, text: 0 },
                isMainVoice: false,
                linkToSeg: null
            });
        });
        row.tracks = tracks;
        if (typeof row.repeat === "undefined") row.repeat = 1;
        return row;
    }

    function loadState() {
        try {
            var saved = JSON.parse(localStorage.getItem("yorkcut.panel") || "");
            if (saved) {
                if (!saved.scripts && saved.rows) {
                    saved.scripts = [{ id: "s_legacy", name: "脚本1", rows: saved.rows, colWidths: saved.colWidths || [] }];
                    delete saved.rows;
                }
                if (saved.scripts && saved.scripts.length) {
                    saved.scripts.forEach(function (script) {
                        if (!script.id) script.id = uid("s");
                        if (!script.name) script.name = "脚本";
                        (script.rows || []).forEach(migrateRow);
                        if (!script.colWidths) script.colWidths = [];
                    });
                    if (typeof saved.activeScript !== "number") saved.activeScript = 0;
                    if (!saved.fps) saved.fps = 30;
                    if (!saved.count) saved.count = 1;
                    if (!saved.nameBase) saved.nameBase = "YorkCut";
                    if (typeof saved.insert === "undefined") saved.insert = false;
                    if (typeof saved.enforce24fps === "undefined") saved.enforce24fps = true;
                    if (!saved.uiZoom) saved.uiZoom = 1;
                    if (!saved.boardVZoom) saved.boardVZoom = 1;
                    if (!saved.colWidth) saved.colWidth = 240;
                    if (!saved.highlightMogrt) saved.highlightMogrt = "";
                    if (!saved.activePreset) saved.activePreset = "";
                    if (!saved.presetDir) saved.presetDir = "";
                    if (!saved.ffprobePath) saved.ffprobePath = "";
                    if (!saved.ffmpegPath) saved.ffmpegPath = "";
                    if (!saved.dedupeMode) saved.dedupeMode = "sequence";
                    if (!saved.dedupeMax) saved.dedupeMax = 1;
                    if (!saved.transition || !saved.transition.names || !saved.transition.names.length) {
                        saved.transition = {
                            mode: (saved.transition && saved.transition.mode) || "off",
                            name: (saved.transition && saved.transition.name) || "Cross Dissolve",
                            names: defaultTransitionNames(),
                            durationFrames: (saved.transition && saved.transition.durationFrames) || 8
                        };
                    }
                    return saved;
                }
            }
        } catch (err) {}
        return {
            scripts: [emptyScript("脚本1")],
            activeScript: 0,
            count: 1,
            fps: 30,
            nameBase: "YorkCut",
            insert: false,
            enforce24fps: true,
            uiZoom: 1,
            boardVZoom: 1,
            colWidth: 240,
            highlightMogrt: "",
            activePreset: "",
            presetDir: "",
            ffprobePath: "",
            ffmpegPath: "",
            dedupeMode: "sequence",
            dedupeMax: 1,
            transition: {
                mode: "off",
                name: "Cross Dissolve",
                names: defaultTransitionNames(),
                durationFrames: 8
            }
        };
    }

    function defaultTransitionNames() {
        if (DEFAULT_TRANSITIONS && DEFAULT_TRANSITIONS.length) return DEFAULT_TRANSITIONS.slice();
        return ["Cross Dissolve", "Dip to Black", "Dip to White", "Push", "Slide", "Wipe"];
    }

    function persist() {
        try {
            ensureTransitionState();
            localStorage.setItem("yorkcut.panel", JSON.stringify({
                scripts: state.scripts,
                activeScript: state.activeScript,
                count: state.count,
                fps: state.fps,
                nameBase: state.nameBase,
                insert: !!state.insert,
                enforce24fps: state.enforce24fps !== false,
                uiZoom: state.uiZoom || 1,
                boardVZoom: state.boardVZoom || 1,
                colWidth: state.colWidth || 240,
                highlightMogrt: state.highlightMogrt || "",
                activePreset: state.activePreset || "",
                presetDir: state.presetDir || "",
                ffprobePath: state.ffprobePath || "",
                ffmpegPath: state.ffmpegPath || "",
                dedupeMode: state.dedupeMode || "off",
                dedupeMax: state.dedupeMax || 1,
                transition: state.transition
            }));
        } catch (err) {}
    }
})();
