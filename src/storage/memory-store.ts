import type { TimedItem } from '../time';

export const LIBRARY_STORAGE_KEY = 'shinian-memoir:library:v3';
export const LEGACY_LIBRARY_STORAGE_KEY = 'shinian-memoir:library:v2';
export const LEGACY_MEMORY_STORAGE_KEY = 'shinian-memoir:entries:v1';

export type TitleOrigin = 'original' | 'generated' | 'manual';
export type OrderMode = 'auto' | 'manual';
export type ChapterMode = 'academic-year' | 'year' | 'manual-group';

export interface MemoryEntry extends TimedItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceFileName: string | null;
  readonly titleOrigin: TitleOrigin;
  readonly manualOrder: number | null;
  readonly includedInBook: boolean;
  /** 自定义章节名；为空时进入“未分组”。 */
  readonly bookGroup: string;
}

export interface BookSettings {
  readonly title: string;
  readonly subtitle: string;
  readonly author: string;
  readonly preface: string;
  readonly afterword: string;
  readonly chapterMode: ChapterMode;
}

export interface PeopleCorrections {
  /** 原始识别名 -> 最终显示名，用于合并同名或修正误识别。 */
  readonly aliases: Readonly<Record<string, string>>;
  /** 不纳入人物索引的误识别词。 */
  readonly ignoredNames: readonly string[];
  /** 未自动识别、但需要补充进索引的人名。 */
  readonly extraNames: readonly string[];
}

