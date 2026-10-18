// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 罗永康 · YorkCut Pro
var picker = require("./picker.js");
var edit = require("./edit.js");
var failed = 0;

function assert(cond, message) {
    if (!cond) {
        failed += 1;
        console.error("FAIL " + message);
    }
}

function close(a, b, message) {
    assert(Math.abs(a - b) < 1e-6, message + " got " + a + " expected " + b);
}

var files = ["a/1.mp4", "a/2.mp4", "b/1.mp4"];
var split = picker.assignFileProbabilities(files, {
    mode: "weight",
    weights: {
        a: { weight: 25, children: { mode: "pool" } },
        b: { weight: 25, children: { mode: "pool" } }
    }
}, 1, 0);
close(split["a/1.mp4"], 0.25, "folder a file share");
close(split["b/1.mp4"], 0.5, "folder b file share");

var equal = picker.assignFileProbabilities(files, {
    mode: "weight",
    weights: {
        a: { weight: 80, children: { mode: "pool" } },
        b: { weight: 80, children: { mode: "pool" } }
    }
}, 1, 0);
close(equal["a/1.mp4"], 1 / 3, "over 100 degrades to equal");

var rooted = picker.assignFileProbabilities(["solo.mp4", "sub/a.mp4"], {
    mode: "weight",
    weights: {
        __root__: { weight: 50, children: { mode: "pool" } },
        sub: { weight: 50, children: { mode: "pool" } }
    }
}, 1, 0);
close(rooted["solo.mp4"], 0.5, "root bucket");
close(rooted["sub/a.mp4"], 0.5, "sub bucket");

var compiled = picker.compileStrategy({
    children: [
        { key: "a", checked: true, hasMedia: true, percent: 25, children: [] },
        { key: "b", checked: true, hasMedia: true, percent: 25, children: [] }
    ]
});
assert(compiled.mode === "weight", "compile keeps weight");
close(compiled.weights.a.weight, 50, "compile normalizes 25+25");

function row(extra) {
    var base = { sync: false, align: true, longMat: "head", ext: 1, keepAudio: false, unique: true, flip: false, crop: false, bgmLoop: true };
    if (extra) {
        for (var key in extra) base[key] = extra[key];
    }
    return base;
}

function stable() { return 0.999; }

var trim = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row()],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        video: { root: "D:/p", rels: ["long.mp4"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 10, "D:/p/long.mp4": 20 }
});
assert(trim.ok, "trim plan ok");
var video = trim.sequences[0].clips.filter(function (c) { return c.track === "video"; })[0];
close(video.timelineDur, 10, "long video trimmed to voice");
close(video.speed, 1, "trim keeps speed 1");
close(video.sourceDur, 10, "trim source is voice length");

var sync = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row({ sync: true, align: false })],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        video: { root: "D:/p", rels: ["long.mp4"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 10, "D:/p/long.mp4": 20 }
});
video = sync.sequences[0].clips.filter(function (c) { return c.track === "video"; })[0];
close(video.speed, 2, "sync speed");
close(video.sourceDur, 20, "sync uses full source");
close(video.timelineDur, 10, "sync timeline is voice");

var blocked = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row()],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        video: { root: "D:/p", rels: ["short.mp4"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 10, "D:/p/short.mp4": 3 }
});
assert(!blocked.ok && blocked.error.indexOf("过短") >= 0, "24fps block");

var sfxPlan = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row({ align: false, sync: false, ext: 2 })],
    libraries: [{
        video: { root: "D:/p", rels: ["a.mp4", "b.mp4"], strategy: { mode: "pool" } },
        sfx: { root: "D:/s", rels: ["long.wav", "tiny.wav"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/p/a.mp4": 3, "D:/p/b.mp4": 4, "D:/s/long.wav": 10, "D:/s/tiny.wav": 2 }
});
assert(sfxPlan.ok, "sfx plan ok");
var sfx = sfxPlan.sequences[0].clips.filter(function (c) { return c.track === "sfx"; });
assert(sfx.length === 2, "two sfx");
close(sfx[0].timelineDur, 3, "first sfx trimmed to shot");
close(sfx[1].timelineDur, 2, "second sfx keeps own length");

var bgmPlan = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [
        row({ align: false, sync: false, unique: false }),
        row({ align: false, sync: false, unique: false })
    ],
    libraries: [
        {
            voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
            bgm: { root: "D:/b", rels: ["song.mp3"], strategy: { mode: "pool" } }
        },
        { voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } } }
    ],
    durations: { "D:/v/a.wav": 4, "D:/b/song.mp3": 10 }
});
assert(bgmPlan.ok, "bgm plan ok");
var bgm = bgmPlan.sequences[0].clips.filter(function (c) { return c.track === "bgm"; });
assert(bgm.length === 1, "bgm continues across empty row");
close(bgm[0].timelineDur, 8, "bgm covers both voice rows");
close(bgmPlan.sequences[0].duration, 8, "sequence length is voice sum");
assert(bgmPlan.sequences[0].bgmClipCount === 1, "bgmClipCount reported");

