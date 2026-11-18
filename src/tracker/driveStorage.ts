import { get, set, del } from 'idb-keyval';

const ROOT_HANDLE_KEY = 'tracker-viz:root-dir-handle';

export interface VirtualFileEntry {
  /** Normalized relative path using forward slashes, e.g. "Projects/MySong/project.mt" */
  relativePath: string;
  file: File;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function mountTrackerDrive(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      'File System Access API (showDirectoryPicker) is not supported in this browser. Use folder drag-and-drop or the file picker instead.'
    );
  }
  const picker = window.showDirectoryPicker as (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;

  const handle = await picker({ id: 'polyend-tracker-drive', mode: 'read' });
  await set(ROOT_HANDLE_KEY, handle);
  return handle;
}

export async function getSavedRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await get<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
    return handle ?? null;
  } catch {
    return null;
  }
}

export async function clearSavedRootHandle(): Promise<void> {
  try {
    await del(ROOT_HANDLE_KEY);
  } catch {
    // Ignore storage cleanup errors
  }
}

export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded = true
): Promise<boolean> {
  type PermissionHandle = FileSystemDirectoryHandle & {
    queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const h = handle as PermissionHandle;
  if (!h.queryPermission) return true;

  const state = await h.queryPermission({ mode: 'read' });
  if (state === 'granted') return true;
  if (!requestIfNeeded || !h.requestPermission) return false;

  const requested = await h.requestPermission({ mode: 'read' });
  return requested === 'granted';
}

export async function getSubdir(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

export async function getFileInDir(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<File | null> {
  try {
    const fh = await parent.getFileHandle(name, { create: false });
    return await fh.getFile();
  } catch {
    return null;
  }
}

/**
 * Recursively collect files from a FileList (from <input webkitdirectory>)
 * into normalized VirtualFileEntry objects.
 */
export function collectFilesFromFileList(fileList: FileList): VirtualFileEntry[] {
  const entries: VirtualFileEntry[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList.item(i);
    if (!file) continue;
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    entries.push({ relativePath: rel, file });
  }
  return entries;
}
