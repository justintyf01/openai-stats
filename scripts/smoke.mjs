// Exercise the built Worker in workerd. All outbound requests are intercepted locally.
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions, Response as LocalResponse } from "miniflare";

let calls = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({
  name: "stats-smoke",
  modules: true,
  scriptPath: "dist/index.js",
  compatibilityDate: "2026-09-05",
  bindings: { OPENAI_ADMIN_KEY: "synthetic-local-only", DAYS: "365" },
  outboundService: async request => {
    calls++;
    const url = new URL(request.url);
    assert.equal(url.origin + url.pathname, "https://api.openai.com/v1/organization/usage/completions");
    const start = Number(url.searchParams.get("start_time"));
    const end = Number(url.searchParams.get("end_time"));
    const data = [];
    for (let day = start; day < end; day += 86400) {
      data.push({ start_time: day, end_time: day + 86400, results: [
        { input_tokens: 1000, output_tokens: 500, num_model_requests: 5 },
      ] });
    }
    return new LocalResponse(JSON.stringify({ data, has_more: false, next_page: null }), {
      headers: { "Content-Type": "application/json" },
    });
  },
}));

try {
  const first = await runtime.dispatchFetch("https://stats.example/activity.svg");
  const body = await first.text();
  assert.equal(first.status, 200);
  assert.equal((body.match(/data-date=/g) ?? []).length, 365);
  // At the exact UTC midnight boundary the current day's empty interval is omitted.
  assert.match(body, /(?:547\.5K|546K) tokens/);
  assert.equal(calls, 12);

  const second = await runtime.dispatchFetch("https://stats.example/activity.svg");
  assert.equal(await second.text(), body);
  assert.equal(calls, 12);
  const light = await runtime.dispatchFetch("https://stats.example/activity.svg?theme=light&days=30");
  const lightBody = await light.text();
  assert.equal(light.status, 200);
  assert.ok(lightBody.includes("#ffffff"));
  assert.equal((lightBody.match(/data-date=/g) ?? []).length, 30);
  assert.equal(calls, 12);
  console.log("Runtime smoke test passed: yearly SVG, 12 upstream calls, SVG cache hit, and shared usage cache across themes.");
} finally {
  await runtime.dispose();
}
