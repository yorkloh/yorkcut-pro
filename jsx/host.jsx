// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * Premiere 2021+ ExtendScript（ES3）。
 * 面板把抽签结果写成 JSON，这里导入素材、新建独立序列；可选再嵌到当前时间轴。
 */
var YORKCUT_TICKS = 254016000000;
/** 变速单位自检只报一次，避免刷屏 */
var yorkcutSpeedVerifiedOnce = false;

function yorkcutHostInfo() {
    var info = { ok: false, version: "", fps: 30, hasSequence: false, hasProject: false };
    try {
        info.version = String(app.version);
        info.ok = true;
        if (app.project) {
            info.hasProject = true;
            if (app.project.activeSequence) {
                info.hasSequence = true;
                info.fps = yorkcutSequenceFps(app.project.activeSequence);
            }
        }
    } catch (err) {
        info.error = String(err);
    }
    return yorkcutStringify(info);
}

/** Panel connectivity probe (keep ASCII-safe). */
function yorkcutPing() {
    var ver = "";
    var hasProj = false;
    try { ver = String(app.version); } catch (e1) { ver = ""; }
    try { hasProj = !!app.project; } catch (e2) { hasProj = false; }
    return '{"ok":true,"ping":true,"version":' + yorkcutQuote(ver) + ',"hasProject":' + (hasProj ? "true" : "false") + '}';
}

function yorkcutProbe(jsonPath) {
    var log = [];
    var prevId = "";
    try {
        if (!app.project) return yorkcutFinish(jsonPath, { ok: false, error: "请先打开一个 Premiere 项目。", log: log });
        if (app.project.activeSequence) prevId = app.project.activeSequence.sequenceID;
        var data = yorkcutReadJson(jsonPath);
        var paths = data.paths || [];
        var mediaBin = yorkcutEnsureBin(yorkcutEnsureBin(app.project.rootItem, "YorkCut"), "媒体");
        var items = yorkcutImportAll(paths, mediaBin, log);
        var durations = {};
        var pending = [];
        var i;
        for (i = 0; i < paths.length; i++) {
            var item = items[yorkcutNorm(paths[i])];
            var dur = item ? yorkcutItemDuration(item) : 0;
            if (dur > 0.01) durations[paths[i]] = dur;
            else if (item) pending.push({ path: paths[i], item: item });
        }
        if (pending.length) {
            var probe = yorkcutMeasureBatch(pending, mediaBin, log);
            for (var k in probe) if (probe.hasOwnProperty(k)) durations[k] = probe[k];
        }
        var got = 0;
        for (var p in durations) if (durations.hasOwnProperty(p)) got++;
        log.push("已读取 " + got + " / " + paths.length + " 个素材时长");
        yorkcutRestoreSequence(prevId);
        return yorkcutFinish(jsonPath, { ok: true, durations: durations, log: log });
    } catch (err) {
        yorkcutRestoreSequence(prevId);
        return yorkcutFinish(jsonPath, { ok: false, error: String(err), log: log });
    }
}

/**
 * cancel.flag：面板点「取消」时写入这个文件。
 * 为什么要用文件：写入阶段是一整次同步的 ExtendScript 调用，面板的 JS 线程虽然没被阻塞，
 * 但没法在宿主执行中途把变量塞进去，只能靠文件当信号。宿主每建完一条序列就查一次。
 */
function yorkcutCancelFlagPath(jsonPath) {
    try {
        var s = String(jsonPath || "");
        var cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
        if (cut < 0) return "";
        return s.substring(0, cut + 1) + "cancel.flag";
    } catch (e) {
        return "";
    }
}

function yorkcutCancelRequested(flagPath) {
    if (!flagPath) return false;
    try {
        var f = new File(flagPath);
        if (f.exists) {
            try { f.remove(); } catch (eRm) {}
            return true;
        }
    } catch (e) {}
    return false;
}

function yorkcutBuild(jsonPath) {
    var log = [];
    var masterId = "";
    try {
        if (!app.project) return yorkcutFinish(jsonPath, { ok: false, error: "请先打开一个 Premiere 项目。", log: log });
        var master = app.project.activeSequence;
        if (master) masterId = master.sequenceID;
        var edl = yorkcutReadJson(jsonPath);
        var rootBin = yorkcutEnsureBin(app.project.rootItem, "YorkCut");
        var mediaBin = yorkcutEnsureBin(rootBin, "媒体");
        var seqBin = yorkcutEnsureBin(rootBin, "成片序列");
        var paths = yorkcutCollectPaths(edl);
        var items = yorkcutImportAll(paths, mediaBin, log);
        var made = [];
        var cursor = 0;
        if (edl.insert && master) {
            try { cursor = master.getPlayerPosition().seconds; } catch (ePos) { cursor = 0; }
        }
        var sequences = edl.sequences || [];
        var cancelFlag = yorkcutCancelFlagPath(jsonPath);
        var cancelled = false;
        var s;
        // 文字现在通过「模板补丁」写进 .mogrt 默认值，统一用标准换行（LF）即可；
        // 之前的三方对照（LF/CR/SP）已确认换行不是原因。
        var YORKCUT_SEP_MODES = ["LF"];
        for (s = 0; s < sequences.length; s++) {
            // 写入过程中也能取消：每建一条序列检查一次面板写下的 cancel.flag
            if (yorkcutCancelRequested(cancelFlag)) {
                cancelled = true;
                log.push("已收到取消：停止创建后续序列（已完成 " + s + "/" + sequences.length + " 条）。");
                break;
            }
            yorkcutMogrtSepMode = YORKCUT_SEP_MODES[s % YORKCUT_SEP_MODES.length];
            var seq = yorkcutBuildSequence(sequences[s], items, seqBin, log);
            var seconds = yorkcutSequenceDuration(seq);
            made.push({ name: seq.name, seconds: seconds });
            if (edl.insert && master) {
                try { app.project.openSequence(master.sequenceID); } catch (eBack) {}
                yorkcutInsertNest(master, seq, cursor, log);
                cursor += seconds;
            }
        }
        yorkcutRestoreSequence(masterId);
        if (cancelled) {
            log.push("已取消：共创建 " + made.length + " 条序列，其余未创建。");
        } else {
            log.push(edl.insert && master
                ? "已新建序列（前缀-序号），并嵌到当前时间轴播放头。"
                : "已在项目面板 YorkCut / 成片序列 中新建独立序列（命名：前缀-1 ...）。");
        }
        return yorkcutFinish(jsonPath, { ok: true, cancelled: cancelled, log: log, sequences: made });
    } catch (err) {
        yorkcutRestoreSequence(masterId);
        return yorkcutFinish(jsonPath, { ok: false, error: String(err), log: log });
    }
}

function yorkcutBuildSequence(spec, items, seqBin, log) {
    var seed = yorkcutSeedItem(spec, items);
    if (!seed) throw new Error("序列 " + spec.name + " 没有可导入的画面或音频。");
    var name = yorkcutUniqueName(spec.name);
    var seq = app.project.createNewSequenceFromClips(name, [seed.item], seqBin);
    if (!seq) throw new Error("Premiere 没有创建序列 " + name + "。");
    yorkcutClearSequence(seq);
    try { app.project.openSequence(seq.sequenceID); } catch (eOpen) {}

    var vCount = Math.max(1, Number(spec.videoLayerCount) || 1);
    var voiceN = Math.max(0, Number(spec.voiceSlotCount) || 0);
    var sfxN = Math.max(0, Number(spec.sfxSlotCount) || 0);
    var bgmN = Math.max(0, Number(spec.bgmSlotCount) || 0);
    var aCount = Math.max(1, voiceN + sfxN + bgmN + 1);
    yorkcutEnsureTrackCount(seq, vCount, aCount, log);

    var clips = spec.clips || [];
    var fps = yorkcutSequenceFps(seq) || 30;
    // 口播按工程内媒体原长校正，并按帧率量化后重排，避免 A 轨帧缝
    yorkcutApplyNativeVoiceDurations(spec, items, log, fps);
    // 与 261009-2 相同：先画面，再口播/音效/BGM。铺完不再移动片段。
    var i;
    var placedBgm = 0;
    var bgmInSpec = 0;
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track === "video") yorkcutPlaceVideo(seq, clips[i], items, log, vCount);
    }
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track === "voice") {
            yorkcutPlaceAudio(seq, clips[i], Number(clips[i].audioSlot) || 0, items, log);
        } else if (clips[i].track === "sfx") {
            yorkcutPlaceAudio(seq, clips[i], voiceN + (Number(clips[i].audioSlot) || 0), items, log);
        } else if (clips[i].track === "bgm") {
            bgmInSpec += 1;
            if (yorkcutPlaceAudio(seq, clips[i], voiceN + sfxN + (Number(clips[i].audioSlot) || 0), items, log)) {
                placedBgm += 1;
            }
        }
    }
    yorkcutImportCaptions(seq, spec, log);
    yorkcutPlaceHighlights(seq, spec, log);
    yorkcutApplyTransitions(seq, spec, log);
    log.push("序列 " + seq.name + " 已生成（V轨 " + vCount + " / 口播 " + voiceN + " / 音效 " + sfxN +
        " / BGM槽 " + bgmN + " / BGM片 " + bgmInSpec + " 已落 " + placedBgm + "）");
    if (bgmN > 0 && bgmInSpec === 0) log.push("警告：配置了背景音槽但规划里没有 BGM 片段。");
    if (bgmInSpec > 0 && placedBgm === 0) log.push("警告：BGM 片段未能放到时间轴，请检查素材是否可导入。");
    return seq;
}

    function yorkcutTransitionTc(frames, fps) {
        var f = Math.max(1, Math.round(Number(frames) || 8));
        var rate = Number(fps) || 30;
        var df = Math.abs(rate - 29.97) < 0.1 || Math.abs(rate - 59.94) < 0.1;
        var sep = df ? ";" : ":";
        var ff = f < 10 ? ("0" + f) : String(f);
        return "00" + sep + "00" + sep + "00" + sep + ff;
    }

    function yorkcutFindTransition(name) {
        var tries = [name, "Cross Dissolve", "交叉溶解", "Dip to Black", "渐隐为黑色"];
        var i;
        for (i = 0; i < tries.length; i++) {
            if (!tries[i]) continue;
            try {
                var tr = qe.project.getVideoTransitionByName(tries[i]);
                if (tr) return { obj: tr, name: tries[i], downgraded: tries[i] !== name };
            } catch (eN) {}
        }
        return null;
    }

