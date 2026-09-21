import { parseTime } from './parse-time';
import type {
  ParseOptions,
  ParsedTime,
  TimeConfidence,
  TimePrecision,
  TimedItem,
  TimelineEntry,
} from './types';

const PRECISION_RANK: Readonly<Record<TimePrecision, number>> = {
  day: 0,
  month: 1,
  season: 2,
  semester: 3,
  'academic-year': 4,
  year: 5,
  fuzzy: 6,
  unknown: 7,
};

const CONFIDENCE_RANK: Readonly<Record<TimeConfidence, number>> = {
  exact: 0,
  approximate: 1,
  fuzzy: 2,
};

function compareNumber(left: number, right: number): number {
  return left - right;
}

/**
 * 对两个已解析时间进行稳定、可解释的排序。
 *
 * 规则依次为：已识别时间在前；区间中点早的在前；起点、终点早的在前；
 * 时间粒度更细的在前；可信度更高的在前。输入顺序由上层时间线负责兜底。
 */
export function compareParsedTimes(left: ParsedTime, right: ParsedTime): number {
  if (left.resolved !== right.resolved) {
    return left.resolved ? -1 : 1;
  }

  if (!left.range || !right.range) {
    return 0;
  }

  const comparisons = [
    compareNumber(left.range.midDay, right.range.midDay),
    compareNumber(left.range.startDay, right.range.startDay),
    compareNumber(left.range.endDay, right.range.endDay),
    compareNumber(PRECISION_RANK[left.precision], PRECISION_RANK[right.precision]),
    compareNumber(
      CONFIDENCE_RANK[left.confidence],
      CONFIDENCE_RANK[right.confidence],
    ),
  ];

  return comparisons.find((comparison) => comparison !== 0) ?? 0;
}

/**
 * 解析原始条目并按时间线排序。相同时间下保持输入原有顺序。
 */
export function sortMemories<T extends TimedItem>(
  items: readonly T[],
  options: ParseOptions = {},
): readonly TimelineEntry<T>[] {
  return items
    .map((item, originalOrder): TimelineEntry<T> => ({
      item,
      parsed: parseTime(item.timeText, options),
      originalOrder,
    }))
    .sort((left, right) => {
      const timeComparison = compareParsedTimes(left.parsed, right.parsed);
      return timeComparison || left.originalOrder - right.originalOrder;
    });
}