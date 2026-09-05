import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { usageRange } from "../src/aggregate.ts";
import type { Env } from "../src/config.ts";
import { bucket, NOW, page } from "./fixtures.ts";

let entries: Map<string, Response>;
let pending: Promise<unknown>[];
let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
const env: Env = { OPENAI_ADMIN_KEY: "test-only-admin-secret", DAYS: "7" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  entries = new Map();
  pending = [];
  cache = {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => { entries.set(request.url, response.clone()); }),
  };
  vi.stubGlobal("caches", { default: cache });
  upstream = vi.fn<typeof fetch>().mockImplementation(async () => page([bucket(usageRange(7, NOW).start)]));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function request(path = "/activity.svg", method = "GET", bindings = env) {
  const response = await worker.fetch(new Request(`https://stats.example${path}`, { method }), bindings,
    { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext);
  await Promise.all(pending);
  return response;
}
it("serves SVG with browser and edge caching, and reuses normalized aliases", async () => {
  const first = await request();
  expect(first.status).toBe(200);
  expect(first.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
  expect(first.headers.get("Cache-Control")).toBe("public, max-age=900, s-maxage=3600");
  expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
  const text = await first.text();
  expect(text).toContain("1.5K tokens");
  expect(text).not.toContain(env.OPENAI_ADMIN_KEY);
  expect(await (await request("/activity.svg?theme=dark&days=7")).text()).toBe(text);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect([...entries.keys()].join()).not.toContain(env.OPENAI_ADMIN_KEY);
});
it("shares usage across cosmetic variants and shorter windows", async () => {
  await request();
  expect(await (await request("/activity.svg?theme=light&days=3&hide_border=true")).text()).toContain("#ffffff");
  expect(upstream).toHaveBeenCalledTimes(1);
});
it("does not extend edge freshness when rendering a variant from older data", async () => {
  await request();
  vi.setSystemTime(new Date(NOW.getTime() + 1800_000));
  await request("/activity.svg?theme=light");
  expect([...entries.values()].at(-1)?.headers.get("Cache-Control")).toContain("s-maxage=1800");
});
it("changes cache scope on UTC rollover, key rotation, and project configuration", async () => {
  await request();
  upstream.mockImplementation(async () => page());
  await request("/activity.svg", "GET", { ...env, OPENAI_ADMIN_KEY: "rotated-test-key" });
  await request("/activity.svg", "GET", { ...env, PROJECT_IDS: "proj_test" });
  vi.setSystemTime(new Date("2026-09-06T01:00:00Z"));
  await request();
  expect(upstream).toHaveBeenCalledTimes(4);
});
it("rejects unknown routes, query parameters, and methods before upstream access", async () => {
  expect((await request("/")).status).toBe(404);
  expect((await request("/__cache/usage/test")).status).toBe(404);
  const post = await request("/activity.svg", "POST");
  expect(post.status).toBe(405);
  expect(post.headers.get("Allow")).toBe("GET, HEAD");
  expect((await request("/activity.svg?project=proj_other")).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
it("requires a configured secret even with cached data", async () => {
  await request();
  const response = await request("/activity.svg", "GET", {});
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("returns uncached safe errors, never upstream bodies", async () => {
  upstream.mockResolvedValue(new Response("sensitive upstream details", { status: 401 }));
  const response = await request();
  expect(response.status).toBe(502);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.text();
  expect(body).toContain("admin key");
  expect(body).not.toContain("sensitive upstream details");
  expect(cache.put).not.toHaveBeenCalled();
});
it("returns a working card if the edge cache fails", async () => {
  cache.match.mockRejectedValue(new Error("cache unavailable"));
  cache.put.mockRejectedValue(new Error("cache unavailable"));
  expect((await request()).status).toBe(200);
});
it("supports HEAD with no body on success, cache hits, and errors", async () => {
  expect(await (await request("/activity.svg", "HEAD")).text()).toBe("");
  expect(await (await request("/activity.svg", "HEAD")).text()).toBe("");
  expect(await (await request("/activity.svg?days=0", "HEAD")).text()).toBe("");
});
