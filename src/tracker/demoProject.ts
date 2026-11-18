import type {
  CompiledStep,
  CompiledTimeline,
  FXBadge,
  InstrumentMeta,
  NoteEvent,
  SongRowInfo,
  TrackMeta,
} from '../types/timeline.ts';
import { formatMidiNote } from './timelineCompiler.ts';

export interface DemoProjectBundle {
  timeline: CompiledTimeline;
  audioBuffer: AudioBuffer;
}

const STEPS_PER_BEAT = 4;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export async function generateDemoProject(sampleRate = 44100): Promise<DemoProjectBundle> {
  const instruments = new Map<number, InstrumentMeta>([
    [0, { index: 0, name: '909 KICK', isOneShot: true, sampleDurationSec: 0.28, kind: 'sample' }],
    [1, { index: 1, name: 'CRISP SNR', isOneShot: true, sampleDurationSec: 0.22, kind: 'sample' }],
    [2, { index: 2, name: 'CH HAT', isOneShot: true, sampleDurationSec: 0.08, kind: 'sample' }],
    [3, { index: 3, name: 'ACID 303', isOneShot: false, sampleDurationSec: null, kind: 'synth' }],
    [4, { index: 4, name: 'JUPITER PAD', isOneShot: false, sampleDurationSec: null, kind: 'synth' }],
    [5, { index: 5, name: 'FM ARP', isOneShot: false, sampleDurationSec: null, kind: 'synth' }],
    [6, { index: 6, name: 'PERC RIM', isOneShot: true, sampleDurationSec: 0.12, kind: 'sample' }],
    [7, { index: 7, name: 'VOX CHOP', isOneShot: true, sampleDurationSec: 0.45, kind: 'sample' }],
  ]);

  const patternConfigs = [
    { name: 'INTRO GROOVE', steps: 32, bpmChange: null as number | null, breakAt: null as number | null },
    { name: 'ACID DROP', steps: 32, bpmChange: null as number | null, breakAt: null as number | null },
    { name: 'TEMPO LIFT', steps: 32, bpmChange: 134, breakAt: 24 },
    { name: 'FINALE', steps: 32, bpmChange: 128, breakAt: null as number | null },
  ];

  const steps: CompiledStep[] = [];
  const allNotes: NoteEvent[] = [];
  const songRows: SongRowInfo[] = [];

  let currentTimeSec = 0;
  let currentStepFloat = 0;
  let currentBpm = 128;
  let nextId = 1;

  const bassSeq = [36, -1, -1, 36, -1, 39, -1, 43, 36, -1, 48, -1, 43, -1, 41, -1];
  const arpSeq = [60, 63, 67, 72, 67, 63, 60, 67, 65, 68, 72, 77, 72, 68, 65, 60];

  for (let row = 0; row < patternConfigs.length; row++) {
    const cfg = patternConfigs[row]!;
    const rowStartTime = currentTimeSec;
    const rowStartStep = currentStepFloat;
    const rowStartBpm = currentBpm;
    let rowStepCount = 0;

    for (let s = 0; s < cfg.steps; s++) {
      let fxTempo: FXBadge | null = null;
      if (s === 0 && cfg.bpmChange !== null) {
        currentBpm = cfg.bpmChange;
        fxTempo = { symbol: 'T', name: 'Tempo', value: currentBpm / 2, display: `T${currentBpm}` };
      }

      const stepDur = 60 / (currentBpm * STEPS_PER_BEAT);
      const stepNotes: NoteEvent[] = [];

      const pushNote = (
        trackIndex: number,
        rawNote: number,
        instIdx: number,
        fx1: FXBadge | null = null,
        fx2: FXBadge | null = null
      ) => {
        const inst = instruments.get(instIdx)!;
        const kind =
          rawNote === -4 ? 'off' : rawNote === -3 ? 'cut' : rawNote === -2 ? 'fade' : 'note';
        const ev: NoteEvent = {
          id: nextId++,
          trackIndex,
          songRow: row,
          patternIndex: row + 1,
          stepIndex: s,
          gridStepFloat: currentStepFloat,
          endStepFloat: currentStepFloat + 0.85,
          triggerTimeSec: currentTimeSec,
          endTimeSec: currentTimeSec + stepDur,
          rawNote,
          kind,
          noteLabel: formatMidiNote(rawNote),
          instrumentIndex: instIdx,
          instrumentName: inst.name,
          colorIndex: instIdx % 16,
          fx1,
          fx2,
        };
        stepNotes.push(ev);
        allNotes.push(ev);
      };

      // Track 0: 4-on-the-floor Kick
      if (s % 4 === 0) {
        pushNote(0, 36, 0, s === 0 ? fxTempo : null);
      }

      // Track 1: Snare on 4, 12
      if (row >= 1 && s % 8 === 4) {
        pushNote(1, 38, 1);
      }

      // Track 2: Off-beat Hats + 16th rolls
      if (s % 2 === 1 || (row >= 1 && s % 4 === 2)) {
        const rollFx: FXBadge | null =
          s === 15 || s === 31 ? { symbol: 'R', name: 'Roll', value: 3, display: 'R3' } : null;
        pushNote(2, 42, 2, rollFx);
      }

      // Track 3: Acid 303 Bassline
      const bassNote = bassSeq[s % bassSeq.length]!;
      if (bassNote >= 0) {
        const glideFx: FXBadge | null =
          s % 16 === 5 ? { symbol: 'G', name: 'Glide', value: 40, display: 'G40' } : null;
        pushNote(3, bassNote, 3, glideFx);
      } else if (s % 16 === 14) {
        pushNote(3, -4, 3); // OFF
      }

      // Track 4: Sustaining Pad Chords (every 16 steps)
      if (s % 16 === 0) {
        pushNote(4, s === 0 ? 48 : 53, 4);
      } else if (s === 30 && row === 3) {
        pushNote(4, -2, 4); // FAD
      }

      // Track 5: FM Arp (from row 1 onward)
      if (row >= 1) {
        const arpNote = arpSeq[s % arpSeq.length]!;
        if (s % 2 === 0 || row >= 2) {
          pushNote(5, arpNote, 5);
        }
      }

      // Track 6: Syncopated Rimshot
      if (s % 16 === 6 || s % 16 === 11) {
        pushNote(6, 50, 6);
      }

      // Track 7: Vox Chop on bar starts in row 1 & 3
      if ((row === 1 || row === 3) && s === 0) {
        pushNote(7, 60, 7);
      }

      steps.push({
        songRow: row,
        patternIndex: row + 1,
        patternName: cfg.name,
        stepIndex: s,
        gridStepFloat: currentStepFloat,
        timeSec: currentTimeSec,
        durationSec: stepDur,
        bpm: currentBpm,
        notes: stepNotes,
      });

      currentTimeSec += stepDur;
      currentStepFloat += 1;
      rowStepCount += 1;

      if (cfg.breakAt !== null && s === cfg.breakAt) {
        break;
      }
    }

    songRows.push({
      songRow: row,
      patternIndex: row + 1,
      patternName: cfg.name,
      startTimeSec: rowStartTime,
      endTimeSec: currentTimeSec,
      startStepFloat: rowStartStep,
      endStepFloat: currentStepFloat,
      stepCount: rowStepCount,
      bpm: rowStartBpm,
    });
  }

  // Compute sustain tails per track
  const notesByTrack: NoteEvent[][] = Array.from({ length: 8 }, () => []);
  for (const n of allNotes) notesByTrack[n.trackIndex]?.push(n);

  for (let t = 0; t < 8; t++) {
    const list = notesByTrack[t]!;
    for (let i = 0; i < list.length; i++) {
      const curr = list[i]!;
      if (curr.kind !== 'note') {
        curr.endStepFloat = curr.gridStepFloat + 0.65;
        curr.endTimeSec = curr.triggerTimeSec;
        continue;
      }
      const next = list[i + 1];
      let endStep = next ? next.gridStepFloat : currentStepFloat;
      let endTime = next ? next.triggerTimeSec : currentTimeSec;
      const inst = instruments.get(curr.instrumentIndex);
      if (inst?.isOneShot && inst.sampleDurationSec) {
        const sEnd = curr.triggerTimeSec + inst.sampleDurationSec;
        if (sEnd < endTime) {
          endTime = sEnd;
          endStep = Math.min(endStep, curr.gridStepFloat + Math.max(0.85, inst.sampleDurationSec / 0.117));
        }
      }
      curr.endStepFloat = Math.max(curr.gridStepFloat + 0.85, endStep - 0.12);
      curr.endTimeSec = Math.max(curr.triggerTimeSec, endTime);
    }
  }

  const tracks: TrackMeta[] = [
    { index: 0, name: 'KICK', hasEvents: true, primaryInstrumentName: '909 KICK', colorIndex: 0 },
    { index: 1, name: 'SNARE', hasEvents: true, primaryInstrumentName: 'CRISP SNR', colorIndex: 1 },
    { index: 2, name: 'HATS', hasEvents: true, primaryInstrumentName: 'CH HAT', colorIndex: 2 },
    { index: 3, name: 'BASS', hasEvents: true, primaryInstrumentName: 'ACID 303', colorIndex: 3 },
    { index: 4, name: 'PAD', hasEvents: true, primaryInstrumentName: 'JUPITER PAD', colorIndex: 4 },
    { index: 5, name: 'ARP', hasEvents: true, primaryInstrumentName: 'FM ARP', colorIndex: 5 },
    { index: 6, name: 'RIM', hasEvents: true, primaryInstrumentName: 'PERC RIM', colorIndex: 6 },
    { index: 7, name: 'VOX', hasEvents: true, primaryInstrumentName: 'VOX CHOP', colorIndex: 7 },
  ];

  const timeline: CompiledTimeline = {
    projectName: 'WEEKLY BEATS #42 (DEMO)',
    initialBpm: 128,
    totalDurationSec: currentTimeSec,
    totalSteps: currentStepFloat,
    maxTrackCount: 8,
    activeTrackIndices: [0, 1, 2, 3, 4, 5, 6, 7],
    tracks,
    instruments,
    songRows,
    steps,
    allNotes,
  };

  // Synthesize sample-locked stereo AudioBuffer
  const totalSamples = Math.ceil((currentTimeSec + 0.5) * sampleRate);
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Noise buffer for snare & hats
  const noiseLen = Math.floor(sampleRate * 0.3);
  const noiseBuf = offline.createBuffer(1, noiseLen, sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;

  const master = offline.createGain();
  master.gain.value = 0.72;
  master.connect(offline.destination);

  for (const n of allNotes) {
    if (n.kind !== 'note') continue;
    const t = n.triggerTimeSec;
    const dur = Math.max(0.06, n.endTimeSec - n.triggerTimeSec);

    if (n.trackIndex === 0) {
      // 909 Kick
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, t);
      osc.frequency.exponentialRampToValueAtTime(44, t + 0.08);
      gain.gain.setValueAtTime(0.95, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.29);
    } else if (n.trackIndex === 1) {
      // Crisp Snare
      const src = offline.createBufferSource();
      src.buffer = noiseBuf;
      const filter = offline.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1100;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      src.connect(filter).connect(gain).connect(master);
      src.start(t);
      src.stop(t + 0.2);
    } else if (n.trackIndex === 2) {
      // Closed Hat
      const src = offline.createBufferSource();
      src.buffer = noiseBuf;
      const filter = offline.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6500;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(0.24, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
      src.connect(filter).connect(gain).connect(master);
      src.start(t);
      src.stop(t + 0.06);
    } else if (n.trackIndex === 3) {
      // Acid 303 Bass
      const osc = offline.createOscillator();
      const filter = offline.createBiquadFilter();
      const gain = offline.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(n.rawNote), t);
      filter.type = 'lowpass';
      filter.Q.value = 7.5;
      filter.frequency.setValueAtTime(1800, t);
      filter.frequency.exponentialRampToValueAtTime(280, t + Math.min(dur, 0.22));
      gain.gain.setValueAtTime(0.36, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.25));
      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + Math.min(dur, 0.26));
    } else if (n.trackIndex === 4) {
      // Pad Chord (root + minor 3rd + 5th)
      for (const offset of [0, 3, 7]) {
        const osc = offline.createOscillator();
        const filter = offline.createBiquadFilter();
        const gain = offline.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(midiToFreq(n.rawNote + offset), t);
        filter.type = 'lowpass';
        filter.frequency.value = 1400;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.11, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(filter).connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
    } else if (n.trackIndex === 5) {
      // FM-ish Arp Lead
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(midiToFreq(n.rawNote), t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.15);
    } else if (n.trackIndex === 6) {
      // Rimshot
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(340, t + 0.04);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.08);
    } else if (n.trackIndex === 7) {
      // Vox-like Formant Chord Hit
      const osc = offline.createOscillator();
      const filter = offline.createBiquadFilter();
      const gain = offline.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(n.rawNote), t);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(950, t);
      filter.Q.value = 4;
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.36);
    }
  }

  const audioBuffer = await offline.startRendering();
  return { timeline, audioBuffer };
}