/** Apply Premiere video transitions via QE DOM (unsupported in public ExtendScript API). */
function yorkcutApplyTransitions(seq, spec, log) {
    var tr = spec.transition || {};
    if (!tr || !tr.mode || tr.mode === "off") return;
    var frames = Math.max(1, Math.round(Number(tr.durationFrames) || 8));
    var names = [];
    var ni;
    if (tr.mode === "fixed" && tr.name) names = [String(tr.name)];
    else if (tr.names && tr.names.length) {
        for (ni = 0; ni < tr.names.length; ni++) if (tr.names[ni]) names.push(String(tr.names[ni]));
    }
    if (!names.length) names = ["Cross Dissolve"];
    try { app.enableQE(); } catch (eQe) {
        log.push("转场失败：无法启用 QE（可忽略，成片仍在）");
        return;
    }
    var qeSeq = yorkcutQeSequence(seq.name);
    if (!qeSeq) {
        log.push("转场失败：QE 未找到序列");
        return;
    }
    var fps = yorkcutSequenceFps(seq) || 30;
    var minSec = (2 * frames) / fps;
    var hl = Number(spec.highlightLayer);
    var vMax = Math.min(seq.videoTracks.numTracks, Math.max(1, Number(spec.videoLayerCount) || 1));
    var applied = 0;
    var skippedShort = 0;
    var downgraded = 0;
    var failed = 0;
    var vi;
    for (vi = 0; vi < vMax; vi++) {
        if (hl >= 0 && vi === hl) continue;
        var qeTrack = qeSeq.getVideoTrackAt(vi);
        if (!qeTrack) continue;
        var num = qeTrack.numItems;
        var i;
        for (i = 0; i < num - 1; i++) {
            var a = qeTrack.getItemAt(i);
            var b = qeTrack.getItemAt(i + 1);
            if (!a || !b) continue;
            try {
                if (String(a.type) === "Empty" || String(b.type) === "Empty") continue;
            } catch (eT) {}
            var durA = 999;
            var durB = 999;
            try { durA = a.end - a.start; } catch (eA) {}
            try { durB = b.end - b.start; } catch (eB) {}
            if (durA < minSec || durB < minSec) {
                skippedShort += 1;
                continue;
            }
            var pickName = names[0];
            if (tr.mode === "random" && names.length > 1) {
                pickName = names[Math.floor(Math.random() * names.length)];
            }
            var found = yorkcutFindTransition(pickName);
            if (!found) {
                failed += 1;
                continue;
            }
            if (found.downgraded) downgraded += 1;
            var tc = yorkcutTransitionTc(frames, fps);
            var okAdd = false;
            try { okAdd = !!a.addTransition(found.obj, false, tc); } catch (eAdd) { okAdd = false; }
            if (!okAdd) {
                try { okAdd = !!b.addTransition(found.obj, true, tc); } catch (eAdd2) { okAdd = false; }
            }
            if (okAdd) applied += 1;
            else failed += 1;
        }
    }
    log.push("转场：成功 " + applied + " / 跳过短镜 " + skippedShort + " / 降级 " + downgraded + " / 失败 " + failed);
}

function yorkcutSeedItem(spec, items) {
    var clips = spec.clips || [];
    var i;
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track === "video" && items[yorkcutNorm(clips[i].path)]) {
            return { item: items[yorkcutNorm(clips[i].path)], path: clips[i].path };
        }
    }
    for (i = 0; i < clips.length; i++) {
        if (items[yorkcutNorm(clips[i].path)]) return { item: items[yorkcutNorm(clips[i].path)], path: clips[i].path };
    }
    return null;
}

function yorkcutReadClipSpan(clip) {
    try {
        var span = clip.end.seconds - clip.start.seconds;
        if (span > 0.01) return span;
    } catch (e1) {}
    return 0;
}

function yorkcutSetClipSpan(clip, seconds) {
    if (!(seconds > 0.01) || !clip) return;
    try {
        var end = new Time();
        end.seconds = clip.start.seconds + seconds;
        clip.end = end;
    } catch (e1) {}
}

/**
 * 用 QE 的真实数据核对画面片是否真的占满了计划长度。
 * 只读校验、只写日志：读不到就不下结论（避免误报），也绝不擅自改动时间轴。
 *
 * 为什么必须走 QE 这条通道：yorkcutSetInOut 会把"计划长度"写进 clip.end，
 * 而变速片的真实长度由素材与速度共同决定，ExtendScript 侧读到的 end 可能只是我们写进去的计划值。
 * 之前正是这个假 end 让变速兜底、补铺、空档自检全部失效，V1 出现空档却全程没有一条警告。
 */
function yorkcutVerifyPictureSpan(seq, clip, item, layer, log) {
    var planned = Number(clip.timelineDur) || 0;
    if (!(planned > 0.05)) return true;
    var plannedStart = Number(clip.timelineStart) || 0;
    var wantSpeed = Number(clip.speed) || 1;
    var actual = -1;
    try {
        app.enableQE();
        var qeSeq = yorkcutQeSequence(seq.name);
        if (qeSeq) {
            var qeTrack = qeSeq.getVideoTrackAt(layer);
            if (qeTrack) {
                var i;
                for (i = 0; i < qeTrack.numItems; i++) {
                    var it = qeTrack.getItemAt(i);
                    if (!it) continue;
                    try { if (String(it.type) === "Empty") continue; } catch (eT) {}
                    var st = NaN;
                    try { st = parseFloat(it.start.secs); } catch (eS1) {}
                    if (isNaN(st)) { try { st = parseFloat(it.start.seconds); } catch (eS2) {} }
                    if (isNaN(st) || Math.abs(st - plannedStart) > 0.2) continue;
                    var en = NaN;
                    try { en = parseFloat(it.end.secs); } catch (eE1) {}
                    if (isNaN(en)) { try { en = parseFloat(it.end.seconds); } catch (eE2) {} }
                    if (!isNaN(en) && en > st) actual = en - st;
                    if (actual < 0) {
                        // 有些版本不暴露 end，只给 duration
                        var du = NaN;
                        try { du = parseFloat(it.duration.secs); } catch (eD1) {}
                        if (isNaN(du)) { try { du = parseFloat(it.duration.seconds); } catch (eD2) {} }
                        if (!isNaN(du) && du > 0) actual = du;
                    }
                    break;
                }
            }
        }
    } catch (eQe) {}
    if (actual < 0) return true;                    // 读不到就不下结论
    if (actual + 0.08 >= planned) {                  // 达标
        if (!yorkcutSpeedVerifiedOnce && Math.abs(wantSpeed - 1) > 0.001) {
            yorkcutSpeedVerifiedOnce = true;
            log.push("变速自检通过（首次）：计划速度 " + wantSpeed.toFixed(3) +
                "，QE 实测片长 " + actual.toFixed(2) + "s / 计划 " + planned.toFixed(2) + "s。");
        }
        return true;
    }
    var mediaDur = 0;
    try { mediaDur = yorkcutItemDuration(item); } catch (eM) {}
    log.push("画面片未占满计划长度：" + item.name +
        "（计划 " + planned.toFixed(2) + "s，实测 " + actual.toFixed(2) + "s，计划速度 " + wantSpeed.toFixed(3) +
        "，素材原长 " + mediaDur.toFixed(2) + "s）→ V" + (layer + 1) +
        " 该段会留下 " + (planned - actual).toFixed(2) + "s 空档。");
    return false;
}

/** 画面只用素材真实时长；短于口播时慢放铺满，低于 24 帧则留空，不用最后一帧硬撑。 */
function yorkcutFitPictureSpan(item, placed, clip, seq, log) {
    var mediaDur = yorkcutItemDuration(item);
    if (!(mediaDur > 0.04)) mediaDur = yorkcutReadClipSpan(placed);
    if (!(mediaDur > 0.04)) mediaDur = Number(clip.sourceDur) || Number(clip.timelineDur) || 1;
    var segmentDur = Number(clip.timelineDur) || mediaDur;
    if (!(segmentDur > 0.04)) segmentDur = mediaDur;
    var fps = 30;
    try { fps = yorkcutSequenceFps(seq) || 30; } catch (eF) { fps = 30; }
    var minSpeed = 24 / fps;
    var inn = Number(clip.inPoint) || 0;
    if (inn < 0) inn = 0;
    if (inn > mediaDur - 0.05) inn = 0;
    var available = mediaDur - inn;
    if (available < 0.04) available = mediaDur;
    var speed = 1;
    var srcUsed = Math.min(available, segmentDur);
    var timelineLen = srcUsed;
    if (segmentDur > available + 0.05) {
        var need = available / segmentDur;
        if (need + 0.0001 >= minSpeed) {
            speed = need;
            srcUsed = available;
            timelineLen = segmentDur;
        } else {
            speed = 1;
            srcUsed = available;
            timelineLen = available;
            log.push("画面短于口播且慢放会低于 24 帧，保留素材原长并留空：" + item.name);
        }
    }
    return {
        inn: inn,
        srcUsed: srcUsed,
        speed: speed,
        timelineLen: timelineLen,
        segmentDur: segmentDur,
        mediaDur: mediaDur
    };
}

/**
 * 口播落轨后若实际短于规划，把更晚的片段前移，避免下一段被甩到空档后面。
 */
function yorkcutCloseVoiceGaps(seq, clips, log) {
    var groups = [];
    var indexByKey = {};
    var i;
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "voice") continue;
        var key = String(Math.round((Number(clips[i].timelineStart) || 0) * 1000) / 1000);
        if (!indexByKey.hasOwnProperty(key)) {
            indexByKey[key] = groups.length;
            groups.push({
                key: key,
                plannedStart: Number(clips[i].timelineStart) || 0,
                plannedDur: Number(clips[i].timelineDur) || 0,
                voices: [clips[i]]
            });
        } else {
            var g = groups[indexByKey[key]];
            g.voices.push(clips[i]);
            var d = Number(clips[i].timelineDur) || 0;
            if (d > g.plannedDur) g.plannedDur = d;
        }
    }
    if (groups.length < 2) return;
    groups.sort(function (a, b) { return a.plannedStart - b.plannedStart; });
    var cursor = groups[0].plannedStart;
    var gi;
    for (gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        var actualEnd = group.plannedStart;
        var vi;
        for (vi = 0; vi < group.voices.length; vi++) {
            var found = yorkcutFindAudioClip(seq, group.voices[vi].path, group.voices[vi].timelineStart);
            var span = found ? yorkcutReadClipSpan(found) : 0;
            var st = found ? found.start.seconds : group.voices[vi].timelineStart;
            if (st + span > actualEnd) actualEnd = st + span;
        }
        if (!(actualEnd > group.plannedStart + 0.05)) actualEnd = group.plannedStart + group.plannedDur;
        cursor = actualEnd;
        if (gi + 1 >= groups.length) break;
        var next = groups[gi + 1];
        var gap = next.plannedStart - cursor;
        if (gap > 0.12) {
            yorkcutShiftClipsFrom(seq, next.plannedStart - 0.04, -gap);
            yorkcutShiftSpecFrom(clips, next.plannedStart - 0.04, -gap);
            log.push("口播实际短于规划 " + gap.toFixed(2) + "s，后续片段已前移");
            var shiftGroups;
            for (shiftGroups = gi + 1; shiftGroups < groups.length; shiftGroups++) {
                groups[shiftGroups].plannedStart -= gap;
            }
        }
    }
}

