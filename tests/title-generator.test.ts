import { describe, expect, it } from 'vitest';
import { generateTitle } from '../src/documents/title-generator';

describe('generateTitle', () => {
  it('uses content keywords and a time cue to make a readable title', () => {
    const title = generateTitle(
      '那天下午下了一场很大的雨。我们躲在教学楼门口，看着操场上的人跑散。',
      ['雨里的操场', '冬天的风'],
      '未命名.txt',
    );

    expect(title).toContain('雨');
    expect(title.length).toBeLessThanOrEqual(16);
  });

  it('avoids duplicating an existing title', () => {
    const title = generateTitle('傍晚的风吹进教室。', ['傍晚的风'], null);
    expect(title).not.toBe('傍晚的风');
  });

  it('falls back to a usable title for short content', () => {
    expect(generateTitle('雨。', [], '2005年秋天的操场.txt').length).toBeGreaterThan(1);
  });
});