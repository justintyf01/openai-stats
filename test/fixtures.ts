import { DAY, aggregate, usageRange } from "../src/aggregate.ts";
import type { UsageBucket } from "../src/openai.ts";

export const NOW = new Date("2026-09-05T12:00:00Z");
export function bucket(start: number, input = 1000, output = 500): UsageBucket {
  return { start_time: start, end_time: start + DAY, results: [{ input_tokens: input, output_tokens: output, num_model_requests: 5 }] };
}
export function page(data: UsageBucket[] = [], has_more = false, next_page: string | null = null): Response {
  return Response.json({ object: "page", data, has_more, next_page });
}
export function sampleDays() {
  const range = usageRange(365, NOW);
  const buckets = Array.from({ length: 365 }, (_, i) => {
    const amount = i % 7 === 0 || i % 11 === 0 ? 0 : Math.round(((i * 7919) % 28_000) * (0.3 + i / 365));
    return { ...bucket(range.start + i * DAY, amount, Math.round(amount * 0.28)),
      results: [{ input_tokens: amount, output_tokens: Math.round(amount * 0.28), num_model_requests: Math.ceil(amount / 2300) }] };
  });
  return aggregate(buckets, range);
}
