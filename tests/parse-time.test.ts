import { describe, expect, it } from 'vitest';
import { parseTime } from '../src/time';

function expectRange(input: string, start: string, end: string): void {
  const parsed = parseTime(input);
  expect(parsed.resolved, `${input} should be resolved`).toBe(true);
  expect(parsed.range?.start).toBe(start);
  expect(parsed.range?.end).toBe(end);
}

describe('parseTime', () => {
  it('parses exact dates in common numeric styles', () => {
    const iso = parseTime('2018-09-01');
    const chinese = parseTime('2005年6月18日');
    const colloquial = parseTime('2005年6月18号');

    expect(iso.precision).toBe('day');
    expect(iso.range?.start).toBe('2018-09-01');
    expect(iso.range?.end).toBe('2018-09-01');
    expect(chinese.range?.start).toBe('2005-06-18');
    expect(colloquial.range?.start).toBe('2005-06-18');
  });

  it('parses months and years as ranges', () => {
    expectRange('2018年9月', '2018-09-01', '2018-09-30');
    expectRange('2020年2月', '2020-02-01', '2020-02-29');
    expectRange('2017年', '2017-01-01', '2017-12-31');
    expectRange('2017', '2017-01-01', '2017-12-31');
  });

  it('parses seasons, including a winter crossing into the next year', () => {
    const autumn = parseTime('2018年秋');
    const winter = parseTime('2018年冬天');

    expect(autumn.range?.start).toBe('2018-09-01');
    expect(autumn.range?.end).toBe('2018-11-30');
    expect(winter.range?.start).toBe('2018-12-01');
    expect(winter.range?.end).toBe('2019-02-28');
  });

  it('converts middle-school semesters using the 2003 enrolment anchor', () => {
    const parsed = parseTime('初二下学期');

    expect(parsed.resolved).toBe(true);
    expect(parsed.precision).toBe('semester');
    expect(parsed.confidence).toBe('approximate');
    expect(parsed.range?.start).toBe('2005-02-01');
    expect(parsed.range?.end).toBe('2005-08-31');
    expect(parsed.notes.join('')).toContain('2003');
  });

  it('supports high-school grades in the same continuous timeline', () => {
    expectRange('高一上学期', '2006-09-01', '2007-01-31');
    expectRange('高二', '2007-09-01', '2008-08-31');
  });

  it('converts middle-school exam phrases into a range', () => {
    const beforeExam = parseTime('大概是中考前');
    expect(beforeExam.resolved).toBe(true);
    expect(beforeExam.range?.start).toBe('2006-03-01');
    expect(beforeExam.range?.end).toBe('2006-06-20');
  });

  it('keeps approximate grade descriptions explicit and comparable', () => {
    const parsed = parseTime('大概是初三那年冬天');

    expect(parsed.resolved).toBe(true);
    expect(parsed.precision).toBe('season');
    expect(parsed.confidence).toBe('approximate');
    expect(parsed.range?.start).toBe('2005-12-01');
    expect(parsed.range?.end).toBe('2006-02-28');
    expect(parsed.notes.join('')).toContain('模糊限定');
  });

  it('marks an approximate exact date as approximate', () => {
    const parsed = parseTime('可能是2018年9月1日');

    expect(parsed.precision).toBe('day');
    expect(parsed.confidence).toBe('approximate');
    expect(parsed.range?.start).toBe('2018-09-01');
  });

  it('accepts a configurable enrolment year', () => {
    const parsed = parseTime('初一上学期', { middleSchoolStartYear: 2010 });
    expect(parsed.range?.start).toBe('2010-09-01');
    expect(parsed.range?.end).toBe('2011-01-31');
  });

  it('rejects impossible dates without throwing', () => {
    const parsed = parseTime('2019年2月30日');

    expect(parsed.resolved).toBe(false);
    expect(parsed.precision).toBe('unknown');
    expect(parsed.normalized).toBe('未识别');
  });

  it('keeps unknown wording instead of guessing', () => {
    const parsed = parseTime('某个记不清的傍晚');

    expect(parsed.resolved).toBe(false);
    expect(parsed.range).toBeNull();
    expect(parsed.notes[0]).toContain('原文仍会保存');
  });
});