function yorkcutFindAudioClip(seq, path, startSec) {
    var key = yorkcutNorm(path);
    var ti, ci;
    var best = null;
    var bestDelta = 0.45;
    for (ti = 0; ti < seq.audioTracks.numTracks; ti++) {
        var list = seq.audioTracks[ti].clips;
        for (ci = 0; ci < list.numItems; ci++) {
            var c = list[ci];
            var media = "";
            try { media = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e1) {}
            if (yorkcutNorm(media) !== key) continue;
            var delta = Math.abs(c.start.seconds - startSec);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = c;
            }
        }
    }
    return best;
}

function yorkcutShiftClipsFrom(seq, fromSec, delta) {
    if (!(Math.abs(delta) > 0.01)) return;
    var lists = [seq.videoTracks, seq.audioTracks];
    var li, ti, ci;
    var pending = [];
    for (li = 0; li < lists.length; li++) {
        var tracks = lists[li];
        for (ti = 0; ti < tracks.numTracks; ti++) {
            var clips = tracks[ti].clips;
            for (ci = 0; ci < clips.numItems; ci++) {
                try {
                    if (clips[ci].start.seconds >= fromSec) pending.push(clips[ci]);
                } catch (e1) {}
            }
        }
    }
    pending.sort(function (a, b) {
        var as = 0;
        var bs = 0;
        try { as = a.start.seconds; } catch (eA) {}
        try { bs = b.start.seconds; } catch (eB) {}
        return delta < 0 ? (as - bs) : (bs - as);
    });
    var i;
    for (i = 0; i < pending.length; i++) {
        var clip = pending[i];
        var span = yorkcutReadClipSpan(clip);
        var start = 0;
        try { start = clip.start.seconds; } catch (eS) {}
        var t0 = new Time();
        t0.seconds = start + delta;
        var t1 = new Time();
        t1.seconds = start + delta + span;
        try { clip.start = t0; } catch (eMove) {}
        try { clip.end = t1; } catch (eEnd) {}
    }
}

function yorkcutShiftSpecFrom(clips, fromSec, delta) {
    var i;
    for (i = 0; i < clips.length; i++) {
        var st = Number(clips[i].timelineStart) || 0;
        if (st >= fromSec) clips[i].timelineStart = st + delta;
    }
}

function yorkcutPlaceVideo(seq, clip, items, log, vCount) {
    var item = items[yorkcutNorm(clip.path)];
    if (!item) {
        log.push("找不到画面：" + clip.path);
        return;
    }
    if (!seq.videoTracks.numTracks) {
        log.push("序列没有视频轨，跳过画面 " + item.name);
        return;
    }
    yorkcutUntargetAudio(seq);
    var layer = Number(clip.videoLayer) || 0;
    if (layer < 0) layer = 0;
    if (layer >= seq.videoTracks.numTracks) layer = seq.videoTracks.numTracks - 1;
    var track = seq.videoTracks[layer];
    var placed = yorkcutOverwrite(track, item, clip.timelineStart);
    if (!placed) {
        log.push("画面没有放上时间轴：" + item.name);
        return;
    }
    var vInn = Number(clip.inPoint) || 0;
    var vSrc = Number(clip.sourceDur) || Number(clip.timelineDur) || 0;
    var vTl = Number(clip.timelineDur) || vSrc;
    // 必须"先变速、再写时间轴长度"。
    // 反过来的话：写 end 时素材还填不满计划长度（此时速度仍是 1），Premiere 的真实片长仍由素材决定，
    // 而我们写进去的 end 却等于"计划长度"；随后 yorkcutReadClipSpan 读到的正是这个假值，
    // 于是变速兜底、补铺、空档自检全部被它骗过 —— V1 出现空档却全程没有一条警告（YorkCut-1 即如此）。
    if (Math.abs(Number(clip.speed) - 1) > 0.001) {
        yorkcutApplySpeed(seq, "video", layer, placed.start.seconds, clip.speed);
    }
    yorkcutSetInOut(placed, vInn, vInn + vSrc, vTl);
    var span = yorkcutReadClipSpan(placed);
    if (vTl > span + 0.08) {
        var mediaDur = yorkcutItemDuration(item);
        if (!(mediaDur > 0.05)) mediaDur = span;
        var minSpeed = 24 / (yorkcutSequenceFps(seq) || 30);
        if (mediaDur > 0.05 && mediaDur + 0.05 < vTl && (mediaDur / vTl) + 0.0001 >= minSpeed) {
            yorkcutSetInOut(placed, vInn, vInn + mediaDur, vTl);
            var filled = yorkcutApplySpeed(seq, "video", layer, placed.start.seconds, mediaDur / vTl);
            if (!filled) log.push("画面短于口播，变速未生效：" + item.name);
        }
    }
    // 独立核对：用 QE 真实数据检查这一片是否真的占满了计划长度
    // （不受我们自己写进 clip.end 的计划值影响），解决"出现空档却全程无警告"的问题。
    yorkcutVerifyPictureSpan(seq, clip, item, layer, log);
    yorkcutApplyMotion(placed, clip, log, layer);
    var strays = yorkcutStrayAudio(seq, clip.path, placed.start.seconds);
    if (clip.keepAudio) {
        var keepIdx = seq.audioTracks.numTracks - 1;
        if (keepIdx >= 0) {
            var heard = yorkcutOverwrite(seq.audioTracks[keepIdx], item, clip.timelineStart);
            if (heard) {
                yorkcutSetInOut(heard, vInn, vInn + vSrc, vTl);
                yorkcutApplySpeed(seq, "audio", keepIdx, heard.start.seconds, clip.speed);
            }
        }
        yorkcutRemoveClips(strays);
    } else {
        yorkcutRemoveClips(strays);
    }
}

function yorkcutPlaceAudio(seq, clip, trackIndex, items, log) {
    var item = items[yorkcutNorm(clip.path)];
    if (!item) {
        log.push("找不到音频：" + clip.path);
        return false;
    }
    if (trackIndex >= seq.audioTracks.numTracks) {
        trackIndex = seq.audioTracks.numTracks - 1;
        log.push("音轨不足，" + item.name + " 改放到 A" + (trackIndex + 1));
    }
    if (trackIndex < 0) return false;
    var placed = yorkcutOverwrite(seq.audioTracks[trackIndex], item, clip.timelineStart);
    if (!placed) {
        log.push("音频没有放上时间轴：" + item.name);
        return false;
    }
    var inn = Number(clip.inPoint) || 0;
    var src = Number(clip.sourceDur) || Number(clip.timelineDur) || 0;
    var tl = Number(clip.timelineDur) || src;
    if (src > 0.01) yorkcutSetInOut(placed, inn, inn + src, tl);
    return true;
}

/**
 * 收尾：若画面未落上则补铺；清掉仍残留在 V 上的「纯口播路径」幽灵片。
 * 不删与规划画面同路径的片段（同文件既作画面又作口播时安全）。
 */
function yorkcutReconcilePictureTracks(seq, clips, items, log, vCount, stats) {
    stats = stats || {};
    var videoPlans = [];
    var voicePathSet = {};
    var i;
    for (i = 0; i < (clips || []).length; i++) {
        if (clips[i].track === "video") videoPlans.push(clips[i]);
        if (clips[i].track === "voice" || clips[i].track === "sfx" || clips[i].track === "bgm") {
            voicePathSet[yorkcutNorm(clips[i].path)] = true;
        }
    }
    var picturePathSet = {};
    for (i = 0; i < videoPlans.length; i++) picturePathSet[yorkcutNorm(videoPlans[i].path)] = true;

    for (i = 0; i < videoPlans.length; i++) {
        var vp = videoPlans[i];
        var layer = Number(vp.videoLayer) || 0;
        if (!yorkcutHasMediaOnVideoTrack(seq, vp.path, vp.timelineStart, layer)) {
            log.push("补铺画面：" + yorkcutBaseName(vp.path));
            if (yorkcutPlaceVideo(seq, vp, items, log, vCount, stats)) {
                stats.videoRepair = (stats.videoRepair || 0) + 1;
                // placeVideo 已计 videoOk，补铺时避免双计失败
            }
        }
    }

    // 删除 V 上口播路径幽灵：该路径不是任何规划画面
    var ghosts = [];
    var ti, ci;
    for (ti = 0; ti < seq.videoTracks.numTracks; ti++) {
        var trackClips = seq.videoTracks[ti].clips;
        for (ci = 0; ci < trackClips.numItems; ci++) {
            var c = trackClips[ci];
            var media = "";
            try { media = c.projectItem ? c.projectItem.getMediaPath() : ""; } catch (e1) {}
            var nk = yorkcutNorm(media);
            if (voicePathSet[nk] && !picturePathSet[nk]) ghosts.push(c);
        }
    }
    if (ghosts.length) {
        yorkcutRemoveClips(ghosts);
        stats.voiceLinkedV = (stats.voiceLinkedV || 0) + ghosts.length;
        log.push("收尾清除口播联接画面 " + ghosts.length + " 处");
    }
}

function yorkcutHasMediaOnVideoTrack(seq, path, startSec, layer) {
    if (!seq.videoTracks.numTracks) return false;
    var key = yorkcutNorm(path);
    var t0 = Number(startSec) || 0;
    var li = Number(layer) || 0;
    if (li < 0) li = 0;
    if (li >= seq.videoTracks.numTracks) li = seq.videoTracks.numTracks - 1;
    var clips = seq.videoTracks[li].clips;
    var ci;
    for (ci = 0; ci < clips.numItems; ci++) {
        var clip = clips[ci];
        if (Math.abs(clip.start.seconds - t0) > 0.35) continue;
        var media = "";
        try { media = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e1) {}
        if (yorkcutNorm(media) === key) return true;
    }
    return false;
}

