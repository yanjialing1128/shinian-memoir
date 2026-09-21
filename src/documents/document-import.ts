import { parseTime } from '../time';
import { generateTitle } from './title-generator';

export interface ImportedDocumentDraft {
  readonly localId: string;
  readonly sourceFileName: string;
  readonly title: string;
  readonly titleGenerated: boolean;
  readonly timeText: string;
  readonly body: string;
  readonly warnings: readonly string[];
}

interface FrontMatter {
  readonly fields: ReadonlyMap<string, string>;
  readonly content: string;
}

const TIME_PATTERNS: readonly RegExp[] = [
  /(?:大概|大约|可能|好像|似乎|应该|差不多|印象中|记得)?(?:19|20)\d{2}年(?:\d{1,2}月(?:\d{1,2}(?:日|号))?)?(?:的?(?:春|夏|秋|冬)(?:天|季)?)?/,
  /(?:大概|大约|可能|好像|似乎|应该|差不多|印象中|记得)?(?:19|20)\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/,
  /(?:大概|大约|可能|好像|似乎|应该|差不多|印象中|记得)?(?:初|高)[一二三](?:那)?年?(?:的)?(?:上|下)?(?:半)?(?:学期|册|期)?/,
  /(?:大概|大约|可能|好像|似乎|应该|差不多|印象中|记得)?(?:初|高)[一二三](?:那)?年?(?:的)?(?:春|夏|秋|冬)(?:天|季)?/,
  /(?:初中|中学)(?:时|时期|期间|那年|毕业|开学)/,
  /中考[前后]/,
];

function createLocalId(fileName: string, index: number): string {
  return `${Date.now()}-${index}-${fileName}-${Math.random().toString(36).slice(2)}`;
}

function normalizeDocumentText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function parseFrontMatter(text: string): FrontMatter {
  if (!text.startsWith('---\n')) {
    return { fields: new Map(), content: text };
  }

  const closingIndex = text.indexOf('\n---', 4);
  if (closingIndex === -1) {
    return { fields: new Map(), content: text };
  }

  const block = text.slice(4, closingIndex);
  const contentStart = text.indexOf('\n', closingIndex + 1);
  const fields = new Map<string, string>();

  for (const line of block.split('\n')) {
    const match = /^([^:：]+)[:：]\s*(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      fields.set(match[1].trim().toLowerCase(), match[2].trim());
    }
  }

  return {
    fields,
    content: contentStart === -1 ? '' : text.slice(contentStart + 1).trim(),
  };
}

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '· ')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findTimeExpression(text: string): string | null {
  for (const pattern of TIME_PATTERNS) {
    const match = pattern.exec(text);
    const candidate = match?.[0]?.trim();
    if (candidate && parseTime(candidate).resolved) {
      return candidate;
    }
  }

  return null;
}

