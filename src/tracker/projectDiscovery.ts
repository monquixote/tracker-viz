import { getFileInDir, getSubdir, type VirtualFileEntry } from './driveStorage.ts';

export interface DiscoveredProjectFiles {
  projectName: string;
  projectMt: File;
  patternsMetadataFile: File | null;
  patternFiles: Map<number, File>;
  instrumentFiles: Map<number, File>;
  wavFile: File | null;
  availableWavFiles: Array<{ name: string; file: File }>;
}

async function findSubdirCaseInsensitive(
  parent: FileSystemDirectoryHandle,
  candidates: string[]
): Promise<FileSystemDirectoryHandle | null> {
  for (const name of candidates) {
    const exact = await getSubdir(parent, name);
    if (exact) return exact;
  }
  const lowerCandidates = new Set(candidates.map((c) => c.toLowerCase()));
  for await (const [entryName, handle] of parent.entries()) {
    if (handle.kind === 'directory' && lowerCandidates.has(entryName.toLowerCase())) {
      return handle as FileSystemDirectoryHandle;
    }
  }
  return null;
}

async function findFileCaseInsensitive(
  parent: FileSystemDirectoryHandle,
  targetName: string
): Promise<File | null> {
  const exact = await getFileInDir(parent, targetName);
  if (exact) return exact;
  const lower = targetName.toLowerCase();
  for await (const [entryName, handle] of parent.entries()) {
    if (handle.kind === 'file' && entryName.toLowerCase() === lower) {
      return (handle as FileSystemFileHandle).getFile();
    }
  }
  return null;
}

function parsePatternIndexFromFilename(filename: string): number | null {
  // Matches pattern_01.mtp, pattern_1.mtp, 01.mtp, etc.
  const match = filename.match(/(\d+)\.mtp$/i);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

function parseInstrumentIndexFromFilename(filename: string): number | null {
  // Matches 00_kick.pti, 01.pti, inst_02.pti, etc.
  const leading = filename.match(/^(\d+).*\.pti$/i);
  if (leading?.[1]) return parseInt(leading[1], 10);
  const anyNum = filename.match(/(\d+)\.pti$/i);
  if (anyNum?.[1]) return parseInt(anyNum[1], 10);
  return null;
}

async function scanProjectDirectoryHandle(
  projectDir: FileSystemDirectoryHandle,
  exportDir: FileSystemDirectoryHandle | null
): Promise<DiscoveredProjectFiles> {
  const projectMt = await findFileCaseInsensitive(projectDir, 'project.mt');
  if (!projectMt) {
    throw new Error(`No project.mt found in "${projectDir.name}"`);
  }

  const patternsDir = await findSubdirCaseInsensitive(projectDir, ['patterns']);
  const instrumentsDir = await findSubdirCaseInsensitive(projectDir, ['instruments']);

  const patternFiles = new Map<number, File>();
  let patternsMetadataFile: File | null = null;

  if (patternsDir) {
    for await (const [name, handle] of patternsDir.entries()) {
      if (handle.kind !== 'file') continue;
      const lower = name.toLowerCase();
      if (
        lower === 'patternsmetadata' ||
        lower === 'patterns.mtp' ||
        lower === 'patternsmetadata.mtp' ||
        lower === 'metadata.mtp'
      ) {
        patternsMetadataFile = await (handle as FileSystemFileHandle).getFile();
        continue;
      }
      if (lower.endsWith('.mtp')) {
        const idx = parsePatternIndexFromFilename(name);
        if (idx !== null) {
          patternFiles.set(idx, await (handle as FileSystemFileHandle).getFile());
        }
      }
    }
  }

  const instrumentFiles = new Map<number, File>();
  if (instrumentsDir) {
    let fallbackIdx = 0;
    for await (const [name, handle] of instrumentsDir.entries()) {
      if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.pti')) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      const idx = parseInstrumentIndexFromFilename(name);
      instrumentFiles.set(idx ?? fallbackIdx++, file);
    }
  }

  // Collect WAV candidates from Export/ and project root
  const availableWavFiles: Array<{ name: string; file: File }> = [];
  const dirsToCheck = [exportDir, projectDir].filter(Boolean) as FileSystemDirectoryHandle[];
  for (const dir of dirsToCheck) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.wav')) {
        const file = await (handle as FileSystemFileHandle).getFile();
        availableWavFiles.push({ name, file });
      }
    }
  }

  // Sort WAVs: prefer name matching projectDir.name, then most recently modified
  const projLower = projectDir.name.toLowerCase();
  availableWavFiles.sort((a, b) => {
    const aMatch = a.name.toLowerCase().includes(projLower) ? 1 : 0;
    const bMatch = b.name.toLowerCase().includes(projLower) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.file.lastModified - a.file.lastModified;
  });

  return {
    projectName: projectDir.name,
    projectMt,
    patternsMetadataFile,
    patternFiles,
    instrumentFiles,
    wavFile: availableWavFiles[0]?.file ?? null,
    availableWavFiles,
  };
}

