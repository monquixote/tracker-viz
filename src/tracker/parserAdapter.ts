import Tracker, {
  AudioUtil,
  InstrumentPlayMode,
  PatternFX,
  type PatternData,
  type PatternsMetadata,
  type ProjectData,
  type StepData,
  type TrackData,
} from '@polyend/tracker-lib';
import type { InstrumentMeta } from '../types/timeline.ts';
import type { DiscoveredProjectFiles } from './projectDiscovery.ts';

export interface ExtendedStepData extends StepData {
  /** Tracker-CE v6 dedicated Volume/Velocity column (0..100), null if unset (0xFF) */
  volume?: number | null;
  /** Tracker-CE v6 dedicated Micro-move column (0..100), null if unset (0xFF) */
  microMove?: number | null;
}

export interface ParsedTrackerProject {
  projectName: string;
  project: ProjectData;
  patternsMetadata: PatternsMetadata | null;
  patterns: Map<number, PatternData>;
  instruments: Map<number, InstrumentMeta>;
}

function cleanInstrumentFilename(filename: string | undefined, fallbackIndex: number): string {
  if (!filename) return `INST ${String(fallbackIndex + 1).padStart(2, '0')}`;
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const noExt = base.replace(/\.(pti|wav)$/i, '').replace(/^\d+[_-]?/, '');
  return noExt.trim() || `INST ${String(fallbackIndex + 1).padStart(2, '0')}`;
}

/**
 * Parses 8-byte-step .mtp files (16432 bytes, used by Tracker+ / Tracker Mini FW 2.0+)
 * which @polyend/tracker-lib v0.1.2's 6-byte-step parser misaligns on.
 */
function parseExtendedPattern8Byte(buffer: ArrayBuffer): PatternData {
  const dv = new DataView(buffer);
  const idFile = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, 2));
  const type = dv.getUint16(2, true);
  const fwVersion = Array.from(new Uint8Array(buffer, 4, 4));
  const fileStructureVersion = Array.from(new Uint8Array(buffer, 8, 4)).join('.');
  const size = dv.getUint16(12, true);

  let offset = 28; // HEADER_SIZE (14) + PADDING_SIZE (2) + UNUSED_SIZE (12)
  const trackCount = 16;
  const stepCount = 128;
  const tracks: TrackData[] = [];

  for (let t = 0; t < trackCount; t++) {
    const rawLen = dv.getUint8(offset++);
    // Tracker+ / Mini stores 0-indexed max step (127 -> 128 steps)
    const length = Math.min(128, Math.max(1, rawLen + 1));
    const steps: ExtendedStepData[] = [];
    for (let s = 0; s < stepCount; s++) {
      const note = dv.getInt8(offset++);
      const instrument = dv.getUint8(offset++);
      const fx1Type = dv.getUint8(offset++);
      const fx1Val = dv.getUint8(offset++);
      const fx0Type = dv.getUint8(offset++);
      const fx0Val = dv.getUint8(offset++);
      const rawVolume = dv.getUint8(offset++);
      const rawMicroMove = dv.getUint8(offset++);

      const fx0Rec = PatternFX[fx0Type] ?? PatternFX[0]!;
      const fx1Rec = PatternFX[fx1Type] ?? PatternFX[0]!;

      steps.push({
        note,
        instrument,
        fx: [
          { type: fx0Rec, value: fx0Type === 0 ? 0 : fx0Val },
          { type: fx1Rec, value: fx1Type === 0 ? 0 : fx1Val },
        ],
        volume: rawVolume <= 100 ? rawVolume : null,
        microMove: rawMicroMove <= 100 ? rawMicroMove : null,
      });
    }
    tracks.push({ length, steps });
  }

  const crc = dv.getUint32(offset, true);
  return {
    header: { id_file: idFile, type, fwVersion, fileStructureVersion, size },
    tracks,
    crc,
    trackCount,
  };
}