function yorkcutBaseName(path) {
    var s = String(path || "").replace(/\\/g, "/");
    var i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * 用工程内媒体原长覆盖口播 timelineDur，并按新标尺平移后续片段起点。
 * 口播落轨不再二次裁切；段内画面若原先对齐整段口播，则缩放到新标尺。
 */
function yorkcutSnapTime(sec, fps) {
    var f = Number(fps) || 0;
    if (!(f >= 1)) return Number(sec) || 0;
    return Math.round((Number(sec) || 0) * f) / f;
}

function yorkcutToFrames(sec, fps) {
    var f = Number(fps) || 0;
    if (!(f >= 1)) return 0;
    return Math.round((Number(sec) || 0) * f);
}

function yorkcutFromFrames(frames, fps) {
    var f = Number(fps) || 0;
    if (!(f >= 1)) return Number(frames) || 0;
    return (Number(frames) || 0) / f;
}

function yorkcutApplyNativeVoiceDurations(spec, items, log, fps) {
    var clips = spec.clips || [];
    if (!clips.length) return;
    var i;
    var f = Number(fps) || 30;

    var segMap = {};
    var starts = [];
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "voice") continue;
        var key0 = String(Math.round((Number(clips[i].timelineStart) || 0) * 1000) / 1000);
        if (!segMap[key0]) {
            segMap[key0] = { oldStart: Number(clips[i].timelineStart) || 0, oldRuler: 0, newRuler: 0, durFrames: 0 };
            starts.push(key0);
        }
        var od = Number(clips[i].timelineDur) || Number(clips[i].sourceDur) || 0;
        if (od > segMap[key0].oldRuler) segMap[key0].oldRuler = od;
    }

    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "voice") continue;
        var item = items[yorkcutNorm(clips[i].path)];
        if (!item) continue;
        var mediaDur = yorkcutItemDuration(item);
        if (!(mediaDur > 0.01)) continue;
        // 统一 round 到帧（不再 ceil），与下一段起点同一套取整
        var mediaFrames = yorkcutToFrames(mediaDur, f);
        if (mediaFrames < 1) mediaFrames = 1;
        mediaDur = yorkcutFromFrames(mediaFrames, f);
        var old = Number(clips[i].sourceDur) || Number(clips[i].timelineDur) || 0;
        clips[i].inPoint = 0;
        clips[i].sourceDur = mediaDur;
        clips[i].timelineDur = mediaDur;
        if (old > 0 && Math.abs(old - mediaDur) > 0.04) {
            log.push("口播原长：" + item.name + " " + old.toFixed(3) + "s -> " + mediaDur.toFixed(3) + "s");
        }
    }

    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "voice") continue;
        var key1 = String(Math.round((Number(clips[i].timelineStart) || 0) * 1000) / 1000);
        if (!segMap[key1]) continue;
        var nd = Number(clips[i].timelineDur) || 0;
        if (nd > segMap[key1].newRuler) segMap[key1].newRuler = nd;
    }

    if (starts.length < 1) return;
    starts.sort(function (a, b) { return segMap[a].oldStart - segMap[b].oldStart; });

    // 段首画面一律收到新口播标尺（含原先长于口播、关闭对齐的溢出片）
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "video") continue;
        var t0 = Number(clips[i].timelineStart) || 0;
        var segKey0 = starts[0];
        var si;
        for (si = 0; si < starts.length; si++) {
            if (segMap[starts[si]].oldStart <= t0 + 0.0005) segKey0 = starts[si];
        }
        var seg0 = segMap[segKey0];
        if (!(seg0.newRuler > 0)) continue;
        var offset0 = t0 - seg0.oldStart;
        if (offset0 < 0.02) {
            clips[i].timelineDur = seg0.newRuler;
            if (Math.abs((Number(clips[i].speed) || 1) - 1) < 0.001) {
                clips[i].sourceDur = seg0.newRuler;
            }
        }
    }

    var newStartFrame = {};
    var cursorF = 0;
    var oldTotal = 0;
    for (i = 0; i < starts.length; i++) {
        var sk = starts[i];
        newStartFrame[sk] = cursorF;
        var ruler = segMap[sk].newRuler || segMap[sk].oldRuler;
        var rf = yorkcutToFrames(ruler, f);
        if (rf < 1) rf = 1;
        segMap[sk].durFrames = rf;
        segMap[sk].newRuler = yorkcutFromFrames(rf, f);
        oldTotal += segMap[sk].oldRuler || 0;
        cursorF += rf;
    }
    var newTotal = yorkcutFromFrames(cursorF, f);

    for (i = 0; i < clips.length; i++) {
        var t = Number(clips[i].timelineStart) || 0;
        var segKey = starts[0];
        var s;
        for (s = 0; s < starts.length; s++) {
            if (segMap[starts[s]].oldStart <= t + 0.0005) segKey = starts[s];
        }
        var oldSeg = segMap[segKey].oldStart;
        var offsetF = yorkcutToFrames(t - oldSeg, f);
        if (offsetF < 0) offsetF = 0;
        var startF = newStartFrame[segKey] + offsetF;
        var durF = yorkcutToFrames(clips[i].timelineDur, f);
        if (clips[i].track === "voice" || (clips[i].track === "video" && offsetF === 0)) {
            durF = segMap[segKey].durFrames - offsetF;
        }
        if (durF < 1) durF = 1;
        if (clips[i].track === "video" || clips[i].track === "voice") {
            var segEndF = newStartFrame[segKey] + segMap[segKey].durFrames;
            if (startF + durF > segEndF) {
                durF = segEndF - startF;
                if (durF < 1) durF = 1;
            }
        }
        clips[i].timelineStart = yorkcutFromFrames(startF, f);
        clips[i].timelineDur = yorkcutFromFrames(durF, f);
        clips[i].inPoint = yorkcutFromFrames(yorkcutToFrames(clips[i].inPoint || 0, f), f);
        if (clips[i].sourceDur != null) {
            if (Math.abs((Number(clips[i].speed) || 1) - 1) < 0.001) {
                clips[i].sourceDur = clips[i].timelineDur;
            } else {
                clips[i].sourceDur = yorkcutFromFrames(Math.max(1, yorkcutToFrames(clips[i].sourceDur, f)), f);
            }
        }
    }

    // 序列总长变化时，把铺满型 BGM 的覆盖长度对齐到新总长（循环片接在末尾）
    if (newTotal > 0.05 && Math.abs(newTotal - oldTotal) > 0.04) {
        yorkcutExtendBgmToTotal(clips, newTotal, f, log);
    }
}

function yorkcutExtendBgmToTotal(clips, newTotal, fps, log) {
    var bySlot = {};
    var i;
    for (i = 0; i < clips.length; i++) {
        if (clips[i].track !== "bgm") continue;
        if (clips[i].bgmLoop === false) continue;
        var slot = String(Number(clips[i].audioSlot) || 0);
        if (!bySlot[slot]) bySlot[slot] = [];
        bySlot[slot].push(i);
    }
    for (var key in bySlot) {
        if (!bySlot.hasOwnProperty(key)) continue;
        var idxs = bySlot[key];
        idxs.sort(function (a, b) {
            return (Number(clips[a].timelineStart) || 0) - (Number(clips[b].timelineStart) || 0);
        });
        var last = clips[idxs[idxs.length - 1]];
        var end = (Number(last.timelineStart) || 0) + (Number(last.timelineDur) || 0);
        if (end >= newTotal - 0.02) continue;
        var media = Number(last.sourceDur) || Number(last.timelineDur) || 0;
        if (!(media > 0.05)) continue;
        var guard = 0;
        var cursor = end;
        while (cursor < newTotal - 0.02 && guard < 200) {
            var seg = Math.min(media, newTotal - cursor);
            seg = yorkcutSnapTime(seg, fps);
            if (seg < 1 / (Number(fps) || 30)) break;
            clips.push({
                track: "bgm",
                path: last.path,
                timelineStart: cursor,
                timelineDur: seg,
                inPoint: 0,
                sourceDur: seg,
                speed: 1,
                audioSlot: Number(last.audioSlot) || 0,
                bgmLoop: true
            });
            cursor += seg;
            guard += 1;
        }
        if (guard > 0) log.push("BGM 已按新口播总长续铺 +" + guard + " 片");
    }
}

/**
 * 字幕 / 高光：用官方接口 Sequence.createCaptionTrack(项目项, 起始秒) 生成真正的字幕轨。
 *
 * 依据（Premiere Pro Scripting Guide → Sequence.createCaptionTrack）：
 *   createCaptionTrack(projectItem, startAtTime, [captionFormat])
 *   "Creates a caption track in the sequence using caption data from a ProjectItem object."
 *   projectItem = 一个字幕源项目项（.srt 导入后的条目）；captionFormat 默认 CAPTION_FORMAT_SUBTITLE。
 *
 * 之前这里查的是 seq.importCaptions（该接口在 ExtendScript 里不存在，只在 UXP/25.6+ 有），
 * 于是误判成"脚本无法上字幕轨"。真正可用的是 createCaptionTrack。
 */
function yorkcutFindItemByPath(path) {
    try {
        var map = yorkcutIndexMedia(app.project.rootItem, {});
        return map[yorkcutNorm(path)] || null;
    } catch (e) {
        return null;
    }
}

/** 文件字节数（ExtendScript）；取不到返回 -1 */
function yorkcutFileBytes(path) {
    try {
        var f = new File(path);
        if (!f.exists) return 0;
        return Number(f.length);
    } catch (e) {
        return -1;
    }
}

function yorkcutAddCaptionTrack(seq, srtPath, log, label) {
    var what = label || "字幕";
    if (!srtPath) return false;
    // 空/不存在的 SRT 绝不能送去 importFiles：Premiere 会弹「导入程序报告了一个一般错误」，
    // 而且那个模态框会卡住同步的 ExtendScript 调用，最终表现为面板"写入超时"。
    var bytes = yorkcutFileBytes(srtPath);
    if (bytes === 0) {
        log.push(what + " SRT 是空文件，已跳过（不送 Premiere 导入，避免弹窗）：" + yorkcutBaseName(srtPath));
        return false;
    }
    if (typeof seq.createCaptionTrack !== "function") {
        log.push("当前 Premiere 不支持 Sequence.createCaptionTrack，" + what + "未上轨。");
        return false;
    }
    var item = yorkcutFindItemByPath(srtPath);
    if (!item) {
        try {
            var bin = yorkcutEnsureBin(yorkcutEnsureBin(app.project.rootItem, "YorkCut"), "字幕");
            bin.select();
            app.project.importFiles([srtPath], 1, bin, 0);
        } catch (eImp) {
            log.push(what + " SRT 导入工程失败：" + eImp);
            return false;
        }
        item = yorkcutFindItemByPath(srtPath);
    }
    if (!item) {
        log.push(what + " SRT 未进入工程，无法建字幕轨：" + yorkcutBaseName(srtPath));
        return false;
    }
    try {
        var ok = seq.createCaptionTrack(item, 0);
        if (ok) {
            log.push(what + "字幕轨已生成：" + yorkcutBaseName(srtPath));
            return true;
        }
        log.push(what + " createCaptionTrack 返回 false（" + yorkcutBaseName(srtPath) + "）");
    } catch (eCap) {
        log.push(what + " createCaptionTrack 调用失败：" + eCap);
    }
    return false;
}