var bgmProbe = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        bgm: { root: "D:/b", rels: ["song.mp3", "other.mp3"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 4 }
});
assert(!bgmProbe.ok && bgmProbe.needProbe, "bgm missing duration needs probe");
assert(bgmProbe.missingPaths && bgmProbe.missingPaths.length > 0, "bgm missingPaths listed");

var srt = edit.cuesToSrt([
    { start: 1, end: 2.5, text: "你好", highlight: false },
    { start: 3, end: 4, text: "高光应排除", highlight: true }
]);
assert(srt.indexOf("你好") >= 0, "caption text");
assert(srt.indexOf("高光应排除") < 0, "highlight excluded from caption srt");
assert(srt.indexOf("00:00:01,000 --> 00:00:02,500") >= 0, "srt stamp");

assert(edit.sequenceName("成片", 3) === "成片-3", "sequence naming");

var multi = edit.planBatch({
    count: 2, fps: 30, nameBase: "Mix", random: stable, enforce24fps: true,
    rows: [row({ unique: false })],
    libraries: [{
        tracks: [
            { id: "v1", type: "voice", root: "D:/v", rels: ["short.wav"], strategy: { mode: "pool" }, isMainVoice: false },
            { id: "v2", type: "voice", root: "D:/v2", rels: ["main.wav"], strategy: { mode: "pool" }, isMainVoice: true },
            { id: "p1", type: "video", root: "D:/p", rels: ["a.mp4"], strategy: { mode: "pool" } },
            { id: "p2", type: "video", root: "D:/p2", rels: ["b.mp4"], strategy: { mode: "pool" } }
        ]
    }],
    durations: {
        "D:/v/short.wav": 4,
        "D:/v2/main.wav": 8,
        "D:/p/a.mp4": 20,
        "D:/p2/b.mp4": 20
    }
});
assert(multi.ok, "multi track plan ok");
assert(multi.sequences.length === 2, "count creates N sequences");
assert(multi.sequences[0].name === "Mix-1" && multi.sequences[1].name === "Mix-2", "prefix-N names");
close(multi.sequences[0].duration, 8, "main voice is ruler");
var voices = multi.sequences[0].clips.filter(function (c) { return c.track === "voice"; });
assert(voices.length === 2, "parallel voices");
var vids = multi.sequences[0].clips.filter(function (c) { return c.track === "video"; });
assert(vids.length === 2, "stacked videos");
assert(vids[0].videoLayer === 0 && vids[1].videoLayer === 1, "video layers");
assert(multi.sequences[0].videoLayerCount === 2, "videoLayerCount");
assert(multi.sequences[0].voiceSlotCount === 2, "voiceSlotCount");

var off24 = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable, enforce24fps: false,
    rows: [row()],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        video: { root: "D:/p", rels: ["short.mp4"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 10, "D:/p/short.mp4": 3 }
});
assert(off24.ok, "24fps off allows stretch");
close(off24.sequences[0].clips.filter(function (c) { return c.track === "video"; })[0].speed, 0.3, "stretch speed");