async function readPatternFileSafe(file: File): Promise<PatternData | null> {
  // 16432 = 28 + 16 * (1 + 128 * 8) + 4 (Tracker+ / Mini FW 2.0+ 8-byte step format)
  if (file.size === 16432) {
    const buf = await file.arrayBuffer();
    return parseExtendedPattern8Byte(buf);
  }
  return Tracker.readPattern(file);
}

export async function parseDiscoveredProject(
  discovered: DiscoveredProjectFiles
): Promise<ParsedTrackerProject> {
  const project = await Tracker.readProject(discovered.projectMt);
  if (!project) {
    throw new Error(`Failed to parse project.mt for "${discovered.projectName}".`);
  }

  let patternsMetadata: PatternsMetadata | null = null;
  if (discovered.patternsMetadataFile) {
    try {
      patternsMetadata = await Tracker.readPatternsMetadata(discovered.patternsMetadataFile);
    } catch {
      patternsMetadata = null;
    }
  }

  // Only load patterns referenced in the song playlist (plus fallback if playlist is empty)
  const referencedIndices = new Set<number>();
  for (const idx of project.song.playlist) {
    if (idx > 0) referencedIndices.add(idx);
  }

  const patterns = new Map<number, PatternData>();
  const usesZeroBased = discovered.patternFiles.has(0);
  const patternEntries = Array.from(discovered.patternFiles.entries()).filter(
    ([idx]) =>
      referencedIndices.size === 0 ||
      (usesZeroBased ? referencedIndices.has(idx + 1) : referencedIndices.has(idx))
  );

  await Promise.all(
    patternEntries.map(async ([idx, file]) => {
      try {
        const pat = await readPatternFileSafe(file);
        if (pat) patterns.set(idx, pat);
      } catch (err) {
        console.warn(`Skipping unreadable pattern ${file.name}:`, err);
      }
    })
  );

  const instruments = new Map<number, InstrumentMeta>();
  await Promise.all(
    Array.from(discovered.instrumentFiles.entries()).map(async ([idx, file]) => {
      try {
        const inst = await Tracker.readInstrument(file);
        if (!inst) return;
        let sampleDurationSec: number | null = null;
        if (inst.wav && inst.wav.byteLength > 44) {
          try {
            const info = AudioUtil.getWavInfo(inst.wav);
            if (info && info.sampleRate > 0 && info.numFrames > 0) {
              sampleDurationSec = info.numFrames / info.sampleRate;
            }
          } catch {
            // Ignore malformed embedded WAV header
          }
        }
        const name = cleanInstrumentFilename(inst.sample?.filename || file.name, idx);
        instruments.set(idx, {
          index: idx,
          name,
          isOneShot: inst.playmode === InstrumentPlayMode.OneShot,
          sampleDurationSec,
          kind: 'sample',
        });
      } catch (err) {
        console.warn(`Skipping unreadable instrument ${file.name}:`, err);
      }
    })
  );

  const firstPat = patterns.get(0) ?? patterns.values().next().value;
  console.info('[tracker-viz] Loaded project:', {
    name: project.projectName,
    fw: project.header.fwVersion,
    structVer: project.header.fileStructureVersion,
    globalTempo: project.values.globalTempo,
    playlist: project.song.playlist.filter((x) => x > 0),
    patternKeys: Array.from(patterns.keys()).sort((a, b) => a - b),
    firstPatInfo: firstPat
      ? {
          header: firstPat.header,
          trackCount: firstPat.trackCount,
          trackLengths: firstPat.tracks.map((tr) => tr.length),
          nonEmptyNotesPerTrack: firstPat.tracks.map(
            (tr) => tr.steps.slice(0, tr.length || 64).filter((s) => s.note > 0).length
          ),
        }
      : null,
  });

  return {
    projectName: project.projectName?.trim() || discovered.projectName,
    project,
    patternsMetadata,
    patterns,
    instruments,
  };
}