/**
 * 字幕 → Premiere 原生字幕轨（C1）。
 * 高光不走这里：高光是画面轨上的 .mogrt 图形（见 yorkcutPlaceHighlights）。
 */
function yorkcutImportCaptions(seq, spec, log) {
    yorkcutAddCaptionTrack(seq, spec.captionPath, log, "字幕");
}

/** 高光：铺到画面轨顶层的 MOGRT 图形（非字幕轨） */
function yorkcutPlaceHighlights(seq, spec, log) {
    var cues = spec.highlightCues || [];
    if (!cues.length) return;
    var mogrt = spec.highlightMogrt || "";
    if (!mogrt) {
        log.push("有高光文案但未指定 .mogrt 模板，已跳过画面轨高光图形。请在面板选择高光图形模板。");
        return;
    }
    var layer = Number(spec.highlightLayer);
    if (!(layer >= 0) || layer >= seq.videoTracks.numTracks) {
        layer = seq.videoTracks.numTracks - 1;
    }
    if (layer < 0) {
        log.push("没有可用视频轨放置高光图形。");
        return;
    }
    var placed = 0;
    var i;
    yorkcutMogrtTextOk = 0;
    yorkcutMogrtTextFail = 0;
    yorkcutMogrtTextDetail = "";
    yorkcutMogrtNote = "";
    yorkcutMogrtCheckTrack = null;
    yorkcutMogrtCheckStart = -1;
    yorkcutMogrtCheckWant = "";
    yorkcutMogrtCheckDone = "";
    yorkcutMogrtTextSource = "";
    yorkcutMogrtPatchedCount = 0;
    for (i = 0; i < cues.length; i++) {
        if (yorkcutPlaceOneHighlight(seq, cues[i], mogrt, layer, log)) placed += 1;
    }
    log.push("高光图形已铺到 V" + (layer + 1) + "：" + placed + "/" + cues.length + " 条" +
        "（模板补丁 " + yorkcutMogrtPatchedCount + " 条，换行=" + yorkcutMogrtSepMode + "）");

    // ---- 存活校验：全部铺完后，再读一次第一条的文字 ----
    // 用来判断文字是「写进去就没」还是「写进去后被后续操作清掉」。
    var survive = "未采样";
    if (yorkcutMogrtCheckStart >= 0 && yorkcutMogrtCheckTrack) {
        var checkItem = null;
        try { checkItem = yorkcutFindClip(yorkcutMogrtCheckTrack, yorkcutMogrtCheckStart); } catch (eChk) { checkItem = null; }
        var v = checkItem ? yorkcutMogrtReadText(checkItem) : null;
        if (v === null) survive = "读不到";
        else if (v === "") survive = "空（被清掉了）";
        else survive = "有 " + v.length + " 字";
    }
    if (yorkcutMogrtWriteEnabled) {
        log.push("高光文字校验：写入时=" + (yorkcutMogrtCheckDone || "未采样") + " → 序列结束时=" + survive);
    }

    if (yorkcutMogrtNote) log.push("高光文字提示：" + yorkcutMogrtNote);
    if (yorkcutMogrtTextFail > 0 && yorkcutMogrtTextOk === 0) {
        log.push("高光文字全部没写进去，模板/参数可能不匹配（可用「高光图形」换个 .mogrt 试试）。");
    }
}

function yorkcutPlaceOneHighlight(seq, cue, mogrtPath, videoTrackIndex, log, label) {
    var what = label || "高光";
    if (!cue || !cue.text) return false;
    // 每条 cue 可以带自己的补丁模板（文字已写进模板默认值，插入即渲染）。
    // 没有则退回序列级模板。
    var useMogrt = (cue.mogrt && String(cue.mogrt)) ? String(cue.mogrt) : mogrtPath;
    if (useMogrt) yorkcutMogrtPatchedCount += 1;
    var start = new Time();
    start.seconds = Number(cue.start) || 0;
    var startSec = start.seconds;
    var dur = (Number(cue.end) || 0) - startSec;
    if (!(dur > 0.05)) dur = 1;
    var track = null;
    try { track = seq.videoTracks[videoTrackIndex]; } catch (eTr) { track = null; }
    if (!track) {
        log.push(what + "：V" + (videoTrackIndex + 1) + " 轨道不存在");
        return false;
    }
    var ticks = "";
    try { ticks = String(start.ticks); } catch (eTick) { ticks = String(Math.round(startSec * 254016000000)); }

    var comp = null;
    var item = null;

    // 路径 A（官方文档写法）：Track.getMGTComponent(mogrtPath, ticks, vidOffset, audOffset)
    //   文档：'Adds an AE Motion Graphics Template - a Mogrt - to the selected track at the specified time'
    //   返回：Component（模板暴露的参数集合）—— 它同时完成「插入」和「取参数」。
    //   以前空参调用 item.getMGTComponent() 必然返回 null，这就是文字一直写不进去的根因。
    if (typeof track.getMGTComponent === "function") {
        try {
            comp = track.getMGTComponent(useMogrt, ticks, 0, 0);
        } catch (eA) {
            yorkcutMogrtNote = "Track.getMGTComponent 报错：" + eA;
        }
        if (comp) item = yorkcutFindClip(track, startSec);
    }

    // 路径 B（回退）：seq.importMGT 插入，再从片段上找参数组件
    if (!comp) {
        try {
            if (typeof seq.importMGT === "function") {
                item = seq.importMGT(useMogrt, start, videoTrackIndex, 0);
            }
        } catch (eB) {
            log.push(what + " MOGRT 导入失败：" + eB);
            return false;
        }
        if (!item) {
            log.push(what + " MOGRT 未放入时间轴，请确认模板路径可用。");
            return false;
        }
        comp = yorkcutMogrtComponentOf(item);
    }

    // ---- 顺序调整：先调时长、再写文字 ----
    // 之前是「先写文字、后改 item.end」，结果写入+读回都成功，但落到时间轴上的文字是空的
    // （片段名从「此处输入您的标题」变成「图形」）。改入出点会让图形按模板重新实例化，
    // 所以把时长改在前面，文字写在最后，避免被重置。
    if (!item) item = yorkcutFindClip(track, startSec);
    if (item) {
        try {
            var end = new Time();
            end.seconds = startSec + dur;
            if (item.end) item.end = end;
        } catch (eEnd) {
            try {
                var out = new Time();
                out.seconds = dur;
                if (item.outPoint !== undefined) item.outPoint = out;
            } catch (eOut) {}
        }
    } else {
        log.push(what + "：图形已插入但没在 V" + (videoTrackIndex + 1) + " 上找到（时长可能没设上）");
    }

    // 时长改完后重新取一次组件：**优先「实例的组件」**（只有它能改到画面），
    // 退而求其次才用 Track.getMGTComponent 返回的那个（那更可能是模板的参数）。
    // 换行形式按本次的诊断模式重整（LF / CR / SP），用于判定哪种能被渲染。
    var mogrtText = yorkcutMogrtReshapeText(cue.text, yorkcutMogrtSepMode);
    var itemComp = item ? yorkcutMogrtComponentOfItem(item) : null;
    var useComp = itemComp || comp;
    if (!yorkcutMogrtTextSource) {
        yorkcutMogrtTextSource = itemComp ? "实例" : (comp ? "模板（可能改不到画面）" : "无");
    }
    var wr;
    if (!yorkcutMogrtWriteEnabled) {
        // 诊断模式：完全不写文字，看插入的图形是否显示「模板自带默认文字」
        wr = { ok: true, why: "" };
        if (!yorkcutMogrtTextSource) yorkcutMogrtTextSource = "跳过写入（看模板默认文字）";
    } else {
        wr = useComp
            ? yorkcutMogrtSetTextOnComponent(useComp, mogrtText)
            : { ok: false, why: "拿不到 MOGRT 参数组件" + (yorkcutMogrtNote ? "（" + yorkcutMogrtNote + "）" : "") };
        if (!wr.ok && item) wr = yorkcutMogrtSetText(item, mogrtText);
    }

    // 写入后立即读回一次（诊断模式跳过）
    var backNow = yorkcutMogrtWriteEnabled && item ? yorkcutMogrtReadText(item) : null;
    if (yorkcutMogrtWriteEnabled && wr.ok && backNow !== null && backNow === "") {
        wr = { ok: false, why: "写入后立即读回为空" };
    }
    if (!yorkcutMogrtCheckDone) {
        yorkcutMogrtCheckDone = (backNow === null) ? "未写入" : ("有 " + backNow.length + " 字");
    }

    if (wr.ok) {
        yorkcutMogrtTextOk += 1;
    } else {
        yorkcutMogrtTextFail += 1;
        if (!yorkcutMogrtTextDetail) {
            yorkcutMogrtTextDetail = wr.why;
            log.push(what + "文字未写入：" + wr.why);
        }
    }

    // 采样第一条，供序列结束时做「存活校验」
    if (yorkcutMogrtCheckStart < 0 && item) {
        yorkcutMogrtCheckTrack = track;
        yorkcutMogrtCheckStart = startSec;
        yorkcutMogrtCheckWant = String(cue.text || "");
    }
    return true;
}


/** 诊断用：本序列里 MOGRT 文本写入成功/失败计数，失败详情只记第一条 */
var yorkcutMogrtTextOk = 0;
var yorkcutMogrtTextFail = 0;
var yorkcutMogrtTextDetail = "";
var yorkcutMogrtNote = "";
/** 存活校验采样：第一条高光的位置 + 写入时的值与长度 */
var yorkcutMogrtCheckTrack = null;
var yorkcutMogrtCheckStart = -1;
var yorkcutMogrtCheckWant = "";
var yorkcutMogrtCheckDone = "";
/** 文字写到了谁身上：实例 / 模板（模板写不进画面，这是关键诊断） */
var yorkcutMogrtTextSource = "";
var yorkcutMogrtSepMode = "CR";
/** 诊断开关：false = 本版不写文字，用于验证「直接改 .mogrt 默认文字」这条路是否有效 */
var yorkcutMogrtWriteEnabled = false;
/** 本次用「补丁模板」插入的高光条数 */
var yorkcutMogrtPatchedCount = 0;

