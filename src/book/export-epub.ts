import JSZip from 'jszip';
import type { BookDocument } from './build-book';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
    .join('\n');
}

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN" xml:lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>${body}</body>
</html>`;
}

function safeFilePart(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[^\u3400-\u9fff\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || fallback;
}

function renderChapterXhtml(
  chapter: BookDocument['chapters'][number],
  chapterNumber: number,
): string {
  const essays = chapter.essays
    .map(
      (essay, essayIndex) => `
        <article class="essay" id="essay-${escapeXml(essay.id)}">
          <p class="eyebrow">篇 ${String(essayIndex + 1).padStart(2, '0')}</p>
          <h2>${escapeXml(essay.title)}</h2>
          <p class="time">${escapeXml(essay.timeText)} · ${escapeXml(essay.normalizedTime)}</p>
          <div class="body">${paragraphs(essay.body)}</div>
        </article>
      `,
    )
    .join('\n');

  return xhtml(
    chapter.title,
    `<section class="chapter">
      <header class="chapter-head">
        <p class="eyebrow">第 ${chapterNumber} 章</p>
        <h1>${escapeXml(chapter.title)}</h1>
        <p class="period">${escapeXml(chapter.period)}</p>
        <p class="intro">${escapeXml(chapter.introduction)}</p>
      </header>
      ${essays}
    </section>`,
  );
}

function renderPeopleXhtml(book: BookDocument): string {
  const items = book.people
    .map(
      (person) =>
        `<li><strong>${escapeXml(person.name)}</strong><span>${person.count} 次 · ${escapeXml(person.essayTitles.join('、'))}</span></li>`,
    )
    .join('\n');

  return xhtml(
    '人物索引',
    `<section class="index-page"><h1>人物索引</h1><ol>${items}</ol></section>`,
  );
}

function renderNav(book: BookDocument, chapterFiles: readonly string[]): string {
  const chapters = book.chapters
    .map((chapter, index) => {
      const essays = chapter.essays
        .map(
          (essay) =>
            `<li><a href="${chapterFiles[index]}#essay-${escapeXml(essay.id)}">${escapeXml(essay.title)}</a></li>`,
        )
        .join('');
      return `<li><a href="${chapterFiles[index]}">${escapeXml(chapter.title)}</a><ol>${essays}</ol></li>`;
    })
    .join('');

  const preface = book.preface ? '<li><a href="preface.xhtml">序</a></li>' : '';
  const afterword = book.afterword ? '<li><a href="afterword.xhtml">后记</a></li>' : '';
  const people = book.people.length ? '<li><a href="people.xhtml">人物索引</a></li>' : '';

  return xhtml(
    '目录',
    `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>目录</h1><ol>${preface}${chapters}${people}${afterword}</ol></nav>`,
  );
}

function renderNcx(book: BookDocument, chapterFiles: readonly string[]): string {
  const points = book.chapters
    .map(
      (chapter, index) => `<navPoint id="nav-${index + 1}" playOrder="${index + 1}">
        <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
        <content src="${chapterFiles[index]}" />
      </navPoint>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(book.generatedAt)}" />
    <meta name="dtb:depth" content="2" />
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>${points}</navMap>
</ncx>`;
}

export async function createEpubBlob(book: BookDocument): Promise<Blob> {
  const zip = new JSZip();
  const identifier = globalThis.crypto?.randomUUID?.() ?? `shinian-${Date.now()}`;
  const chapterFiles = book.chapters.map(
    (chapter, index) => `chapter-${String(index + 1).padStart(2, '0')}-${safeFilePart(chapter.title, 'chapter')}.xhtml`,
  );
  const manifestChapters = chapterFiles
    .map(
      (file, index) =>
        `<item id="chapter-${index + 1}" href="${file}" media-type="application/xhtml+xml" />`,
    )
    .join('\n    ');
  const spineChapters = [
    ...(book.preface ? ['<itemref idref="preface" />'] : []),
    ...chapterFiles.map((_, index) => `<itemref idref="chapter-${index + 1}" />`),
    ...(book.people.length ? ['<itemref idref="people" />'] : []),
    ...(book.afterword ? ['<itemref idref="afterword" />'] : []),
  ].join('\n    ');

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`,
  );

  zip.file(
    'OEBPS/styles.css',
    `html { font-family: "Noto Serif SC", "Songti SC", serif; color: #26241f; }
body { margin: 0 5%; line-height: 1.9; }
h1, h2 { font-weight: 500; line-height: 1.35; }
h1 { margin: 1.8em 0 .7em; font-size: 1.8em; }
h2 { margin: 1.8em 0 .5em; font-size: 1.5em; }
p { margin: 0 0 1em; text-indent: 2em; }
.cover { min-height: 85vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover h1 { font-size: 2.4em; }
.cover .subtitle { color: #6f685e; text-indent: 0; }
.cover .author { margin-top: 3em; text-indent: 0; }
.eyebrow, .period, .time { color: #8e776b; font-family: sans-serif; font-size: .75em; text-indent: 0; }
.chapter-head { margin-bottom: 3em; }
.essay { margin-top: 3em; break-before: page; }
.intro { color: #6f685e; font-size: .9em; }
.index-page li { margin-bottom: .8em; }
.index-page span { display: block; color: #777; font-size: .8em; text-indent: 0; }`,
  );

  zip.file(
    'OEBPS/cover.xhtml',
    xhtml(
      book.title,
      `<section class="cover"><p class="eyebrow">SHINIAN MEMOIR</p><h1>${escapeXml(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${escapeXml(book.subtitle)}</p>` : ''}<p class="author">${escapeXml(book.author || '著')}</p></section>`,
    ),
  );

  if (book.preface) {
    zip.file(
      'OEBPS/preface.xhtml',
      xhtml('序', `<section><h1>序</h1>${paragraphs(book.preface)}</section>`),
    );
  }

  book.chapters.forEach((chapter, index) => {
    zip.file(`OEBPS/${chapterFiles[index]}`, renderChapterXhtml(chapter, index + 1));
  });

  if (book.people.length) {
    zip.file('OEBPS/people.xhtml', renderPeopleXhtml(book));
  }

  if (book.afterword) {
    zip.file(
      'OEBPS/afterword.xhtml',
      xhtml('后记', `<section><h1>后记</h1>${paragraphs(book.afterword)}</section>`),
    );
  }

  zip.file('OEBPS/nav.xhtml', renderNav(book, chapterFiles));
  zip.file('OEBPS/toc.ncx', renderNcx(book, chapterFiles));

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>${escapeXml(book.author || '佚名')}</dc:creator>
    <meta property="dcterms:modified">${escapeXml(new Date(book.generatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'))}</meta>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />
    ${book.preface ? '<item id="preface" href="preface.xhtml" media-type="application/xhtml+xml" />' : ''}
    ${manifestChapters}
    ${book.people.length ? '<item id="people" href="people.xhtml" media-type="application/xhtml+xml" />' : ''}
    ${book.afterword ? '<item id="afterword" href="afterword.xhtml" media-type="application/xhtml+xml" />' : ''}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="styles" href="styles.css" media-type="text/css" />
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover" />
    ${spineChapters}
    <itemref idref="nav" />
  </spine>
</package>`,
  );

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}