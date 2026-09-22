import { describe, expect, it } from 'vitest';
import { serializeMemoirMarkdown } from '../src/storage/file-format';
import {
  FileLibraryRepository,
  type FileEntryInfo,
  type FileLibraryAdapter,
} from '../src/storage/library-repository';
import { createEmptyLibraryState, createMemory, type LibraryState } from '../src/storage/memory-store';

class MemoryFileAdapter implements FileLibraryAdapter {
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  async ensureDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }

  async listDirectory(path: string): Promise<readonly FileEntryInfo[]> {
    const prefix = `${path}/`;
    return [...this.files.keys()]
      .filter((filePath) => filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/'))
      .map((filePath) => ({ name: filePath.slice(prefix.length), isFile: true }));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async readText(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

function createRepository(
  adapter: MemoryFileAdapter,
  legacyState: LibraryState,
  onClear: () => void,
): FileLibraryRepository {
  return new FileLibraryRepository({
    memoirDirectory: 'local/com.shinian.memoir/memoirs',
    metaPath: 'local/com.shinian.memoir/meta.json',
    joinPath: async (...parts) => parts.join('/'),
    adapter,
    loadLegacyState: () => legacyState,
    clearLegacyStorage: onClear,
    middleSchoolStartYear: 2003,
    highSchoolStartYear: 2006,
  });
}

describe('Tauri Markdown repository', () => {
  it('migrates localStorage data when the memoirs directory is empty', async () => {
    const adapter = new MemoryFileAdapter();
    const memory = createMemory({
      title: '初三那个同桌',
      timeText: '初二下学期',
      body: '正文内容……\n\n第二段……',
      bookGroup: '初中',
      now: new Date('2026-09-21T00:10:00Z'),
    });
    const legacy = { ...createEmptyLibraryState(), memories: [memory] };
    let cleared = false;
    const repository = createRepository(adapter, legacy, () => {
      cleared = true;
    });

    const result = await repository.load();
    const markdown = adapter.files.get(`local/com.shinian.memoir/memoirs/${memory.id}.md`);

    expect(result.migratedCount).toBe(1);
    expect(cleared).toBe(true);
    expect(markdown).toContain('title: "初三那个同桌"');
    expect(markdown).toContain('time: "初二下学期"');
    expect(markdown).toContain('group: "初中"');
    expect(markdown).toContain('inBook: true');
    expect(adapter.files.get('local/com.shinian.memoir/meta.json')).toContain('"middleSchoolStartYear": 2003');
  });

  it('does not migrate when the memoirs directory already contains Markdown files', async () => {
    const adapter = new MemoryFileAdapter();
    const memory = createMemory({
      title: '已经存在',
      timeText: '2018年秋',
      body: '不会再次迁移。',
    });
    await adapter.writeText(
      `local/com.shinian.memoir/memoirs/${memory.id}.md`,
      serializeMemoirMarkdown(memory, 1),
    );
    await adapter.writeText(
      'local/com.shinian.memoir/meta.json',
      JSON.stringify({ version: 1, preface: '序', afterword: '后记', groups: [], middleSchoolStartYear: 2003, highSchoolStartYear: 2006 }),
    );
    let migrationCalled = false;
    const repository = new FileLibraryRepository({
      memoirDirectory: 'local/com.shinian.memoir/memoirs',
      metaPath: 'local/com.shinian.memoir/meta.json',
      joinPath: async (...parts) => parts.join('/'),
      adapter,
      loadLegacyState: () => {
        migrationCalled = true;
        return { ...createEmptyLibraryState(), memories: [memory] };
      },
      clearLegacyStorage: () => undefined,
      middleSchoolStartYear: 2003,
      highSchoolStartYear: 2006,
    });

    const result = await repository.load();

    expect(result.migratedCount).toBe(0);
    expect(migrationCalled).toBe(false);
    expect(result.state.memories[0]?.title).toBe('已经存在');
  });
});