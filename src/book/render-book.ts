import type { BookDocument, BookEssay } from './build-book';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bodyToParagraphs(body: string): readonly string[] {
  return body
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function renderParagraphs(text: string): string {
  return bodyToParagraphs(text)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
}

function folio(page: number): string {
  return `<span class="folio" aria-hidden="true">${page}</span>`;
}

function createPageMap(book: BookDocument): Readonly<Record<string, number>> {
  const pages: Record<string, number> = {};
  let page = 4;

  if (book.preface) {
    page += 1;
    pages.preface = page;
  }

  page += 1;
  pages.contents = page;

  book.chapters.forEach((chapter) => {
    page += 1;
    pages[chapter.id] = page;
    chapter.essays.forEach((essay) => {
      page += 1;
      pages[`essay:${essay.id}`] = page;
    });
  });

  if (book.people.length) {
    page += 1;
    pages.people = page;
  }

  if (book.afterword) {
    page += 1;
    pages.afterword = page;
  }

  return pages;
}

function renderEssay(essay: BookEssay, number: number, page: number): string {
  return `
    <section class="book-page essay-page" id="essay-${escapeHtml(essay.id)}" data-folio="${page}">
      <header class="essay__header">
        <p class="essay__number">篇 ${String(number).padStart(2, '0')}</p>
        <h3>${escapeHtml(essay.title)}</h3>
        <p class="essay__time">
          <span>${escapeHtml(essay.timeText)}</span>
          <i aria-hidden="true"></i>
          <span>${escapeHtml(essay.normalizedTime)}</span>
        </p>
      </header>
      <div class="essay__body">${renderParagraphs(essay.body)}</div>
      ${folio(page)}
    </section>
  `;
}

function renderContents(
  book: BookDocument,
  pages: Readonly<Record<string, number>>,
): string {
  const frontMatter: string[] = [];
  if (book.preface) {
    frontMatter.push(`<li><a href="#preface"><span>序</span><i></i><b>${pages.preface ?? ''}</b></a></li>`);
  }
  if (book.people.length) {
    frontMatter.push(`<li><a href="#people-index"><span>人物索引</span><i></i><b>${pages.people ?? ''}</b></a></li>`);
  }
  if (book.afterword) {
    frontMatter.push(`<li><a href="#afterword"><span>后记</span><i></i><b>${pages.afterword ?? ''}</b></a></li>`);
  }

  const chapters = book.chapters
    .map((chapter, chapterIndex) => {
      const essays = chapter.essays
        .map(
          (essay, essayIndex) =>
            `<li><a href="#essay-${escapeHtml(essay.id)}"><span>${chapterIndex + 1}.${essayIndex + 1}　${escapeHtml(essay.title)}</span><i></i><b>${pages[`essay:${essay.id}`] ?? ''}</b></a></li>`,
        )
        .join('');
      return `
        <section class="contents__chapter">
          <a class="contents__chapter-title" href="#${escapeHtml(chapter.id)}"><span>${escapeHtml(chapter.title)}</span><i></i><b>${pages[chapter.id] ?? ''}</b></a>
          <ol>${essays}</ol>
        </section>
      `;
    })
    .join('');

  return `
    <section class="book-page contents page-break" id="contents" data-folio="${pages.contents}">
      <p class="section-mark">目录</p>
      <h2>目 录</h2>
      ${frontMatter.length ? `<ul class="contents__front">${frontMatter.join('')}</ul>` : ''}
      <div class="contents__list">${chapters}</div>
      ${folio(pages.contents ?? 1)}
    </section>
  `;
}

function renderChapterOpener(
  chapter: BookDocument['chapters'][number],
  chapterIndex: number,
  page: number,
): string {
  return `
    <section class="book-page chapter-opener page-break" id="${escapeHtml(chapter.id)}" data-folio="${page}">
      <header class="chapter__header">
        <p class="chapter__number">第 ${chapterIndex + 1} 章</p>
        <h2>${escapeHtml(chapter.title)}</h2>
        <p class="chapter__period">${escapeHtml(chapter.period)}</p>
        <p class="chapter__intro">${escapeHtml(chapter.introduction)}</p>
      </header>
      ${folio(page)}
    </section>
  `;
}

function renderTextPage(
  id: string,
  marker: string,
  title: string,
  text: string,
  page: number,
): string {
  return `
    <section class="book-page text-page page-break" id="${id}" data-folio="${page}">
      <p class="section-mark">${escapeHtml(marker)}</p>
      <h2>${escapeHtml(title)}</h2>
      <div class="text-page__body">${renderParagraphs(text)}</div>
      ${folio(page)}
    </section>
  `;
}

function renderPeopleIndex(book: BookDocument, page: number): string {
  if (book.people.length === 0) return '';
  const items = book.people
    .map(
      (person) => `
        <li>
          <strong>${escapeHtml(person.name)}</strong>
          <span>${person.count} 次 · ${escapeHtml(person.essayTitles.join('、'))}</span>
        </li>
      `,
    )
    .join('');

  return `
    <section class="book-page text-page index-page page-break" id="people-index" data-folio="${page}">
      <p class="section-mark">INDEX</p>
      <h2>人物索引</h2>
      <p class="index-page__intro">索引记录至少出现两次的人名，也可以在工作台中手动修正。</p>
      <ol class="people-index">${items}</ol>
      ${folio(page)}
    </section>
  `;
}

/**
 * 生成按 A5 中文书规格排版的独立 HTML。屏幕中每节模拟一张书页，打印时由 @page 接管。
 */
export function renderBookHtml(book: BookDocument): string {
  const pages = createPageMap(book);
  const generated = new Date(book.generatedAt);
  const dateLabel = `${generated.getFullYear()}年${generated.getMonth() + 1}月${generated.getDate()}日`;
  const author = book.author ? escapeHtml(book.author) : '著';
  const preface = book.preface
    ? renderTextPage('preface', '序', '序', book.preface, pages.preface ?? 1)
    : '';
  const afterword = book.afterword
    ? renderTextPage('afterword', '后记', '后记', book.afterword, pages.afterword ?? 1)
    : '';
  const people = renderPeopleIndex(book, pages.people ?? 1);
  const chapters = book.chapters
    .map((chapter, index) => {
      const opener = renderChapterOpener(chapter, index, pages[chapter.id] ?? 1);
      const essays = chapter.essays
        .map((essay, essayIndex) =>
          renderEssay(essay, essayIndex + 1, pages[`essay:${essay.id}`] ?? 1),
        )
        .join('\n');
      return `${opener}\n${essays}`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(book.title)}</title>
  <style>
    @page { size: A5; margin: 20mm 22mm; }
    :root {
      --paper: #fffdf8;
      --ink: #2a2a2a;
      --muted: #8a8580;
      --rule: #e8e4de;
      --wood: #8b6f47;
      --serif: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif;
      --sans: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html { background: #e6e1d9; }
    body { margin: 0; color: var(--ink); background: #e6e1d9; font-family: var(--serif); }
    .book { width: 148mm; margin: 0 auto; background: var(--paper); }
    .book-page {
      position: relative;
      display: flex;
      width: 148mm;
      min-height: 210mm;
      flex-direction: column;
      padding: 20mm 22mm;
      border-bottom: 1px solid #d9d3ca;
      background: var(--paper);
    }
    .folio { margin-top: auto; padding-top: 8mm; color: var(--muted); font-family: Georgia, serif; font-size: 8pt; text-align: center; }
    .cover { border-top: 6px solid var(--wood); }
    .cover__top { display: flex; justify-content: space-between; color: var(--wood); font-family: var(--sans); font-size: 8pt; letter-spacing: .12em; }
    .cover__middle { margin: auto 0; }
    .cover h1 { margin: 0 0 5mm; font-size: 28pt; font-weight: 500; line-height: 1.25; }
    .cover__subtitle { margin: 0; color: var(--muted); font-size: 10pt; line-height: 1.7; }
    .cover__bottom { display: flex; justify-content: space-between; color: var(--muted); font-family: var(--sans); font-size: 8pt; }
    .half-title { align-items: center; justify-content: center; text-align: center; }
    .half-title h1 { margin: 0; font-size: 20pt; font-weight: 500; }
    .title-page { align-items: center; justify-content: center; text-align: center; }
    .title-page h2 { margin: 0; font-size: 24pt; font-weight: 500; }
    .title-page p { margin: 4mm 0 0; color: var(--muted); font-size: 10pt; line-height: 1.7; }
    .title-page__author { margin-top: 24mm !important; color: var(--ink) !important; font-family: var(--sans); font-size: 10pt !important; }
    .colophon { padding-top: 34mm; color: var(--muted); }
    .colophon h2 { margin: 0; color: var(--ink); font-size: 16pt; font-weight: 500; }
    .colophon dl { display: grid; grid-template-columns: 24mm 1fr; gap: 3mm 4mm; margin: 18mm 0 0; font-family: var(--sans); font-size: 8.5pt; }
    .colophon dd { margin: 0; color: var(--ink); }
    .section-mark { margin: 0; color: var(--wood); font-family: var(--sans); font-size: 8pt; letter-spacing: .12em; }
    .contents h2, .text-page h2, .chapter-opener h2 { margin: 3mm 0 12mm; font-size: 18pt; font-weight: 500; line-height: 1.4; }
    .contents__front, .contents ol, .contents ul { margin: 0; padding: 0; list-style: none; }
    .contents__front { padding-bottom: 5mm; border-bottom: 1px solid var(--rule); }
    .contents__chapter { padding: 6mm 0; border-bottom: 1px solid var(--rule); break-inside: avoid; }
    .contents a { display: grid; grid-template-columns: minmax(0, 1fr) 8mm; align-items: end; gap: 3mm; color: inherit; font-size: 9pt; line-height: 1.65; text-decoration: none; }
    .contents a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .contents a i { border-bottom: 1px dotted #bdb5aa; }
    .contents a b { color: var(--muted); font-family: Georgia, serif; font-size: 8pt; font-weight: 400; text-align: right; }
    .contents__chapter-title { margin-bottom: 2mm; font-weight: 600; }
    .contents ol a { padding-left: 5mm; color: #5f5a54; }
    .text-page { padding-top: 24mm; }
    .text-page__body, .essay__body { color: #30302e; font-size: 10.5pt; line-height: 1.65; text-align: justify; }
    .text-page__body p, .essay__body p { margin: 0; text-indent: 2em; orphans: 2; widows: 2; }
    .chapter-opener { justify-content: center; }
    .chapter__number { margin: 0; color: var(--wood); font-family: var(--sans); font-size: 8pt; letter-spacing: .12em; }
    .chapter__header h2 { margin-top: 5mm; }
    .chapter__period { margin: -8mm 0 8mm; color: var(--muted); font-family: var(--sans); font-size: 8pt; }
    .chapter__intro { max-width: 82mm; margin: 0; color: var(--muted); font-size: 9.5pt; line-height: 1.7; }
    .essay__header { margin-bottom: 9mm; break-after: avoid; }
    .essay__number { margin: 0 0 2mm; color: var(--wood); font-family: var(--sans); font-size: 7.5pt; letter-spacing: .1em; }
    .essay h3 { margin: 0; font-size: 14pt; font-weight: 500; line-height: 1.45; }
    .essay__time { display: flex; flex-wrap: wrap; gap: 2mm; margin: 3mm 0 0; color: var(--muted); font-family: var(--sans); font-size: 8pt; }
    .essay__time i { width: 5mm; height: 1px; align-self: center; background: #c8c0b6; }
    .index-page__intro { margin: -7mm 0 8mm; color: var(--muted); font-size: 9pt; line-height: 1.7; }
    .people-index { margin: 0; padding: 0; list-style: none; }
    .people-index li { display: grid; grid-template-columns: 24mm 1fr; gap: 4mm; padding: 2.5mm 0; border-bottom: 1px solid var(--rule); font-size: 9pt; line-height: 1.65; }
    .people-index li span { color: var(--muted); }
    .page-break { break-before: page; page-break-before: always; }
    @media (max-width: 620px) {
      .book { width: 100%; }
      .book-page { width: 100%; min-height: auto; padding: 32px 24px 48px; }
      .cover { min-height: 620px; }
    }
    @media print {
      html, body { background: #fff; }
      body > :not(.book) { display: none !important; }
      .book { width: auto; margin: 0; }
      .book-page { width: auto; min-height: 0; padding: 0; border: 0; background: transparent; }
      .cover { height: 170mm; border-top-width: 4px; }
      .page-break { break-before: page; page-break-before: always; }
      .essay__header, .chapter__header { break-after: avoid; }
      .essay__body p, .text-page__body p { orphans: 2; widows: 2; }
      .folio { position: fixed; right: 0; bottom: -14mm; left: 0; padding: 0; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <main class="book">
    <section class="book-page cover">
      <div class="cover__top"><span>SHINIAN MEMOIR</span><span>${dateLabel}</span></div>
      <div class="cover__middle">
        <h1>${escapeHtml(book.title)}</h1>
        ${book.subtitle ? `<p class="cover__subtitle">${escapeHtml(book.subtitle)}</p>` : ''}
      </div>
      <div class="cover__bottom"><span>${author}</span><span>共 ${book.essayCount} 篇</span></div>
    </section>
    <section class="book-page half-title page-break"><h1>${escapeHtml(book.title)}</h1></section>
    <section class="book-page title-page page-break">
      <p class="section-mark">A MEMOIR</p>
      <h2>${escapeHtml(book.title)}</h2>
      ${book.subtitle ? `<p>${escapeHtml(book.subtitle)}</p>` : ''}
      <p class="title-page__author">${author}</p>
    </section>
    <section class="book-page colophon page-break">
      <p class="section-mark">COLOPHON</p>
      <h2>关于本书</h2>
      <dl>
        <dt>书名</dt><dd>${escapeHtml(book.title)}</dd>
        <dt>作者</dt><dd>${author}</dd>
        <dt>篇章</dt><dd>${book.essayCount} 篇</dd>
        <dt>编排</dt><dd>拾年 · 本地回忆录编辑室</dd>
        <dt>日期</dt><dd>${dateLabel}</dd>
      </dl>
    </section>
    ${preface}
    ${renderContents(book, pages)}
    ${chapters}
    ${people}
    ${afterword}
  </main>
</body>
</html>`;
}

export function bookFileName(title: string, extension = 'html'): string {
  const safe = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${safe || '我的回忆录'}.${extension}`;
}