export interface LibraryState {
  readonly version: 3;
  readonly memories: readonly MemoryEntry[];
  readonly orderMode: OrderMode;
  readonly book: BookSettings;
  readonly people: PeopleCorrections;
  readonly backupDirectoryName: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NewMemoryInput {
  readonly title: string;
  readonly timeText: string;
  readonly body: string;
  readonly now?: Date;
  readonly sourceFileName?: string | null;
  readonly titleOrigin?: TitleOrigin;
  readonly includedInBook?: boolean;
  readonly bookGroup?: string;
}

export const DEFAULT_BOOK_SETTINGS: BookSettings = {
  title: '我的回忆录',
  subtitle: '把走过的日子，慢慢写成书',
  author: '',
  preface: '',
  afterword: '',
  chapterMode: 'year',
};

export const DEFAULT_PEOPLE_CORRECTIONS: PeopleCorrections = {
  aliases: {},
  ignoredNames: [],
  extraNames: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTitleOrigin(value: unknown): value is TitleOrigin {
  return value === 'original' || value === 'generated' || value === 'manual';
}

function isOrderMode(value: unknown): value is OrderMode {
  return value === 'auto' || value === 'manual';
}

function isChapterMode(value: unknown): value is ChapterMode {
  return value === 'academic-year' || value === 'year' || value === 'manual-group';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeBookSettings(value: unknown): BookSettings {
  if (!isRecord(value)) {
    return DEFAULT_BOOK_SETTINGS;
  }

  return {
    title:
      typeof value.title === 'string' && value.title.trim().length > 0
        ? value.title.trim()
        : DEFAULT_BOOK_SETTINGS.title,
    subtitle:
      typeof value.subtitle === 'string'
        ? value.subtitle.trim()
        : DEFAULT_BOOK_SETTINGS.subtitle,
    author: typeof value.author === 'string' ? value.author.trim() : '',
    preface: typeof value.preface === 'string' ? value.preface.trim() : '',
    afterword: typeof value.afterword === 'string' ? value.afterword.trim() : '',
    chapterMode: isChapterMode(value.chapterMode)
      ? value.chapterMode
      : DEFAULT_BOOK_SETTINGS.chapterMode,
  };
}

function normalizePeopleCorrections(value: unknown): PeopleCorrections {
  if (!isRecord(value)) {
    return DEFAULT_PEOPLE_CORRECTIONS;
  }

  const aliases: Record<string, string> = {};
  if (isRecord(value.aliases)) {
    for (const [rawName, displayName] of Object.entries(value.aliases)) {
      if (typeof displayName === 'string' && rawName.trim() && displayName.trim()) {
        aliases[rawName.trim()] = displayName.trim();
      }
    }
  }

  const ignoredNames = Array.isArray(value.ignoredNames)
    ? value.ignoredNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : [];
  const extraNames = Array.isArray(value.extraNames)
    ? value.extraNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : [];

  return {
    aliases,
    ignoredNames,
    extraNames,
  };
}

function normalizeMemory(value: unknown, _index: number): MemoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' && value.id ? value.id : null;
  const title = typeof value.title === 'string' ? value.title.trim() : null;
  const timeText = typeof value.timeText === 'string' ? value.timeText.trim() : null;
  const body = typeof value.body === 'string' ? value.body.trim() : null;
  if (!id || !title || !timeText || !body) {
    return null;
  }

  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt;
  const manualOrder =
    typeof value.manualOrder === 'number' && Number.isFinite(value.manualOrder)
      ? value.manualOrder
      : null;

  return {
    id,
    title,
    timeText,
    body,
    createdAt,
    updatedAt,
    sourceFileName: asNullableString(value.sourceFileName),
    titleOrigin: isTitleOrigin(value.titleOrigin) ? value.titleOrigin : 'original',
    manualOrder,
    includedInBook:
      typeof value.includedInBook === 'boolean' ? value.includedInBook : true,
    bookGroup: typeof value.bookGroup === 'string' ? value.bookGroup.trim() : '',
  };
}

function parseLegacyMemories(raw: string | null): readonly MemoryEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item, index) => {
      const normalized = normalizeMemory(item, index);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function createEmptyLibraryState(): LibraryState {
  return {
    version: 3,
    memories: [],
    orderMode: 'auto',
    book: DEFAULT_BOOK_SETTINGS,
    people: DEFAULT_PEOPLE_CORRECTIONS,
    backupDirectoryName: null,
  };
}

export function parseStoredLibraryState(raw: string | null): LibraryState {
  if (!raw) {
    return createEmptyLibraryState();
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      (value.version !== 2 && value.version !== 3) ||
      !Array.isArray(value.memories)
    ) {
      return createEmptyLibraryState();
    }

    const memories = value.memories.flatMap((item, index) => {
      const normalized = normalizeMemory(item, index);
      return normalized ? [normalized] : [];
    });

    return {
      version: 3,
      memories,
      orderMode: isOrderMode(value.orderMode) ? value.orderMode : 'auto',
      book: normalizeBookSettings(value.book),
      people: normalizePeopleCorrections(value.people),
      backupDirectoryName:
        typeof value.backupDirectoryName === 'string'
          ? value.backupDirectoryName.trim() || null
          : null,
    };
  } catch {
    return createEmptyLibraryState();
  }
}

export function loadLibraryState(storage: StorageLike): LibraryState {
  try {
    const currentRaw = storage.getItem(LIBRARY_STORAGE_KEY);
    if (currentRaw) {
      return parseStoredLibraryState(currentRaw);
    }

    const legacyV2Raw = storage.getItem(LEGACY_LIBRARY_STORAGE_KEY);
    if (legacyV2Raw) {
      const migrated = parseStoredLibraryState(legacyV2Raw);
      storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    const legacyMemories = parseLegacyMemories(storage.getItem(LEGACY_MEMORY_STORAGE_KEY));
    if (legacyMemories.length === 0) {
      return createEmptyLibraryState();
    }

    const migrated: LibraryState = {
      version: 3,
      memories: legacyMemories,
      orderMode: 'auto',
      book: DEFAULT_BOOK_SETTINGS,
      people: DEFAULT_PEOPLE_CORRECTIONS,
      backupDirectoryName: null,
    };
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return createEmptyLibraryState();
  }
}

export function saveLibraryState(storage: StorageLike, state: LibraryState): boolean {
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function createMemory(input: NewMemoryInput): MemoryEntry {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${now.getTime()}-${Math.random().toString(36).slice(2)}`;

  return {
    id,
    title: input.title.trim(),
    timeText: input.timeText.trim(),
    body: input.body.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceFileName: input.sourceFileName ?? null,
    titleOrigin: input.titleOrigin ?? 'manual',
    manualOrder: null,
    includedInBook: input.includedInBook ?? true,
    bookGroup: input.bookGroup?.trim() ?? '',
  };
}

export function updateMemory(
  memory: MemoryEntry,
  changes: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>,
  now: Date = new Date(),
): MemoryEntry {
  return {
    ...memory,
    ...changes,
    id: memory.id,
    createdAt: memory.createdAt,
    updatedAt: now.toISOString(),
  };
}

export function withNormalizedManualOrder(
  memories: readonly MemoryEntry[],
): readonly MemoryEntry[] {
  return memories.map((memory, index) => ({
    ...memory,
    manualOrder: index,
  }));
}