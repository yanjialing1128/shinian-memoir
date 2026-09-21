/** 时间文本被解释成的粒度。粒度越细，通常越适合放在相近时间的靠前位置。 */
export type TimePrecision =
  | 'day'
  | 'month'
  | 'season'
  | 'semester'
  | 'academic-year'
  | 'year'
  | 'fuzzy'
  | 'unknown';

/** 对时间范围可信程度的描述。 */
export type TimeConfidence = 'exact' | 'approximate' | 'fuzzy';

/** 一个可用于比较的闭区间，日期内部统一表示为 UTC 日序号。 */
export interface TimeRange {
  readonly startDay: number;
  readonly endDay: number;
  readonly midDay: number;
  readonly start: string;
  readonly end: string;
}

/** 时间解析器的完整输出。解析失败不会抛异常，而是返回 resolved: false。 */
export interface ParsedTime {
  readonly input: string;
  readonly resolved: boolean;
  readonly range: TimeRange | null;
  readonly precision: TimePrecision;
  readonly confidence: TimeConfidence;
  readonly normalized: string;
  readonly notes: readonly string[];
}

/** 学校年级换算时需要的最小配置。 */
export interface ParseOptions {
  /** 初一（七年级）入学年份。默认值为需求中的 2003。 */
  readonly middleSchoolStartYear?: number;
}

/** 可参与时间线排序的最小数据结构。 */
export interface TimedItem {
  readonly timeText: string;
}

/** 原始条目与解析结果、原始输入顺序的组合。 */
export interface TimelineEntry<T extends TimedItem> {
  readonly item: T;
  readonly parsed: ParsedTime;
  readonly originalOrder: number;
}