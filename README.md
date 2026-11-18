# tracker-viz — Polyend Tracker 3D Visualizer

**[Launch Live App](https://monquixote.github.io/tracker-viz/)**

A local-first, zero-backend 3D note-highway visualizer and 60fps video exporter for **Polyend Tracker**, **Tracker Mini**, **Tracker+**, and **Tracker-CE** projects. All project parsing, audio analysis, WebGL rendering, and video encoding happen locally in your browser — your music and project files are never uploaded anywhere.

---

## Browser Support

- **Recommended: Chrome or Edge (desktop)** — supports full folder persistence (`MOUNT TRACKER`), deterministic 1080p 60fps MP4/WebM export via WebCodecs, and live **Web MIDI Sync**.
- **Other modern browsers:** You can load projects via **`OPEN FOLDER`** + **`LOAD WAV`** and preview or capture in real time via **`● LIVE REC`**.

---

## Features

- **Native Polyend Tracker Parser:** Reads `project.mt`, `.mtp` pattern files (both standard 6-byte patterns and 16-track Tracker+ / Tracker Mini / Tracker-CE v6 8-byte patterns), `patternsMetadata`, and `.pti` instrument metadata.
- **Tight Audio & Groove Sync:**
  - Supports **Swing FX (`I`)** (including Song Mode persistence across patterns) and **Micro-move (`m`)** (both FX slot `m` and Tracker-CE v6 dedicated column).
  - Real-time FFT/RMS/oscilloscope visual reactivity computed directly from your master WAV.
  - Manual **`OFFSET`** slider (`-300ms` to `+300ms`) plus one-click **`AUTO`** transient alignment to lock playback to exported audio.
- **Customizable Visuals:**
  - **`LANES`:** `Auto`, `8`, `12`, or `16` lanes.
  - **`CAM`:** `Classic`, `Low Action`, `Top-Down`, `Side Sweep`.
  - **`BACKDROP`:** `Outrun Sun`, `Joy Division`, `Demoscene`, `Hyperspace`, `Oscilloscope`, `Plasma Cloud`, `None`.
  - **`SECTIONS`:** `Gantries`, `Fly-Through Laser`, `Chromatic Slam`, `None`.
  - **`NAMES`:** Edit track labels and pattern section titles (saved per project in browser `localStorage`).
  - **Track Mutes:** Click tracks in the top-left HUD to mute/unmute lane visuals.
  - **Clean View:** Click **`HIDE UI`** or press `H` to show only the highway and top-left telemetry HUD.
- **Live Web MIDI Sync (`MIDI SYNC`):** Sync visuals to Polyend Tracker MIDI Start (`0xFA`), Continue (`0xFB`), Stop (`0xFC`), and 24-PPQN Clock (`0xF8`).
- **60fps Video Export:**
  - **`EXPORT MP4`** *(recommended default)*: Deterministic 1920×1080 60fps H.264 + AAC export with audio and the top-left telemetry HUD composited cleanly.
  - **`EXPORT WEBM`:** Deterministic 1920×1080 60fps VP9 + 48 kHz Opus export.
  - **`● LIVE REC`:** Real-time canvas capture (pair with **`ALPHA`** to record transparent-background `.webm` overlays for video editors).

---

## How to Use

1. **Open the visualizer:** Go to **https://monquixote.github.io/tracker-viz/**. A built-in demo project loads automatically so you can test the camera, backdrops, and controls immediately.
2. **Prepare your audio on the Tracker:** Render your full song master `.wav` (e.g. into `/Export/` on your SD card, or save a `.wav` inside the project folder).
3. **Load a project:**
   - **Option 1 (`MOUNT TRACKER` — Chrome/Edge):** Click **`MOUNT TRACKER`** and pick your Tracker SD card root (or your `/Projects` folder). Then use **`PROJECTS`** to pick a track + WAV (auto-matched by name or selected manually) or **`LOAD LATEST`** to open your most recent project.
   - **Option 2 (`OPEN FOLDER`):** Click **`OPEN FOLDER`** to pick a single project folder directly, and **`LOAD WAV`** if your master `.wav` lives outside that folder.
4. **Sync playback:** Press `Space` or **`▶ PLAY`**. If the exported `.wav` has leading silence or hardware latency, click **`AUTO`** (detects the first transient) or dial **`OFFSET`** until note strikes snap to the audio transients.
5. **Style your render:** Choose presets under **`CAM`**, **`BACKDROP`**, **`SECTIONS`**, and **`LANES`**, and customize track/pattern labels under **`NAMES`**. Press **`H`** (`HIDE UI`) to preview the clean render.
6. **Export or jam live:**
   - **Video:** Click **`EXPORT MP4`** (recommended) or **`EXPORT WEBM`** to render a frame-accurate 1080p 60fps file.
   - **Hardware MIDI:** Connect your Tracker over USB/MIDI, enable **MIDI Clock Out** + **Transport Out** on the Tracker, click **`MIDI SYNC`** (pick an input or `All MIDI Inputs`), and start playback from **Song Row 01**.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `H` | Toggle Hide / Show UI (`HIDE UI` / `SHOW UI`) |

---

## Local Development

```bash
npm install
npm run dev      # Start local Vite dev server (http://localhost:5173)
npm run typecheck
npm run build    # Typecheck and output static site to dist/
```