// 关闭「画面对齐」时，长画面仍须裁到口播长（片尾/段间）
var noAlign = edit.planBatch({
    count: 1, fps: 60, nameBase: "T", random: stable, enforce24fps: true,
    rows: [row({ align: false, sync: false })],
    libraries: [{
        voice: { root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
        video: { root: "D:/p", rels: ["long.mp4"], strategy: { mode: "pool" } }
    }],
    durations: { "D:/v/a.wav": 2, "D:/p/long.mp4": 8 }
});
assert(noAlign.ok, "align-off still plans");
var naVid = noAlign.sequences[0].clips.filter(function (c) { return c.track === "video"; })[0];
var naVoice = noAlign.sequences[0].clips.filter(function (c) { return c.track === "voice"; })[0];
close(naVid.timelineDur, naVoice.timelineDur, "align-off video trimmed to voice");
assert(Math.abs(naVid.timelineStart + naVid.timelineDur - (naVoice.timelineStart + naVoice.timelineDur)) < 1e-6, "align-off video ends with voice");

var cap = edit.estimateCapacity([row({ unique: false, crop: true })], [{
    tracks: [{ type: "video", root: "D:/p", rels: ["a.mp4"] }]
}]);
assert(cap.infinite, "capacity infinite with crop");

var candidates = edit.collectCandidatePaths({
    count: 1, spare: 2, random: stable,
    rows: [row({ unique: false })],
    libraries: [{
        tracks: [
            { type: "voice", root: "D:/v", rels: ["a.wav", "b.wav", "c.wav"], strategy: { mode: "pool" } },
            { type: "video", root: "D:/p", rels: ["1.mp4", "2.mp4", "3.mp4", "4.mp4"], strategy: { mode: "pool" } }
        ]
    }],
    durations: {}
});
assert(candidates.length > 0 && candidates.length < 7, "candidate probe is sparse not full library");
assert(candidates.indexOf("D:/v/a.wav") >= 0 || candidates.indexOf("D:/v/b.wav") >= 0 || candidates.indexOf("D:/v/c.wav") >= 0, "voice candidate");

var cached = edit.collectCandidatePaths({
    count: 1, spare: 2, random: stable,
    rows: [row({ unique: false })],
    libraries: [{
        tracks: [
            { type: "voice", root: "D:/v", rels: ["a.wav"], strategy: { mode: "pool" } },
            { type: "video", root: "D:/p", rels: ["1.mp4"], strategy: { mode: "pool" } }
        ]
    }],
    durations: { "D:/v/a.wav": 3, "D:/p/1.mp4": 5 }
});
assert(cached.length === 0, "no probe when durations cached");

var needProbe = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable,
    rows: [row({ unique: false })],
    libraries: [{
        tracks: [
            { type: "voice", root: "D:/v", rels: ["a.wav", "b.wav"], strategy: { mode: "pool" } },
            { type: "video", root: "D:/p", rels: ["1.mp4", "2.mp4"], strategy: { mode: "pool" } }
        ]
    }],
    durations: {}
});
assert(!needProbe.ok && needProbe.needProbe, "full-pool pick requests probe for chosen files");
assert(needProbe.missingPaths && needProbe.missingPaths.length > 0, "missingPaths listed");

// 回归：「三条序列素材完全相同」。
// 以前只要池子里有 1 个已测时长的文件，抽签就会立刻用它，于是每轨候选被永久压缩成 1 个，
// count 条序列必然拿到同一批素材。现在必须先补足已测候选（请求探针），而不是塌缩。
var collapseLib = { root: "D:/big", strategy: { mode: "pool" }, rels: ["k1.mp4", "k2.mp4", "k3.mp4", "k4.mp4", "k5.mp4", "k6.mp4"] };
var collapseDurations = { "D:/big/k1.mp4": 5 };
var collapse = edit.planBatch({
    count: 3, fps: 30, nameBase: "T", random: stable, planAttempt: 0,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{ video: collapseLib }],
    durations: collapseDurations
});
assert(!collapse.ok && collapse.needProbe, "1 measured file must request probe, not collapse the pool");
assert(collapse.missingPaths && collapse.missingPaths.length > 0, "collapse lists probe candidates");

// 探针超过放宽阈值后必须回到旧行为，保证「时长测不出来」时仍能出片（不新增失败路径）
var relaxedCollapse = edit.planBatch({
    count: 3, fps: 30, nameBase: "T", random: stable, planAttempt: 6,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{ video: collapseLib }],
    durations: collapseDurations
});
assert(relaxedCollapse.ok, "relaxed attempt still plans (no new failure path)");

// 已测候选足够时，多条序列应当能抽到不同素材（池子有真实随机性）。
// 注意：本文件的 stable() 是常量 0.999，用它永远抽到同一项，所以这里换一个会变化的确定性随机源。
function varyingRandom() {
    var s = 123456789;
    return function () {
        s = (s * 16807) % 2147483647;   // 16807 * 2^31 < 2^53，整数运算不丢精度
        return s / 2147483647;
    };
}
var varied = edit.planBatch({
    count: 12, fps: 30, nameBase: "T", random: varyingRandom(), planAttempt: 0,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{
        video: {
            root: "D:/big", strategy: { mode: "pool" },
            rels: ["k1.mp4", "k2.mp4", "k3.mp4", "k4.mp4", "k5.mp4", "k6.mp4"]
        }
    }],
    durations: { "D:/big/k1.mp4": 5, "D:/big/k2.mp4": 6, "D:/big/k3.mp4": 7, "D:/big/k4.mp4": 8, "D:/big/k5.mp4": 9 }
});
assert(varied.ok, "healthy pool plans ok");
var chosenVideos = {};
(varied.sequences || []).forEach(function (s) {
    (s.clips || []).filter(function (c) { return c.track === "video"; })
        .forEach(function (c) { chosenVideos[c.path] = true; });
});
assert(Object.keys(chosenVideos).length > 1,
    "healthy pool should draw more than one distinct video across sequences");

