import { aggregate, usageRange, type DailyUsage } from "./aggregate.ts";
import { ConfigError, readConfig, type Env } from "./config.ts";
import { fetchUsage, UsageError } from "./openai.ts";
import { renderError, renderSvg } from "./svg.ts";

const CACHE_CONTROL = "public, max-age=900, s-maxage=3600";
const svgHeaders = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/activity.svg") return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    try {
      const config = readConfig(url, env);
      const key = env.OPENAI_ADMIN_KEY?.trim();
      if (!key) throw new ConfigError("Set the OPENAI_ADMIN_KEY Worker secret to show activity.", 503);
      const range = usageRange(config.maxDays);
      // Internal keys never contain plaintext credentials; rotation also invalidates edge entries.
      const scope = await digest(JSON.stringify(["v1", key, config.projectIds, config.maxDays, range.start]));
      const dataKey = new Request(`${url.origin}/__cache/usage/${scope}`);
      const svgKey = new Request(`${url.origin}/__cache/svg/${scope}/${await digest(JSON.stringify(config))}`);
      const cache = caches.default;
      const cachedSvg = await cache.match(svgKey).catch(() => undefined);
      if (cachedSvg) return new Response(request.method === "HEAD" ? null : cachedSvg.body, cachedSvg);

      const cachedData = await cache.match(dataKey).catch(() => undefined);
      let days: DailyUsage[];
      let fetchedAt: number;
      if (cachedData) {
        ({ days, fetchedAt } = await cachedData.json<{ days: DailyUsage[]; fetchedAt: number }>());
      } else {
        days = aggregate(await fetchUsage(key, range, config.projectIds), range);
        fetchedAt = Date.now();
        ctx.waitUntil(cache.put(dataKey, new Response(JSON.stringify({ days, fetchedAt }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
        })).catch(() => {}));
      }
      const svg = renderSvg(days.slice(-config.days), config);
      // A newly rendered theme must expire with its source data, not extend its freshness.
      const edgeTtl = Math.max(1, 3600 - Math.floor((Date.now() - fetchedAt) / 1000));
      const response = new Response(svg, {
        headers: { ...svgHeaders, "Cache-Control": edgeTtl === 3600 ? CACHE_CONTROL : `public, max-age=900, s-maxage=${edgeTtl}` },
      });
      ctx.waitUntil(cache.put(svgKey, response.clone()).catch(() => {}));
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      let status = 502;
      let message = "OpenAI usage is temporarily unavailable. Try again later.";
      if (error instanceof ConfigError) {
        status = error.status;
        message = error.status === 400 ? error.message : "Check the Worker configuration and OPENAI_ADMIN_KEY secret.";
      } else if (error instanceof UsageError) {
        if (error.kind === "auth") message = "Check the Worker admin key and organization usage permissions.";
        if (error.kind === "rate_limit") { status = 503; message = "OpenAI usage is rate limited. Try again later."; }
        if (error.kind === "timeout") { status = 504; message = "OpenAI usage timed out. Try again later."; }
      }
      return new Response(request.method === "HEAD" ? null : renderError(message), {
        status, headers: { ...svgHeaders, "Cache-Control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
