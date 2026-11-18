import type { FX, PatternData } from '@polyend/tracker-lib';
import type {
  CompiledStep,
  CompiledTimeline,
  FXBadge,
  InstrumentMeta,
  NoteEvent,
  NoteKind,
  SongRowInfo,
  TrackMeta,
} from '../types/timeline.ts';
import type { ExtendedStepData, ParsedTrackerProject } from './parserAdapter.ts';

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
const STEPS_PER_BEAT = 4; // Polyend Tracker default LPB = 4 (16th notes)

export function formatMidiNote(midi: number): string {
  if (midi === -2) return 'FAD';
  if (midi === -3) return 'CUT';
  if (midi === -4) return 'OFF';
  if (midi < 0 || midi > 127) return '---';
  const noteName = NOTE_NAMES[midi % 12] ?? 'C-';
  // Polyend Tracker displays MIDI 60 as C-5 (octave = floor(midi / 12))
  const octave = Math.floor(midi / 12);
  return `${noteName}${octave}`;
}

function getNoteKind(rawNote: number): NoteKind | null {
  // Note 0 (0x00, C--1) is used as uninitialized/empty on some firmware/FX-only steps;
  // valid playable Tracker notes start at C-0 (12) or >= 1.
  if (rawNote >= 1 && rawNote <= 127) return 'note';
  if (rawNote === -2) return 'fade';
  if (rawNote === -3) return 'cut';
  if (rawNote === -4) return 'off';
  return null;
}

function resolveInstrumentMeta(
  instIdx: number,
  instruments: Map<number, InstrumentMeta>
): InstrumentMeta {
  const existing = instruments.get(instIdx);
  if (existing) return existing;

  if (instIdx >= 48 && instIdx <= 63) {
    return {
      index: instIdx,
      name: `MIDI ${String(instIdx - 47).padStart(2, '0')}`,
      isOneShot: false,
      sampleDurationSec: null,
      kind: 'midi',
    };
  }
  if (instIdx >= 64) {
    return {
      index: instIdx,
      name: `SYNTH ${instIdx - 63}`,
      isOneShot: false,
      sampleDurationSec: null,
      kind: 'synth',
    };
  }
  return {
    index: instIdx,
    name: `SMP ${String(instIdx + 1).padStart(2, '0')}`,
    isOneShot: false,
    sampleDurationSec: null,
    kind: 'sample',
  };
}

function formatFxBadge(fx: FX | undefined): FXBadge | null {
  if (!fx || !fx.type || fx.type.index === 0 || fx.type.symbol === '-') {
    return null;
  }
  let displayVal = fx.value;
  if (fx.type.index === 15) {
    // Tempo FX is stored halved (4..200 -> 8..400 BPM)
    displayVal = fx.value * 2;
  } else if (fx.type.index === 17) {
    // Swing FX is stored 25..75, displayed -25..+25
    displayVal = fx.value - 50;
  } else if (fx.type.index === 25) {
    // Slice is 0..47 -> 1..48
    displayVal = fx.value + 1;
  }
  return {
    symbol: fx.type.symbol,
    name: fx.type.name,
    value: fx.value,
    display: `${fx.type.symbol}${displayVal}`,
  };
}

function lookupPattern(
  patterns: Map<number, PatternData>,
  patternIndex: number
): PatternData | undefined {
  // Polyend Tracker saves patterns 0-based (pattern_00.mtp = Pattern 1 in song.playlist)
  if (patterns.has(0)) {
    return patterns.get(patternIndex - 1);
  }
  return patterns.get(patternIndex) ?? patterns.get(patternIndex - 1);
}

export interface CompileOptions {
  /** Whether to dynamically change BPM on Pattern FX 'T' (index 15). Default false to avoid Tracker+ Synth/MIDI FX collisions. */
  applyTempoFx?: boolean;
}

