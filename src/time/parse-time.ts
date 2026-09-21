import type {
  ParseOptions,
  ParsedTime,
  TimeConfidence,
  TimePrecision,
  TimeRange,
} from './types';

const DAY_MS = 86_400_000;
const DEFAULT_YEAR = 2003;
const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

const FIRST_TERM_DETAILS = new Set([
  '上',
  '上学期',
  '上半学期',
  '上学期时',
  '秋学期',
  '秋季学期',
]);

const SECOND_TERM_DETAILS = new Set([
  '下',
  '下学期',
  '下半学期',
  '下学期时',
  '春学期',
  '春季学期',
]);

const WHOLE_GRADE_DETAILS = new Set([
  '',
  '时',
  '时期',
  '期间',
  '那年',
  '这年',
  '的那年',
  '的那一年',
]);

const APPROXIMATE_PREFIX =
  /^(大概是|大约是|可能是|好像是|似乎是|应该是|差不多是|印象中是|印象里是|记得是|我想是|大概|大约|可能|好像|似乎|应该|差不多|印象中|印象里|记得|也许)(?:在)?/;

const GRADE_INDEX: Readonly<Record<string, number>> = {
  初一: 1,
  七年级: 1,
  初二: 2,
  八年级: 2,
  初三: 3,
  九年级: 3,
  高一: 4,
  高二: 5,
  高三: 6,
};

interface ResolvedRangeOptions {
  readonly precision: TimePrecision;
  readonly confidence: TimeConfidence;
  readonly notes?: readonly string[];
}

function normalizeText(input: string): string {
  return input
    .trim()
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[／]/g, '/')
    .replace(/[．]/g, '.')
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[。！!]+$/g, '');
}