// 回归：「权重模式下所有子文件夹百分比相同」时，候选池不能退化成固定字母序。
// 旧实现同票按文件名兜底排序（a<b?-1:1），再配合 pickSmartMedia 的 slice，
// 会让「权重 + 不重复」每次都抽到同一批文件（用户表现为"权重设了却像没生效"）。
function weightTieRng() {
    var s = 24681357;
    return function () {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}
var tieFiles = ["a/1.mp4", "a/2.mp4", "b/1.mp4", "b/2.mp4"];
var tieStrategy = {
    mode: "weight",
    weights: {
        a: { weight: 50, children: { mode: "pool" } },
        b: { weight: 50, children: { mode: "pool" } }
    }
};
var tieRng = weightTieRng();
var tieFirst = {};
var ti;
for (ti = 0; ti < 24; ti++) {
    var tiePool = picker.getSmartMediaPool(tieFiles, tieStrategy, tieRng);
    if (tiePool[0] && tiePool[0].length) tieFirst[tiePool[0][0]] = true;
}
assert(Object.keys(tieFirst).length > 1,
    "equal-weight ties must be shuffled, not a fixed alphabetical order");

// 回归：「背景音永远同一首」。
// 声音轨（口播/音效/背景音）以前也有"只从已测时长的少数文件里抽"的问题：
// 只要池子里有 1 个已测文件就会一直用它，于是三条序列的 BGM 都是同一首，且每次生成都不变。
var bgmCollapse = edit.planBatch({
    count: 3, fps: 30, nameBase: "T", random: varyingRandom(), planAttempt: 0,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{
        voice: { root: "D:/v", strategy: { mode: "pool" }, rels: ["v.wav"] },
        video: { root: "D:/p", strategy: { mode: "pool" }, rels: ["p.mp4"] },
        bgm: { root: "D:/b", strategy: { mode: "pool" }, rels: ["b1.mp3", "b2.mp3", "b3.mp3", "b4.mp3", "b5.mp3", "b6.mp3"] }
    }],
    durations: { "D:/v/v.wav": 5, "D:/p/p.mp4": 5, "D:/b/b1.mp3": 30 }
});
assert(!bgmCollapse.ok && bgmCollapse.needProbe,
    "bgm pool with only 1 measured file must request probe instead of always using it");

// 回归：文案只吃 .txt（.srt 已禁用），且「一个 txt = 一条 cue，内部换行，时长=口播段」。
// 历史坑：.srt 自带时间码 → cue 被顶到段外 → 成片从 46s 被拉成 207s、片段互相重叠被切开。
var subPlan = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable, planAttempt: 0,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{
        voice: { root: "D:/v", strategy: { mode: "pool" }, rels: ["v.wav"] },
        video: { root: "D:/p", strategy: { mode: "pool" }, rels: ["p.mp4"] },
        // 同时放 .srt 和 .txt：.srt 必须被忽略
        sub: { root: "D:/s", strategy: { mode: "pool" }, rels: ["a.srt", "b.txt"] }
    }],
    durations: { "D:/v/v.wav": 5, "D:/p/p.mp4": 5 },
    texts: {
        "D:/s/a.srt": "1\n00:00:00,000 --> 00:00:02,000\nhello\n",
        "D:/s/b.txt": "line1\n\nline3\n"
    }
});
assert(subPlan.ok, "subtitle track must not block planning (text has no media duration)");
var subCues = (subPlan.sequences[0].captionCues || []);
// 一个 .txt = 一条 cue（中间的空行必须留在这一条里，不能拆成多条）
assert(subCues.length === 1, "one .txt must produce exactly ONE cue (got " + subCues.length + ")");
assert(subCues[0].text === "line1\r\rline3",
    "interior blank lines must stay INSIDE the single cue (got " + JSON.stringify(subCues[0].text) + ")");
assert(Math.abs((subCues[0].end - subCues[0].start) - 5) < 0.2,
    "cue must span the voiceover segment (got " + (subCues[0].end - subCues[0].start).toFixed(2) + "s)");
