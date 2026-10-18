// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
/**
 * 多轨成片规划：多口播并行（最长或主口播为标尺），多画面整段叠满。
 */
(function (root, factory) {
    var api = factory(root.YorkCutPicker || require("./picker.js"));
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.YorkCutEdit = api;
})(typeof window !== "undefined" ? window : globalThis, function (picker) {
    var VIDEO_EXTS = [".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".webm"];
    var PURE_AUDIO_EXTS = [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"];
    /** 画面池才收视频。声音轨只收纯音频，视频要先抽出 wav。 */
    var AUDIO_POOL_EXTS = PURE_AUDIO_EXTS.concat(VIDEO_EXTS);
    var IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"];
    // 文案素材只收 .txt（.srt 已禁用：它自带时间码，会把字幕/高光顶到段外并拉长成片）
    var TEXT_EXTS = [".txt"];
    // 这些扩展名不再当文案用，但必须仍被认成"文本类"，
    // 否则会被当成媒体送进时长探针 → Premiere 弹「导入程序报一般错误」并卡住。
    var BLOCKED_TEXT_EXTS = [".srt", ".ass", ".vtt"];
    var TYPE_EXTS = {
        video: VIDEO_EXTS,
        voice: PURE_AUDIO_EXTS,
        sfx: PURE_AUDIO_EXTS,
        bgm: PURE_AUDIO_EXTS,
        sub: TEXT_EXTS,
        subHl: TEXT_EXTS
    };
    var AUDIO_EXTS = PURE_AUDIO_EXTS;
    var BGM_EXTS = PURE_AUDIO_EXTS;

    /**
     * 是否为文本类素材（字幕 / 高光）。
     * 文本没有"媒体时长"这一概念，绝不能进探针队列 —— 探针会把它当媒体导入 Premiere，
     * 结果是 Premiere 弹「文件导入失败：因文件头错误而不能打开」，并让整次生成失败。
     */
    function isTextPath(path) {
        var lower = String(path == null ? "" : path).toLowerCase();
        var i, ext;
        for (i = 0; i < TEXT_EXTS.length; i++) {
            ext = TEXT_EXTS[i];
            if (lower.length >= ext.length && lower.lastIndexOf(ext) === lower.length - ext.length) return true;
        }
        for (i = 0; i < BLOCKED_TEXT_EXTS.length; i++) {
            ext = BLOCKED_TEXT_EXTS[i];
            if (lower.length >= ext.length && lower.lastIndexOf(ext) === lower.length - ext.length) return true;
        }
        return false;
    }

    function planBatch(spec) {
        var rng = spec.random || Math.random;
        var fps = Number(spec.fps) || 30;
        var count = Math.max(1, Number(spec.count) || 1);
        var rawRows = spec.rows || [];
        var baseLibs = normalizeLibraries(spec.libraries || [], rawRows);
        var expanded = expandRowsAndLibraries(rawRows, baseLibs);
        var rows = expanded.rows;
        var libraries = expanded.libraries;
        var durations = spec.durations || {};
        var used = {};
        var sequences = [];
        var warnings = [];
        var missingPaths = [];
        var enforce24 = spec.enforce24fps !== false;
        var dedupeMode = spec.dedupeMode || "off";
        var dedupeMax = Math.max(1, Number(spec.dedupeMax) || 1);
        var transition = spec.transition || { mode: "off" };
        // 抽签池健康度（修复「多条序列抽到完全相同素材」）：
        // 同一轨至少攒到 MIN_TIMED 个「已测时长」候选才允许抽签；不足则先请求探针。
        // 探针超过 RELAX_AFTER 轮后放宽为 1，保证「素材时长测不出来」时仍能像以前一样出片，
        // 因此不会新增失败路径，只是首次生成会多探几轮（之后走时长缓存）。
        var planAttempt = Math.max(0, Number(spec.planAttempt) || 0);
        var minTimedTarget = planAttempt >= 6 ? 1 : 5;

        for (var n = 0; n < count; n++) {
            var seqUsed = dedupeMode === "sequence" ? {} : used;
            var planned = planSequence({
                rows: rows,
                libraries: libraries,
                durations: durations,
                fps: fps,
                name: sequenceName(spec.nameBase || "YorkCut", n + 1),
                used: seqUsed,
                dedupeMode: dedupeMode,
                dedupeMax: dedupeMax,
                random: rng,
                warnings: warnings,
                enforce24fps: enforce24,
                texts: spec.texts || {},
                missingPaths: missingPaths,
                minTimedTarget: minTimedTarget,
                transition: transition
            });
            if (planned.error) {
                return {
                    ok: false,
                    error: planned.error,
                    warnings: warnings,
                    sequences: sequences,
                    missingPaths: uniqPaths(missingPaths),
                    needProbe: missingPaths.length > 0
                };
            }
            if (planned.sequence) sequences.push(planned.sequence);
        }
        if (!sequences.length) {
            return {
                ok: false,
                error: "没有可生成的片段。请至少配置口播或画面文件夹。",
                warnings: warnings,
                sequences: [],
                missingPaths: uniqPaths(missingPaths),
                needProbe: missingPaths.length > 0
            };
        }
        return { ok: true, sequences: sequences, warnings: warnings, missingPaths: [] };
    }

    function uniqPaths(list) {
        var out = [];
        var seen = {};
        for (var i = 0; i < (list || []).length; i++) {
            var p = list[i];
            if (!p) continue;
            var k = pathKey(p);
            if (seen[k]) continue;
            seen[k] = true;
            out.push(p);
        }
        return out;
    }

    function noteMissing(opts, abs) {
        if (!opts || !opts.missingPaths || !abs) return;
        opts.missingPaths.push(abs);
    }

    function sequenceName(base, index) {
        return String(base || "YorkCut") + "-" + index;
    }

    function expandRowsAndLibraries(rows, libraries) {
        var outRows = [];
        var outLibs = [];
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var lib = libraries[i] || { tracks: [] };
            var repeat = Math.max(1, Number(row.repeat) || 1);
            for (var r = 0; r < repeat; r++) {
                outRows.push(row);
                outLibs.push(r === 0 ? lib : cloneLib(lib));
            }
        }
        return { rows: outRows, libraries: outLibs };
    }

    function cloneLib(lib) {
        return { tracks: (lib.tracks || []).map(function (t) {
            return {
                id: t.id, type: t.type, root: t.root, rels: (t.rels || []).slice(),
                strategy: t.strategy, isMainVoice: !!t.isMainVoice
            };
        }) };
    }

    function planSequence(opts) {
        var rows = opts.rows;
        var currentTime = 0;
        var clips = [];
        var captionCues = [];
        var highlightCues = [];
        var shotIndex = 0;
        var bgmStates = {};
        var bgmBlocks = [];
        var any = false;
        var videoLayerCount = 0;
        var voiceSlotCount = 0;
        var sfxSlotCount = 0;
        var bgmSlotCount = 0;

        for (var r = 0; r < rows.length; r++) {
            var row = normalizeRow(rows[r]);
            var libTracks = (opts.libraries[r] && opts.libraries[r].tracks) || [];
            var voiceLibs = filterLibs(libTracks, "voice");
            var videoLibs = filterLibs(libTracks, "video");
            var sfxLibs = filterLibs(libTracks, "sfx");
            var bgmLibs = filterLibs(libTracks, "bgm");
            var subLibs = filterLibs(libTracks, "sub").concat(filterLibs(libTracks, "subHl"));

            // 段级配置提示：这样"段数 6 却只生成 5 段"能在日志里直接看到原因
            if (opts.warnings) {
                if (!voiceLibs.length && !videoLibs.length && !sfxLibs.length && !subLibs.length) {
                    opts.warnings.push("第 " + (r + 1) + " 段没有配置任何文件夹（口播/画面/音效/字幕/高光都为空），这一段会被跳过");
                } else if (!voiceLibs.length) {
                    opts.warnings.push("第 " + (r + 1) + " 段没有口播文件夹：这一段没有口播时长基准，字幕/高光会按画面长度铺");
                }
            }

            var voiceLayers = [];
            var voiceDur = 0;
            var hasVoice = false;
            var mainVoiceDur = 0;
            var hasMain = false;

            for (var vi = 0; vi < voiceLibs.length; vi++) {
                var missBefore = (opts.missingPaths && opts.missingPaths.length) || 0;
                var vp = takeTrack(voiceLibs[vi], AUDIO_EXTS, 1, row.unique, opts);
                if (!vp.length) {
                    if (opts.missingPaths && opts.missingPaths.length > missBefore) {
                        return { error: "NEED_PROBE" };
                    }
                    if (folderMissingDuration(voiceLibs[vi], AUDIO_EXTS, opts)) {
                        return { error: "NEED_PROBE" };
                    }
                    continue;
                }
                var slot = vi;
                if (slot + 1 > voiceSlotCount) voiceSlotCount = slot + 1;
                voiceLayers.push({ pick: vp[0], slot: slot, isMain: !!voiceLibs[vi].isMainVoice });
                if (vp[0].duration > voiceDur) voiceDur = vp[0].duration;
                if (voiceLibs[vi].isMainVoice) {
                    hasMain = true;
                    mainVoiceDur = vp[0].duration;
                }
                hasVoice = true;
            }
            if (hasMain && mainVoiceDur > 0) voiceDur = mainVoiceDur;

            var videoLayers = [];
            for (var y = 0; y < videoLibs.length; y++) {
                var picked = pickVideos(videoLibs[y], row, hasVoice, voiceDur, opts);
                if (picked.error) return { error: picked.error };
                if (!picked.clips.length) continue;
                var layer = y;
                if (layer + 1 > videoLayerCount) videoLayerCount = layer + 1;
                videoLayers.push({ clips: picked.clips, layer: layer });
            }

            var sfxLayers = [];
            for (var s = 0; s < sfxLibs.length; s++) {
                var sc = Math.min(Math.max(1, Number(row.ext) || 1), (sfxLibs[s].rels || []).length || 1);
                if (row.unique || (opts.dedupeMode && opts.dedupeMode !== "off")) {
                    sc = Math.min(sc, countUnused(sfxLibs[s], AUDIO_EXTS, opts.used, opts));
                }
                var missSfx = (opts.missingPaths && opts.missingPaths.length) || 0;
                var sp = sc > 0 ? takeTrack(sfxLibs[s], AUDIO_EXTS, sc, row.unique, opts) : [];
                if (!sp.length) {
                    // 与口播一致：如果这次是"池子太小、先把未测时长交给探针"被拦下的，
                    // 必须请求探针。否则 takeTrack 返回空会被这里静默 continue，
                    // 音效轨就变成空轨，而且永远抽不到新素材。
                    if (opts.missingPaths && opts.missingPaths.length > missSfx) {
                        return { error: "NEED_PROBE" };
                    }
                    continue;
                }
                if (s + 1 > sfxSlotCount) sfxSlotCount = s + 1;
                sfxLayers.push({ picks: sp, slot: s });
            }

            var baseVideoClips = videoLayers.length ? videoLayers[0].clips : [];
            var videoSum = sumClipDur(baseVideoClips);
            var rowRuler = 0;
            if (hasVoice && voiceDur > 0) rowRuler = voiceDur;
            else if (videoSum > 0) rowRuler = videoSum;
            if (rowRuler <= 0) {
                if (opts.missingPaths && opts.missingPaths.length) return { error: "NEED_PROBE" };
                continue;
            }
            any = true;

            for (var vli = 0; vli < voiceLayers.length; vli++) {
                var voice = voiceLayers[vli].pick;
                clips.push(makeClip("voice", voice, currentTime, voice.duration, 0, voice.duration, 1, {
                    audioSlot: voiceLayers[vli].slot
                }));
            }

            var rowShotBase = shotIndex;
            for (var vl = 0; vl < videoLayers.length; vl++) {
                var cursor = currentTime;
                var vclips = videoLayers[vl].clips;
                for (var pi = 0; pi < vclips.length; pi++) {
                    var video = vclips[pi];
                    clips.push(makeClip("video", video, cursor, video.timelineDur, video.inPoint, video.sourceDur, video.speed, {
                        keepAudio: !!row.keepAudio,
                        flip: !!row.flip,
                        motionScale: row.crop ? round1(105 + opts.random() * 13) : 100,
                        shotIndex: vl === 0 ? shotIndex : rowShotBase + pi,
                        videoLayer: videoLayers[vl].layer
                    }));
                    cursor += video.timelineDur;
                    if (vl === 0) shotIndex += 1;
                }
            }

            for (var sl = 0; sl < sfxLayers.length; sl++) {
                var picks = sfxLayers[sl].picks;
                for (var si = 0; si < picks.length; si++) {
                    var logical = rowRuler;
                    var start = currentTime;
                    var idx = rowShotBase;
                    if (baseVideoClips.length && si < baseVideoClips.length) {
                        var offset = 0;
                        for (var b = 0; b < si; b++) offset += baseVideoClips[b].timelineDur;
                        start = currentTime + offset;
                        logical = baseVideoClips[si].timelineDur;
                        idx = rowShotBase + si;
                    }
                    clips.push(makeClip("sfx", picks[si], start, picks[si].duration, 0, picks[si].duration, 1, {
                        shotIndex: idx,
                        logicalDur: logical,
                        audioSlot: sfxLayers[sl].slot
                    }));
                }
            }

            for (var bi = 0; bi < bgmLibs.length; bi++) {
                if (bi + 1 > bgmSlotCount) bgmSlotCount = bi + 1;
                var key = String(bi);
                var rolled = rollBgm(bgmStates[key], bgmBlocks, bgmLibs[bi], row, rowRuler, currentTime, opts, bi);
                if (rolled && rolled.error) return { error: rolled.error };
                bgmStates[key] = rolled;
            }
            if (!bgmLibs.length) {
                Object.keys(bgmStates).forEach(function (key) {
                    if (bgmStates[key] && bgmStates[key].file) bgmStates[key].dur += rowRuler;
                });
            }

            for (var su = 0; su < subLibs.length; su++) {
                if (subLibs[su].type === "subHl") {
                    pushCues(highlightCues, subLibs[su], row, currentTime, rowRuler, true, opts);
                } else {
                    pushCues(captionCues, subLibs[su], row, currentTime, rowRuler, false, opts);
                }
            }

            currentTime += rowRuler;
        }

        if (!any || currentTime <= 0) return { sequence: null };
        applySfxTrim(clips);
        Object.keys(bgmStates).forEach(function (key) {
            if (bgmStates[key] && bgmStates[key].file && bgmStates[key].dur > 0) bgmBlocks.push(bgmStates[key]);
        });
        for (var bj = 0; bj < bgmBlocks.length; bj++) expandBgm(clips, bgmBlocks[bj], opts);

        // 配置了 BGM 槽却一张都没铺上 → 多半是时长未探针，强制走探针轮
        var bgmClipCount = 0;
        for (var bc = 0; bc < clips.length; bc++) {
            if (clips[bc].track === "bgm") bgmClipCount += 1;
        }
        if (bgmSlotCount > 0 && bgmClipCount === 0) {
            if (opts.missingPaths && opts.missingPaths.length) return { error: "NEED_PROBE" };
            return { error: "背景音已配置但未能铺轨（请确认文件夹内有音频或带声音的视频，并等待时长探针）。" };
        }

        // 字幕不再占用画面轨：它走 Premiere 原生字幕轨（C1），由宿主 Sequence.createCaptionTrack 生成。
        // 只有「高光」需要一层画面轨（MOGRT 图形）。
        var vLayers = Math.max(1, videoLayerCount);
        var highlightLayer = -1;
        if (highlightCues.length) {
            highlightLayer = vLayers;        // 高光图形放在画面层之上
            vLayers += 1;
        }

        // 再保险：有口播标尺的段，画面不得超出该段
        clampVideosToVoiceSegments(clips);
        // 按序列帧粘合：用整数帧累加，避免 round/ceil 混用露 1 帧缝
        currentTime = abutClipsToFps(clips, opts.fps);

        return {
            sequence: {
                name: opts.name,
                duration: currentTime,
                clips: clips,
                captionCues: captionCues,
                highlightCues: highlightCues,
                highlightLayer: highlightLayer,
                videoLayerCount: vLayers,
                voiceSlotCount: Math.max(0, voiceSlotCount),
                sfxSlotCount: Math.max(0, sfxSlotCount),
                bgmSlotCount: Math.max(0, bgmSlotCount),
                bgmClipCount: bgmClipCount,
                transition: opts.transition || { mode: "off" }
            }
        };
    }

    function normalizeRow(row) {
        return {
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

    function filterLibs(tracks, type) {
        var out = [];
        for (var i = 0; i < tracks.length; i++) {
            if (tracks[i] && tracks[i].type === type && tracks[i].root) out.push(tracks[i]);
        }
        return out;
    }

    function folderMissingDuration(lib, exts, opts) {
        if (!lib || !lib.root || !lib.rels) return false;
        var rels = filterExt(lib.rels, exts);
        if (!rels.length) return false;
        for (var i = 0; i < rels.length; i++) {
            if (lookupDur(opts.durations, absJoin(lib.root, rels[i])) > 0) return false;
        }
        return true;
    }

    function rollBgm(state, blocks, lib, row, rowRuler, rowStart, opts, slot) {
        var hasFolder = !!(lib && lib.root && lib.rels && lib.rels.length);
        if (!hasFolder) {
            if (state && state.file) state.dur += rowRuler;
            return state;
        }
        if (state && state.file && state.dur > 0) blocks.push(state);
        var missBefore = (opts.missingPaths && opts.missingPaths.length) || 0;
        var picks = takeTrack(lib, BGM_EXTS, 1, false, opts);
        if (!picks.length) {
            // 与口播一致：抽中却无时长 → 必须探针，禁止静默空 BGM
            if (opts.missingPaths && opts.missingPaths.length > missBefore) {
                return { error: "NEED_PROBE" };
            }
            if (folderMissingDuration(lib, BGM_EXTS, opts)) {
                return { error: "NEED_PROBE" };
            }
            return { file: "", dur: 0, loop: row.bgmLoop !== false, start: rowStart, mediaDur: 0, audioSlot: slot };
        }
        return {
            file: picks[0].path,
            dur: rowRuler,
            loop: row.bgmLoop !== false,
            start: rowStart,
            mediaDur: picks[0].duration,
            audioSlot: slot
        };
    }

    function expandBgm(clips, block, opts) {
        if (!block || !block.file || block.dur <= 0) return;
        var mediaDur = Number(block.mediaDur) || lookupDur(opts && opts.durations, block.file) || 0;
        if (mediaDur <= 0.05) {
            noteMissing(opts, block.file);
            return;
        }
        var cursor = block.start;
        var remain = block.dur;
        if (block.loop === false) {
            var use = Math.min(mediaDur, remain);
            clips.push({
                track: "bgm", path: block.file, timelineStart: cursor, timelineDur: use,
                inPoint: 0, sourceDur: use, speed: 1, audioSlot: block.audioSlot || 0, bgmLoop: false
            });
            return;
        }
        var guard = 0;
        while (remain > 0.05 && guard < 500) {
            var seg = Math.min(mediaDur, remain);
            clips.push({
                track: "bgm", path: block.file, timelineStart: cursor, timelineDur: seg,
                inPoint: 0, sourceDur: seg, speed: 1, audioSlot: block.audioSlot || 0, bgmLoop: true
            });
            cursor += seg;
            remain -= seg;
            guard += 1;
        }
    }

    function snapTime(sec, fps) {
        var f = Number(fps) || 0;
        if (!(f >= 1) || !(sec >= 0)) return Number(sec) || 0;
        return Math.round((Number(sec) || 0) * f) / f;
    }

    function toFrames(sec, fps) {
        var f = Number(fps) || 0;
        if (!(f >= 1)) return 0;
        return Math.round((Number(sec) || 0) * f);
    }

    function fromFrames(frames, fps) {
        var f = Number(fps) || 0;
        if (!(f >= 1)) return Number(frames) || 0;
        return (Number(frames) || 0) / f;
    }

    /** 按口播段把同起点画面裁到口播长（含片尾、含关闭对齐的溢出片） */
    function clampVideosToVoiceSegments(clips) {
        if (!clips || !clips.length) return;
        var rulers = {};
        var i;
        for (i = 0; i < clips.length; i++) {
            if (clips[i].track !== "voice") continue;
            var key = String(Math.round((Number(clips[i].timelineStart) || 0) * 1000) / 1000);
            var d = Number(clips[i].timelineDur) || 0;
            if (!rulers[key] || d > rulers[key]) rulers[key] = d;
        }
        for (i = 0; i < clips.length; i++) {
            if (clips[i].track !== "video") continue;
            var t = Number(clips[i].timelineStart) || 0;
            var rk = String(Math.round(t * 1000) / 1000);
            var ruler = rulers[rk];
            if (!(ruler > 0)) continue;
            var vd = Number(clips[i].timelineDur) || 0;
            if (vd > ruler + 0.0005) {
                clips[i].timelineDur = ruler;
                if (Math.abs((Number(clips[i].speed) || 1) - 1) < 0.001) {
                    clips[i].sourceDur = ruler;
                }
            }
        }
    }

    /**
     * 以口播段为骨架，用整数帧重排所有片段起点/时长，保证相邻段首尾同帧。
     * @returns {number} 序列总时长（秒）
     */
    function abutClipsToFps(clips, fps) {
        var f = Number(fps) || 0;
        if (!(f >= 1) || !clips || !clips.length) return 0;

        var segKeys = [];
        var segOld = {};
        var i;
        for (i = 0; i < clips.length; i++) {
            if (clips[i].track !== "voice") continue;
            var sk = String(Math.round((Number(clips[i].timelineStart) || 0) * 1000) / 1000);
            if (!segOld[sk]) {
                segOld[sk] = {
                    oldStart: Number(clips[i].timelineStart) || 0,
                    durFrames: toFrames(clips[i].timelineDur, f)
                };
                segKeys.push(sk);
            } else {
                var df = toFrames(clips[i].timelineDur, f);
                if (df > segOld[sk].durFrames) segOld[sk].durFrames = df;
            }
        }
        if (!segKeys.length) {
            for (i = 0; i < clips.length; i++) {
                clips[i].timelineStart = fromFrames(toFrames(clips[i].timelineStart, f), f);
                clips[i].timelineDur = Math.max(1, toFrames(clips[i].timelineDur, f)) / f;
                clips[i].inPoint = fromFrames(toFrames(clips[i].inPoint || 0, f), f);
                if (clips[i].sourceDur != null) {
                    clips[i].sourceDur = Math.max(1, toFrames(clips[i].sourceDur, f)) / f;
                }
            }
            var maxEnd = 0;
            for (i = 0; i < clips.length; i++) {
                var e = (Number(clips[i].timelineStart) || 0) + (Number(clips[i].timelineDur) || 0);
                if (e > maxEnd) maxEnd = e;
            }
            return maxEnd;
        }

        segKeys.sort(function (a, b) { return segOld[a].oldStart - segOld[b].oldStart; });
        var newStartFrame = {};
        var cursor = 0;
        for (i = 0; i < segKeys.length; i++) {
            var k = segKeys[i];
            newStartFrame[k] = cursor;
            var dfr = segOld[k].durFrames;
            if (dfr < 1) dfr = 1;
            segOld[k].durFrames = dfr;
            cursor += dfr;
        }

        for (i = 0; i < clips.length; i++) {
            var c = clips[i];
            var t0 = Number(c.timelineStart) || 0;
            var seg = segKeys[0];
            var s;
            for (s = 0; s < segKeys.length; s++) {
                if (segOld[segKeys[s]].oldStart <= t0 + 0.0005) seg = segKeys[s];
            }
            var offsetFrames = toFrames(t0 - segOld[seg].oldStart, f);
            if (offsetFrames < 0) offsetFrames = 0;
            var startF = newStartFrame[seg] + offsetFrames;
            var durF;
            if (c.track === "voice" || (c.track === "video" && offsetFrames === 0)) {
                // 段首画面/口播：铺满该段帧数
                durF = segOld[seg].durFrames - offsetFrames;
            } else {
                durF = toFrames(c.timelineDur, f);
            }
            if (c.track === "video" && offsetFrames === 0) {
                durF = segOld[seg].durFrames;
            }
            if (durF < 1) durF = 1;
            // 不得越过本段终点（同层画面）
            if (c.track === "video" || c.track === "voice" || c.track === "sfx") {
                var segEnd = newStartFrame[seg] + segOld[seg].durFrames;
                if (startF + durF > segEnd && (c.track === "voice" || c.track === "video")) {
                    durF = segEnd - startF;
                    if (durF < 1) durF = 1;
                }
            }
            c.timelineStart = fromFrames(startF, f);
            c.timelineDur = fromFrames(durF, f);
            c.inPoint = fromFrames(toFrames(c.inPoint || 0, f), f);
            if (c.sourceDur != null) {
                if (Math.abs((Number(c.speed) || 1) - 1) < 0.001) {
                    c.sourceDur = c.timelineDur;
                } else {
                    c.sourceDur = fromFrames(Math.max(1, toFrames(c.sourceDur, f)), f);
                }
            }
        }

        // BGM：从 0 铺到总长（非循环保持原长上限已在 expandBgm 处理）
        for (i = 0; i < clips.length; i++) {
            if (clips[i].track !== "bgm") continue;
            if (clips[i].bgmLoop === false) {
                clips[i].timelineStart = 0;
                var bgF = toFrames(clips[i].timelineDur, f);
                if (bgF < 1) bgF = 1;
                if (bgF > cursor) bgF = cursor;
                clips[i].timelineDur = fromFrames(bgF, f);
                if (Math.abs((Number(clips[i].speed) || 1) - 1) < 0.001) {
                    clips[i].sourceDur = clips[i].timelineDur;
                }
            } else {
                clips[i].timelineStart = fromFrames(toFrames(clips[i].timelineStart, f), f);
                clips[i].timelineDur = fromFrames(Math.max(1, toFrames(clips[i].timelineDur, f)), f);
            }
        }
        return fromFrames(cursor, f);
    }

    function pushCues(cues, lib, row, rowStart, rowDur, isHl, opts) {
        if (!lib || !lib.root || !lib.rels || !lib.rels.length) return;
        // 字幕 / 高光是文本文件，不能走 takeTrack：takeTrack 只接受"已测时长"的素材，
        // 文本永远拿不到时长 → 既抽不到字幕，还会把 .srt/.txt 记进 missingPaths，
        // 于是探针把它们当媒体导入 Premiere（"文件导入失败 / 因文件头错误而不能打开"）。
        // 这里按普通抽签直接取一个文本文件即可。
        var pools = openPool({ root: lib.root, rels: lib.rels, strategy: lib.strategy }, TEXT_EXTS, false, opts);
        if (!pools.unique.length) return;
        var picked = picker.pickSmartMedia(pools.unique, pools.raw, 1, false, opts.random);
        if (!picked.length) return;
        var file = { path: absJoin(lib.root, picked[0]) };
        var text = opts.texts ? opts.texts[file.path] : "";
        if (!text) {
            if (opts.warnings) {
                var nm = String(file.path).split(/[\\/]/).pop();
                opts.warnings.push((isHl ? "高光" : "字幕") + "文件内容为空或读不到：" + nm +
                    "（这一轨不会有" + (isHl ? "高光" : "字幕") + "）");
            }
            return;
        }
        var lower = file.path.toLowerCase();
        if (lower.lastIndexOf(".srt") === lower.length - 4) {
            // .srt 已被禁用（只支持 .txt）。留这条只为兼容老配置，且不再使用它的时间码：
            // 按纯文本处理，避免把 SRT 时间码当成字幕节奏铺出去（那会把片段顶到段外、拉长成片）。
            var srtLines = text.split(/\r?\n/).map(function (line) { return line.replace(/^\s+|\s+$/g, ""); })
                .filter(function (line) { return line && !/^\d+$/.test(line) && line.indexOf("-->") < 0; });
            if (!srtLines.length) return;
            pushOneCue(cues, srtLines, rowStart, rowDur, isHl);
            return;
        }
        var lines = textLines(text);
        if (!lines.length) return;
        pushOneCue(cues, lines, rowStart, rowDur, isHl);
    }

    /**
     * 拆行：只裁掉「首尾」空行，**保留中间的空行**（空行是排版，要原样留在这条字幕里）。
     */
    function textLines(raw) {
        var arr = String(raw == null ? "" : raw).split(/\r?\n/);
        var out = [];
        var i;
        for (i = 0; i < arr.length; i++) {
            out.push(arr[i].replace(/^\s+|\s+$/g, ""));
        }
        while (out.length && !out[0]) out.shift();
        while (out.length && !out[out.length - 1]) out.pop();
        return out;
    }

    /**
     * 一个 .txt = 一条 cue（内部保留换行与空行），时长 = 本段口播时长。
     * 用 \r 作换行符：Premiere 的文本引擎（MOGRT 文本参数、字幕导入）习惯用回车分行。
     */
    function pushOneCue(cues, lines, rowStart, rowDur, isHl) {
        var span = Number(rowDur) > 0.05 ? Number(rowDur) : 1;
        cues.push({
            start: rowStart,
            end: rowStart + span,
            text: lines.join("\r"),
            highlight: isHl
        });
    }

    function preferTimedRels(root, rels, durations) {
        var timed = [];
        var untimed = [];
        for (var i = 0; i < (rels || []).length; i++) {
            if (lookupDur(durations, absJoin(root, rels[i])) > 0) timed.push(rels[i]);
            else untimed.push(rels[i]);
        }
        return { timed: timed, untimed: untimed, ordered: timed.concat(untimed) };
    }

    /**
     * 池子健康检查：同一轨「已测时长」候选太少时，把尚未测时长的候选交给探针并请求重抽。
     *
     * 为什么必须这样：抽签循环是从候选序列里取「第一个已测时长的文件」，
     * 所以只要池子里已有 1 个已测文件，它就会被永久选中 —— 候选池被压缩成 1 个元素，
     * 于是 count 条序列必然拿到完全相同的素材（日志里表现为探了几个文件，成片就是那几个）。
     * 这里先把已测候选攒到 minTimedTarget 个，再开始抽签，池子才真正有随机性。
     *
     * @returns {boolean} true 表示「本轮不该抽签，应先探针」
     */
    function timedPoolTooSmall(root, pref, opts) {
        var target = Number(opts && opts.minTimedTarget);
        if (!(target > 1)) return false;              // 放宽阶段：保持原有行为
        if (!pref.untimed.length) return false;       // 没有可测的素材了，不能空转
        var want = Math.min(target, pref.ordered.length);
        if (pref.timed.length >= want) return false;
        var room = 6;                                 // 一轮最多记 6 条，避免把整夹塞进 missingPaths
        var noted = 0;
        for (var i = 0; i < pref.untimed.length && room > 0; i++) {
            var abs = absJoin(root, pref.untimed[i]);
            // 文本类（字幕/高光）没有媒体时长，永远不该进探针队列；
            // 若一条都没记下（例如这一轨全是文本），必须返回 false，
            // 否则会一直请求探针又给不出待测文件，形成空转循环。
            if (isTextPath(abs)) continue;
            noteMissing(opts, abs);
            noted += 1;
            room -= 1;
        }
        return noted > 0;
    }

    function pickVideos(lib, row, hasVoice, voiceDur, opts) {
        // 全库池抽签；优先已测时长，避免未测文件抢占去重名额 / 污染探针列表
        var pools = openPool(lib, VIDEO_EXTS, row.unique, opts);
        if (!pools.unique.length) return { clips: [] };
        var enforce24 = opts.enforce24fps !== false;
        var pref = preferTimedRels(lib.root, pools.unique, opts.durations);
        // 池子太小就先补时长再抽，否则每轨只剩 1 个候选，所有序列都会抽到同一个文件
        if (timedPoolTooSmall(lib.root, pref, opts)) {
            return { error: "NEED_PROBE", missing: true };
        }
        if (!hasVoice) {
            var pickPool = pref.timed.length ? pref.timed : pools.unique;
            var pickRaw = pref.timed.length ? pref.timed.slice() : pools.raw;
            var count = Math.min(Math.max(1, Number(row.ext) || 1), pickPool.length);
            var rels = picker.pickSmartMedia(pickPool, pickRaw, count, !!row.unique, opts.random);
            var nativeClips = [];
            var okRels = [];
            for (var ni = 0; ni < rels.length; ni++) {
                var nativePath = absJoin(lib.root, rels[ni]);
                var nativeDur = lookupDur(opts.durations, nativePath);
                if (!(nativeDur > 0)) {
                    noteMissing(opts, nativePath);
                    continue;
                }
                okRels.push(rels[ni]);
                nativeClips.push({ path: nativePath, timelineDur: nativeDur, inPoint: 0, sourceDur: nativeDur, speed: 1, duration: nativeDur });
            }
            claim(lib.root, okRels, row.unique, opts.used, opts);
            if (!nativeClips.length && rels.length) {
                return { error: "NEED_PROBE", missing: true };
            }
            return { clips: nativeClips };
        }

        var order = pref.ordered.slice();
        if (!row.unique && pref.timed.length) {
            order = pref.timed.slice();
            if (order.length > 1) order = picker.shuffle(order, opts.random);
            order = order.concat(pref.untimed);
        } else if (!row.unique) {
            order = picker.shuffle(order, opts.random);
        }
        var threshold = 24 / (Number(opts.fps) || 30);
        var sawTimed = false;
        var sawUntimed = false;
        var noted = 0;
        for (var i = 0; i < order.length; i++) {
            var path = absJoin(lib.root, order[i]);
            var dur = lookupDur(opts.durations, path);
            if (!(dur > 0)) {
                sawUntimed = true;
                // 仅记少量待探针，避免一轮把整夹未测文件全塞进 missingPaths
                if (noted < 6) {
                    noteMissing(opts, path);
                    noted += 1;
                }
                continue;
            }
            sawTimed = true;
            var speed = 1;
            var trim = 0;
            // 有口播时：时间轴长度必须等于口播标尺（关「对齐」也裁切，避免段间露缝与片尾溢出）
            var target = voiceDur > 0 ? voiceDur : dur;
            var source = dur;
            if (row.sync && voiceDur > 0) {
                target = voiceDur;
                speed = dur / voiceDur;
                source = dur;
                if (enforce24 && speed < threshold) {
                    opts.warnings.push("画面 " + order[i] + " 变速后将低于 24 帧，已跳过");
                    continue;
                }
            } else if (voiceDur > 0) {
                if (dur > voiceDur) {
                    target = voiceDur;
                    source = voiceDur;
                    speed = 1;
                    if (row.align && row.longMat === "random") {
                        trim = opts.random() * (dur - voiceDur);
                    } else if (row.align && row.longMat === "tail") {
                        trim = dur - voiceDur;
                    } else {
                        trim = 0; // 默认从头裁
                    }
                } else if (dur < voiceDur) {
                    target = voiceDur;
                    source = dur;
                    speed = dur / voiceDur;
                    if (enforce24 && speed < threshold) {
                        opts.warnings.push("画面 " + order[i] + " 拉慢后将低于 24 帧，已跳过");
                        continue;
                    }
                } else {
                    target = voiceDur;
                    source = dur;
                    speed = 1;
                    trim = 0;
                }
            }
            claim(lib.root, [order[i]], row.unique, opts.used, opts);
            return {
                clips: [{ path: path, timelineDur: target, inPoint: trim, sourceDur: source, speed: speed, duration: target }]
            };
        }
        if (!sawTimed) {
            if (sawUntimed) return { error: "NEED_PROBE", missing: true };
            return { error: "还没有读到画面时长，无法按口播对齐。请确认这些视频能被 Premiere 导入。" };
        }
        var folder = lib.root.replace(/\\/g, "/").split("/").pop();
        if (!enforce24) {
            return { error: "【" + folder + "】没有可用画面素材。" };
        }
        return {
            error: "【" + folder + "】中的所有视频均过短。\n\n由于开启了 24 帧保护与画面对齐/变速，强行拉伸会让成片帧率跌破 24 帧/秒。\n\n请补充更长的画面，关闭对齐，或关闭 24 帧保护后重试。"
        };
    }

    function takeTrack(lib, exts, count, unique, opts) {
        if (!lib || !lib.root || !lib.rels || !lib.rels.length || count <= 0) return [];
        // 全库文件名池抽签；有已测时长时优先抽它们（修复：去重开启时未测文件被 claim 导致 NEED_PROBE 死循环）
        var candidates = filterExt(lib.rels, exts);
        if (!candidates.length) return [];
        var pools = openPool({ root: lib.root, rels: candidates, strategy: lib.strategy }, exts, unique, opts);
        if (!pools.unique.length) return [];
        var pref = preferTimedRels(lib.root, pools.unique, opts.durations);
        // 与画面轨同一套"池子健康检查"：声音轨（口播/音效/背景音）如果只从「已测时长」的少数文件里抽，
        // 背景音就会永远抽到同一个文件（实测：三条序列的 BGM 都是同一首，且每次生成都不变）。
        // 不足时先把未测的交给探针，而不是把候选池永久压缩成 1 个。
        if (timedPoolTooSmall(lib.root, pref, opts)) return [];
        var pickUnique = pref.timed.length ? pref.timed : pools.unique;
        var pickRaw = pref.timed.length ? pref.timed.slice() : pools.raw;
        var want = Math.min(count, pickUnique.length);
        var rels = picker.pickSmartMedia(pickUnique, pickRaw, want, !!unique, opts.random);
        var out = [];
        var okRels = [];
        for (var i = 0; i < rels.length; i++) {
            var path = absJoin(lib.root, rels[i]);
            var dur = lookupDur(opts.durations, path);
            if (dur > 0) {
                out.push({ path: path, duration: dur });
                okRels.push(rels[i]);
            } else if (!isTextPath(path)) {
                // 文本文件没有媒体时长，永远不该进探针队列（探针会把 .srt 当媒体导入 Premiere）
                noteMissing(opts, path);
            }
        }
        // 仅占用真正用上的素材（旧版 unique 才 claim；现去重开启时绝不可 claim 未测文件）
        claim(lib.root, okRels, unique, opts.used, opts);
        return out;
    }

    function openPool(lib, exts, unique, opts) {
        var rels = filterExt(lib.rels, exts);
        var pools = picker.getSmartMediaPool(rels, lib.strategy, opts.random);
        var needDedupe = !!unique || (opts.dedupeMode && opts.dedupeMode !== "off");
        if (needDedupe) {
            var filtered = filterUnused(lib.root, pools[0], pools[1], opts.used, opts);
            if (!filtered[0].length && pools[0].length) {
                if (opts.warnings) {
                    opts.warnings.push("素材去重后池空，已放宽复用（" + (lib.root || "") + "）");
                }
                pools = [pools[0], pools[1]];
            } else {
                pools = filtered;
            }
        } else {
            pools = [pools[0], pools[1]];
        }
        return { unique: pools[0], raw: pools[1] };
    }

    function useCount(used, key) {
        if (!used || !key) return 0;
        var v = used[key];
        if (v === true) return 1;
        return Number(v) || 0;
    }

    function filterUnused(root, uniquePool, rawPool, used, opts) {
        var max = opts && opts.dedupeMode && opts.dedupeMode !== "off"
            ? Math.max(1, Number(opts.dedupeMax) || 1)
            : 1;
        var kept = [];
        for (var i = 0; i < uniquePool.length; i++) {
            var key = pathKey(absJoin(root, uniquePool[i]));
            if (useCount(used, key) < max) kept.push(uniquePool[i]);
        }
        var set = {};
        for (var k = 0; k < kept.length; k++) set[kept[k]] = true;
        var raw = [];
        for (var r = 0; r < rawPool.length; r++) if (set[rawPool[r]]) raw.push(rawPool[r]);
        if (!raw.length) raw = kept.slice();
        return [kept, raw];
    }

    function countUnused(lib, exts, used, opts) {
        var n = 0;
        var max = opts && opts.dedupeMode && opts.dedupeMode !== "off"
            ? Math.max(1, Number(opts.dedupeMax) || 1)
            : 1;
        var rels = filterExt(lib.rels || [], exts);
        for (var i = 0; i < rels.length; i++) {
            if (useCount(used, pathKey(absJoin(lib.root, rels[i]))) < max) n += 1;
        }
        return n;
    }

    function claim(root, rels, unique, used, opts) {
        var force = !!unique || (opts && opts.dedupeMode && opts.dedupeMode !== "off");
        if (!force || !used) return;
        for (var i = 0; i < rels.length; i++) {
            var key = pathKey(absJoin(root, rels[i]));
            used[key] = useCount(used, key) + 1;
        }
    }

    function applySfxTrim(clips) {
        var videos = [];
        var sfx = [];
        for (var i = 0; i < clips.length; i++) {
            if (clips[i].track === "video" && (clips[i].videoLayer || 0) === 0) videos.push(clips[i]);
            else if (clips[i].track === "sfx") sfx.push(clips[i]);
        }
        var occupied = {};
        for (var s = 0; s < sfx.length; s++) {
            if (sfx[s].shotIndex >= 0) occupied[sfx[s].shotIndex] = true;
        }
        for (var j = 0; j < sfx.length; j++) {
            var item = sfx[j];
            if (item.shotIndex < 0 || item.shotIndex >= videos.length) continue;
            var logical = videos[item.shotIndex].timelineDur;
            item.logicalDur = logical;
            if (occupied[item.shotIndex + 1] && logical > 0 && item.timelineDur > logical) {
                item.timelineDur = logical;
                item.sourceDur = Math.min(item.sourceDur, logical);
            }
        }
    }

    function makeClip(track, src, start, timelineDur, inPoint, sourceDur, speed, extra) {
        var clip = {
            track: track,
            path: src.path,
            timelineStart: start,
            timelineDur: timelineDur,
            inPoint: inPoint,
            sourceDur: sourceDur,
            speed: speed
        };
        if (extra) {
            for (var k in extra) if (extra.hasOwnProperty(k)) clip[k] = extra[k];
        }
        return clip;
    }

    function sumClipDur(list) {
        var n = 0;
        for (var i = 0; i < list.length; i++) n += list[i].duration || list[i].timelineDur || 0;
        return n;
    }

    function filterExt(rels, exts) {
        var out = [];
        for (var i = 0; i < (rels || []).length; i++) {
            var lower = String(rels[i]).toLowerCase();
            for (var e = 0; e < exts.length; e++) {
                if (lower.length >= exts[e].length && lower.lastIndexOf(exts[e]) === lower.length - exts[e].length) {
                    out.push(rels[i]);
                    break;
                }
            }
        }
        return out;
    }

    function lookupDur(durations, path) {
        if (!durations || !path) return 0;
        if (durations.hasOwnProperty(path)) return Number(durations[path]) || 0;
        var key = pathKey(path);
        if (durations.hasOwnProperty(key)) return Number(durations[key]) || 0;
        for (var k in durations) {
            if (durations.hasOwnProperty(k) && pathKey(k) === key) return Number(durations[k]) || 0;
        }
        return 0;
    }

    /** 写入时长缓存时同时挂 pathKey，避免 \ / 大小写导致探针后仍判缺时长 */
    function rememberDur(durations, path, seconds) {
        if (!durations || !path) return;
        var n = Number(seconds);
        if (!(n > 0)) return;
        durations[path] = n;
        var key = pathKey(path);
        if (key) durations[key] = n;
        var slash = String(path).replace(/\\/g, "/");
        if (slash !== path) durations[slash] = n;
        var back = String(path).replace(/\//g, "\\");
        if (back !== path) durations[back] = n;
    }

    function absJoin(root, rel) {
        var sep = String(root).indexOf("\\") >= 0 ? "\\" : "/";
        var parts = String(rel).replace(/\\/g, "/").split("/");
        var p = String(root).replace(/[\\\/]+$/, "");
        for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            p += sep + parts[i];
        }
        return p;
    }

    function pathKey(p) {
        var s = String(p || "").replace(/\\/g, "/").replace(/\/+/g, "/");
        // 去掉 file:/// 与盘符前多余 /
        if (s.indexOf("file:") === 0) {
            s = s.replace(/^file:\/\//i, "");
            if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
            try { s = decodeURI(s); } catch (e) {}
            s = s.replace(/\\/g, "/");
        }
        var win = true;
        if (typeof process !== "undefined" && process.platform && process.platform !== "win32") win = false;
        else if (typeof navigator !== "undefined" && navigator.platform && !/win/i.test(navigator.platform)) win = false;
        return win ? s.toLowerCase() : s;
    }

    function round1(n) { return Math.round(n * 10) / 10; }

    function parseSrt(content) {
        var blocks = String(content).replace(/^\s+|\s+$/g, "").split(/\n\s*\n/);
        var subs = [];
        for (var i = 0; i < blocks.length; i++) {
            var lines = blocks[i].split(/\n/);
            if (lines.length < 2) continue;
            var timeLine = lines.length >= 3 ? lines[1] : lines[0];
            var m = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
            if (!m) continue;
            var textLines = lines.length >= 3 ? lines.slice(2) : [];
            subs.push({
                start: srtStamp(m[1], m[2], m[3], m[4]),
                end: srtStamp(m[5], m[6], m[7], m[8]),
                text: textLines.join(" ").replace(/^\s+|\s+$/g, "")
            });
        }
        return subs;
    }

    function srtStamp(h, m, s, ms) {
        return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    }

    function formatSrtTime(seconds) {
        if (seconds < 0) seconds = 0;
        var msTotal = Math.round(seconds * 1000);
        var ms = msTotal % 1000;
        var s = Math.floor(msTotal / 1000);
        var h = Math.floor(s / 3600);
        s = s % 3600;
        var m = Math.floor(s / 60);
        s = s % 60;
        return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms, 3);
    }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) s = "0" + s;
        return s;
    }

    /**
     * 字幕 cues → SRT。
     * @param {Array} cues
     * @param {boolean} [includeHighlight] true 时连高光 cue 一起写（默认 false：
     *        高光走画面轨 MOGRT 图形，不需要 SRT）。
     *        以前这里无条件跳过 highlight cue，导致给高光生成 SRT 时永远是 0 字节空文件，
     *        空的 .srt 送去 app.project.importFiles() 会弹出「导入程序报告了一个一般错误」并卡住。
     */
    function cuesToSrt(cues, includeHighlight) {
        var parts = [];
        var index = 1;
        for (var i = 0; i < cues.length; i++) {
            var cue = cues[i];
            if (!cue || !cue.text) continue;
            if (cue.highlight && !includeHighlight) continue;
            // cue.text 内部用 \r 分行（给 MOGRT 用）；写成 SRT 时换行换成 \n。
            // 关键：SRT 里「空行」是片段分隔符，会把一条字幕截断（Premiere 只认到空行前一行）。
            // 所以空行用一个空格占位：既不会被当分隔符，显示出来又是一个空行。
            var rawLines = String(cue.text).replace(/\r\n?/g, "\n").split("\n");
            for (var li = 0; li < rawLines.length; li++) {
                if (!rawLines[li].replace(/\s/g, "")) rawLines[li] = " ";
            }
            parts.push(String(index));
            parts.push(formatSrtTime(cue.start) + " --> " + formatSrtTime(cue.end));
            parts.push(rawLines.join("\n"));
            parts.push("");
            index += 1;
        }
        return parts.join("\n");
    }

    function collectProbePaths(libraries, durations) {
        var paths = [];
        var seen = {};
        for (var r = 0; r < libraries.length; r++) {
            var tracks = (libraries[r] && libraries[r].tracks) || [];
            for (var t = 0; t < tracks.length; t++) {
                var bucket = tracks[t];
                if (!bucket || !bucket.root || !bucket.rels) continue;
                if (bucket.type === "sub" || bucket.type === "subHl") continue;
                var exts = TYPE_EXTS[bucket.type] || AUDIO_EXTS;
                var rels = filterExt(bucket.rels, exts);
                for (var i = 0; i < rels.length; i++) {
                    var abs = absJoin(bucket.root, rels[i]);
                    var key = pathKey(abs);
                    if (seen[key]) continue;
                    if (lookupDur(durations, abs) > 0) continue;
                    seen[key] = true;
                    paths.push(abs);
                }
            }
        }
        return paths;
    }

    /**
     * 快速生成：只收集「本轮抽签可能用到」且尚无时长的候选路径，避免全库探针。
     * spare：每轨多抽几条备用（24帧跳过/读时长失败时可少轮补探针）。
     */
    function collectCandidatePaths(spec) {
        var rng = spec.random || Math.random;
        var count = Math.max(1, Number(spec.count) || 1);
        var spare = Math.max(1, Number(spec.spare) || 3);
        var rawRows = spec.rows || [];
        var baseLibs = normalizeLibraries(spec.libraries || [], rawRows);
        var expanded = expandRowsAndLibraries(rawRows, baseLibs);
        var rows = expanded.rows;
        var libraries = expanded.libraries;
        var durations = spec.durations || {};
        var used = {};
        var paths = [];
        var seen = {};

        function pushAbs(abs) {
            if (!abs) return;
            var key = pathKey(abs);
            if (seen[key]) return;
            seen[key] = true;
            if (lookupDur(durations, abs) > 0) return;
            paths.push(abs);
        }

        function dryTake(lib, exts, want) {
            if (!lib || !lib.root || !lib.rels || !lib.rels.length || want <= 0) return;
            var candidates = filterExt(lib.rels, exts);
            if (!candidates.length) return;
            var pools = picker.getSmartMediaPool(candidates, lib.strategy || { mode: "pool" }, rng);
            if (lib._uniqueDry) pools = filterUnused(lib.root, pools[0], pools[1], used);
            else pools = [pools[0], pools[1]];
            if (!pools[0].length) return;
            var n = Math.min(want, pools[0].length);
            var rels = picker.pickSmartMedia(pools[0], pools[1], n, !!lib._uniqueDry, rng);
            if (lib._uniqueDry) claim(lib.root, rels, true, used, { dedupeMode: "off" });
            for (var i = 0; i < rels.length; i++) pushAbs(absJoin(lib.root, rels[i]));
        }

        for (var n = 0; n < count; n++) {
            for (var r = 0; r < rows.length; r++) {
                var row = normalizeRow(rows[r]);
                var libTracks = (libraries[r] && libraries[r].tracks) || [];
                var voiceLibs = filterLibs(libTracks, "voice");
                var videoLibs = filterLibs(libTracks, "video");
                var sfxLibs = filterLibs(libTracks, "sfx");
                var bgmLibs = filterLibs(libTracks, "bgm");
                var vi, y, s, bi;
                for (vi = 0; vi < voiceLibs.length; vi++) {
                    voiceLibs[vi]._uniqueDry = !!row.unique;
                    dryTake(voiceLibs[vi], AUDIO_EXTS, spare);
                }
                for (y = 0; y < videoLibs.length; y++) {
                    videoLibs[y]._uniqueDry = !!row.unique;
                    var vWant = Math.max(spare, Math.max(1, Number(row.ext) || 1) * spare);
                    if (vWant > 12) vWant = 12;
                    dryTake(videoLibs[y], VIDEO_EXTS, vWant);
                }
                for (s = 0; s < sfxLibs.length; s++) {
                    sfxLibs[s]._uniqueDry = !!row.unique;
                    dryTake(sfxLibs[s], AUDIO_EXTS, Math.min(12, Math.max(1, Number(row.ext) || 1) * spare));
                }
                for (bi = 0; bi < bgmLibs.length; bi++) {
                    bgmLibs[bi]._uniqueDry = false;
                    dryTake(bgmLibs[bi], BGM_EXTS, spare);
                }
            }
        }
        return paths;
    }

    /**
     * 产能粗估：有随机裁切/随机截取 → ∞；
     * 否则按各段「不重复」时瓶颈轨文件数与镜头数估算排列数，再相乘。
     */
    function estimateCapacity(rows, libraries) {
        var infinite = false;
        var total = 1;
        var detail = [];
        for (var r = 0; r < rows.length; r++) {
            var row = normalizeRow(rows[r]);
            var libTracks = (libraries[r] && libraries[r].tracks) || [];
            if (row.crop || row.longMat === "random") {
                infinite = true;
                detail.push("第" + (r + 1) + "段开启随机裁切/随机截取 → ∞");
                continue;
            }
            var repeat = row.repeat;
            var segmentCap = 1;
            var voiceLibs = filterLibs(libTracks, "voice");
            var videoLibs = filterLibs(libTracks, "video");
            if (row.unique) {
                var bottleneck = Infinity;
                voiceLibs.concat(videoLibs).forEach(function (lib) {
                    var exts = lib.type === "video" ? VIDEO_EXTS : AUDIO_EXTS;
                    var n = filterExt(lib.rels || [], exts).length;
                    if (n < bottleneck) bottleneck = n;
                });
                if (!isFinite(bottleneck) || bottleneck <= 0) segmentCap = 0;
                else {
                    var need = Math.max(1, Number(row.ext) || 1);
                    segmentCap = bottleneck >= need ? perm(bottleneck, Math.min(need, bottleneck)) : 0;
                }
            } else {
                var vCount = 0;
                videoLibs.forEach(function (lib) { vCount += filterExt(lib.rels || [], VIDEO_EXTS).length; });
                var aCount = 0;
                voiceLibs.forEach(function (lib) { aCount += filterExt(lib.rels || [], AUDIO_EXTS).length; });
                if (aCount > 0 && vCount > 0) segmentCap = Math.max(1, vCount * aCount);
                else segmentCap = Math.max(vCount, aCount, 1);
            }
            segmentCap = Math.max(0, segmentCap) * repeat;
            detail.push("第" + (r + 1) + "段约 " + segmentCap);
            total *= Math.max(1, segmentCap);
            if (total > 1e12) {
                infinite = true;
                break;
            }
        }
        if (infinite) return { infinite: true, value: Infinity, text: "∞（含随机算法）", detail: detail };
        return { infinite: false, value: total, text: String(total), detail: detail };
    }

    function perm(n, k) {
        if (k > n) return 0;
        var p = 1;
        for (var i = 0; i < k; i++) p *= (n - i);
        return p;
    }

    /** 兼容旧 libraries：{voice,video,...} → {tracks:[...]} */
    function normalizeLibraries(libraries, rows) {
        var out = [];
        for (var r = 0; r < (rows || []).length; r++) {
            var lib = libraries[r] || {};
            if (lib.tracks) {
                out.push(lib);
                continue;
            }
            var tracks = [];
            ["voice", "video", "sfx", "bgm", "sub", "subHl"].forEach(function (type) {
                if (lib[type] && lib[type].root) {
                    tracks.push({
                        id: type + "_" + r,
                        type: type,
                        root: lib[type].root,
                        rels: lib[type].rels || [],
                        strategy: lib[type].strategy || { mode: "pool" },
                        isMainVoice: false
                    });
                }
            });
            out.push({ tracks: tracks });
        }
        return out;
    }

    return {
        planBatch: planBatch,
        cuesToSrt: cuesToSrt,
        parseSrt: parseSrt,
        collectProbePaths: collectProbePaths,
        collectCandidatePaths: collectCandidatePaths,
        estimateCapacity: estimateCapacity,
        normalizeLibraries: normalizeLibraries,
        absJoin: absJoin,
        pathKey: pathKey,
        lookupDur: lookupDur,
        rememberDur: rememberDur,
        sequenceName: sequenceName,
        VIDEO_EXTS: VIDEO_EXTS,
        AUDIO_EXTS: AUDIO_EXTS,
        BGM_EXTS: BGM_EXTS,
        PURE_AUDIO_EXTS: PURE_AUDIO_EXTS,
        IMAGE_EXTS: IMAGE_EXTS,
        TEXT_EXTS: TEXT_EXTS,
        TYPE_EXTS: TYPE_EXTS,
        /** 文本类（字幕/高光）判定：这类文件没有媒体时长，不能进探针 */
        isTextPath: isTextPath,
        extsForType: function (type) { return TYPE_EXTS[type] || AUDIO_POOL_EXTS; }
    };
});