export interface ProjectCandidate {
  name: string;
  relativePath: string;
  lastModified: number;
  dirHandle: FileSystemDirectoryHandle;
}

export interface TrackerDriveCatalog {
  projects: ProjectCandidate[];
  exportDir: FileSystemDirectoryHandle | null;
  availableWavs: Array<{ name: string; file: File }>;
}

async function collectProjectsRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  out: ProjectCandidate[]
): Promise<void> {
  if (depth > 4) return;

  const mtFile = await findFileCaseInsensitive(dir, 'project.mt');
  if (mtFile) {
    let maxMod = mtFile.lastModified;
    const patternsDir = await findSubdirCaseInsensitive(dir, ['patterns']);
    if (patternsDir) {
      for await (const [pName, pHandle] of patternsDir.entries()) {
        if (pHandle.kind === 'file' && pName.toLowerCase().endsWith('.mtp')) {
          const f = await (pHandle as FileSystemFileHandle).getFile();
          if (f.lastModified > maxMod) maxMod = f.lastModified;
        }
      }
    }
    out.push({
      name: dir.name,
      relativePath: prefix ? `${prefix}/${dir.name}` : dir.name,
      lastModified: maxMod,
      dirHandle: dir,
    });
    return;
  }

  for await (const [entryName, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    const lower = entryName.toLowerCase();
    if (lower === 'patterns' || lower === 'instruments' || lower.startsWith('.')) continue;
    await collectProjectsRecursive(
      handle as FileSystemDirectoryHandle,
      prefix ? `${prefix}/${entryName}` : entryName,
      depth + 1,
      out
    );
  }
}

async function collectWavsRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  out: Array<{ name: string; file: File }>
): Promise<void> {
  if (depth > 3) return;
  for await (const [entryName, handle] of dir.entries()) {
    if (entryName.startsWith('.')) continue;
    if (handle.kind === 'file' && entryName.toLowerCase().endsWith('.wav')) {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({
        name: prefix ? `${prefix}/${entryName}` : entryName,
        file,
      });
    } else if (handle.kind === 'directory') {
      await collectWavsRecursive(
        handle as FileSystemDirectoryHandle,
        prefix ? `${prefix}/${entryName}` : entryName,
        depth + 1,
        out
      );
    }
  }
}

/**
 * Recursively lists all valid projects in /Projects/ (any subfolder depth)
 * and all WAVs in /Export/, /Exports/, /Audio/, /Recordings/, or root.
 */
export async function listProjectsFromDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle
): Promise<TrackerDriveCatalog> {
  const directMt = await findFileCaseInsensitive(rootHandle, 'project.mt');
  if (directMt) {
    const localWavs: Array<{ name: string; file: File }> = [];
    await collectWavsRecursive(rootHandle, '', 0, localWavs);
    return {
      projects: [
        {
          name: rootHandle.name,
          relativePath: rootHandle.name,
          lastModified: directMt.lastModified,
          dirHandle: rootHandle,
        },
      ],
      exportDir: null,
      availableWavs: localWavs,
    };
  }

  const projectsDir = await findSubdirCaseInsensitive(rootHandle, ['Projects', 'Project']);
  const exportDir = await findSubdirCaseInsensitive(rootHandle, ['Export', 'Exports']);

  const projects: ProjectCandidate[] = [];
  if (projectsDir) {
    await collectProjectsRecursive(projectsDir, '', 0, projects);
  } else {
    // Fallback: user may have picked a subfolder inside /Projects directly
    await collectProjectsRecursive(rootHandle, '', 0, projects);
  }

  if (projects.length === 0) {
    throw new Error(
      `No valid Polyend Tracker projects (with project.mt) found inside "${rootHandle.name}".`
    );
  }

  projects.sort((a, b) => b.lastModified - a.lastModified || a.relativePath.localeCompare(b.relativePath));

  const availableWavs: Array<{ name: string; file: File }> = [];
  const wavFolders = ['Export', 'Exports', 'Audio', 'Recordings', 'Render', 'Renders'];
  for (const folderName of wavFolders) {
    const sub = await findSubdirCaseInsensitive(rootHandle, [folderName]);
    if (sub) {
      await collectWavsRecursive(sub, sub.name, 0, availableWavs);
    }
  }
  // Also check root-level .wav files
  for await (const [entryName, handle] of rootHandle.entries()) {
    if (handle.kind === 'file' && entryName.toLowerCase().endsWith('.wav')) {
      const file = await (handle as FileSystemFileHandle).getFile();
      availableWavs.push({ name: entryName, file });
    }
  }

  availableWavs.sort((a, b) => b.file.lastModified - a.file.lastModified);

  return { projects, exportDir, availableWavs };
}

