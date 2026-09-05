import { describe, expect, it } from "vitest";
import { aggregate, usageRange } from "../src/aggregate.ts";
import { escapeXml, renderError, renderSvg } from "../src/svg.ts";
import { NOW, sampleDays } from "./fixtures.ts";

const config = { theme: "github-dark" as const, title: "Token activity", hideBorder: false };
describe("SVG card", () => {
  it("renders every date once, with accessible totals and both themes", () => {
    const days = sampleDays();
    const dark = renderSvg(days, config);
    expect(dark.match(/data-date=/g)).toHaveLength(365);
    expect(dark).toContain('aria-labelledby="card-title card-desc"');
    expect(dark).toContain("Today is partial.");
    expect(dark).toContain("#0d1117");
    expect(dark).toContain("Past year");
    expect(renderSvg(days, { ...config, theme: "github-light", hideBorder: true })).toContain('stroke="none"');
    expect(renderSvg(days, { ...config, theme: "github-light" })).toContain("#ffffff");
  });
  it("aligns Monday through Sunday and leaves out padding dates", () => {
    const days = aggregate([], usageRange(2, new Date("2026-09-07T12:00:00Z")));
    const svg = renderSvg(days, config);
    expect(svg).toContain('x="52" y="159" width="10" height="10" rx="2" data-date="2026-09-06"');
    expect(svg).toContain('x="65" y="81" width="10" height="10" rx="2" data-date="2026-09-07"');
  });
  it("handles no activity and a single day", () => {
    const svg = renderSvg(aggregate([], usageRange(1, NOW)), config);
    expect(svg).toContain("0 tokens");
    expect(svg).toContain("Past 1 day");
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  it("escapes XML and strips invalid XML controls", () => {
    const title = '<script>alert("x")</script> & \u0000';
    const svg = renderSvg(sampleDays(), { ...config, title });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(escapeXml("\u0000\ud800A & B 🟩")).toBe("A &amp; B 🟩");
    expect(renderError(title)).not.toContain("<script>");
  });
});
