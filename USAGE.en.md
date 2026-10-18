# Usage Guide

## Quick flow

1. Premiere → `Window → Extensions → YorkCut Pro`
2. **Import**: choose the media root folder, scan
3. **Edit**: for each segment pick media / caption folders, picking mode, speed range
4. **Output**: number of sequences → Generate → confirm preview → write to Premiere
5. Find the sequences under `YorkCut / 成片序列` in the project panel

---

## 1. Folder layout

```
Media/
├─ seg1/
│  ├─ video/      clips or stills (mp4 / mov / jpg / png)
│  ├─ voice/      voice-over audio (mp3 / wav) or video (needs ffmpeg)
│  ├─ sfx/        optional
│  └─ text/       caption .txt files (captions + highlight graphics)
├─ seg2/ ...
└─ bgm/           optional background music
```

A segment may configure only some tracks — e.g. `video` + `text` only also works.

---

## 2. Caption format

- **`.txt` only**; `.srt` / `.ass` / `.vtt` are ignored.
- **One `.txt` = one caption (or one highlight graphic)**, lasting the voice-over length of that segment.
- Line breaks inside the file are preserved; **blank lines stay blank**; leading/trailing blank lines are dropped.

Example `seg1/text/01.txt`:

```
First line of the caption

second paragraph
and its second line
```

Result: a single caption on track C1 containing a blank line, and a single highlight graphic with the same text.

---

## 3. Language

Chinese by default. If the system language is not Chinese the panel switches to English
automatically; the small **EN / 中文** button in the bottom-right corner toggles it manually.
The choice is remembered.

---

## 4. Highlight template

Bring your own `.mogrt` (pick it in the panel) or drop one into the plugin `assets\` folder.
For every caption the plugin generates a patched `.mogrt` with the text baked into the template
default, because `setValue` on a MGT text layer does not render on Premiere 25.1.

---

## 5. Generate

1. Output tab → number of sequences → Generate
2. Confirm the preview dialog → `Write to Premiere`
3. Expected log:

```
[5/8] planning…
  highlight: patching templates (15 captions, highlight-title.mogrt)…
  templates done: 15/15 in 1.2 s
[7/8] writing to Premiere…
  speed check passed: planned 0.855, measured 9.93s / 9.93s
  caption track created: YorkCut-1.srt
  highlight graphics placed on V2: 5/5 (template patches 5, line breaks=LF)
[8/8] done · YorkCut-1 (53.22s)…
```

4. The project panel gets `prefix-1`, `prefix-2`, …

---

## 6. Logs and troubleshooting

- Log file: `%APPDATA%\YorkCutPro\logs\yorkcut-YYYYMMDD.log` (plain text, contains media paths)
- Duration cache: `%APPDATA%\YorkCutPro\durations.json` (delete to re-probe)
- Panel settings: `%APPDATA%\YorkCutPro\.yorkcut.json`

| Symptom | Check |
|---|---|
| No captions after generating | is the caption folder full of `.txt`? Premiere 23+? |
| Graphic shows no text | template text layer locked / no exposed text param — try another template |
| A segment was skipped | its voice folder is empty (each segment needs at least voice or video) |
| Speed looks wrong | look at the `speed check` log line |
| Slow on first run | template patching is cached by text hash after the first run |

---

## 7. FAQ

**Can I produce 100 sequences?** Yes, but batch it — every sequence is really built inside Premiere.

**Are `.srt` captions supported?** No, `.txt` only.

**Does it phone home?** No. Only the optional ffmpeg download needs network.

**Does the log leak anything?** It is a local plain-text file with media paths; nothing is uploaded.

**Do I need to pay for commercial use?** AGPL-3.0 allows commercial use, but derivative works must
stay open source. **Closed-source** use requires a commercial license (1141673084@qq.com).
