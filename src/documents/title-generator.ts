const STOP_WORDS = new Set([
  '我们',
  '你们',
  '他们',
  '自己',
  '一个',
  '一些',
  '这个',
  '那个',
  '这些',
  '那些',
  '因为',
  '所以',
  '但是',
  '然后',
  '还是',
  '已经',
  '没有',
  '就是',
  '觉得',
  '知道',
  '时候',
  '起来',
  '出来',
  '进去',
  '一下',
  '一场',
  '一次',
  '一天',
  '那年',
  '那天',
  '当时',
  '后来',
  '记得',
  '可能',
  '大概',
  '非常',
  '特别',
]);

const IMPORTANT_SINGLE_WORDS = new Set(['雨', '雪', '风', '灯', '信', '花', '树', '云', '猫', '狗']);
const SCENE_KEYWORDS = ['操场', '教室', '教学楼', '走廊', '门口', '宿舍', '食堂', '自行车', '毕业', '考试', '老师', '同学', '朋友', '雨', '雪', '风'];

const TIME_CUES = [
  '清晨',
  '早上',
  '上午',
  '中午',
  '下午',
  '傍晚',
  '晚上',
  '夜里',
  '春天',
  '夏天',
  '秋天',
  '冬天',
  '雨天',
  '雪天',
  '周末',
  '暑假',
  '寒假',
];

interface SegmentLike {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

interface SegmenterLike {
  new (
    locales?: string | string[],
    options?: { granularity: 'word' },
  ): SegmentLike;
}

function getWords(text: string): readonly string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterLike }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter('zh-CN', { granularity: 'word' });
    return [...segmenter.segment(text)]
      .filter((part) => part.isWordLike !== false)
      .map((part) => part.segment.trim())
      .filter(Boolean);
  }

  return text.match(/[\u3400-\u9fff]{2,4}/g) ?? [];
}

function isUsefulWord(word: string): boolean {
  return (
    /^[\u3400-\u9fff]{1,4}$/.test(word) &&
    ([...word].length > 1 || IMPORTANT_SINGLE_WORDS.has(word)) &&
    !STOP_WORDS.has(word) &&
    !TIME_CUES.includes(word) &&
    !/^[的了着过]|[的了着过]$/.test(word)
  );
}

function titleStyle(titles: readonly string[]): {
  readonly averageLength: number;
  readonly commonSuffix: string | null;
} {
  const cleanTitles = titles.map((title) => title.trim()).filter(Boolean);
  if (cleanTitles.length === 0) {
    return { averageLength: 9, commonSuffix: null };
  }

  const averageLength = Math.round(
    cleanTitles.reduce((sum, title) => sum + [...title].length, 0) / cleanTitles.length,
  );
  const suffixes = new Map<string, number>();

  for (const title of cleanTitles) {
    const characters = [...title];
    if (characters.length < 3) {
      continue;
    }
    const suffix = characters.slice(-2).join('');
    suffixes.set(suffix, (suffixes.get(suffix) ?? 0) + 1);
  }

  const commonSuffix =
    [...suffixes.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    averageLength: Math.max(5, Math.min(14, averageLength)),
    commonSuffix,
  };
}

function firstNarrativeSentence(body: string): string {
  const first = body
    .replace(/\r/g, '')
    .split(/[\n。！？!?]/)
    .map((part) => part.trim())
    .find(Boolean);

  return first ?? body.trim();
}

function trimTitleCandidate(candidate: string, maximumLength: number): string {
  const cleaned = candidate
    .replace(/^[“”"'《》\s]+|[“”"'《》，,。！？!?\s]+$/g, '')
    .replace(/^(?:那天|有一次|我记得|记得|后来|当时|那时候|那时|大概|可能)/, '')
    .trim();

  if ([...cleaned].length <= maximumLength) {
    return cleaned;
  }

  const clause = cleaned.split(/[，,；;：:]/)[0]?.trim() ?? cleaned;
  if ([...clause].length >= 4 && [...clause].length <= maximumLength) {
    return clause;
  }

  return [...cleaned].slice(0, maximumLength).join('');
}

function extractKeywords(body: string): readonly string[] {
  const sceneWords = SCENE_KEYWORDS.map((word) => ({ word, index: body.indexOf(word) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.word);
  const words = [...new Set([...sceneWords, ...getWords(body)])].filter(isUsefulWord);
  const scores = new Map<string, number>();

  words.forEach((word, index) => {
    scores.set(word, (scores.get(word) ?? 0) + 2 - index / Math.max(words.length, 1));
  });

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .map(([word]) => word)
    .slice(0, 8);
}

function fileNameCandidates(fileName: string | null): readonly string[] {
  if (!fileName) {
    return [];
  }

  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const cleaned = stem
    .replace(/^(?:19|20)\d{2}[-年./]\d{1,2}(?:[-月./]\d{1,2}日?)?[-_—\s]*/, '')
    .replace(/^(?:初|高)[一二三](?:上|下)学期?[-_—\s]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  return cleaned.length >= 2 ? [cleaned] : [];
}

function makeUniqueTitle(title: string, existingTitles: readonly string[]): string {
  const normalizedExisting = new Set(existingTitles.map((item) => item.trim()));
  if (!normalizedExisting.has(title)) {
    return title;
  }

  let index = 2;
  while (normalizedExisting.has(`${title}（${index}）`)) {
    index += 1;
  }
  return `${title}（${index}）`;
}

/**
 * 在没有原始标题时，根据正文关键词和已有标题的长度/用词习惯生成标题。
 * 这是完全本地的启发式生成，不会上传正文。
 */
export function generateTitle(
  body: string,
  existingTitles: readonly string[] = [],
  fileName: string | null = null,
): string {
  const cleanBody = body.replace(/\s+/g, ' ').trim();
  const style = titleStyle(existingTitles);
  const maximumLength = Math.max(6, Math.min(16, style.averageLength + 3));
  const sentence = firstNarrativeSentence(cleanBody);
  const keywords = extractKeywords(cleanBody);
  const timeCue = TIME_CUES.find((cue) => cleanBody.includes(cue));
  const primaryKeyword = keywords[0];
  const secondaryKeyword = keywords[1];
  const candidates: string[] = [];

  if (timeCue && primaryKeyword && !primaryKeyword.includes(timeCue)) {
    const measureWord = /雨|雪/.test(primaryKeyword) ? '场' : /风/.test(primaryKeyword) ? '阵' : '';
    candidates.push(`${timeCue}的那${measureWord}${primaryKeyword}`);
  }

  if (primaryKeyword && secondaryKeyword) {
    candidates.push(`${primaryKeyword}与${secondaryKeyword}`);
  }

  if (primaryKeyword && style.commonSuffix && !primaryKeyword.endsWith(style.commonSuffix)) {
    candidates.push(`${primaryKeyword}${style.commonSuffix}`);
  }

  if (sentence) {
    candidates.push(trimTitleCandidate(sentence, maximumLength));
  }

  if (primaryKeyword) {
    candidates.push(primaryKeyword);
  }

  candidates.push(...fileNameCandidates(fileName));
  candidates.push('一段旧时光');

  const selected =
    candidates
      .map((candidate) => trimTitleCandidate(candidate, maximumLength))
      .find((candidate) => candidate.length >= 2) ?? '一段旧时光';

  return makeUniqueTitle(selected, existingTitles);
}