import { describe, expect, it } from "vitest";
import { aggregate, DAY, intensityLevels, usageRange } from "../src/aggregate.ts";
import { bucket, NOW } from "./fixtures.ts";

describe("UTC aggregation", () => {
  it("includes today and exactly 365 dates", () => {
    const range = usageRange(365, NOW);
    const days = aggregate([], range);
    expect(days).toHaveLength(365);
    expect(days[0]?.date).toBe("2025-09-06");
    expect(days.at(-1)?.date).toBe("2026-09-05");
    expect(range.end).toBe(NOW.getTime() / 1000);
  });
  it("sums results, fills missing days, and does not double count cached input", () => {
    const range = usageRange(3, NOW);
    const data = bucket(range.start);
    data.results.push({ input_tokens: 50, output_tokens: 25, num_model_requests: 2, input_cached_tokens: 40 } as typeof data.results[number]);
    const days = aggregate([bucket(range.start + 2 * DAY), data], range);
    expect(days.map(d => d.tokens)).toEqual([1575, 0, 1500]);
    expect(days.map(d => d.requests)).toEqual([7, 0, 5]);
  });
  it("handles leap days and calendar year boundaries", () => {
    expect(aggregate([], usageRange(3, new Date("2024-03-01T12:00:00Z")))).toEqual([
      { date: "2024-02-28", tokens: 0, requests: 0 },
      { date: "2024-02-29", tokens: 0, requests: 0 },
      { date: "2024-03-01", tokens: 0, requests: 0 },
    ]);
    expect(aggregate([], usageRange(2, new Date("2026-01-01T00:00:00Z")))).toHaveLength(2);
  });
  it("excludes buckets outside the interval", () => {
    const range = usageRange(1, NOW);
    expect(aggregate([bucket(range.start - DAY), bucket(range.start + DAY)], range)[0]?.tokens).toBe(0);
  });
});

describe("intensity levels", () => {
  const levels = (tokens: number[]) => intensityLevels(tokens.map(n => ({ date: "2026-01-01", tokens: n, requests: 0 })));
  it("uses positive-day quartiles, independent of zero days and scale", () => {
    expect(levels([0, 0, 10, 20, 30, 40])).toEqual([0, 0, 1, 2, 3, 4]);
    expect(levels([0, 10000, 20000, 30000, 40000])).toEqual([0, 1, 2, 3, 4]);
  });
  it("handles empty history, one active day, and ties deterministically", () => {
    expect(levels([0, 0])).toEqual([0, 0]);
    expect(levels([0, 8])).toEqual([0, 1]);
    expect(levels([8, 8, 8, 8])).toEqual([1, 1, 1, 1]);
  });
});
