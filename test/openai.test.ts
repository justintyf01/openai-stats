import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY, usageRange } from "../src/aggregate.ts";
import { fetchUsage } from "../src/openai.ts";
import { bucket, NOW, page } from "./fixtures.ts";

afterEach(() => vi.useRealTimers());
describe("Usage client", () => {
  it("covers a year with 12 nonoverlapping windows and at most 3 concurrent requests", async () => {
    const range = usageRange(365, NOW);
    let active = 0;
    let maxActive = 0;
    const intervals: [number, number][] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const url = new URL(String(input));
      const start = Number(url.searchParams.get("start_time"));
      const end = Number(url.searchParams.get("end_time"));
      intervals.push([start, end]);
      expect(url.origin + url.pathname).toBe("https://api.openai.com/v1/organization/usage/completions");
      expect(url.searchParams.get("bucket_width")).toBe("1d");
      expect(url.searchParams.get("limit")).toBe("31");
      expect(url.searchParams.getAll("project_ids[]")).toEqual(["proj_test"]);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-only-key" });
      expect(init?.redirect).toBe("manual");
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return page(Array.from({ length: Math.ceil((end - start) / DAY) }, (_, i) => bucket(start + i * DAY)));
    });
    expect(await fetchUsage("test-only-key", range, ["proj_test"], fetcher)).toHaveLength(365);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(maxActive).toBe(3);
    intervals.sort((a, b) => a[0] - b[0]);
    expect(intervals[0]?.[0]).toBe(range.start);
    expect(intervals.at(-1)?.[1]).toBe(range.end);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]?.[0]).toBe(intervals[i - 1]?.[1]);
  });
  it("follows opaque cursors without changing the window", async () => {
    const range = usageRange(2, NOW);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([bucket(range.start)], true, "cursor+/="))
      .mockResolvedValueOnce(page([bucket(range.start + DAY)]));
    expect(await fetchUsage("test", range, [], fetcher)).toHaveLength(2);
    const second = new URL(String(fetcher.mock.calls[1]?.[0]));
    expect(second.searchParams.get("page")).toBe("cursor+/=");
    expect(second.searchParams.get("start_time")).toBe(String(range.start));
  });
  it.each([302, 401, 403, 429, 500])("sanitizes upstream HTTP %s", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive upstream details", { status }));
    await expect(fetchUsage("test", usageRange(1, NOW), [], fetcher)).rejects.toThrow(/Usage fetch failed/);
  });
  it("rejects malformed counts and duplicate buckets", async () => {
    const range = usageRange(1, NOW);
    const bad = bucket(range.start, -1);
    await expect(fetchUsage("test", range, [], vi.fn<typeof fetch>().mockResolvedValue(page([bad])))).rejects.toThrow("invalid");
    await expect(fetchUsage("test", range, [], vi.fn<typeof fetch>().mockResolvedValue(page([bucket(range.start), bucket(range.start)])))).rejects.toThrow("invalid");
  });
  it("rejects missing and repeated pagination cursors", async () => {
    const range = usageRange(1, NOW);
    await expect(fetchUsage("test", range, [], vi.fn<typeof fetch>().mockResolvedValue(page([], true)))).rejects.toThrow("invalid");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page([], true, "same"));
    await expect(fetchUsage("test", range, [], fetcher)).rejects.toThrow("invalid");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds total pagination calls", async () => {
    let n = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page([], true, String(++n)));
    await expect(fetchUsage("test", usageRange(1, NOW), [], fetcher)).rejects.toThrow("invalid");
    expect(fetcher).toHaveBeenCalledTimes(24);
  });
  it("times out and cancels a stalled upstream", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const pending = expect(fetchUsage("test", usageRange(1, NOW), [], fetcher)).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
  });
  it("does not fetch an empty interval at precisely midnight", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await fetchUsage("test", usageRange(1, new Date("2026-09-05T00:00:00Z")), [], fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