function looksLikeTitle(line: string): boolean {
  const cleaned = line.trim().replace(/^#+\s*/, '').replace(/^《|》$/g, '');
  const characterCount = [...cleaned].length;
  return (
    characterCount >= 2 &&
    characterCount <= 30 &&
    !/[。！？!?；;，,]/.test(cleaned) &&
    !/^(?:标题|题目|时间|日期|正文|作者)[:：]/.test(cleaned) &&
    !parseTime(cleaned).resolved
  );
}

function extractLabeledValue(line: string, labels: readonly string[]): string | null {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = new RegExp(`^(?:${labelPattern})[:：]\\s*(.+)$`).exec(line.trim());
  return match?.[1]?.trim() ?? null;
}

function removeLine(lines: readonly string[], index: number): string[] {
  return lines.filter((_, lineIndex) => lineIndex !== index);
}

function resolveTitle(
  explicitTitle: string | null,
  body: string,
  existingTitles: readonly string[],
  fileName: string,
  warnings: string[],
): { readonly title: string; readonly generated: boolean } {
  if (explicitTitle) {
    return { title: explicitTitle, generated: false };
  }

  warnings.push('未找到原始标题，已根据正文和已有标题风格自动生成。');
  return {
    title: generateTitle(body, existingTitles, fileName),
    generated: true,
  };
}

/**
 * 从纯文本中识别标题、时间和正文。该函数不读取文件，便于测试和复用。
 */
export function analyzeDocument(
  rawText: string,
  fileName: string,
  existingTitles: readonly string[] = [],
): ImportedDocumentDraft {
  const normalized = normalizeDocumentText(rawText);
  const frontMatter = parseFrontMatter(normalized);
  let lines = frontMatter.content.split('\n');
  const warnings: string[] = [];

  let explicitTitle =
    frontMatter.fields.get('title') ??
    frontMatter.fields.get('标题') ??
    frontMatter.fields.get('题目') ??
    null;
  let timeText =
    frontMatter.fields.get('time') ??
    frontMatter.fields.get('date') ??
    frontMatter.fields.get('时间') ??
    frontMatter.fields.get('日期') ??
    null;

  const inspectLimit = Math.min(lines.length, 18);
  const removedLineIndexes = new Set<number>();
  for (let index = 0; index < inspectLimit; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line) {
      continue;
    }

    const titleValue = extractLabeledValue(line, ['标题', '题目']);
    if (titleValue) {
      explicitTitle = titleValue;
      removedLineIndexes.add(index);
      continue;
    }

    const timeValue = extractLabeledValue(line, ['时间', '日期', '发生于']);
    if (timeValue) {
      if (parseTime(timeValue).resolved) {
        timeText = timeValue;
      } else {
        warnings.push(`元数据中的时间“${timeValue}”暂时无法识别，请导入后调整。`);
      }
      removedLineIndexes.add(index);
      continue;
    }

    const headingMatch = /^#\s+(.+)$/.exec(line);
    if (headingMatch?.[1]) {
      const heading = headingMatch[1].trim();
      if (parseTime(heading).resolved && !timeText) {
        timeText = heading;
      } else if (!explicitTitle) {
        explicitTitle = heading;
      }
      removedLineIndexes.add(index);
    }
  }
  lines = lines.filter((_, index) => !removedLineIndexes.has(index));

  if (!timeText) {
    const headText = lines.slice(0, Math.min(lines.length, 20)).join('\n');
    timeText = findTimeExpression(`${headText}\n${fileName}`);
  }

  if (!explicitTitle) {
    const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
    const firstLine = firstContentIndex === -1 ? '' : (lines[firstContentIndex]?.trim() ?? '');
    const remainingCount = lines
      .slice(firstContentIndex + 1)
      .filter((line) => line.trim().length > 0).length;

    if (firstLine && remainingCount > 0 && looksLikeTitle(firstLine)) {
      explicitTitle = firstLine.replace(/^#+\s*/, '').replace(/^《|》$/g, '');
      lines = removeLine(lines, firstContentIndex);
    }
  }

  if (timeText && !parseTime(timeText).resolved) {
    warnings.push(`时间“${timeText}”暂时无法识别，请导入后调整。`);
  } else if (!timeText) {
    warnings.push('没有提取到时间，导入后可以手动补充。');
  }

  let body = stripMarkdownFormatting(lines.join('\n').trim());
  if (!body) {
    warnings.push('文档正文为空。');
    body = '（正文为空）';
  }

  const resolvedTitle = resolveTitle(
    explicitTitle?.trim() || null,
    body,
    existingTitles,
    fileName,
    warnings,
  );

  return {
    localId: createLocalId(fileName, 0),
    sourceFileName: fileName,
    title: resolvedTitle.title,
    titleGenerated: resolvedTitle.generated,
    timeText: timeText ?? '',
    body,
    warnings,
  };
}

function htmlToDocumentText(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const title = documentNode.querySelector('h1')?.textContent?.trim();
  const parts = [...documentNode.body.querySelectorAll('h1, h2, h3, p, li')]
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);

  if (title && parts[0] !== title) {
    parts.unshift(`# ${title}`);
  }

  return parts.join('\n\n');
}

async function readDocumentText(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return htmlToDocumentText(result.value);
  }

  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      if (pageText) {
        pages.push(pageText);
      }
    }

    return pages.join('\n\n');
  }

  const text = await file.text();
  if (extension === 'html' || extension === 'htm') {
    return htmlToDocumentText(text);
  }
  return text;
}

export function isSupportedDocument(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'pdf'].includes(extension);
}

export async function importDocumentFiles(
  files: readonly File[],
  existingTitles: readonly string[] = [],
): Promise<readonly ImportedDocumentDraft[]> {
  const titles = [...existingTitles];
  const drafts: ImportedDocumentDraft[] = [];

  for (const [index, file] of files.entries()) {
    if (!isSupportedDocument(file)) {
      throw new Error(`暂不支持 ${file.name} 的格式。`);
    }

    const text = await readDocumentText(file);
    const draft = analyzeDocument(text, file.name, titles);
    const uniqueDraft = {
      ...draft,
      localId: createLocalId(file.name, index),
    };
    drafts.push(uniqueDraft);
    titles.push(uniqueDraft.title);
  }

  return drafts;
}