// 字幕走 Premiere 原生字幕轨（Sequence.createCaptionTrack），不再占用画面轨
assert(subPlan.sequences[0].videoLayerCount === 1,
    "captions must NOT reserve a video layer (got " + subPlan.sequences[0].videoLayerCount + ")");
assert(typeof subPlan.sequences[0].captionLayer === "undefined",
    "captionLayer must be gone (captions use a caption track now)");

// 回归：高光走画面轨 .mogrt 图形，必须单独预留一层并计入 videoLayerCount
var hlPlan = edit.planBatch({
    count: 1, fps: 30, nameBase: "T", random: stable, planAttempt: 0,
    rows: [row({ align: false, sync: false, unique: false })],
    libraries: [{
        voice: { root: "D:/v", strategy: { mode: "pool" }, rels: ["v.wav"] },
        video: { root: "D:/p", strategy: { mode: "pool" }, rels: ["p.mp4"] },
        subHl: { root: "D:/h", strategy: { mode: "pool" }, rels: ["h.txt"] }
    }],
    durations: { "D:/v/v.wav": 5, "D:/p/p.mp4": 5 },
    texts: { "D:/h/h.txt": "第一行\n第二行\n第三行\n" }
});
assert(hlPlan.ok, "highlight track must plan fine");
assert((hlPlan.sequences[0].highlightCues || []).length === 1,
    "one .txt without blank lines must produce exactly ONE highlight cue");
assert(String(hlPlan.sequences[0].highlightCues[0].text).indexOf("\r") >= 0,
    "multi-line block must keep line breaks inside one cue");
assert(hlPlan.sequences[0].highlightLayer === 1,
    "highlight graphics must get their own video layer (got " + hlPlan.sequences[0].highlightLayer + ")");
assert(hlPlan.sequences[0].videoLayerCount === 2,
    "videoLayerCount must include the highlight layer (got " + hlPlan.sequences[0].videoLayerCount + ")");
// 高光 cue 只有在显式要求时才写进 SRT（否则会得到 0 字节空文件）
var hlCue = hlPlan.sequences[0].highlightCues[0];
var hlSrtDefault = edit.cuesToSrt([hlCue]);
var hlSrtWith = edit.cuesToSrt([hlCue], true);
assert(hlSrtDefault === "", "highlight cues must be skipped by default SRT");
assert(hlSrtWith.indexOf("-->") >= 0, "cuesToSrt(..., true) must serialize highlight cues");
assert(hlSrtWith.indexOf("\r") < 0, "SRT output must use \\n, not \\r");
assert(hlSrtWith.indexOf("\n\n") < 0, "SRT must NOT contain a blank line inside a cue (it would truncate the caption)");
assert(hlSrtWith.split("\n").length >= 4, "multi-line text must stay multi-line in SRT");
// isTextPath 仍要认 .srt（否则它会被当媒体送进探针），但 .srt 不再能当文案被抽中
assert(edit.isTextPath("D:/s/a.srt") === true, "isTextPath should still detect .srt (never probe it)");
assert(edit.isTextPath("D:/s/b.txt") === true, "isTextPath should detect .txt");
assert(edit.isTextPath("D:/p/p.mp4") === false, "isTextPath should not flag media");
assert(edit.TEXT_EXTS.length === 1 && edit.TEXT_EXTS[0] === ".txt", "only .txt is a text source now");

// ---- 作者印记校验（可选）：panel.js 的 runSummary() 前 24 个 var 名称首字母连读 ----
// 该函数被删掉时跳过，不算失败——印记是可选的。
(function () {
    var fs = require("fs");
    var path = require("path");
    var SIG = "YorkCutmadebyLuoYongkang";
    var p = path.join(__dirname, "..", "js", "panel.js");
    if (!fs.existsSync(p)) return;
    var src = String(fs.readFileSync(p, "utf8"));
    var at = src.indexOf("function runSummary");
    if (at < 0) {
        console.log("(author mark absent: runSummary not found, skipped)");
        return;
    }
    var body = src.slice(at, at + 6000);
    var re = /^[ \t]*var (\w+)/gm;
    var chars = "";
    var m;
    while ((m = re.exec(body)) !== null && chars.length < SIG.length) {
        chars += m[1].charAt(0);
    }
    assert(chars === SIG, "author mark spells " + chars + " (expected " + SIG + ")");
})();

if (failed) {
    console.error(failed + " failed");
    process.exit(1);
}
console.log("selftest ok");
