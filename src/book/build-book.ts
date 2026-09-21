import { buildPersonIndex } from '../people/build-index';
import {
  DEFAULT_PEOPLE_CORRECTIONS,
  type BookSettings,
  type MemoryEntry,
  type PeopleCorrections,
} from '../storage/memory-store';
import { parseTime, type ParseOptions } from '../time';

export interface BookEssay {
  readonly id: string;
  readonly title: string;
  readonly timeText: string;
  readonly normalizedTime: string;
  readonly body: string;
  readonly group: string;
}

export interface BookChapter {
  readonly id: string;
  readonly title: string;
  readonly period: string;
  readonly introduction: string;
  readonly essays: readonly BookEssay[];
}

export interface BookPerson {
  readonly name: string;
  readonly count: number;
  readonly essayTitles: readonly string[];
}

export interface BookDocument {
  readonly title: string;
  readonly subtitle: string;
  readonly author: string;
  readonly preface: string;
  readonly afterword: string;
  readonly generatedAt: string;
  readonly chapters: readonly BookChapter[];
  readonly people: readonly BookPerson[];
  readonly essayCount: number;
}

const GRADE_NAMES = ['初一', '初二', '初三', '高一', '高二', '高三'] as const;

function datePartsFromDay(day: number): { year: number; month: number } {
  const date = new Date(day * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function academicStageLabel(startYear: number, options: ParseOptions): string | null {
  const anchor = options.middleSchoolStartYear ?? 2003;
  const gradeIndex = startYear - anchor;
  return GRADE_NAMES[gradeIndex] ?? null;
}

function fallbackChapter(_entry: MemoryEntry): {
  readonly key: string;
  readonly title: string;
  readonly period: string;
} {
  return { key: 'unknown', title: '时间待考', period: '没有明确时间的篇章' };
}

function academicChapter(
  entry: MemoryEntry,
  options: ParseOptions,
): { readonly key: string; readonly title: string; readonly period: string } {
  const parsed = parseTime(entry.timeText, options);
  if (!parsed.resolved || !parsed.range) {
    return fallbackChapter(entry);
  }

  const { year, month } = datePartsFromDay(parsed.range.midDay);
  const startYear = month >= 8 ? year : year - 1;
  const stage = academicStageLabel(startYear, options);
  return {
    key: `academic-${startYear}`,
    title: stage ? `${stage} · ${startYear}—${startYear + 1}` : `${startYear}—${startYear + 1} 学年`,
    period: `${startYear}年8月—${startYear + 1}年7月`,
  };
}

function calendarChapter(entry: MemoryEntry): {
  readonly key: string;
  readonly title: string;
  readonly period: string;
} {
  const parsed = parseTime(entry.timeText);
  if (!parsed.resolved || !parsed.range) {
    return fallbackChapter(entry);
  }

  const { year } = datePartsFromDay(parsed.range.midDay);
  return {
    key: `year-${year}`,
    title: `${year}年`,
    period: `${year}年1月—12月`,
  };
}

function manualChapter(entry: MemoryEntry): {
  readonly key: string;
  readonly title: string;
  readonly period: string;
} {
  const group = entry.bookGroup.trim() || '未分组';
  return {
    key: `group-${group}`,
    title: group,
    period: group === '未分组' ? '手动分组的默认章节' : '手动编排章节',
  };
}

function chapterIntroduction(title: string, count: number): string {
  if (title === '时间待考') {
    return `还有 ${count} 篇回忆暂时没有准确落点，等想起更多细节时，再为它们找到位置。`;
  }
  if (title === '未分组') {
    return `这一章暂收 ${count} 篇尚未分组的内容。`;
  }
  return `这一章收着 ${count} 篇回忆。它们被放在一起，彼此照见。`;
}

/**
 * 将当前时间线中的选篇编成书。函数保留传入顺序，因此手动排序和手动分组都会直接影响成书。
 */
export function buildBook(
  memories: readonly MemoryEntry[],
  settings: BookSettings,
  options: ParseOptions = {},
  corrections: PeopleCorrections = DEFAULT_PEOPLE_CORRECTIONS,
): BookDocument {
  const included = memories.filter((memory) => memory.includedInBook);
  const groups = new Map<
    string,
    { readonly title: string; readonly period: string; readonly essays: BookEssay[] }
  >();

  for (const memory of included) {
    const parsed = parseTime(memory.timeText, options);
    const chapter =
      settings.chapterMode === 'manual-group'
        ? manualChapter(memory)
        : settings.chapterMode === 'year'
          ? calendarChapter(memory)
          : academicChapter(memory, options);
    const existing = groups.get(chapter.key);

    const essay: BookEssay = {
      id: memory.id,
      title: memory.title,
      timeText: memory.timeText,
      normalizedTime: parsed.resolved ? parsed.normalized : '时间待考',
      body: memory.body,
      group: memory.bookGroup,
    };

    if (existing) {
      existing.essays.push(essay);
    } else {
      groups.set(chapter.key, {
        title: chapter.title,
        period: chapter.period,
        essays: [essay],
      });
    }
  }

  const chapters = [...groups.entries()].map(([id, group], index): BookChapter => ({
    id: `${id.replace(/[^\w\u3400-\u9fff-]/g, '-')}-${index + 1}`,
    title: group.title,
    period: group.period,
    introduction: chapterIntroduction(group.title, group.essays.length),
    essays: group.essays,
  }));

  const people = buildPersonIndex(included, corrections).map((person): BookPerson => ({
    name: person.name,
    count: person.count,
    essayTitles: person.occurrences.map((occurrence) => occurrence.title),
  }));

  return {
    title: settings.title.trim() || '我的回忆录',
    subtitle: settings.subtitle.trim(),
    author: settings.author.trim(),
    preface: settings.preface.trim(),
    afterword: settings.afterword.trim(),
    generatedAt: new Date().toISOString(),
    chapters,
    people,
    essayCount: included.length,
  };
}