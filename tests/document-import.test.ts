import { describe, expect, it } from 'vitest';
import { analyzeDocument } from '../src/documents/document-import';

describe('analyzeDocument', () => {
  it('extracts a Markdown title, labeled time and body', () => {
    const draft = analyzeDocument(
      `# 雨里的运动会\n\n时间：初二下学期\n\n那天下了很大的雨。\n我们仍然跑完了接力。`,
      '运动会.md',
    );

    expect(draft.title).toBe('雨里的运动会');
    expect(draft.titleGenerated).toBe(false);
    expect(draft.timeText).toBe('初二下学期');
    expect(draft.body).toContain('那天下了很大的雨');
    expect(draft.body).not.toContain('时间：');
  });

  it('keeps a plain first-line title instead of generating a new one', () => {
    const draft = analyzeDocument(
      `旧操场的风\n时间：初三那年冬天\n\n那天傍晚，风从操场尽头吹过来。`,
      '旧操场.txt',
    );

    expect(draft.title).toBe('旧操场的风');
    expect(draft.titleGenerated).toBe(false);
  });

  it('generates a title when the document has none', () => {
    const draft = analyzeDocument(
      `2018年秋\n\n傍晚的风吹过操场，我们坐在台阶上聊天。`,
      '风.txt',
    );

    expect(draft.timeText).toBe('2018年秋');
    expect(draft.titleGenerated).toBe(true);
    expect(draft.title.length).toBeGreaterThan(1);
  });

  it('reads title and date from front matter', () => {
    const draft = analyzeDocument(
      `---\ntitle: 旧教室\ndate: 2005年冬天\n---\n\n窗边结了一层雾。`,
      '旧教室.md',
    );

    expect(draft.title).toBe('旧教室');
    expect(draft.timeText).toBe('2005年冬天');
    expect(draft.body).toBe('窗边结了一层雾。');
  });

  it('keeps the original text when no time can be found', () => {
    const draft = analyzeDocument('记不清是哪一天。\n\n只记得下过雨。', '片段.txt');
    expect(draft.timeText).toBe('');
    expect(draft.warnings.join('')).toContain('没有提取到时间');
  });
});