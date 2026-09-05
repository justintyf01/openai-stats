import { intensityLevels, type DailyUsage } from "./aggregate.ts";
import type { Config, Theme } from "./config.ts";

const palettes = {
  "github-dark": { background: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#9198a1", levels: ["#21262d", "#0e4429", "#006d32", "#26a641", "#39d353"] },
  "github-light": { background: "#ffffff", border: "#d1d9e0", text: "#1f2328", muted: "#59636e", levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] },
};
const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function escapeXml(value: string): string {
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

function frame(content: string, label: string, theme: Theme, hideBorder: boolean, width: number, height: number): string {
  const p = palettes[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="card-title card-desc">
<title id="card-title">${escapeXml(label)}</title>
<style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;fill:${p.text}}.muted{fill:${p.muted};font-size:11px}.heading{font-size:16px;font-weight:600}${p.levels.map((fill, i) => `.l${i}{fill:${fill}}`).join("")}</style>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${p.background}" stroke="${hideBorder ? "none" : p.border}"/>
${content}
</svg>`;
}

export function renderSvg(days: DailyUsage[], config: Pick<Config, "theme" | "title" | "hideBorder">): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const offset = (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const columns = Math.ceil((offset + days.length) / 7);
  const width = Math.max(480, 78 + columns * 13);
  const total = days.reduce((sum, day) => sum + day.tokens, 0);
  const requests = days.reduce((sum, day) => sum + day.requests, 0);
  const active = days.filter(day => day.tokens > 0).length;
  const levels = intensityLevels(days);
  const gridX = 52;
  const gridY = 81;
  const cells: string[] = [];
  const labels: string[] = [];
  let labelColumn = -4;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const column = Math.floor((offset + i) / 7);
    const row = (offset + i) % 7;
    const date = new Date(`${day.date}T00:00:00Z`);
    if ((i === 0 || date.getUTCDate() === 1) && column - labelColumn >= 3) {
      labels.push(`<text class="muted" x="${gridX + column * 13}" y="70">${months[date.getUTCMonth()]}</text>`);
      labelColumn = column;
    }
    cells.push(`<rect class="l${levels[i]}" x="${gridX + column * 13}" y="${gridY + row * 13}" width="10" height="10" rx="2" data-date="${day.date}"><title>${day.date}: ${number.format(day.tokens)} tokens, ${number.format(day.requests)} requests</title></rect>`);
  }
  const summary = `${number.format(total)} tokens, ${number.format(requests)} requests, ${active} active days. ${first.date} through ${last.date}, UTC. Today is partial.`;
  const headingFit = [...config.title].length * 9 > width - 180 ? ` textLength="${width - 180}" lengthAdjust="spacingAndGlyphs"` : "";
  const content = `<desc id="card-desc">${escapeXml(summary)}</desc>
<text class="heading" x="24" y="32"${headingFit}>${escapeXml(config.title)}</text>
<text class="muted" x="24" y="50">OPENAI API</text>
<text x="${width - 24}" y="32" text-anchor="end" font-size="15" font-weight="600">${compact.format(total)} tokens</text>
${labels.join("\n")}
${["Mon", "Wed", "Fri"].map((day, i) => `<text class="muted" x="24" y="${gridY + i * 26 + 9}">${day}</text>`).join("\n")}
${cells.join("\n")}
<text class="muted" x="24" y="195">${compact.format(requests)} requests · ${active} active days</text>
<text class="muted" x="${width - 149}" y="195">Less</text>
${[0, 1, 2, 3, 4].map(i => `<rect class="l${i}" x="${width - 119 + i * 13}" y="186" width="10" height="10" rx="2"/>`).join("\n")}
<text class="muted" x="${width - 24}" y="195" text-anchor="end">More</text>
<text class="muted" x="24" y="221">${first.date} — ${last.date} · UTC</text>
<text class="muted" x="${width - 24}" y="221" text-anchor="end">${days.length === 365 ? "Past year" : `Past ${days.length} ${days.length === 1 ? "day" : "days"}`} · today is partial</text>`;
  return frame(content, `${config.title} — OpenAI token activity`, config.theme, config.hideBorder, width, 240);
}

export function renderError(message: string): string {
  return frame(`<desc id="card-desc">${escapeXml(message)}</desc><text class="heading" x="24" y="34">OpenAI activity unavailable</text><text class="muted" x="24" y="60">${escapeXml(message)}</text>`, "OpenAI activity unavailable", "github-dark", false, 600, 88);
}
