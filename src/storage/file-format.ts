import type { TitleOrigin, MemoryEntry } from './memory-store';

interface FrontMatterValue {
  readonly [key: string]: string | number | boolean | null;
}

function parseYamlScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseFrontMatter(text: string): {
  readonly fields: FrontMatterValue;
  readonly body: string;
} | null {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n')) return null;
  const closing = normalized.indexOf('\n---', 4);
  if (closing === -1) return null;
  const fields: Record<string, string | number | boolean | null> = {};
  for (const line of normalized.slice(4, closing).split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (match?.[1]) fields[match[1]] = parseYamlScalar(match[2] ?? '');
  }
  const bodyStart = normalized.indexOf('\n', closing + 1);
  return {
    fields,
    body: (bodyStart === -1 ? '' : normalized.slice(bodyStart + 1)).trim(),
  };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asTitleOrigin(value: unknown): TitleOrigin {
  return value === 'generated' || value === 'manual' || value === 'original'
    ? value
    : 'original';
}

export function serializeMemoirMarkdown(memory: MemoryEntry, order: number): string {
  return `---
id: ${JSON.stringify(memory.id)}
title: ${JSON.stringify(memory.title)}
time: ${JSON.stringify(memory.timeText)}
order: ${order}
group: ${JSON.stringify(memory.bookGroup)}
inBook: ${memory.includedInBook}
created: ${JSON.stringify(memory.createdAt)}
updated: ${JSON.stringify(memory.updatedAt)}
title_origin: ${memory.titleOrigin}
source_file: ${memory.sourceFileName ? JSON.stringify(memory.sourceFileName) : 'null'}
---

${memory.body}
`;
}

export function parseMemoirMarkdown(text: string): MemoryEntry | null {
  const parsed = parseFrontMatter(text);
  if (!parsed) return null;
  const id = asString(parsed.fields.id).trim();
  const title = asString(parsed.fields.title).trim();
  const timeText = asString(parsed.fields.time).trim();
  if (!id || !title) return null;
  const createdAt = asString(parsed.fields.created, new Date(0).toISOString());
  const updatedAt = asString(parsed.fields.updated, createdAt);
  const order = typeof parsed.fields.order === 'number' ? parsed.fields.order : 0;
  const inBook = parsed.fields.inBook ?? parsed.fields.included_in_book;

  return {
    id,
    title,
    timeText: timeText || '时间待考',
    body: parsed.body || '（正文为空）',
    createdAt,
    updatedAt,
    sourceFileName:
      typeof parsed.fields.source_file === 'string' ? parsed.fields.source_file : null,
    titleOrigin: asTitleOrigin(parsed.fields.title_origin),
    manualOrder: Number.isFinite(order) ? Math.max(0, order - 1) : null,
    includedInBook: asBoolean(inBook, true),
    bookGroup: asString(parsed.fields.group).trim(),
  };
}