/** 按指定形式重整换行：LF=\n，CR=\r，SP=空格（用于判断哪种能被渲染） */
function yorkcutMogrtReshapeText(text, mode) {
    var lines = String(text == null ? "" : text).split(/\r?\n/);
    if (mode === "LF") return lines.join("\n");
    if (mode === "SP") return lines.join(" ");
    return lines.join("\r");
}

/** 读出图形片段当前"文本参数"的值；拿不到返回 null */
function yorkcutMogrtReadText(trackItem) {
    var comp = yorkcutMogrtComponentOf(trackItem);
    if (!comp) return null;
    var props = comp.properties;
    if (!props) return null;
    var count = 0;
    if (typeof props.numItems === "number") count = props.numItems;
    else if (typeof props.length === "number") count = props.length;
    var i, p, name;
    for (i = 0; i < count; i++) {
        p = null;
        try { p = props[i]; } catch (eI) { p = null; }
        if (!p) continue;
        name = "";
        try { name = String(p.displayName || p.name || ""); } catch (eN) { name = ""; }
        if (!/text|文本|source\s*text|标题|内容/i.test(name)) continue;
        try {
            if (typeof p.getValue === "function") {
                var v = p.getValue();
                return (v == null) ? "" : String(v);
            }
        } catch (eG) {
            return null;
        }
    }
    return null;
}

/**
 * 取「时间轴上那个图形实例」的参数组件（这是能改到画面文字的唯一来源）。
 * 关键怀疑点：Track.getMGTComponent() 返回的可能是**模板**的参数，而不是实例的——
 * 于是写入成功、读回一致，但画面不变。这里先让片段被选中（文档里 getMGTComponent 提到
 * "selected track"），再取它的组件。
 */
function yorkcutMogrtComponentOfItem(trackItem) {
    if (!trackItem) return null;
    var picked = null;
    try { if (typeof trackItem.setSelected === "function") trackItem.setSelected(1, 1); } catch (eSel) {}
    try {
        if (typeof trackItem.getMGTComponent === "function") {
            var c = trackItem.getMGTComponent();
            if (c) picked = c;
        }
    } catch (e1) {}
    if (!picked) {
        try {
            var comps = trackItem.components;
            var n = comps ? ((typeof comps.numItems === "number") ? comps.numItems : (comps.length || 0)) : 0;
            for (var i = 0; i < n; i++) {
                var c2 = null;
                try { c2 = comps[i]; } catch (eIdx) { c2 = null; }
                if (c2 && yorkcutComponentHasText(c2)) { picked = c2; break; }
            }
        } catch (e2) {}
    }
    try { if (typeof trackItem.setSelected === "function") trackItem.setSelected(0, 1); } catch (eDesel) {}
    return picked;
}

/** 参数集合里是否含"文本项"（用于判断某个 Component 是不是 MGT 图形的参数集合） */
function yorkcutComponentHasText(comp) {
    if (!comp) return false;
    var props = comp.properties;
    if (!props) return false;
    var count = 0;
    if (typeof props.numItems === "number") count = props.numItems;
    else if (typeof props.length === "number") count = props.length;
    var i, p, name;
    for (i = 0; i < count; i++) {
        p = null;
        try { p = props[i]; } catch (eIdx) { p = null; }
        if (!p) continue;
        name = "";
        try { name = String(p.displayName || p.name || ""); } catch (eN) { name = ""; }
        if (/text|文本|source\s*text|标题|内容/i.test(name)) return true;
    }
    return false;
}

/**
 * 从一个 trackItem 上拿到 MGT 参数组件。
 * 路径 1：item.getMGTComponent()（部分版本可无参调用）
 * 路径 2：item.components 里找"带文本参数"的组件（MGT 图形会以组件形式挂上去）
 */
function yorkcutMogrtComponentOf(trackItem) {
    if (!trackItem) return null;
    try {
        if (typeof trackItem.getMGTComponent === "function") {
            var c = trackItem.getMGTComponent();
            if (c) return c;
        }
    } catch (e1) {}
    try {
        var comps = trackItem.components;
        var n = comps ? ((typeof comps.numItems === "number") ? comps.numItems : (comps.length || 0)) : 0;
        var i;
        for (i = 0; i < n; i++) {
            var c2 = null;
            try { c2 = comps[i]; } catch (eIdx) { c2 = null; }
            if (c2 && yorkcutComponentHasText(c2)) return c2;
        }
    } catch (e2) {}
    return null;
}

/**
 * 把文字写进「已经拿到的参数集合」（纯函数：不计数、不打日志）。
 * 注意：官方文档里 Component.properties 是 Array（ComponentParamCollection），
 * 可能只有 .length 而没有 .numItems —— 只按 numItems 遍历会一次都不执行、静默失败。
 */
function yorkcutMogrtSetTextOnComponent(comp, text) {
    if (!comp) return { ok: false, why: "参数组件为空" };
    var props = comp.properties;
    if (!props) return { ok: false, why: "模板没有参数集合" };
    var count = 0;
    if (typeof props.numItems === "number") count = props.numItems;
    else if (typeof props.length === "number") count = props.length;
    if (!(count > 0)) return { ok: false, why: "模板暴露了 0 个参数（numItems/length 都取不到）" };
    var names = [];
    var targets = [];
    var i, p, name;
    for (i = 0; i < count; i++) {
        p = null;
        try { p = props[i]; } catch (eIdx) { p = null; }
        name = "";
        if (p) {
            try { name = String(p.displayName || p.name || ""); } catch (eN) { name = ""; }
        }
        names.push(name || ("#" + (i + 1)));
        if (p && /text|文本|source\s*text|标题|内容/i.test(name)) targets.push(i);
    }
    if (!targets.length) {
        return { ok: false, why: "模板参数里没有文本项（实际参数：" + names.join(" / ") + "）" };
    }
    for (var t = 0; t < targets.length; t++) {
        p = props[targets[t]];
        try {
            if (!p || !p.setValue) continue;
            try {
                p.setValue(text, 1);
            } catch (e1) {
                p.setValue(text);
            }
            // 读回校验：确认文字真的落进去了；顺便发现「换行被折叠」这类问题
            var back = null;
            try {
                if (typeof p.getValue === "function") back = p.getValue();
            } catch (eGet) { back = null; }
            var norm = function (s) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n"); };
            var wantN = norm(text);
            if (back == null || back === "") {
                yorkcutMogrtNote = "已写入参数「" + names[targets[t]] + "」，但读回为空（无法校验，可能只是该版本不支持 getValue）";
            } else {
                var gotN = norm(back);
                if (gotN !== wantN) {
                    if (wantN.indexOf("\n") >= 0 && gotN.indexOf("\n") < 0) {
                        yorkcutMogrtNote = "文字已写入，但换行被折叠成一行（参数「" + names[targets[t]] + "」）";
                    } else {
                        yorkcutMogrtNote = "文字已写入，但读回内容不同：期望 " + wantN.length + " 字符，读回 " + gotN.length + " 字符";
                    }
                }
            }
            return { ok: true, why: "" };
        } catch (eSet) {
            return { ok: false, why: "写入参数「" + names[targets[t]] + "」失败：" + eSet };
        }
    }
    return { ok: false, why: "参数「" + names[targets[0]] + "」没有 setValue" };
}

/** 从 trackItem 上取组件并写文字 */
function yorkcutMogrtSetText(trackItem, text) {
    var comp = yorkcutMogrtComponentOf(trackItem);
    if (!comp) return { ok: false, why: "片段上没有可用的参数组件（getMGTComponent 与 components 都拿不到）" };
    return yorkcutMogrtSetTextOnComponent(comp, text);
}

function yorkcutInsertNest(master, seq, seconds, log) {
    if (!master.videoTracks.numTracks) throw new Error("当前时间轴没有视频轨。");
    var item = seq.projectItem;
    if (!item) throw new Error("序列没有项目条目：" + seq.name);
    var placed = yorkcutOverwrite(master.videoTracks[0], item, seconds);
    if (!placed) log.push("未能插入时间轴：" + seq.name);
}

function yorkcutOverwrite(track, item, seconds) {
    var before = track.clips.numItems;
    var time = new Time();
    time.seconds = seconds;
    try { track.overwriteClip(item, time.ticks); } catch (e1) {}
    var placed = yorkcutFindClip(track, seconds);
    if (placed) return placed;
    try { track.overwriteClip(item, time); } catch (e2) {}
    placed = yorkcutFindClip(track, seconds);
    if (placed) return placed;
    if (track.clips.numItems > before) return track.clips[track.clips.numItems - 1];
    return null;
}

function yorkcutFindClip(track, seconds) {
    var best = null;
    var bestDelta = 0.35;
    var i;
    for (i = 0; i < track.clips.numItems; i++) {
        var clip = track.clips[i];
        var delta = Math.abs(clip.start.seconds - seconds);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = clip;
        }
    }
    return best;
}

/**
 * 设置素材入出点，并按时间轴时长写 end，避免只改 outPoint 时片尾仍按原片长度显示。
 * @param {number} [timelineDur] 时间轴占用秒数；默认 outSec-inSec
 */
function yorkcutSetInOut(clip, inSec, outSec, timelineDur) {
    if (outSec < inSec) outSec = inSec;
    var inn = new Time();
    inn.seconds = inSec;
    var out = new Time();
    out.seconds = outSec;
    try { clip.inPoint = inn; } catch (e1) {}
    try { clip.outPoint = out; } catch (e2) {}
    var tl = Number(timelineDur);
    if (!(tl > 0.0005)) tl = outSec - inSec;
    if (!(tl > 0.0005)) return;
    try {
        if (clip.start) {
            var end = new Time();
            end.seconds = clip.start.seconds + tl;
            clip.end = end;
        }
    } catch (e3) {}
    // 部分版本用 duration / 读写 seconds 校正
    try {
        if (clip.end && clip.start && Math.abs(clip.end.seconds - clip.start.seconds - tl) > 0.02) {
            var end2 = new Time();
            end2.seconds = clip.start.seconds + tl;
            clip.end = end2;
        }
    } catch (e4) {}
}

