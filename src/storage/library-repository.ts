import { sortMemories } from '../time';
import { parseMemoirMarkdown, serializeMemoirMarkdown } from './file-format';
import {
  createEmptyLibraryState,
  loadLibraryState,
  parseStoredLibraryState,
  saveLibraryState,
  type LibraryState,
  type MemoryEntry,
} from './memory-store';

export interface FileEntryInfo {
  readonly name: string;
  readonly isFile: boolean;
}

export interface FileLibraryAdapter {
  ensureDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<readonly FileEntryInfo[]>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface LibraryLoadResult {
  readonly state: LibraryState;
  readonly migratedCount: number;
  readonly middleSchoolStartYear: number;
  readonly highSchoolStartYear: number;
}

export interface LibraryRepository {
  readonly kind: 'browser' | 'tauri';
  load(): Promise<LibraryLoadResult>;
  save(state: LibraryState): Promise<void>;
}

interface FileRepositoryOptions {
  readonly memoirDirectory: string;
  readonly metaPath: string;
  readonly joinPath: (...parts: string[]) => Promise<string>;
  readonly adapter: FileLibraryAdapter;
  readonly loadLegacyState: () => LibraryState;
  readonly clearLegacyStorage: () => void;
  readonly middleSchoolStartYear: number;
  readonly highSchoolStartYear: number;
}

interface DesktopMeta {
  readonly version: 1;
  readonly preface: string;
  readonly afterword: string;
  readonly groups: readonly string[];
  readonly middleSchoolStartYear: number;
  readonly highSchoolStartYear: number;
  readonly orderMode?: 'auto' | 'manual';
  readonly book?: LibraryState['book'];
  readonly people?: LibraryState['people'];
  readonly backupDirectoryName?: string | null;
}

function orderedMemories(state: LibraryState): readonly MemoryEntry[] {
  if (state.orderMode === 'auto') return sortMemories(state.memories).map((entry) => entry.item);
  return [...state.memories].sort((left, right) => {
    const leftOrder = left.manualOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.manualOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.createdAt.localeCompare(right.createdAt);
  });
}

function memoirFileName(id: string): string {
  return `${id.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')}.md`;
}

export class FileLibraryRepository implements LibraryRepository {
  readonly kind = 'tauri' as const;

  constructor(private readonly options: FileRepositoryOptions) {}

  private async writeMeta(state: LibraryState): Promise<void> {
    const meta: DesktopMeta = {
      version: 1,
      preface: state.book.preface,
      afterword: state.book.afterword,
      groups: [...new Set(state.memories.map((memory) => memory.bookGroup).filter(Boolean))],
      middleSchoolStartYear: this.options.middleSchoolStartYear,
      highSchoolStartYear: this.options.highSchoolStartYear,
      orderMode: state.orderMode,
      book: state.book,
      people: state.people,
      backupDirectoryName: state.backupDirectoryName,
    };
    await this.options.adapter.writeText(this.options.metaPath, JSON.stringify(meta, null, 2));
  }

  private async writeMemories(state: LibraryState): Promise<ReadonlySet<string>> {
    const expected = new Set<string>();
    const ordered = orderedMemories(state);
    for (const [index, memory] of ordered.entries()) {
      const fileName = memoirFileName(memory.id);
      expected.add(fileName);
      await this.options.adapter.writeText(
        await this.options.joinPath(this.options.memoirDirectory, fileName),
        serializeMemoirMarkdown(memory, index + 1),
      );
    }
    return expected;
  }

