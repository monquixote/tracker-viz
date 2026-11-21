import Tracker from '@polyend/tracker-lib';
import type { DiscoveredProjectFiles } from './projectDiscovery.ts';

/** Compensates for the 300ms leading silence kept in public/demo/oceanic-frogs.mp3. */
export const BUNDLED_DEMO_LATENCY_OFFSET_MS = -300;

function demoUrl(relPath: string): string {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(relPath, baseUrl).href;
}

async function fetchAsFile(
  relPath: string,
  filename: string,
  mimeType = 'application/octet-stream'
): Promise<File> {
  const res = await fetch(demoUrl(relPath));
  if (!res.ok) {
    throw new Error(`Failed to fetch bundled demo asset "${relPath}" (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new File([buf], filename, { type: mimeType });
}

/**
 * Fetches the bundled Oceanic Frogs project & MP3 from public/demo/ and wraps
 * them into DiscoveredProjectFiles for the standard parser + compiler pipeline.
 */
export async function loadBundledDemoFiles(): Promise<DiscoveredProjectFiles> {
  const projectMt = await fetchAsFile('demo/project.mt', 'project.mt');
  const project = await Tracker.readProject(projectMt);
  if (!project) {
    throw new Error('Failed to parse bundled demo project.mt');
  }

  const referencedIndices = Array.from(
    new Set(project.song.playlist.filter((idx) => idx > 0))
  ).sort((a, b) => a - b);

  const patternsMetadataPromise = fetchAsFile(
    'demo/patterns/patternsMetadata',
    'patternsMetadata'
  ).catch(() => null);

  const patternEntriesPromise = Promise.all(
    referencedIndices.map(async (idx): Promise<[number, File]> => {
      const filename = `pattern_${String(idx).padStart(2, '0')}.mtp`;
      const file = await fetchAsFile(`demo/patterns/${filename}`, filename);
      return [idx, file];
    })
  );

  const [patternsMetadataFile, patternEntries, mp3File] = await Promise.all([
    patternsMetadataPromise,
    patternEntriesPromise,
    fetchAsFile('demo/oceanic-frogs.mp3', 'oceanic-frogs.mp3', 'audio/mpeg'),
  ]);

  return {
    projectName: project.projectName?.trim() || 'Oceanic Frogs',
    projectMt,
    patternsMetadataFile,
    patternFiles: new Map<number, File>(patternEntries),
    instrumentFiles: new Map<number, File>(),
    wavFile: mp3File,
    availableWavFiles: [{ name: mp3File.name, file: mp3File }],
  };
}
