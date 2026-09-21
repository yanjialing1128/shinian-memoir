import { describe, expect, it } from 'vitest';
import { writeDirectoryBackup } from '../src/storage/directory-backup';
import { createEmptyLibraryState, createMemory } from '../src/storage/memory-store';

interface FakeFileHandle {
  createWritable(): Promise<{ write(data: string | BufferSource | Blob): Promise<void>; close(): Promise<void> }>;
}

function createFakeDirectory(files: Map<string, string>, prefix = ''): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: prefix || 'backup',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFileHandle: async (name: string): Promise<FakeFileHandle> => ({
      createWritable: async () => ({
        write: async (data) => {
          files.set(`${prefix}${name}`, typeof data === 'string' ? data : String(data));
        },
        close: async () => undefined,
      }),
    }),
    getDirectoryHandle: async (name: string): Promise<FileSystemDirectoryHandle> =>
      createFakeDirectory(files, `${prefix}${name}/`),
    removeEntry: async () => undefined,
    values: async function* () {},
  } as unknown as FileSystemDirectoryHandle;
}

describe('directory backup', () => {
  it('writes metadata and one markdown file per entry', async () => {
    const files = new Map<string, string>();
    const memory = createMemory({
      title: '旧操场',
      timeText: '2018年秋',
      body: '风吹过看台。',
      bookGroup: '那些地方',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const state = {
      ...createEmptyLibraryState(),
      memories: [memory],
      book: { ...createEmptyLibraryState().book, preface: '序言', afterword: '后记' },
    };

    const count = await writeDirectoryBackup(createFakeDirectory(files), state, [memory]);

    expect(count).toBe(1);
    expect(files.has('拾年备份.json')).toBe(true);
    expect(files.has('篇章/001-旧操场.md')).toBe(true);
    expect(files.get('序.md')).toContain('序言');
    expect(files.get('后记.md')).toContain('后记');
  });
});