  private async removeStaleMemoirFiles(expected: ReadonlySet<string>): Promise<void> {
    const entries = await this.options.adapter.listDirectory(this.options.memoirDirectory);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith('.md'))
        .filter((entry) => !expected.has(entry.name))
        .map(async (entry) =>
          this.options.adapter.remove(
            await this.options.joinPath(this.options.memoirDirectory, entry.name),
          ),
        ),
    );
  }

  private async writeAll(state: LibraryState): Promise<void> {
    const expected = await this.writeMemories(state);
    await this.removeStaleMemoirFiles(expected);
    await this.writeMeta(state);
  }

  private async loadMemories(): Promise<readonly MemoryEntry[]> {
    const entries = await this.options.adapter.listDirectory(this.options.memoirDirectory);
    const memories: MemoryEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md')) continue;
      const text = await this.options.adapter.readText(
        await this.options.joinPath(this.options.memoirDirectory, entry.name),
      );
      const memory = parseMemoirMarkdown(text);
      if (memory) memories.push(memory);
    }
    return memories.sort((left, right) => {
      const leftOrder = left.manualOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.manualOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.createdAt.localeCompare(right.createdAt);
    });
  }

  private async loadMeta(): Promise<{
    readonly state: LibraryState;
    readonly middleSchoolStartYear: number;
    readonly highSchoolStartYear: number;
  }> {
    if (!(await this.options.adapter.exists(this.options.metaPath))) {
      return {
        state: createEmptyLibraryState(),
        middleSchoolStartYear: this.options.middleSchoolStartYear,
        highSchoolStartYear: this.options.highSchoolStartYear,
      };
    }

    const raw = await this.options.adapter.readText(this.options.metaPath);
    try {
      const meta = JSON.parse(raw) as DesktopMeta;
      const state = parseStoredLibraryState(
        JSON.stringify({
          version: 3,
          memories: [],
          orderMode: meta.orderMode,
          book: meta.book
            ? {
                ...meta.book,
                preface: meta.preface ?? meta.book.preface,
                afterword: meta.afterword ?? meta.book.afterword,
              }
            : { preface: meta.preface, afterword: meta.afterword },
          people: meta.people,
          backupDirectoryName: meta.backupDirectoryName,
        }),
      );
      return {
        state,
        middleSchoolStartYear:
          Number.isInteger(meta.middleSchoolStartYear) && meta.middleSchoolStartYear > 1900
            ? meta.middleSchoolStartYear
            : this.options.middleSchoolStartYear,
        highSchoolStartYear:
          Number.isInteger(meta.highSchoolStartYear) && meta.highSchoolStartYear > 1900
            ? meta.highSchoolStartYear
            : this.options.highSchoolStartYear,
      };
    } catch {
      return {
        state: createEmptyLibraryState(),
        middleSchoolStartYear: this.options.middleSchoolStartYear,
        highSchoolStartYear: this.options.highSchoolStartYear,
      };
    }
  }

  async load(): Promise<LibraryLoadResult> {
    await this.options.adapter.ensureDirectory(this.options.memoirDirectory);
    const memories = await this.loadMemories();

    if (memories.length > 0) {
      const meta = await this.loadMeta();
      return {
        state: { ...meta.state, version: 3, memories },
        migratedCount: 0,
        middleSchoolStartYear: meta.middleSchoolStartYear,
        highSchoolStartYear: meta.highSchoolStartYear,
      };
    }

    const legacy = this.options.loadLegacyState();
    if (legacy.memories.length > 0) {
      await this.writeAll(legacy);
      this.options.clearLegacyStorage();
      return {
        state: legacy,
        migratedCount: legacy.memories.length,
        middleSchoolStartYear: this.options.middleSchoolStartYear,
        highSchoolStartYear: this.options.highSchoolStartYear,
      };
    }

    return {
      state: createEmptyLibraryState(),
      migratedCount: 0,
      middleSchoolStartYear: this.options.middleSchoolStartYear,
      highSchoolStartYear: this.options.highSchoolStartYear,
    };
  }

  async save(state: LibraryState): Promise<void> {
    await this.options.adapter.ensureDirectory(this.options.memoirDirectory);
    await this.writeAll(state);
  }
}

export class BrowserLibraryRepository implements LibraryRepository {
  readonly kind = 'browser' as const;

  load(): Promise<LibraryLoadResult> {
    return Promise.resolve({
      state: loadLibraryState(localStorage),
      migratedCount: 0,
      middleSchoolStartYear: 2003,
      highSchoolStartYear: 2006,
    });
  }

  save(state: LibraryState): Promise<void> {
    if (!saveLibraryState(localStorage, state)) {
      return Promise.reject(new Error('浏览器本地存储写入失败。'));
    }
    return Promise.resolve();
  }
}

async function createTauriRepository(): Promise<LibraryRepository> {
  const [{ appLocalDataDir, join }, fs] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const appData = await appLocalDataDir();
  const memoirDirectory = await join(appData, 'memoirs');
  const metaPath = await join(appData, 'meta.json');
  return new FileLibraryRepository({
    memoirDirectory,
    metaPath,
    joinPath: join,
    middleSchoolStartYear: 2003,
    highSchoolStartYear: 2006,
    loadLegacyState: () => loadLibraryState(localStorage),
    clearLegacyStorage: () => localStorage.clear(),
    adapter: {
      ensureDirectory: (path) => fs.mkdir(path, { recursive: true }),
      listDirectory: async (path) =>
        (await fs.readDir(path)).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile,
        })),
      exists: (path) => fs.exists(path),
      readText: (path) => fs.readTextFile(path),
      writeText: (path, content) => fs.writeTextFile(path, content),
      remove: (path) => fs.remove(path),
    },
  });
}

export async function createLibraryRepository(): Promise<LibraryRepository> {
  return '__TAURI_INTERNALS__' in window ? createTauriRepository() : new BrowserLibraryRepository();
}