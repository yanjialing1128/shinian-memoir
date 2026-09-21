import { describe, expect, it } from 'vitest';
import {
  LEGACY_LIBRARY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  createEmptyLibraryState,
  createMemory,
  loadLibraryState,
  parseStoredLibraryState,
  saveLibraryState,
  type MemoryEntry,
  type StorageLike,
} from '../src/storage/memory-store';

function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): StorageLike {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('memory store', () => {
  it('creates a version 3 local memory entry', () => {
    const memory = createMemory({
      title: '  开学第一天  ',
      timeText: ' 初一上学期 ',
      body: '  那天下了雨。  ',
      sourceFileName: '开学.docx',
      titleOrigin: 'original',
      bookGroup: '初中',
      now: new Date('2026-09-20T10:00:00.000Z'),
    });

    expect(memory.title).toBe('开学第一天');
    expect(memory.timeText).toBe('初一上学期');
    expect(memory.sourceFileName).toBe('开学.docx');
    expect(memory.bookGroup).toBe('初中');
    expect(memory.includedInBook).toBe(true);
    expect(memory.updatedAt).toBe('2026-09-20T10:00:00.000Z');
  });

  it('round-trips the version 3 library state through a local storage adapter', () => {
    const storage = createMemoryStorage();
    const memory = createMemory({
      title: '操场',
      timeText: '2004年秋',
      body: '风吹过旗杆。',
      now: new Date('2026-09-20T10:00:00.000Z'),
    });
    const state = {
      ...createEmptyLibraryState(),
      memories: [memory],
      orderMode: 'manual' as const,
    };

    expect(saveLibraryState(storage, state)).toBe(true);
    expect(loadLibraryState(storage)).toEqual(state);
  });

  it('migrates old v1 entries into the v3 library', () => {
    const legacy: MemoryEntry[] = [
      {
        id: 'legacy-1',
        title: '旧篇章',
        timeText: '初二下学期',
        body: '旧正文',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        sourceFileName: null,
        titleOrigin: 'original',
        manualOrder: 0,
        includedInBook: true,
        bookGroup: '',
      },
    ];
    const storage = createMemoryStorage({
      [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify(legacy),
    });

    const loaded = loadLibraryState(storage);

    expect(loaded.version).toBe(3);
    expect(loaded.memories).toHaveLength(1);
    expect(storage.getItem(LIBRARY_STORAGE_KEY)).not.toBeNull();
  });

  it('migrates v2 book state and fills the new preface/group fields', () => {
    const rawV2 = JSON.stringify({
      version: 2,
      memories: [
        {
          id: 'v2-1',
          title: '旧教室',
          timeText: '2005年',
          body: '窗边有雾。',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          sourceFileName: null,
          titleOrigin: 'original',
          manualOrder: null,
          includedInBook: true,
        },
      ],
      orderMode: 'auto',
      book: {
        title: '旧书',
        subtitle: '',
        author: '我',
        chapterMode: 'academic-year',
      },
    });
    const storage = createMemoryStorage({ [LEGACY_LIBRARY_STORAGE_KEY]: rawV2 });
    const loaded = loadLibraryState(storage);

    expect(loaded.version).toBe(3);
    expect(loaded.book.preface).toBe('');
    expect(loaded.book.afterword).toBe('');
    expect(loaded.memories[0]?.bookGroup).toBe('');
  });

  it('ignores malformed stored state', () => {
    expect(parseStoredLibraryState('{not json')).toEqual(createEmptyLibraryState());
    expect(parseStoredLibraryState(JSON.stringify({ version: 1 }))).toEqual(
      createEmptyLibraryState(),
    );
  });
});