import type { UsageBucket } from "./openai.ts";

export const DAY = 86_400;
export interface DailyUsage { date: string; tokens: number; requests: number }
export interface UsageRange { start: number; end: number; days: number }

export function usageRange(days: number, now = new Date()): UsageRange {
  const end = Math.floor(now.getTime() / 1000);
  const today = Math.floor(end / DAY) * DAY;
  return { start: today - (days - 1) * DAY, end, days };
}

export function aggregate(buckets: UsageBucket[], range: UsageRange): DailyUsage[] {
  const days = Array.from({ length: range.days }, (_, i) => ({
    date: new Date((range.start + i * DAY) * 1000).toISOString().slice(0, 10),
    tokens: 0,
    requests: 0,
  }));
  for (const bucket of buckets) {
    const index = Math.floor((bucket.start_time - range.start) / DAY);
    const day = days[index];
    if (!day || bucket.start_time >= range.end) continue;
    for (const result of bucket.results) {
      // Cached input is already part of input_tokens; do not add it again.
      day.tokens += result.input_tokens + result.output_tokens;
      day.requests += result.num_model_requests;
    }
  }
  return days;
}

export function intensityLevels(days: DailyUsage[]): number[] {
  const positive = days.map(day => day.tokens).filter(value => value > 0).sort((a, b) => a - b);
  const quantile = (p: number) => {
    const index = (positive.length - 1) * p;
    const lower = Math.floor(index);
    const a = positive[lower] ?? 0;
    return a + ((positive[Math.ceil(index)] ?? a) - a) * (index - lower);
  };
  const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
  return days.map(({ tokens }) => tokens === 0 ? 0 : 1 + thresholds.filter(t => tokens > t).length);
}