function yorkcutApplySpeed(seq, kind, trackIndex, startSec, speed) {
    if (!(speed > 0) || Math.abs(speed - 1) < 0.001) return true;
    try { app.enableQE(); } catch (e0) { return false; }
    var qeSeq = yorkcutQeSequence(seq.name);
    if (!qeSeq) return false;
    var track = null;
    try {
        track = kind === "video" ? qeSeq.getVideoTrackAt(trackIndex) : qeSeq.getAudioTrackAt(trackIndex);
    } catch (e1) { return false; }
    if (!track) return false;
    var qeClip = null;
    var i;
    var total = track.numItems;
    for (i = 0; i < total; i++) {
        var it = track.getItemAt(i);
        if (!it) continue;
        var typeName = "";
        try { typeName = String(it.type); } catch (eType) {}
        if (typeName === "Empty") continue;
        var start = 0;
        try { start = parseFloat(it.start.secs); } catch (eStart) { start = NaN; }
        if (isNaN(start)) {
            try { start = parseFloat(it.start.seconds); } catch (eStart2) { start = NaN; }
        }
        if (isNaN(start)) continue;
        if (Math.abs(start - startSec) < 0.2) { qeClip = it; break; }
    }
    if (!qeClip) return false;
    // QE 的 setSpeed 收的是「倍率」而不是百分数：1 = 100%。
    // 实测证据：计划 0.844（应减速到 84.4%）被按 speed*100 = 84.4 传进去后，时间轴上显示成 8440%（即 84.4 倍），
    // 片段被压成约 0.1s 的碎片 —— 表现就是"该减速的片段反而被加速几百倍"，以及"V1 上少了几段"（碎片肉眼看不见）。
    // 注：项目里所有历史副本都是 speed*100，所以这不是"以前对、后来改坏"，而是从一开始就传错了单位。
    var rate = speed;
    try {
        qeClip.setSpeed(rate, "", false, true, false);
        return true;
    } catch (e2) {}
    try {
        qeClip.setSpeed(rate);
        return true;
    } catch (e3) {}
    return false;
}

function yorkcutApplyMotion(clip, plan, log, videoLayer) {
    var scale = plan.motionScale || 100;
    var flip = !!plan.flip;
    if (!flip && Math.abs(scale - 100) < 0.5) return;
    var comp = yorkcutFindComponent(clip, ["AE.ADBE Motion", "AE.ADBE Geometry", "AE.ADBE Geometry2"], ["Motion", "运动", "变换"]);
    if (!comp) {
        log.push("未找到运动控件，跳过缩放/翻转：" + clip.name);
        return;
    }
    var prop = yorkcutFindProperty(comp, ["Scale", "缩放"]);
    if (prop && Math.abs(scale - 100) >= 0.5) {
        try { prop.setValue(scale, true); } catch (e1) {
            try { prop.setValue(scale, 1); } catch (e2) {}
        }
    }
    if (flip) {
        var width = yorkcutFindProperty(comp, ["Scale Width", "缩放宽度", "宽"]);
        if (width) {
            try { width.setValue(-100, true); return; } catch (e3) {}
        }
        if (!yorkcutAddEffect(clip, ["Horizontal Flip", "水平翻转"], videoLayer)) {
            log.push("翻转效果未加上：" + clip.name + "（中英文效果名都未匹配）");
        }
    }
}

function yorkcutAddEffect(clip, names, videoLayer) {
    try { app.enableQE(); } catch (e0) { return false; }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) return false;
    var effect = null;
    var n;
    for (n = 0; n < names.length; n++) {
        try {
            effect = qe.project.getVideoEffectByName(names[n]);
        } catch (e1) { effect = null; }
        if (effect) break;
    }
    if (!effect) return false;
    try {
        // ExtendScript 的 TrackItem 没有 parentTrackIndex 属性，旧代码里它恒为 undefined，
        // 于是 `|| 0` 让所有「水平翻转」都加到 V1 上。改用落轨时已知的层号。
        var li = Math.max(0, Number(videoLayer) || 0);
        var track = qeSeq.getVideoTrackAt(li);
        if (!track) return false;
        var i;
        for (i = 0; i < track.numItems; i++) {
            var it = track.getItemAt(i);
            if (!it || String(it.type) === "Empty") continue;
            var start = NaN;
            try { start = parseFloat(it.start.secs); } catch (eS1) {}
            if (isNaN(start)) {
                try { start = parseFloat(it.start.seconds); } catch (eS2) {}
            }
            if (Math.abs(start - clip.start.seconds) < 0.2) {
                it.addVideoEffect(effect);
                return true;
            }
        }
    } catch (e2) {}
    return false;
}

function yorkcutFindComponent(clip, matchNames, displayNames) {
    var comps = clip.components;
    if (!comps) return null;
    var i;
    for (i = 0; i < comps.numItems; i++) {
        var comp = comps[i];
        var match = "";
        var display = "";
        try { match = String(comp.matchName); } catch (e1) {}
        try { display = String(comp.displayName); } catch (e2) {}
        if (yorkcutInList(match, matchNames) || yorkcutInList(display, displayNames)) return comp;
    }
    return null;
}

function yorkcutFindProperty(comp, names) {
    var props = comp.properties;
    if (!props) return null;
    var i;
    for (i = 0; i < props.numItems; i++) {
        var display = "";
        try { display = String(props[i].displayName); } catch (e1) {}
        if (yorkcutInList(display, names)) return props[i];
    }
    return null;
}

function yorkcutInList(value, list) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === value) return true;
    return false;
}

function yorkcutStrayAudio(seq, path, startSec) {
    var hits = [];
    var key = yorkcutNorm(path);
    var ti, ci;
    for (ti = 0; ti < seq.audioTracks.numTracks; ti++) {
        var clips = seq.audioTracks[ti].clips;
        for (ci = 0; ci < clips.numItems; ci++) {
            var clip = clips[ci];
            if (Math.abs(clip.start.seconds - startSec) > 0.25) continue;
            var media = "";
            try { media = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e1) {}
            if (yorkcutNorm(media) === key) hits.push(clip);
        }
    }
    return hits;
}

/** 口播 mp4 落 A 轨时，Premiere 可能联接把画面写到 V —— 收集待删 */
function yorkcutStrayVideo(seq, path, startSec) {
    var hits = [];
    var key = yorkcutNorm(path);
    var ti, ci;
    for (ti = 0; ti < seq.videoTracks.numTracks; ti++) {
        var clips = seq.videoTracks[ti].clips;
        for (ci = 0; ci < clips.numItems; ci++) {
            var clip = clips[ci];
            if (Math.abs(clip.start.seconds - startSec) > 0.25) continue;
            var media = "";
            try { media = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e1) {}
            if (yorkcutNorm(media) === key) hits.push({ clip: clip, track: ti });
        }
    }
    return hits;
}

function yorkcutClipPresenceKey(clip, trackHint) {
    var media = "";
    var start = 0;
    try { start = clip.start.seconds; } catch (e0) {}
    try { media = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e1) {}
    return String(trackHint) + "|" + (Math.round(start * 100) / 100) + "|" + yorkcutNorm(media);
}

function yorkcutVideoPresenceKeys(seq) {
    var keys = {};
    var ti, ci;
    for (ti = 0; ti < seq.videoTracks.numTracks; ti++) {
        var clips = seq.videoTracks[ti].clips;
        for (ci = 0; ci < clips.numItems; ci++) {
            keys[yorkcutClipPresenceKey(clips[ci], ti)] = true;
        }
    }
    return keys;
}

function yorkcutAudioPresenceKeys(seq) {
    var keys = {};
    var ti, ci;
    for (ti = 0; ti < seq.audioTracks.numTracks; ti++) {
        var clips = seq.audioTracks[ti].clips;
        for (ci = 0; ci < clips.numItems; ci++) {
            var clip = clips[ci];
            keys[yorkcutClipPresenceKey(clip, ti)] = true;
            var start = 0;
            var media = "";
            try { start = clip.start.seconds; } catch (e0) {}
            try { media = clip.projectItem ? clip.projectItem.getMediaPath() : ""; } catch (e1) {}
            keys[(Math.round(start * 100) / 100) + "|" + yorkcutNorm(media)] = true;
        }
    }
    return keys;
}

function yorkcutRemoveClips(clips) {
    var i;
    for (i = clips.length - 1; i >= 0; i--) {
        try { clips[i].remove(false, false); } catch (e1) {
            try { clips[i].remove(false); } catch (e2) {}
        }
    }
}

function yorkcutUntargetAudio(seq) {
    var i;
    try {
        for (i = 0; i < seq.audioTracks.numTracks; i++) seq.audioTracks[i].setTargeted(false, true);
    } catch (e1) {}
}

function yorkcutUntargetVideo(seq) {
    var i;
    try {
        for (i = 0; i < seq.videoTracks.numTracks; i++) seq.videoTracks[i].setTargeted(false, true);
    } catch (e1) {}
}

function yorkcutTargetOnlyVideo(seq, layer) {
    yorkcutUntargetAudio(seq);
    yorkcutUntargetVideo(seq);
    try {
        if (layer >= 0 && layer < seq.videoTracks.numTracks) {
            seq.videoTracks[layer].setTargeted(true, true);
        }
    } catch (e1) {}
}

function yorkcutTargetOnlyAudio(seq, trackIndex) {
    yorkcutUntargetVideo(seq);
    yorkcutUntargetAudio(seq);
    try {
        if (trackIndex >= 0 && trackIndex < seq.audioTracks.numTracks) {
            seq.audioTracks[trackIndex].setTargeted(true, true);
        }
    } catch (e1) {}
}

function yorkcutEnsureTrackCount(seq, videoCount, audioCount, log) {
    var addV = videoCount - seq.videoTracks.numTracks;
    var addA = audioCount - seq.audioTracks.numTracks;
    if (addV < 0) addV = 0;
    if (addA < 0) addA = 0;
    if (!addV && !addA) return;
    try {
        app.enableQE();
        var qeSeq = yorkcutQeSequence(seq.name);
        if (qeSeq && qeSeq.addTracks) {
            qeSeq.addTracks(addV, addA, 0);
            return;
        }
    } catch (err) {}
    if (seq.audioTracks.numTracks < 2) log.push("序列音轨少于 2 条，音效可能和口播叠在同一轨。");
}

function yorkcutQeSequence(name) {
    var i;
    try {
        var total = qe.project.numSequences;
        for (i = 0; i < total; i++) {
            var seq = qe.project.getSequenceAt(i);
            if (seq && seq.name === name) return seq;
        }
    } catch (e1) {}
    try { return qe.project.getActiveSequence(); } catch (e2) { return null; }
}

