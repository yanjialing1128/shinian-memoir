import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildBook } from '../src/book/build-book';
import { createEpubBlob } from '../src/book/export-epub';
import { renderBookHtml } from '../src/book/render-book';
import type { BookSettings, MemoryEntry, PeopleCorrections } from '../src/storage/memory-store';

const settings: BookSettings = {
  title: '我的回忆录',
  subtitle: '旧时光',
  author: '小明',
  preface: '这是序。',
  afterword: '这是后记。',
  chapterMode: 'manual-group',
};

function memory(id: string, title: string, timeText: string, body: string, group: string): MemoryEntry {
  return {
    id,
    title,
    timeText,
    body,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourceFileName: null,
    titleOrigin: 'original',
    manualOrder: null,
    includedInBook: true,
    bookGroup: group,
  };
}

describe('book builder v3', () => {
  it('groups entries by custom chapter names', () => {
    const book = buildBook(
      [
        memory('1', '教室', '2005年秋', '张明在教室里等我。', '那些人'),
        memory('2', '操场', '2006年春', '张明在操场跑步。', '那些地方'),
      ],
      settings,
    );

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['那些人', '那些地方']);
    expect(book.preface).toBe('这是序。');
    expect(book.afterword).toBe('这是后记。');
  });

  it('renders preface, afterword, people index and realistic book pages', () => {
    const book = buildBook(
      [
        memory('1', '教室', '2005年秋', '张明在教室里等我。张明笑了。', '那些人'),
      ],
      settings,
    );
    const html = renderBookHtml(book);

    expect(html).toContain('关于本书');
    expect(html).toContain('这是序。');
    expect(html).toContain('这是后记。');
    expect(html).toContain('人物索引');
    expect(html).toContain('张明');
    expect(html).toContain('@page { size: A5; margin: 20mm 22mm; }');
    expect(html).toContain('font-size: 10.5pt');
    expect(html).toContain('line-height: 1.65');
    expect(html).toContain('text-indent: 2em');
    expect(html).toContain('orphans: 2');
    expect(html).toContain('@media print');
  });

  it('creates a valid EPUB archive with navigation and front/back matter', async () => {
    const corrections: PeopleCorrections = {
      aliases: {},
      ignoredNames: [],
      extraNames: [],
    };
    const book = buildBook(
      [memory('1', '教室', '2005年秋', '张明在教室里等我。张明笑了。', '那些人')],
      settings,
      {},
      corrections,
    );
    const blob = await createEpubBlob(book);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(await archive.file('mimetype')?.async('string')).toBe('application/epub+zip');
    expect(archive.file('META-INF/container.xml')).toBeTruthy();
    expect(archive.file('OEBPS/content.opf')).toBeTruthy();
    expect(archive.file('OEBPS/nav.xhtml')).toBeTruthy();
    expect(await archive.file('OEBPS/preface.xhtml')?.async('string')).toContain('这是序。');
    expect(await archive.file('OEBPS/afterword.xhtml')?.async('string')).toContain('这是后记。');
  });
});