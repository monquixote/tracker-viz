import './ui/styles.css';
import { AudioAnalyzer } from './audio/audioAnalyzer.ts';
import { AudioEngine } from './audio/audioEngine.ts';
import { FrameStateStore } from './audio/frameStore.ts';
import { MidiClockAdapter } from './audio/midiClockAdapter.ts';
import { LiveRecorder } from './export/liveRecorder.ts';
import { isWebCodecsSupported, runOfflineExport, type OfflineFormat } from './export/offlineExporter.ts';
import { TRACK_HEX_PALETTE } from './scene/constants.ts';
import { HighwayScene } from './scene/highwayScene.ts';
import { generateDemoProject } from './tracker/demoProject.ts';
import {
  collectFilesFromFileList,
  ensureReadPermission,
  getSavedRootHandle,
  mountTrackerDrive,
} from './tracker/driveStorage.ts';
import { parseDiscoveredProject } from './tracker/parserAdapter.ts';
import {
  discoverFromVirtualFiles,
  discoverLatestFromDirectoryHandle,
  listProjectsFromDirectoryHandle,
  loadProjectFromDirectoryHandle,
  type DiscoveredProjectFiles,
} from './tracker/projectDiscovery.ts';
import { compileTrackerProject } from './tracker/timelineCompiler.ts';
import type { CompiledTimeline } from './types/timeline.ts';
import { AppShell } from './ui/appShell.ts';
import { HudOverlay } from './ui/hudOverlay.ts';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function bootstrap(): Promise<void> {
  const appEl = document.getElementById('app');
  if (!appEl) throw new Error('Missing #app mount element');

  const audioEngine = new AudioEngine();
  const audioAnalyzer = new AudioAnalyzer();
  const frameStore = new FrameStateStore();
  const liveRecorder = new LiveRecorder();

  let currentTimeline: CompiledTimeline | null = null;
  let transparentMode = false;
  let offlineAbort: AbortController | null = null;
  let isExportingOffline = false;
  let needsRender = true;
  let idleCooldownSec = 0.8;

  const markDirty = (cooldown = 0.25) => {
    needsRender = true;
    idleCooldownSec = Math.max(idleCooldownSec, cooldown);
  };

  const hud = new HudOverlay((trackIndex) => {
    frameStore.toggleMute(trackIndex);
    markDirty();
  });

  const midiAdapter = new MidiClockAdapter({
    onInputsChanged: (inputs) => {
      if (midiAdapter.isEnabled()) {
        shell.setMidiSyncState(true, inputs);
      }
    },
    onTransportEvent: (type) => {
      if (type === 'start') {
        audioEngine.pause();
        frameStore.resetPrevTime(-1);
        markDirty(0.8);
      } else if (type === 'continue') {
        markDirty(0.8);
      } else {
        markDirty(0.5);
      }
    },
  });

  async function openProjectPicker(handle: FileSystemDirectoryHandle): Promise<void> {
    shell.showToast('Scanning /Projects/...');
    const catalog = await listProjectsFromDirectoryHandle(handle);
    shell.hideToast();
    if (catalog.projects.length === 0) {
      throw new Error('No valid Polyend Tracker projects found in /Projects/.');
    }
    if (catalog.projects.length === 1) {
      const only = catalog.projects[0]!;
      const discovered = await loadProjectFromDirectoryHandle(only.dirHandle, catalog.exportDir);
      await loadDiscovered(discovered);
      return;
    }
    shell.showProjectPicker(catalog.projects, catalog.availableWavs, async (picked, wavOverride) => {
      try {
        shell.showToast(`Loading ${picked.name}...`);
        const discovered = await loadProjectFromDirectoryHandle(picked.dirHandle, catalog.exportDir);
        if (wavOverride !== null) {
          discovered.wavFile = wavOverride;
        }
        await loadDiscovered(discovered);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    });
  }

  const shell = new AppShell({
    onMountDrive: async () => {
      try {
        shell.showToast('Select your Polyend Tracker SD / USB drive...');
        const handle = await mountTrackerDrive();
        await openProjectPicker(handle);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    },
    onBrowseProjects: async () => {
      try {
        const saved = await getSavedRootHandle();
        if (!saved) {
          const handle = await mountTrackerDrive();
          await openProjectPicker(handle);
          return;
        }
        const ok = await ensureReadPermission(saved, true);
        if (!ok) {
          shell.showToast('Permission denied. Click MOUNT TRACKER to re-authorize.');
          setTimeout(() => shell.hideToast(), 3000);
          return;
        }
        await openProjectPicker(saved);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    },
    onLoadLatest: async () => {
      try {
        const saved = await getSavedRootHandle();
        if (!saved) {
          shell.showToast('No saved Tracker drive. Click MOUNT TRACKER first.');
          setTimeout(() => shell.hideToast(), 3000);
          return;
        }
        const ok = await ensureReadPermission(saved, true);
        if (!ok) {
          shell.showToast('Permission denied. Click MOUNT TRACKER to re-authorize.');
          setTimeout(() => shell.hideToast(), 3000);
          return;
        }
        shell.showToast('Scanning /Projects/ for latest project...');
        const discovered = await discoverLatestFromDirectoryHandle(saved);
        await loadDiscovered(discovered);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    },
    onFolderFilesSelected: async (fileList) => {
      try {
        shell.showToast('Reading selected project folder...');
        const entries = collectFilesFromFileList(fileList);
        const discovered = discoverFromVirtualFiles(entries);
        await loadDiscovered(discovered);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    },
    onWavSelected: async (file) => {
      try {
        shell.showToast(`Decoding ${file.name}...`);
        await audioEngine.loadWavFile(file);
        shell.hideToast();
      } catch (err) {
        shell.showToast(`Failed to decode WAV: ${(err as Error).message}`);
        setTimeout(() => shell.hideToast(), 3000);
      }
    },
    onPlayPause: () => {
      if (audioEngine.isPlaying()) {
        audioEngine.pause();
      } else {
        void audioEngine.play();
      }
      markDirty(0.8);
    },
    onStop: () => {
      audioEngine.stop();
      frameStore.resetPrevTime(-1);
      markDirty(0.4);
    },
    onSeek: (timeSec) => {
      frameStore.resetPrevTime(timeSec);
      audioEngine.seek(timeSec);
      markDirty(0.3);
    },
    onLatencyChange: (ms) => {
      audioEngine.setLatencyOffsetMs(ms);
      markDirty(0.2);
    },
    onAutoAlign: () => {
      const firstTransient = audioEngine.detectFirstTransientSec();
      const firstNoteSec = currentTimeline?.allNotes[0]?.triggerTimeSec ?? 0;
      if (firstTransient === null) {
        shell.showToast('Load a WAV file first to auto-align.');
        setTimeout(() => shell.hideToast(), 2500);
        return;
      }
      // If WAV starts at firstTransient and note is at firstNoteSec, offset = (firstNoteSec - firstTransient) * 1000
      const offsetMs = Math.max(-300, Math.min(300, (firstNoteSec - firstTransient) * 1000));
      audioEngine.setLatencyOffsetMs(offsetMs);
      shell.setLatencyOffsetMs(offsetMs);
      markDirty(0.2);
    },
    onLaneModeChange: (mode) => {
      scene.setLaneMode(mode);
      markDirty(0.2);
    },
    onCameraChange: (preset) => {
      scene.setCameraPreset(preset);
      markDirty(0.2);
    },
    onBackdropChange: (mode) => {
      scene.setBackdropMode(mode);
      markDirty(0.2);
    },
    onPatternDisplayChange: (mode) => {
      scene.setPatternDisplayMode(mode);
      markDirty(0.2);
    },
    onEditPatternNames: () => {
      if (!currentTimeline) return;
      const visibleTracks = scene.getLaneLayout().visibleTrackIndices;
      const trackEntries = visibleTracks.map((trkIdx) => {
        const meta = currentTimeline!.tracks[trkIdx];
        return {
          trackIndex: trkIdx,
          name: meta?.name ?? `TRK ${String(trkIdx + 1).padStart(2, '0')}`,
          colorHex: TRACK_HEX_PALETTE[trkIdx % TRACK_HEX_PALETTE.length]!,
        };
      });

      const uniquePatterns = new Map<number, string>();
      for (const row of currentTimeline.songRows) {
        if (!uniquePatterns.has(row.patternIndex)) {
          uniquePatterns.set(row.patternIndex, row.patternName);
        }
      }
      const patternEntries = Array.from(uniquePatterns.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([patternIndex, name]) => ({ patternIndex, name }));

      shell.showNamesEditor(trackEntries, patternEntries, (updatedTracks, updatedPatterns) => {
        if (!currentTimeline) return;

        for (const trk of currentTimeline.tracks) {
          const next = updatedTracks.get(trk.index);
          if (next) trk.name = next;
        }
        for (const row of currentTimeline.songRows) {
          const next = updatedPatterns.get(row.patternIndex);
          if (next) row.patternName = next;
        }
        for (const step of currentTimeline.steps) {
          const next = updatedPatterns.get(step.patternIndex);
          if (next) step.patternName = next;
        }

        try {
          const serTracks: Record<string, string> = {};
          updatedTracks.forEach((v, k) => {
            serTracks[String(k)] = v;
          });
          localStorage.setItem(
            `tracker-viz:trk-names:${currentTimeline.projectName}`,
            JSON.stringify(serTracks)
          );

          const serPats: Record<string, string> = {};
          updatedPatterns.forEach((v, k) => {
            serPats[String(k)] = v;
          });
          localStorage.setItem(
            `tracker-viz:pat-names:${currentTimeline.projectName}`,
            JSON.stringify(serPats)
          );
        } catch {
          // Ignore storage quota errors
        }

        scene.refreshHeaders();
        hud.setTimeline(currentTimeline);
        shell.setTimeline(currentTimeline);
        markDirty(0.3);
      });
    },
    onToggleMidiSync: async () => {
      if (midiAdapter.isEnabled()) {
        midiAdapter.disconnect();
        midiAdapter.reset();
        shell.setMidiSyncState(false, []);
        frameStore.resetPrevTime(-1);
        markDirty(0.2);
        return;
      }
      try {
        audioEngine.pause();
        const inputs = await midiAdapter.connect();
        midiAdapter.reset();
        frameStore.resetPrevTime(-1);
        shell.setMidiSyncState(true, inputs);
        shell.showToast(
          inputs.length > 0
            ? 'MIDI Sync ready — press Play on your Polyend Tracker (starts at Row 01).'
            : 'MIDI Sync active — no MIDI input detected yet.'
        );
        setTimeout(() => shell.hideToast(), 3200);
        markDirty(0.3);
      } catch (err) {
        shell.showToast((err as Error).message);
        setTimeout(() => shell.hideToast(), 3500);
      }
    },
    onMidiInputChange: (id) => {
      midiAdapter.setSelectedInput(id);
    },
    onTransparentChange: (transparent) => {
      transparentMode = transparent;
      scene.setTransparentBackground(transparent);
      markDirty(0.2);
    },
    onToggleLiveRecord: async () => {
      if (liveRecorder.isRecording()) {
        const { blob, extension } = await liveRecorder.stop();
        shell.setRecordingState(false);
        const safeName = (currentTimeline?.projectName || 'tracker-viz').replace(/[^a-z0-9_-]/gi, '_');
        downloadBlob(blob, `${safeName}-live.${extension}`);
      } else {
        liveRecorder.start(scene.getCanvas(), audioEngine.getMediaStreamAudioTrack(), {
          transparent: transparentMode,
        });
        shell.setRecordingState(true);
        if (!audioEngine.isPlaying()) {
          void audioEngine.play();
        }
      }
    },
    onOfflineExport: async (format: OfflineFormat) => {
      if (!currentTimeline) return;
      if (!isWebCodecsSupported()) {
        shell.showToast('WebCodecs not supported in this browser. Use LIVE REC instead.');
        setTimeout(() => shell.hideToast(), 3500);
        return;
      }
      if (transparentMode && format === 'webm') {
        shell.showToast('Note: WebCodecs strips alpha; use LIVE REC for transparent WebM.');
        await new Promise((r) => setTimeout(r, 1400));
      }

      audioEngine.pause();
      isExportingOffline = true;
      offlineAbort = new AbortController();

      try {
        shell.showToast(`Starting 60fps ${format.toUpperCase()} render...`, 0, true);
        const durationSec = Math.max(
          currentTimeline.totalDurationSec,
          audioEngine.getDurationSec()
        );
        const { blob, extension } = await runOfflineExport(scene, frameStore, {
          format,
          fps: 60,
          audioBuffer: audioEngine.getAudioBuffer(),
          durationSec,
          latencyOffsetMs: audioEngine.getLatencyOffsetMs(),
          drawHudOverlay: (ctx, frame, dur) => hud.drawToExportCanvas(ctx, frame, dur),
          signal: offlineAbort.signal,
          onProgress: (p, text) => shell.showToast(text, p, true),
        });
        const safeName = currentTimeline.projectName.replace(/[^a-z0-9_-]/gi, '_');
        downloadBlob(blob, `${safeName}-60fps.${extension}`);
        shell.hideToast();
      } catch (err) {
        if ((err as Error).message !== 'Export cancelled') {
          shell.showToast(`Export error: ${(err as Error).message}`);
          setTimeout(() => shell.hideToast(), 4000);
        } else {
          shell.hideToast();
        }
      } finally {
        isExportingOffline = false;
        offlineAbort = null;
      }
    },
    onCancelOfflineExport: () => {
      offlineAbort?.abort();
    },
  });

  appEl.appendChild(shell.root);
  shell.viewportEl.appendChild(hud.root);

  const scene = new HighwayScene(shell.viewportEl);

  async function applyTimeline(timeline: CompiledTimeline, audioBuffer: AudioBuffer | null): Promise<void> {
    // Re-apply any saved custom track & pattern names for this project
    try {
      const rawTrk = localStorage.getItem(`tracker-viz:trk-names:${timeline.projectName}`);
      if (rawTrk) {
        const savedTrk = JSON.parse(rawTrk) as Record<string, string>;
        for (const trk of timeline.tracks) {
          const custom = savedTrk[String(trk.index)];
          if (custom) trk.name = custom;
        }
      }
      const raw = localStorage.getItem(`tracker-viz:pat-names:${timeline.projectName}`);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, string>;
        for (const row of timeline.songRows) {
          const custom = saved[String(row.patternIndex)];
          if (custom) row.patternName = custom;
        }
        for (const step of timeline.steps) {
          const custom = saved[String(step.patternIndex)];
          if (custom) step.patternName = custom;
        }
      }
    } catch {
      // Ignore malformed storage
    }

    currentTimeline = timeline;
    audioEngine.setAudioBuffer(audioBuffer);
    frameStore.setTimeline(timeline);
    scene.setTimeline(timeline);
    hud.setTimeline(timeline);
    shell.setTimeline(timeline);
    markDirty(0.5);
  }

  async function loadDiscovered(discovered: DiscoveredProjectFiles): Promise<void> {
    shell.showToast(`Parsing ${discovered.projectName}...`);
    const parsed = await parseDiscoveredProject(discovered);
    const timeline = compileTrackerProject(parsed);

    let audioBuffer: AudioBuffer | null = null;
    if (discovered.wavFile) {
      shell.showToast(`Decoding ${discovered.wavFile.name}...`);
      audioBuffer = await audioEngine.loadWavFile(discovered.wavFile);
    }

    await applyTimeline(timeline, audioBuffer);
    shell.hideToast();
  }

  async function loadDemo(): Promise<void> {
    shell.showToast('Synthesizing demo project & audio...');
    const demo = await generateDemoProject();
    await applyTimeline(demo.timeline, demo.audioBuffer);
    shell.hideToast();
  }

  // Keyboard shortcuts: Space (Play/Pause), H (Hide/Show UI)
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (audioEngine.isPlaying()) audioEngine.pause();
      else void audioEngine.play();
      markDirty(0.8);
    } else if (e.code === 'KeyH') {
      e.preventDefault();
      shell.toggleCleanView();
      markDirty(0.2);
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    if (!isExportingOffline) {
      scene.resize(shell.viewportEl.clientWidth, shell.viewportEl.clientHeight);
      markDirty(0.2);
    }
  });
  resizeObserver.observe(shell.viewportEl);

  // Load Demo immediately so the user sees a working 3D highway on first launch
  await loadDemo();

  let lastFrameMs = performance.now();
  function animate(nowMs: number): void {
    requestAnimationFrame(animate);
    if (isExportingOffline) return;

    const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
    lastFrameMs = nowMs;

    const midiSnap = midiAdapter.isEnabled()
      ? midiAdapter.getSnapshot(audioEngine.getLatencyOffsetMs())
      : null;
    const isPlaying = midiSnap ? midiSnap.isPlaying : audioEngine.isPlaying();

    if (!isPlaying) {
      if (!needsRender && idleCooldownSec <= 0) {
        return;
      }
      idleCooldownSec = Math.max(0, idleCooldownSec - dt);
      needsRender = false;
    } else {
      idleCooldownSec = 0.6;
    }

    const audioTime = audioEngine.getCurrentAudioTimeSec();
    const frame = midiSnap
      ? frameStore.evaluateAtGridStep(midiSnap.gridStepFloat, midiSnap.isPlaying, midiSnap.measuredBpm)
      : frameStore.evaluate(audioEngine.getVisualTimeSec(), isPlaying);
    const analysis = audioAnalyzer.analyze(
      midiSnap ? null : audioEngine.getAudioBuffer(),
      audioTime,
      !midiSnap && isPlaying,
      dt
    );

    scene.renderFrame(frame, dt, analysis);
    hud.update(frame, currentTimeline?.totalDurationSec ?? 0);
    shell.update(frame);
  }

  requestAnimationFrame(animate);
}

void bootstrap();
