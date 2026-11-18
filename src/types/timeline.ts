export type NoteKind = 'note' | 'off' | 'fade' | 'cut';

export type LaneMode = 'auto' | 8 | 12 | 16;

export type BackdropMode =
  | 'outrun'
  | 'waterfall'
  | 'demoscene'
  | 'hyperspace'
  | 'oscilloscope'
  | 'plasma'
  | 'none';

export type PatternDisplayMode = 'gantries' | 'marquee' | 'chromatic' | 'none';

export type CameraPreset = 'classic' | 'low' | 'top' | 'side';

export interface FXBadge {
  symbol: string;
  name: string;
  value: number;
  display: string;
}

export interface NoteEvent {
  id: number;
  trackIndex: number;
  songRow: number;
  patternIndex: number;
  stepIndex: number;
  /** Effective visual/trigger grid coordinate (baseGridStepFloat + timingOffsetSteps, 4 steps = 1 beat) */
  gridStepFloat: number;
  /** Un-shifted integer step position along the song timeline */
  baseGridStepFloat?: number;
  /** Combined fractional step offset from Swing FX ('I') and Micro-move ('m') */
  timingOffsetSteps?: number;
  /** End visual grid coordinate (for sustain tails) */
  endStepFloat: number;
  /** Exact audio trigger time in seconds */
  triggerTimeSec: number;
  /** End time in seconds */
  endTimeSec: number;
  /** MIDI note 0..127, or negative for OFF/FAD/CUT */
  rawNote: number;
  kind: NoteKind;
  /** Formatted tracker note string, e.g. "C-4", "F#3", "OFF", "FAD", "CUT" */
  noteLabel: string;
  instrumentIndex: number;
  instrumentName: string;
  /** Normalized 0..15 palette index */
  colorIndex: number;
  fx1: FXBadge | null;
  fx2: FXBadge | null;
}

export interface CompiledStep {
  songRow: number;
  patternIndex: number;
  patternName: string;
  stepIndex: number;
  gridStepFloat: number;
  timeSec: number;
  durationSec: number;
  bpm: number;
  /** Active Swing FX raw value (25..75, default 50) */
  swing?: number;
  notes: NoteEvent[];
}

export interface SongRowInfo {
  songRow: number;
  patternIndex: number;
  patternName: string;
  startTimeSec: number;
  endTimeSec: number;
  startStepFloat: number;
  endStepFloat: number;
  stepCount: number;
  bpm: number;
}

export interface TrackMeta {
  index: number;
  name: string;
  hasEvents: boolean;
  primaryInstrumentName: string;
  colorIndex: number;
}

export interface InstrumentMeta {
  index: number;
  name: string;
  isOneShot: boolean;
  sampleDurationSec: number | null;
  kind: 'sample' | 'midi' | 'synth';
}

export interface CompiledTimeline {
  projectName: string;
  initialBpm: number;
  totalDurationSec: number;
  totalSteps: number;
  maxTrackCount: number;
  activeTrackIndices: number[];
  tracks: TrackMeta[];
  instruments: Map<number, InstrumentMeta>;
  songRows: SongRowInfo[];
  steps: CompiledStep[];
  allNotes: NoteEvent[];
}

export interface FrameState {
  timeSec: number;
  isPlaying: boolean;
  songRow: number;
  patternIndex: number;
  patternName: string;
  stepIndex: number;
  /** 0.0 to 1.0 fractional progress within the current step */
  stepProgress: number;
  /** Continuous step position along the song timeline */
  gridStepFloat: number;
  bpm: number;
  activeMutes: boolean[];
  /** Notes within the visible Z-window [pastBuffer .. lookahead] */
  visibleNotes: NoteEvent[];
  /** Notes that crossed the trigger line between previous frame and this frame */
  justTriggeredNotes: NoteEvent[];
  /** Active FX badges on the current step */
  activeFxBadges: Array<{ trackIndex: number; badge: FXBadge }>;
}

/**
 * Decoupled data source adapter interface (Layer A -> Layer B).
 * Phase 1: File/Demo CompiledTimeline.
 * Phase 2/3: Live Web MIDI / tracker-ce USB Serial.
 */
export interface DataSourceAdapter {
  readonly id: string;
  readonly label: string;
  getTimeline(): CompiledTimeline | null;
}
