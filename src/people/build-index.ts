import type { MemoryEntry, PeopleCorrections } from '../storage/memory-store';

const COMMON_SURNAMES = '张王李赵刘陈杨黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文';
const SURNAME_CLASS = `[${COMMON_SURNAMES}]`;
const EXPLICIT_NAME_PATTERN = new RegExp(`(?:名叫|叫作|叫)([${COMMON_SURNAMES}][\\u3400-\\u9fff]{1,2})`, 'g');
const NON_NAME_WORDS = new Set([
  '老师',
  '校长',
  '同学',
  '朋友',
  '主任',
  '叔叔',
  '阿姨',
  '爷爷',
  '奶奶',
  '先生',
  '女士',
  '医生',
  '同学',
  '班主',
  '班主任',
]);

export interface PersonOccurrence {
  readonly memoryId: string;
  readonly title: string;
}

export interface PersonIndexEntry {
  readonly name: string;
  readonly count: number;
  readonly occurrences: readonly PersonOccurrence[];
}

const ROLE_SUFFIXES = [
  '班主任',
  '老师',
  '校长',
  '同学',
  '朋友',
  '主任',
  '叔叔',
  '阿姨',
  '爷爷',
  '奶奶',
  '先生',
  '女士',
  '医生',
];

const BAD_NAME_CONTINUATIONS = new Set([
  '和', '与', '在', '的', '是', '了', '着', '过', '就', '也', '都', '又', '再',
  '很', '太', '一', '说', '问', '答', '笑', '哭', '看', '走', '跑', '站', '坐',
  '来', '去', '把', '被', '给', '让', '从', '对', '向', '跟', '他', '她', '它',
]);

function isLikelyName(candidate: string): boolean {
  if (candidate.length < 2 || candidate.length > 4 || !COMMON_SURNAMES.includes(candidate[0] ?? '')) {
    return false;
  }

  if (NON_NAME_WORDS.has(candidate.slice(1)) || NON_NAME_WORDS.has(candidate)) {
    return false;
  }

  return !/^[的了着过和与在是有个这那]|[的了着过和与在是有个这那]$/.test(candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countNameOccurrences(text: string, name: string): number {
  return [...text.matchAll(new RegExp(escapeRegExp(name), 'g'))].length;
}

function extractHeuristicName(text: string, surnameIndex: number): string | null {
  const surname = text[surnameIndex];
  const second = text[surnameIndex + 1];
  const third = text[surnameIndex + 2];
  if (!surname || !second || !/^[\u3400-\u9fff]$/.test(second)) {
    return null;
  }

  const firstTwo = `${surname}${second}`;
  const firstThree = third && /^[\u3400-\u9fff]$/.test(third) ? `${firstTwo}${third}` : null;
  const followingText = text.slice(surnameIndex);

  if (ROLE_SUFFIXES.some((suffix) => followingText.startsWith(`${surname}${suffix}`))) {
    return null;
  }

  if (
    firstThree &&
    !BAD_NAME_CONTINUATIONS.has(third ?? '') &&
    !ROLE_SUFFIXES.some((suffix) => firstThree.endsWith(suffix.slice(-1)))
  ) {
    return isLikelyName(firstThree) ? firstThree : firstTwo;
  }

  return isLikelyName(firstTwo) ? firstTwo : null;
}

export function extractPersonNames(text: string): readonly string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(EXPLICIT_NAME_PATTERN)) {
    const name = match[1];
    if (name && isLikelyName(name)) {
      names.add(name);
    }
  }

  const surnamePattern = new RegExp(SURNAME_CLASS, 'g');
  for (const match of text.matchAll(surnamePattern)) {
    if (match.index === undefined) continue;
    const name = extractHeuristicName(text, match.index);
    if (name) names.add(name);
  }

  return [...names];
}
export function detectPeople(
  memories: readonly MemoryEntry[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const memory of memories) {
    for (const name of extractPersonNames(memory.body)) {
      counts[name] = (counts[name] ?? 0) + countNameOccurrences(memory.body, name);
    }
  }

  return counts;
}

function canonicalName(rawName: string, corrections: PeopleCorrections): string {
  return corrections.aliases[rawName]?.trim() || rawName;
}

export function buildPersonIndex(
  memories: readonly MemoryEntry[],
  corrections: PeopleCorrections,
): readonly PersonIndexEntry[] {
  const ignored = new Set(corrections.ignoredNames.map((name) => name.trim()));
  const entries = new Map<
    string,
    { count: number; occurrences: Map<string, PersonOccurrence> }
  >();

  for (const memory of memories) {
    if (!memory.includedInBook) {
      continue;
    }

    const counts = new Map<string, number>();
    for (const rawName of extractPersonNames(memory.body)) {
      if (ignored.has(rawName)) {
        continue;
      }
      counts.set(rawName, countNameOccurrences(memory.body, rawName));
    }

    for (const [rawName, count] of counts) {
      const name = canonicalName(rawName, corrections);
      const entry = entries.get(name) ?? { count: 0, occurrences: new Map() };
      entry.count += count;
      entry.occurrences.set(memory.id, { memoryId: memory.id, title: memory.title });
      entries.set(name, entry);
    }
  }

  for (const rawName of corrections.extraNames) {
    const name = canonicalName(rawName.trim(), corrections);
    if (!name || ignored.has(rawName)) {
      continue;
    }
    const entry = entries.get(name) ?? { count: 0, occurrences: new Map() };
    entries.set(name, entry);
  }

  return [...entries.entries()]
    .filter(
      ([name, entry]) =>
        entry.count >= 2 ||
        corrections.extraNames.some((rawName) => canonicalName(rawName.trim(), corrections) === name),
    )
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      occurrences: [...entry.occurrences.values()],
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'));
}

export function listDetectedPeople(
  memories: readonly MemoryEntry[],
  corrections: PeopleCorrections,
): readonly { readonly rawName: string; readonly count: number; readonly ignored: boolean }[] {
  const detected = detectPeople(memories);
  const names = new Set([...Object.keys(detected), ...corrections.extraNames]);

  return [...names]
    .map((rawName) => ({
      rawName,
      count: detected[rawName] ?? 0,
      ignored: corrections.ignoredNames.includes(rawName),
    }))
    .filter((item) => item.count >= 1 || corrections.extraNames.includes(item.rawName))
    .sort((left, right) => right.count - left.count || left.rawName.localeCompare(right.rawName, 'zh-CN'));
}