export async function loadProjectFromDirectoryHandle(
  projectDir: FileSystemDirectoryHandle,
  exportDir: FileSystemDirectoryHandle | null
): Promise<DiscoveredProjectFiles> {
  return scanProjectDirectoryHandle(projectDir, exportDir);
}

/**
 * Discovers the latest project from a Polyend Tracker SD root handle
 * (containing /Projects and /Export) OR from a direct project folder handle.
 */
export async function discoverLatestFromDirectoryHandle(
  rootHandle: FileSystemDirectoryHandle
): Promise<DiscoveredProjectFiles> {
  const catalog = await listProjectsFromDirectoryHandle(rootHandle);
  const latest = catalog.projects[0];
  if (!latest) {
    throw new Error('No valid Polyend Tracker projects (with project.mt) found in /Projects/.');
  }
  return scanProjectDirectoryHandle(latest.dirHandle, catalog.exportDir);
}

/**
 * Discovers a project from a flat list of dropped/input files.
 */
export function discoverFromVirtualFiles(entries: VirtualFileEntry[]): DiscoveredProjectFiles {
  const mtEntries = entries.filter((e) => e.relativePath.toLowerCase().endsWith('/project.mt') || e.relativePath.toLowerCase() === 'project.mt');
  if (mtEntries.length === 0) {
    throw new Error('No project.mt file found in the selected folder.');
  }

  // Pick the most recently modified project.mt
  mtEntries.sort((a, b) => b.file.lastModified - a.file.lastModified);
  const chosenMt = mtEntries[0]!;
  const mtPathParts = chosenMt.relativePath.split('/');
  mtPathParts.pop(); // remove "project.mt"
  const projectPrefix = mtPathParts.length > 0 ? mtPathParts.join('/') + '/' : '';
  const projectName = mtPathParts[mtPathParts.length - 1] || 'Tracker Project';

  const patternFiles = new Map<number, File>();
  let patternsMetadataFile: File | null = null;
  const instrumentFiles = new Map<number, File>();
  const availableWavFiles: Array<{ name: string; file: File }> = [];

  for (const entry of entries) {
    const rel = entry.relativePath;
    const lower = rel.toLowerCase();

    if (lower.endsWith('.wav')) {
      availableWavFiles.push({ name: entry.file.name, file: entry.file });
      continue;
    }

    if (projectPrefix && !rel.startsWith(projectPrefix)) continue;
    const sub = rel.slice(projectPrefix.length);
    const subLower = sub.toLowerCase();

    if (subLower.startsWith('patterns/')) {
      const base = sub.split('/').pop() ?? '';
      const baseLower = base.toLowerCase();
      if (
        baseLower === 'patternsmetadata' ||
        baseLower === 'patterns.mtp' ||
        baseLower === 'patternsmetadata.mtp' ||
        baseLower === 'metadata.mtp'
      ) {
        patternsMetadataFile = entry.file;
      } else if (subLower.endsWith('.mtp')) {
        const idx = parsePatternIndexFromFilename(base);
        if (idx !== null) patternFiles.set(idx, entry.file);
      }
    } else if (subLower.startsWith('instruments/') && subLower.endsWith('.pti')) {
      const base = sub.split('/').pop() ?? '';
      const idx = parseInstrumentIndexFromFilename(base);
      if (idx !== null) instrumentFiles.set(idx, entry.file);
    }
  }

  const projLower = projectName.toLowerCase();
  availableWavFiles.sort((a, b) => {
    const aMatch = a.name.toLowerCase().includes(projLower) ? 1 : 0;
    const bMatch = b.name.toLowerCase().includes(projLower) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.file.lastModified - a.file.lastModified;
  });

  return {
    projectName,
    projectMt: chosenMt.file,
    patternsMetadataFile,
    patternFiles,
    instrumentFiles,
    wavFile: availableWavFiles[0]?.file ?? null,
    availableWavFiles,
  };
}
