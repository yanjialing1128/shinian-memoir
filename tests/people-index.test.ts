import { describe, expect, it } from 'vitest';
import { buildPersonIndex, extractPersonNames } from '../src/people/build-index';
import type { MemoryEntry, PeopleCorrections } from '../src/storage/memory-store';

function memory(id: string, title: string, body: string): MemoryEntry {
  return {
    id,
    title,
    timeText: '2018年',
    body,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourceFileName: null,
    titleOrigin: 'original',
    manualOrder: null,
    includedInBook: true,
    bookGroup: '',
  };
}

describe('people index', () => {
  it('extracts common-surname names and ignores role descriptions', () => {
    const names = extractPersonNames('张明和李华一起走进教室，王老师正在等他们。张明笑了。');
    expect(names).toContain('张明');
    expect(names).toContain('李华');
    expect(names).not.toContain('王老师');
  });

  it('keeps repeated names and supports alias, ignore and manual additions', () => {
    const memories = [
      memory('1', '操场', '张明跑得很快，张明回头等我。'),
      memory('2', '教室', '李华把书递给张明。'),
      memory('3', '回家', '王老师也来了。'),
    ];
    const corrections: PeopleCorrections = {
      aliases: { 张明: '小明' },
      ignoredNames: ['王老师'],
      extraNames: ['赵清'],
    };
    const index = buildPersonIndex(memories, corrections);

    expect(index.find((person) => person.name === '小明')?.count).toBe(3);
    expect(index.find((person) => person.name === '赵清')?.count).toBe(0);
    expect(index.some((person) => person.name === '王老师')).toBe(false);
  });
});