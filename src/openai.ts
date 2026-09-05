import { DAY, type UsageRange } from "./aggregate.ts";

export interface UsageBucket {
  start_time: number;
  end_time: number;
  results: { input_tokens: number; output_tokens: number; num_model_requests: number }[];
}
interface UsagePage { data: UsageBucket[]; has_more: boolean; next_page: string | null }

export class UsageError extends Error {
  constructor(readonly kind: "auth" | "rate_limit" | "upstream" | "invalid" | "timeout") {
    super(`Usage fetch failed: ${kind}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function parsePage(value: unknown): UsagePage {
  if (!isRecord(value) || !Array.isArray(value.data) || typeof value.has_more !== "boolean" ||
      !(value.next_page === null || typeof value.next_page === "string")) throw new UsageError("invalid");
  for (const bucket of value.data) {
    if (!isRecord(bucket) || !count(bucket.start_time) || !count(bucket.end_time) ||
        bucket.end_time <= bucket.start_time || bucket.end_time - bucket.start_time > DAY ||
        bucket.start_time % DAY !== 0 || !Array.isArray(bucket.results)) throw new UsageError("invalid");
    for (const result of bucket.results) {
      if (!isRecord(result) || !count(result.input_tokens) || !count(result.output_tokens) ||
          !count(result.num_model_requests)) throw new UsageError("invalid");
    }
  }
  return value as unknown as UsagePage;
}

/** Nonoverlapping 31-day windows; three in flight, with cursor support inside each. */
export async function fetchUsage(
  key: string, range: UsageRange, projectIds: string[], fetcher: typeof fetch = fetch,
): Promise<UsageBucket[]> {
  const windows: { start: number; end: number }[] = [];
  for (let start = range.start; start < range.end; start += 31 * DAY) {
    windows.push({ start, end: Math.min(start + 31 * DAY, range.end) });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let nextWindow = 0;
  let calls = 0;
  const buckets: UsageBucket[] = [];
  const seenBuckets = new Set<number>();
  async function consume(): Promise<void> {
    while (nextWindow < windows.length) {
      const window = windows[nextWindow++]!;
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      do {
        if (controller.signal.aborted) throw new UsageError("timeout");
        // Leaves ample room below the Free tier's 50-subrequest limit, including cache operations.
        if (++calls > 24) throw new UsageError("invalid");
        const url = new URL("https://api.openai.com/v1/organization/usage/completions");
        url.searchParams.set("start_time", String(window.start));
        url.searchParams.set("end_time", String(window.end));
        url.searchParams.set("bucket_width", "1d");
        url.searchParams.set("limit", "31");
        for (const id of projectIds) url.searchParams.append("project_ids[]", id);
        if (cursor) url.searchParams.set("page", cursor);
        const response = await fetcher(url.toString(), {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: controller.signal,
          redirect: "manual",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new UsageError(response.status === 401 || response.status === 403 ? "auth" :
            response.status === 429 ? "rate_limit" : "upstream");
        }
        const page = parsePage(await response.json());
        for (const bucket of page.data) {
          if (bucket.start_time < window.start || bucket.start_time >= window.end || seenBuckets.has(bucket.start_time)) {
            throw new UsageError("invalid");
          }
          seenBuckets.add(bucket.start_time);
          buckets.push(bucket);
        }
        cursor = page.has_more ? page.next_page : null;
        if (page.has_more && (!cursor || seenCursors.has(cursor))) throw new UsageError("invalid");
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(3, windows.length) }, consume));
    return buckets.sort((a, b) => a.start_time - b.start_time);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    controller.abort();
    if (error instanceof UsageError) throw error;
    throw new UsageError(timedOut ? "timeout" : "upstream");
  } finally {
    clearTimeout(timer);
  }
}