export function compileTrackerProject(
  parsed: ParsedTrackerProject,
  options: CompileOptions = {}
): CompiledTimeline {
  const { project, patternsMetadata, patterns, instruments } = parsed;
  const applyTempoFx = options.applyTempoFx ?? false;
  let currentBpm = project.values.globalTempo > 0 ? project.values.globalTempo : 120;
  const initialBpm = currentBpm;

  // Build song playlist (stop or skip 0s)
  const playlist: number[] = [];
  for (const patIdx of project.song.playlist) {
    if (patIdx > 0) playlist.push(patIdx);
  }
  // Fallback if playlist is empty but patterns exist
  if (playlist.length === 0 && patterns.size > 0) {
    const sorted = Array.from(patterns.keys()).sort((a, b) => a - b);
    for (const k of sorted) playlist.push(k);
  }

  const steps: CompiledStep[] = [];
  const allNotes: NoteEvent[] = [];
  const songRows: SongRowInfo[] = [];

  let currentTimeSec = 0;
  let currentStepFloat = 0;
  let currentSwing = 50; // Persists across patterns in Song Mode unless updated by FX 'I'
  let nextNoteId = 1;
  let maxTrackCount = 8;

  const trackEventCounts = new Array<number>(16).fill(0);
  const trackInstCounts = Array.from({ length: 16 }, () => new Map<number, number>());

  for (let songRow = 0; songRow < playlist.length; songRow++) {
    const patternIndex = playlist[songRow]!;
    const pattern = lookupPattern(patterns, patternIndex);
    if (!pattern) continue;

    const patternName =
      patternsMetadata?.patternNames?.[patternIndex - 1]?.trim() ||
      patternsMetadata?.patternNames?.[patternIndex]?.trim() ||
      `PAT ${String(patternIndex).padStart(2, '0')}`;

    const trackCount = Math.min(16, pattern.tracks.length || pattern.trackCount || 8);
    if (trackCount > maxTrackCount) maxTrackCount = trackCount;

    const patternLength = pattern.tracks[0]?.length || 64;
    const rowStartTime = currentTimeSec;
    const rowStartStep = currentStepFloat;
    const rowStartBpm = currentBpm;
    let rowStepCount = 0;

    for (let stepIdx = 0; stepIdx < patternLength; stepIdx++) {
      let breakPatternAfterStep = false;

      // Pass 1: Scan FX1/FX2 across all tracks on this step for Tempo, Break Pattern & Swing ('I')
      for (let t = 0; t < trackCount; t++) {
        const step = pattern.tracks[t]?.steps[stepIdx];
        if (!step) continue;
        for (const fx of step.fx) {
          if (!fx?.type) continue;
          if (
            applyTempoFx &&
            t < 8 &&
            fx.type.index === 15 &&
            fx.value >= 15 &&
            fx.value <= 150 &&
            step.instrument < 48
          ) {
            currentBpm = fx.value * 2;
          } else if (fx.type.index === 13 && fx.value > 0) {
            breakPatternAfterStep = true;
          } else if (fx.type.index === 17 && fx.value >= 25 && fx.value <= 75) {
            currentSwing = fx.value;
          }
        }
      }

      const swingOffsetSteps = stepIdx % 2 === 1 ? (currentSwing - 50) / 100 : 0;
      const stepDurationSec = 60 / (currentBpm * STEPS_PER_BEAT);
      const stepNotes: NoteEvent[] = [];

      // Pass 2: Collect all note/off/cut/fade events on this step with Swing & Micro-move timing offsets
      for (let t = 0; t < trackCount; t++) {
        const step = pattern.tracks[t]?.steps[stepIdx];
        if (!step) continue;

        const kind = getNoteKind(step.note);
        const fx1 = formatFxBadge(step.fx[0]);
        const fx2 = formatFxBadge(step.fx[1]);

        if (kind === null) continue;

        let fxMicroMove = 0;
        for (const fx of step.fx) {
          if (fx?.type?.index === 2 && fx.value > 0 && fx.value <= 100) {
            fxMicroMove = Math.max(fxMicroMove, fx.value);
          }
        }
        const extStep = step as ExtendedStepData;
        const dedicatedMicroMove =
          extStep.microMove != null && extStep.microMove > 0 && extStep.microMove <= 100
            ? extStep.microMove
            : 0;
        const microMoveOffsetSteps = Math.min(100, dedicatedMicroMove + fxMicroMove) / 100;
        const timingOffsetSteps = swingOffsetSteps + microMoveOffsetSteps;
        const noteGridStep = Math.max(0, currentStepFloat + timingOffsetSteps);
        const noteTriggerTimeSec = Math.max(0, currentTimeSec + timingOffsetSteps * stepDurationSec);

        const instIdx = step.instrument >= 0 ? step.instrument : 0;
        const instMeta = resolveInstrumentMeta(instIdx, instruments);
        if (!instruments.has(instIdx)) {
          instruments.set(instIdx, instMeta);
        }

        trackEventCounts[t] = (trackEventCounts[t] ?? 0) + 1;
        if (kind === 'note') {
          const counts = trackInstCounts[t]!;
          counts.set(instIdx, (counts.get(instIdx) ?? 0) + 1);
        }

        const noteEvent: NoteEvent = {
          id: nextNoteId++,
          trackIndex: t,
          songRow,
          patternIndex,
          stepIndex: stepIdx,
          gridStepFloat: noteGridStep,
          baseGridStepFloat: currentStepFloat,
          timingOffsetSteps,
          endStepFloat: noteGridStep + 0.85,
          triggerTimeSec: noteTriggerTimeSec,
          endTimeSec: noteTriggerTimeSec + stepDurationSec,
          rawNote: step.note,
          kind,
          noteLabel: formatMidiNote(step.note),
          instrumentIndex: instIdx,
          instrumentName: instMeta.name,
          colorIndex: instIdx % 16,
          fx1,
          fx2,
        };

        stepNotes.push(noteEvent);
        allNotes.push(noteEvent);
      }

      steps.push({
        songRow,
        patternIndex,
        patternName,
        stepIndex: stepIdx,
        gridStepFloat: currentStepFloat,
        timeSec: currentTimeSec,
        durationSec: stepDurationSec,
        bpm: currentBpm,
        swing: currentSwing,
        notes: stepNotes,
      });

      currentTimeSec += stepDurationSec;
      currentStepFloat += 1;
      rowStepCount += 1;

      if (breakPatternAfterStep) break;
    }

    songRows.push({
      songRow,
      patternIndex,
      patternName,
      startTimeSec: rowStartTime,
      endTimeSec: currentTimeSec,
      startStepFloat: rowStartStep,
      endStepFloat: currentStepFloat,
      stepCount: rowStepCount,
      bpm: rowStartBpm,
    });
  }

  // Sort chronologically by triggerTimeSec before sustain/FrameStateStore passes
  // because Swing < 50% or large Micro-move shifts can reorder adjacent steps.
  allNotes.sort(
    (a, b) =>
      a.triggerTimeSec - b.triggerTimeSec ||
      a.gridStepFloat - b.gridStepFloat ||
      a.trackIndex - b.trackIndex ||
      a.id - b.id
  );

  // Pass 3: Compute sustain tail lengths per track (capped by next event, OFF/FAD/CUT, or .pti OneShot duration)
  const notesByTrack: NoteEvent[][] = Array.from({ length: 16 }, () => []);
  for (const n of allNotes) {
    notesByTrack[n.trackIndex]?.push(n);
  }

  for (let t = 0; t < 16; t++) {
    const trackNotes = notesByTrack[t]!;
    for (let i = 0; i < trackNotes.length; i++) {
      const curr = trackNotes[i]!;
      if (curr.kind !== 'note') {
        curr.endStepFloat = curr.gridStepFloat + 0.65;
        curr.endTimeSec = curr.triggerTimeSec;
        continue;
      }

      const next = trackNotes[i + 1];
      let maxEndStep = next ? next.gridStepFloat : currentStepFloat;
      let maxEndTime = next ? next.triggerTimeSec : currentTimeSec;

      const inst = instruments.get(curr.instrumentIndex);
      if (inst?.isOneShot && inst.sampleDurationSec && inst.sampleDurationSec > 0) {
        const sampleEndTime = curr.triggerTimeSec + inst.sampleDurationSec;
        if (sampleEndTime < maxEndTime) {
          maxEndTime = sampleEndTime;
          // Estimate step span from local tempo
          const avgStepDur =
            (maxEndTime - curr.triggerTimeSec) / Math.max(0.001, maxEndStep - curr.gridStepFloat);
          const estSteps =
            avgStepDur > 0 ? inst.sampleDurationSec / avgStepDur : curr.gridStepFloat + 1;
          maxEndStep = Math.min(maxEndStep, curr.gridStepFloat + Math.max(0.85, estSteps));
        }
      }

      curr.endStepFloat = Math.max(curr.gridStepFloat + 0.85, maxEndStep - 0.12);
      curr.endTimeSec = Math.max(curr.triggerTimeSec, maxEndTime);
    }
  }

  // Build track metadata
  const tracks: TrackMeta[] = [];
  const activeTrackIndices: number[] = [];

  for (let t = 0; t < maxTrackCount; t++) {
    const hasEvents = (trackEventCounts[t] ?? 0) > 0;
    if (hasEvents) activeTrackIndices.push(t);

    // Find most-used instrument on this track
    let bestInstIdx = t;
    let bestCount = -1;
    for (const [instIdx, cnt] of trackInstCounts[t]!.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestInstIdx = instIdx;
      }
    }
    const primaryInst = instruments.get(bestInstIdx);
    const rawName = project.values.trackNames?.[t]?.trim();

    tracks.push({
      index: t,
      name: rawName || `TRK ${String(t + 1).padStart(2, '0')}`,
      hasEvents,
      primaryInstrumentName: primaryInst?.name ?? `TRK ${t + 1}`,
      colorIndex: bestInstIdx % 16,
    });
  }

  // Ensure at least 4 tracks if completely empty
  if (activeTrackIndices.length === 0) {
    for (let t = 0; t < Math.min(8, maxTrackCount); t++) activeTrackIndices.push(t);
  }

  let finalDurationSec = currentTimeSec;
  let finalTotalSteps = currentStepFloat;
  const lastNote = allNotes[allNotes.length - 1];
  if (lastNote) {
    if (lastNote.gridStepFloat > finalTotalSteps) {
      finalTotalSteps = lastNote.gridStepFloat + 0.25;
    }
    if (lastNote.triggerTimeSec > finalDurationSec) {
      finalDurationSec = lastNote.triggerTimeSec + 0.1;
    }
  }

  return {
    projectName: parsed.projectName,
    initialBpm,
    totalDurationSec: finalDurationSec,
    totalSteps: finalTotalSteps,
    maxTrackCount,
    activeTrackIndices,
    tracks,
    instruments,
    songRows,
    steps,
    allNotes,
  };
}