function resolveStartYear(options: ParseOptions): number {
  const candidate = options.middleSchoolStartYear ?? DEFAULT_YEAR;
  if (!Number.isInteger(candidate) || candidate < YEAR_MIN || candidate > YEAR_MAX) {
    return DEFAULT_YEAR;
  }
  return candidate;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= YEAR_MIN &&
    year <= YEAR_MAX &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function toDay(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function calendarFromDay(day: number): { year: number; month: number; day: number } {
  const date = new Date(day * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function createRange(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
): TimeRange {
  const startDay = toDay(start[0], start[1], start[2]);
  const endDay = toDay(end[0], end[1], end[2]);

  if (endDay < startDay) {
    throw new Error('Time range end cannot be before its start.');
  }

  return {
    startDay,
    endDay,
    midDay: Math.floor((startDay + endDay) / 2),
    start: fromDay(startDay),
    end: fromDay(endDay),
  };
}

function startOfMonthRange(year: number, month: number): TimeRange {
  return createRange([year, month, 1], [year, month, daysInMonth(year, month)]);
}

function formatMonth(year: number, month: number): string {
  return `${year}年${month}月`;
}

function formatDay(day: number): string {
  const date = calendarFromDay(day);
  return `${date.year}年${date.month}月${date.day}日`;
}

function formatRange(range: TimeRange, precision: TimePrecision): string {
  if (precision === 'day') {
    return formatDay(range.startDay);
  }

  if (precision === 'month') {
    const start = calendarFromDay(range.startDay);
    return formatMonth(start.year, start.month);
  }

  if (precision === 'year') {
    return `${calendarFromDay(range.startDay).year}年`;
  }

  const start = calendarFromDay(range.startDay);
  const end = calendarFromDay(range.endDay);

  if (start.year === end.year) {
    return `${start.year}年${start.month}月—${end.month}月`;
  }

  return `${start.year}年${start.month}月—${end.year}年${end.month}月`;
}

function resolvedResult(
  input: string,
  range: TimeRange,
  options: ResolvedRangeOptions,
): ParsedTime {
  return {
    input,
    resolved: true,
    range,
    precision: options.precision,
    confidence: options.confidence,
    normalized: formatRange(range, options.precision),
    notes: options.notes ?? [],
  };
}

function unresolvedResult(input: string, notes: readonly string[] = []): ParsedTime {
  return {
    input,
    resolved: false,
    range: null,
    precision: 'unknown',
    confidence: 'fuzzy',
    normalized: '未识别',
    notes,
  };
}

function seasonRange(
  year: number,
  season: '春' | '夏' | '秋' | '冬',
): TimeRange {
  switch (season) {
    case '春':
      return createRange([year, 3, 1], [year, 5, 31]);
    case '夏':
      return createRange([year, 6, 1], [year, 8, 31]);
    case '秋':
      return createRange([year, 9, 1], [year, 11, 30]);
    case '冬':
      return createRange([year, 12, 1], [year + 1, 2, daysInMonth(year + 1, 2)]);
  }
}

function academicYearRange(startYear: number): TimeRange {
  return createRange(
    [startYear, 9, 1],
    [startYear + 1, 8, 31],
  );
}

function semesterRange(startYear: number, term: 'first' | 'second'): TimeRange {
  if (term === 'first') {
    return createRange([startYear, 9, 1], [startYear + 1, 1, 31]);
  }

  return createRange([startYear + 1, 2, 1], [startYear + 1, 8, 31]);
}

function gradeStartYear(gradeIndex: number, middleSchoolStartYear: number): number {
  return middleSchoolStartYear + gradeIndex - 1;
}

function gradeAnchorNote(startYear: number): string {
  return `按初一入学年份 ${startYear} 年推算；可在解析配置中调整。`;
}

function normalizeGradeDetail(remainder: string): string {
  if (/^(的时候|那会儿|时|期间)$/.test(remainder)) {
    return '';
  }

  return remainder
    .replace(/^(?:那|这)(?:一)?年(?:的)?/, '')
    .replace(/^年(?:的)?/, '')
    .replace(/^的/, '');
}

function parseGradeDetail(
  gradeIndex: number,
  detail: string,
  middleSchoolStartYear: number,
  approximate: boolean,
): ParsedTime | null {
  const startYear = gradeStartYear(gradeIndex, middleSchoolStartYear);
  const notes = [gradeAnchorNote(middleSchoolStartYear)];
  const confidence: TimeConfidence = 'approximate';
  let range: TimeRange;
  let precision: TimePrecision;

  if (WHOLE_GRADE_DETAILS.has(detail)) {
    range = academicYearRange(startYear);
    precision = 'academic-year';
  } else if (FIRST_TERM_DETAILS.has(detail)) {
    range = semesterRange(startYear, 'first');
    precision = 'semester';
  } else if (SECOND_TERM_DETAILS.has(detail)) {
    range = semesterRange(startYear, 'second');
    precision = 'semester';
  } else if (/^(春天|春季|春)$/.test(detail)) {
    range = seasonRange(startYear + 1, '春');
    precision = 'season';
  } else if (/^(夏天|夏季|夏)$/.test(detail)) {
    range = seasonRange(startYear + 1, '夏');
    precision = 'season';
  } else if (/^(秋天|秋季|秋)$/.test(detail)) {
    range = seasonRange(startYear, '秋');
    precision = 'season';
  } else if (/^(冬天|冬季|冬)$/.test(detail)) {
    range = seasonRange(startYear, '冬');
    precision = 'season';
  } else if (/^(寒假|寒假时|寒假里)$/.test(detail)) {
    range = createRange([startYear + 1, 1, 15], [startYear + 1, 2, 15]);
    precision = 'fuzzy';
  } else if (/^(暑假|暑假时|暑假里)$/.test(detail)) {
    range = createRange([startYear + 1, 7, 1], [startYear + 1, 8, 31]);
    precision = 'fuzzy';
  } else if (/^(开学|刚开学|入学|刚入学|开学时)$/.test(detail)) {
    range = createRange([startYear, 9, 1], [startYear, 9, 30]);
    precision = 'fuzzy';
  } else if (/^(毕业|毕业时|毕业前|初中毕业|中考)$/.test(detail)) {
    range = createRange([startYear + 1, 5, 1], [startYear + 1, 7, 31]);
    precision = 'fuzzy';
  } else if (detail === '中考前') {
    range = createRange([startYear + 1, 3, 1], [startYear + 1, 6, 20]);
    precision = 'fuzzy';
  } else if (detail === '中考后') {
    range = createRange([startYear + 1, 6, 21], [startYear + 1, 8, 31]);
    precision = 'fuzzy';
  } else {
    return null;
  }

  return resolvedResult('', range, {
    precision,
    confidence: approximate ? 'approximate' : confidence,
    notes: approximate
      ? [...notes, '原始描述带有“大概/可能”等模糊限定。']
      : notes,
  });
}

function parseNumericTime(cleaned: string, approximate: boolean): ParsedTime | null {
  const chineseDateMatch =
    /^(\d{4})年(\d{1,2})月(?:(\d{1,2})(?:日|号)?)?$/.exec(cleaned);
  const symbolicDateMatch =
    /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(cleaned);
  const match = chineseDateMatch ?? symbolicDateMatch;

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const dayText = match[3];
    const day = dayText === undefined ? null : Number(dayText);

    if (day === null) {
      if (year < YEAR_MIN || year > YEAR_MAX || month < 1 || month > 12) {
        return null;
      }

      const result = resolvedResult('', startOfMonthRange(year, month), {
        precision: 'month',
        confidence: approximate ? 'approximate' : 'exact',
        notes: approximate ? ['原始描述带有“大概/可能”等模糊限定。'] : [],
      });
      return result;
    }

    if (!isValidDate(year, month, day)) {
      return null;
    }

    const result = resolvedResult('', createRange([year, month, day], [year, month, day]), {
      precision: 'day',
      confidence: approximate ? 'approximate' : 'exact',
      notes: approximate ? ['原始描述带有“大概/可能”等模糊限定。'] : [],
    });
    return result;
  }

  const yearSeasonMatch = /^(\d{4})年?(?:的)?(春|夏|秋|冬)(?:天|季)?$/.exec(cleaned);
  if (yearSeasonMatch) {
    const year = Number(yearSeasonMatch[1]);
    const season = yearSeasonMatch[2] as '春' | '夏' | '秋' | '冬';
    if (year < YEAR_MIN || year > YEAR_MAX) {
      return null;
    }

    return resolvedResult('', seasonRange(year, season), {
      precision: 'season',
      confidence: approximate ? 'approximate' : 'exact',
      notes: approximate ? ['原始描述带有“大概/可能”等模糊限定。'] : [],
    });
  }

  const yearMatch = /^(\d{4})年?$/.exec(cleaned);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    if (year < YEAR_MIN || year > YEAR_MAX) {
      return null;
    }

    return resolvedResult('', createRange([year, 1, 1], [year, 12, 31]), {
      precision: 'year',
      confidence: approximate ? 'approximate' : 'exact',
      notes: approximate ? ['原始描述带有“大概/可能”等模糊限定。'] : [],
    });
  }

  return null;
}

function parseGradeTime(
  cleaned: string,
  middleSchoolStartYear: number,
  approximate: boolean,
): ParsedTime | null {
  const match = /^(初一|初二|初三|七年级|八年级|九年级|高一|高二|高三)(.*)$/.exec(
    cleaned,
  );
  if (!match) {
    return null;
  }

  const gradeToken = match[1];
  const remainder = match[2];
  const gradeIndex = gradeToken === undefined ? undefined : GRADE_INDEX[gradeToken];
  if (gradeIndex === undefined || remainder === undefined) {
    return null;
  }

  const detail = normalizeGradeDetail(remainder);
  const partialResult = parseGradeDetail(
    gradeIndex,
    detail,
    middleSchoolStartYear,
    approximate,
  );
  if (!partialResult) {
    return null;
  }

  return {
    ...partialResult,
    input: cleaned,
  };
}

function parseExamTime(
  cleaned: string,
  middleSchoolStartYear: number,
  approximate: boolean,
): ParsedTime | null {
  const gradeThreeStartYear = middleSchoolStartYear + 2;
  const examYear = gradeThreeStartYear + 1;
  let range: TimeRange;

  if (cleaned === '中考前') {
    range = createRange([examYear, 3, 1], [examYear, 6, 20]);
  } else if (cleaned === '中考后') {
    range = createRange([examYear, 6, 21], [examYear, 8, 31]);
  } else if (cleaned === '中考那年' || cleaned === '中考') {
    range = academicYearRange(gradeThreeStartYear);
  } else {
    return null;
  }

  const notes = [
    gradeAnchorNote(middleSchoolStartYear),
    ...(approximate ? ['原始描述带有“大概/可能”等模糊限定。'] : []),
  ];
  return resolvedResult(cleaned, range, {
    precision: 'fuzzy',
    confidence: 'approximate',
    notes,
  });
}

function parseSpecialMiddleSchoolTime(
  cleaned: string,
  middleSchoolStartYear: number,
  approximate: boolean,
): ParsedTime | null {
  const match = /^(初中|中学)(.*)$/.exec(cleaned);
  if (!match) {
    return null;
  }

  const remainder = match[2];
  if (remainder === undefined) {
    return null;
  }

  const detail = normalizeGradeDetail(remainder);
  const notes = [gradeAnchorNote(middleSchoolStartYear)];
  let range: TimeRange;
  let precision: TimePrecision;

  if (WHOLE_GRADE_DETAILS.has(detail) || detail === '的那几年' || detail === '那几年') {
    range = createRange(
      [middleSchoolStartYear, 9, 1],
      [middleSchoolStartYear + 3, 8, 31],
    );
    precision = 'academic-year';
  } else if (/^(开学|刚开学|入学|刚入学|开学时)$/.test(detail)) {
    range = createRange([middleSchoolStartYear, 9, 1], [middleSchoolStartYear, 9, 30]);
    precision = 'fuzzy';
  } else if (/^(毕业|毕业时|毕业前)$/.test(detail)) {
    range = createRange(
      [middleSchoolStartYear + 3, 5, 1],
      [middleSchoolStartYear + 3, 7, 31],
    );
    precision = 'fuzzy';
  } else {
    return null;
  }

  return resolvedResult(cleaned, range, {
    precision,
    confidence: 'approximate',
    notes: approximate
      ? [...notes, '原始描述带有“大概/可能”等模糊限定。']
      : notes,
  });
}

function stripApproximatePrefix(input: string): {
  readonly cleaned: string;
  readonly approximate: boolean;
} {
  const match = APPROXIMATE_PREFIX.exec(input);
  if (!match) {
    return { cleaned: input.replace(/^在/, ''), approximate: false };
  }

  return {
    cleaned: input.slice(match[0].length).replace(/^在/, ''),
    approximate: true,
  };
}

/**
 * 把中文或数字写法的模糊时间解析成一个闭区间。
 *
 * 支持日期、年月、年份、季节、学期/年级，以及带“大概/可能”等限定词的描述。
 * 不认识的文本会返回 resolved: false，方便调用方继续保存原文。
 */
export function parseTime(input: string, options: ParseOptions = {}): ParsedTime {
  const normalizedInput = normalizeText(input);
  if (normalizedInput.length === 0) {
    return unresolvedResult(input, ['时间文本为空。']);
  }

  const { cleaned, approximate } = stripApproximatePrefix(normalizedInput);
  if (cleaned.length === 0) {
    return unresolvedResult(input, ['只有模糊限定词，没有可识别的时间信息。']);
  }

  const middleSchoolStartYear = resolveStartYear(options);
  const parsed =
    parseNumericTime(cleaned, approximate) ??
    parseGradeTime(cleaned, middleSchoolStartYear, approximate) ??
    parseExamTime(cleaned, middleSchoolStartYear, approximate) ??
    parseSpecialMiddleSchoolTime(cleaned, middleSchoolStartYear, approximate);

  if (!parsed) {
    return unresolvedResult(input, [
      '暂不支持这段写法；原文仍会保存，并排在已识别时间之后。',
    ]);
  }

  return {
    ...parsed,
    input,
  };
}