function yorkcutMeasureBatch(pending, bin, log) {
    var out = {};
    if (!pending.length) return out;
    var seq = app.project.createNewSequenceFromClips(yorkcutUniqueName("YorkCut_时长探针"), [pending[0].item], bin);
    if (!seq) {
        log.push("无法建立时长探针序列，部分素材时长为 0。");
        return out;
    }
    var i;
    for (i = 0; i < pending.length; i++) {
        yorkcutClearSequence(seq);
        var track = yorkcutProbeTrack(seq, pending[i].path);
        if (!track) continue;
        // 音频优先素材原长；仅视频再回落到时间轴测量
        var fromItem = yorkcutItemDuration(pending[i].item);
        if (fromItem > 0.01 && yorkcutIsAudioPath(pending[i].path)) {
            out[pending[i].path] = fromItem;
            continue;
        }
        var placed = yorkcutOverwrite(track, pending[i].item, 0);
        if (!placed) continue;
        var dur = fromItem;
        try {
            var tl = placed.end.seconds - placed.start.seconds;
            if (tl > dur) dur = tl;
        } catch (e1) {}
        try {
            var src = placed.outPoint.seconds - placed.inPoint.seconds;
            if (src > 0.01 && (dur <= 0.01 || Math.abs(src - dur) < 0.25)) dur = src;
        } catch (e2) {}
        if (dur > 0.01) out[pending[i].path] = dur;
    }
    yorkcutClearSequence(seq);
    try {
        if (app.project.deleteSequence) app.project.deleteSequence(seq);
    } catch (eDel) {
        log.push("时长探针序列已留在素材箱，可手动删除。");
    }
    return out;
}

function yorkcutIsAudioPath(path) {
    var lower = String(path).toLowerCase();
    var exts = [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"];
    var i;
    for (i = 0; i < exts.length; i++) {
        if (lower.length >= exts[i].length && lower.lastIndexOf(exts[i]) === lower.length - exts[i].length) return true;
    }
    return false;
}

function yorkcutProbeTrack(seq, path) {
    var audio = yorkcutIsAudioPath(path);
    if (!audio && seq.videoTracks.numTracks) return seq.videoTracks[0];
    if (seq.audioTracks.numTracks) return seq.audioTracks[0];
    if (seq.videoTracks.numTracks) return seq.videoTracks[0];
    return null;
}

function yorkcutItemDuration(item) {
    // 优先媒体元数据时长（素材原长），避免用时间轴落点时长被序列帧率取整
    try {
        var md = String(item.getProjectMetadata());
        var match = md.match(/MediaDuration">(\d+)/);
        if (!match) match = md.match(/<MediaDuration>(\d+)<\/MediaDuration>/);
        if (match) {
            var ticks = parseFloat(match[1]);
            if (ticks > 1000000) {
                var fromMeta = ticks / YORKCUT_TICKS;
                if (fromMeta > 0.01) return fromMeta;
            }
        }
    } catch (eMeta) {}
    try {
        if (item.getMediaPath && item.getOutPoint && item.getInPoint) {
            var inn = item.getInPoint();
            var out = item.getOutPoint();
            // 若工程里被裁过入出点，用全长：有的版本 getOutPoint 已是媒体尾
            if (out && inn && out.seconds > inn.seconds + 0.01) return out.seconds - inn.seconds;
        }
    } catch (e1) {}
    try {
        var inn2 = item.getInPoint();
        var out2 = item.getOutPoint();
        if (out2 && inn2 && out2.seconds > inn2.seconds + 0.01) return out2.seconds - inn2.seconds;
    } catch (e2) {}
    return 0;
}

function yorkcutImportAll(paths, bin, log) {
    var map = yorkcutIndexMedia(app.project.rootItem, {});
    var missing = [];
    var i;
    for (i = 0; i < paths.length; i++) {
        var key = yorkcutNorm(paths[i]);
        if (map[key]) continue;
        missing.push(paths[i]);
    }
    var start = 0;
    while (start < missing.length) {
        var chunk = [];
        var end = start + 40;
        if (end > missing.length) end = missing.length;
        for (i = start; i < end; i++) chunk.push(missing[i]);
        try {
            bin.select();
            app.project.importFiles(chunk, 1, bin, 0);
        } catch (err) {
            log.push("导入失败：" + err);
        }
        start = end;
    }
    if (missing.length) {
        // 只重扫一次工程索引，避免每个文件递归查找
        map = yorkcutIndexMedia(app.project.rootItem, {});
        for (i = 0; i < missing.length; i++) {
            var k2 = yorkcutNorm(missing[i]);
            if (!map[k2]) log.push("导入后仍找不到：" + missing[i]);
        }
    }
    return map;
}

/** Index project media path -> ProjectItem */
function yorkcutIndexMedia(node, map) {
    if (!map) map = {};
    if (!node || !node.children) return map;
    var i;
    for (i = 0; i < node.children.numItems; i++) {
        var child = node.children[i];
        if (child.type === ProjectItemType.BIN || child.type === ProjectItemType.ROOT) {
            yorkcutIndexMedia(child, map);
        } else {
            var media = "";
            try { media = child.getMediaPath(); } catch (e1) { media = ""; }
            if (media) map[yorkcutNorm(media)] = child;
        }
    }
    return map;
}

function yorkcutFindByPath(node, key) {
    var map = yorkcutIndexMedia(node, {});
    return map[key] || null;
}

function yorkcutCollectPaths(edl) {
    var list = [];
    var seen = {};
    var sequences = edl.sequences || [];
    var s, c;
    for (s = 0; s < sequences.length; s++) {
        var clips = sequences[s].clips || [];
        for (c = 0; c < clips.length; c++) {
            var path = clips[c].path;
            if (!path || seen[yorkcutNorm(path)]) continue;
            seen[yorkcutNorm(path)] = true;
            list.push(path);
        }
        if (sequences[s].captionPath && !seen[yorkcutNorm(sequences[s].captionPath)]) {
            // 只登记"见过"，不要加进导入列表：
            // .srt 不是媒体文件，app.project.importFiles() 会弹「因文件头错误而不能打开」并抛异常。
            // 字幕只由 yorkcutImportCaptions() 通过 seq.importCaptions() 上轨。
            seen[yorkcutNorm(sequences[s].captionPath)] = true;
        }
    }
    return list;
}

function yorkcutEnsureBin(parent, name) {
    var i;
    for (i = 0; i < parent.children.numItems; i++) {
        var child = parent.children[i];
        if (child.name === name && (child.type === ProjectItemType.BIN || child.type === ProjectItemType.ROOT)) return child;
    }
    return parent.createBin(name);
}

function yorkcutClearSequence(seq) {
    yorkcutClearTrackList(seq.videoTracks);
    yorkcutClearTrackList(seq.audioTracks);
}

function yorkcutClearTrackList(tracks) {
    var t, c;
    for (t = 0; t < tracks.numTracks; t++) {
        var clips = tracks[t].clips;
        for (c = clips.numItems - 1; c >= 0; c--) {
            try { clips[c].remove(false, false); } catch (e1) {}
        }
    }
}

function yorkcutSequenceDuration(seq) {
    var maxEnd = 0;
    maxEnd = yorkcutTrackEnd(seq.videoTracks, maxEnd);
    maxEnd = yorkcutTrackEnd(seq.audioTracks, maxEnd);
    try {
        if (seq.end && seq.end.seconds > maxEnd) maxEnd = seq.end.seconds;
    } catch (e1) {}
    return maxEnd;
}

function yorkcutTrackEnd(tracks, maxEnd) {
    var t, c;
    for (t = 0; t < tracks.numTracks; t++) {
        var clips = tracks[t].clips;
        for (c = 0; c < clips.numItems; c++) {
            try {
                if (clips[c].end.seconds > maxEnd) maxEnd = clips[c].end.seconds;
            } catch (e1) {}
        }
    }
    return maxEnd;
}

function yorkcutSequenceFps(seq) {
    try {
        var frame = seq.getSettings().videoFrameRate;
        if (frame && frame.seconds > 0) {
            var fps = Math.round(1 / frame.seconds);
            if (fps >= 1 && fps <= 240) return fps;
        }
    } catch (e1) {}
    return 30;
}

function yorkcutUniqueName(base) {
    var used = {};
    var i;
    for (i = 0; i < app.project.sequences.numSequences; i++) used[app.project.sequences[i].name] = true;
    if (!used[base]) return base;
    var n = 2;
    while (used[base + "_" + n]) n++;
    return base + "_" + n;
}

function yorkcutRestoreSequence(sequenceId) {
    if (!sequenceId) return;
    try { app.project.openSequence(sequenceId); } catch (e1) {}
}

function yorkcutNorm(path) {
    return String(path || "").replace(/\\/g, "/").toLowerCase();
}

function yorkcutReadJson(path) {
    var file = new File(path);
    file.encoding = "UTF-8";
    if (!file.exists) throw new Error("找不到计划文件：" + path);
    if (!file.open("r")) throw new Error("无法读取计划文件：" + path);
    var text = file.read();
    file.close();
    if (text.charCodeAt(0) === 65279) text = text.substring(1);
    return eval("(" + text + ")");
}

function yorkcutResultPath(jsonPath) {
    var dot = String(jsonPath).lastIndexOf(".");
    if (dot < 0) return String(jsonPath) + ".result.json";
    return String(jsonPath).substring(0, dot) + ".result.json";
}

function yorkcutFinish(jsonPath, payload) {
    var text = yorkcutStringify(payload);
    try {
        var out = new File(yorkcutResultPath(jsonPath));
        out.encoding = "UTF-8";
        if (out.open("w")) {
            out.write(text);
            out.close();
            return yorkcutStringify({ ok: true, resultPath: yorkcutResultPath(jsonPath) });
        }
    } catch (err) {}
    return text;
}

function yorkcutStringify(value) {
    if (value === null || typeof value === "undefined") return "null";
    var kind = typeof value;
    if (kind === "number") return isFinite(value) ? String(value) : "null";
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "string") return yorkcutQuote(value);
    if (value instanceof Array) {
        var parts = [];
        var i;
        for (i = 0; i < value.length; i++) parts.push(yorkcutStringify(value[i]));
        return "[" + parts.join(",") + "]";
    }
    var fields = [];
    for (var key in value) {
        if (!value.hasOwnProperty(key)) continue;
        if (typeof value[key] === "undefined" || typeof value[key] === "function") continue;
        fields.push(yorkcutQuote(key) + ":" + yorkcutStringify(value[key]));
    }
    return "{" + fields.join(",") + "}";
}

function yorkcutQuote(text) {
    var out = "\"";
    var s = String(text);
    var i;
    for (i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === "\\") out += "\\\\";
        else if (ch === "\"") out += "\\\"";
        else if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += ch;
    }
    return out + "\"";
}
