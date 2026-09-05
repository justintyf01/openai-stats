export interface Env {
  OPENAI_ADMIN_KEY?: string;
  DAYS?: string;
  THEME?: string;
  TITLE?: string;
  PROJECT_IDS?: string;
}

export type Theme = "github-dark" | "github-light";

export interface Config {
  maxDays: number;
  days: number;
  theme: Theme;
  title: string;
  hideBorder: boolean;
  projectIds: string[];
}

export class ConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function parseDays(value: string, max: number, status: number): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new ConfigError(`Days must be an integer from 1 to ${max}.`, status);
  }
  return Number(value);
}

function parseTheme(value: string, status: number): Theme {
  if (value === "dark" || value === "github-dark") return "github-dark";
  if (value === "light" || value === "github-light") return "github-light";
  throw new ConfigError("Theme must be dark or light.", status);
}

export function readConfig(url: URL, env: Env): Config {
  const maxDays = parseDays(env.DAYS ?? "365", 365, 503);
  const defaultTheme = parseTheme(env.THEME ?? "github-dark", 503);
  const allowed = new Set(["days", "theme", "hide_border"]);
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name) || url.searchParams.getAll(name).length !== 1) {
      throw new ConfigError("Unsupported or repeated query parameter.");
    }
  }
  const border = url.searchParams.get("hide_border") ?? "false";
  if (border !== "true" && border !== "false") {
    throw new ConfigError("hide_border must be true or false.");
  }
  const title = env.TITLE?.trim() || "Token activity";
  if ([...title].length > 48) throw new ConfigError("TITLE must be at most 48 characters.", 503);
  const projectIds = [...new Set((env.PROJECT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean))].sort();
  if (projectIds.length > 20 || projectIds.some(id => !/^proj_[A-Za-z0-9_-]+$/.test(id))) {
    throw new ConfigError("Invalid PROJECT_IDS configuration.", 503);
  }
  return {
    maxDays,
    days: parseDays(url.searchParams.get("days") ?? String(maxDays), maxDays, 400),
    theme: url.searchParams.has("theme") ? parseTheme(url.searchParams.get("theme")!, 400) : defaultTheme,
    title,
    hideBorder: border === "true",
    projectIds,
  };
}
