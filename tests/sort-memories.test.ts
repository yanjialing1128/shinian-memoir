import { describe, expect, it } from 'vitest';
import { sortMemories } from '../src/time';

describe('sortMemories', () => {
  it('sorts mixed precise and fuzzy times into one timeline', () => {
    const memories = [
      { title: '2018年秋', timeText: '2018年秋' },
      { title: '初三冬天', timeText: '大概是初三那年冬天' },
      { title: '初二下学期', timeText: '初二下学期' },
      { title: '2018年10月1日', timeText: '2018-10-01' },
      { title: '2017年', timeText: '2017年' },
    ];

    const sorted = sortMemories(memories).map((entry) => entry.item.title);

    expect(sorted).toEqual([
      '初二下学期',
      '初三冬天',
      '2017年',
      '2018年10月1日',
      '2018年秋',
    ]);
  });

  it('places unresolved times at the end and preserves their input order', () => {
    const memories = [
      { title: '记不清一', timeText: '某个夏天' },
      { title: '有日期', timeText: '2005-06-01' },
      { title: '记不清二', timeText: '傍晚' },
    ];

    const sorted = sortMemories(memories).map((entry) => entry.item.title);

    expect(sorted).toEqual(['有日期', '记不清一', '记不清二']);
  });

  it('uses midpoint and then range start for overlapping fuzzy ranges', () => {
    const memories = [
      { title: '十月', timeText: '2018年10月' },
      { title: '全年', timeText: '2018年' },
      { title: '深秋', timeText: '2018年秋' },
    ];

    const sorted = sortMemories(memories).map((entry) => entry.item.title);

    expect(sorted).toEqual(['全年', '深秋', '十月']);
  });
});