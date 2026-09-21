import { memoryToMarkdown } from './export-data';
import type { LibraryState, MemoryEntry } from './memory-store';

const DATABASE_NAME = 'shinian-memoir-files';
const STORE_NAME = 'handles';
const DIRECTORY_KEY = 'backup-directory';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地备份数据库。'));
  });
}

async function storeDirectoryHandle(
  handle: FileSystemDirectoryHandle | null,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = handle ? store.put(handle, DIRECTORY_KEY) : store.delete(DIRECTORY_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('无法保存备份目录。'));
  });
  database.close();
}

export async function restoreDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!('indexedDB' in globalThis)) {
    return null;
  }

  try {
    const database = await openDatabase();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('无法读取备份目录。'));
    });
    database.close();
    return handle;
  } catch {
    return null;
  }
}

export function supportsDirectoryBackup(): boolean {
  return typeof window.showDirectoryPicker === 'function' && 'indexedDB' in globalThis;
}

export async function chooseBackupDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsDirectoryBackup() || !window.showDirectoryPicker) {
    throw new Error('当前浏览器不支持本地文件夹备份，请使用新版 Chrome 或 Edge。');
  }

  const handle = await window.showDirectoryPicker({
    id: 'shinian-memoir-backup',
    mode: 'readwrite',
  });
  await storeDirectoryHandle(handle);
  return handle;
}

export async function ensureDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  const options = { mode: 'readwrite' as const };
  const current = await handle.queryPermission(options);
  if (current === 'granted') {
    return true;
  }
  if (!request) {
    return false;
  }
  return (await handle.requestPermission(options)) === 'granted';
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function safeFileName(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return safe || fallback;
}

export async function writeDirectoryBackup(
  directory: FileSystemDirectoryHandle,
  state: LibraryState,
  orderedMemories: readonly MemoryEntry[],
): Promise<number> {
  if (!(await ensureDirectoryPermission(directory, false))) {
    throw new Error('备份文件夹需要重新授权。');
  }

  await writeFile(
    directory,
    '拾年备份.json',
    JSON.stringify(
      {
        schema: 'shinian-memoir/v3',
        savedAt: new Date().toISOString(),
        library: state,
      },
      null,
      2,
    ),
  );

  const entriesDirectory = await directory.getDirectoryHandle('篇章', { create: true });
  for (const [index, memory] of orderedMemories.entries()) {
    const name = `${String(index + 1).padStart(3, '0')}-${safeFileName(memory.title, '未命名')}.md`;
    await writeFile(entriesDirectory, name, memoryToMarkdown(memory));
  }

  if (state.book.preface.trim()) {
    await writeFile(directory, '序.md', `# 序\n\n${state.book.preface.trim()}\n`);
  }
  if (state.book.afterword.trim()) {
    await writeFile(directory, '后记.md', `# 后记\n\n${state.book.afterword.trim()}\n`);
  }

  await writeFile(
    directory,
    'README.txt',
    `拾年回忆录自动备份\n\n最后保存：${new Date().toLocaleString('zh-CN')}\n篇章数量：${orderedMemories.length}\n\n每篇回忆保存在“篇章”文件夹中，元数据在“拾年备份.json”。\n`,
  );

  return orderedMemories.length;
}

export async function forgetBackupDirectory(): Promise<void> {
  await storeDirectoryHandle(null);
}