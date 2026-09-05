import { expect, it } from "vitest";
import { readConfig } from "../src/config.ts";

const url = (query = "") => new URL(`https://stats.example/activity.svg${query}`);
it("resolves defaults, aliases, and owner project scope", () => {
  expect(readConfig(url(), {})).toMatchObject({ days: 365, theme: "github-dark", hideBorder: false });
  expect(readConfig(url("?days=7&theme=light&hide_border=true"), { DAYS: "30", PROJECT_IDS: "proj_b, proj_a,proj_b" }))
    .toMatchObject({ days: 7, maxDays: 30, theme: "github-light", hideBorder: true, projectIds: ["proj_a", "proj_b"] });
});
it.each(["?days=0", "?days=366", "?days=1.5", "?days=3e1", "?theme=blue", "?hide_border=1", "?theme=dark&theme=light", "?project=proj_other", "?OPENAI_ADMIN_KEY=secret", "?random=123"])("rejects invalid parameters: %s", query => {
  expect(() => readConfig(url(query), {})).toThrow();
});
it("does not allow a reader to exceed the configured history", () => {
  expect(() => readConfig(url("?days=31"), { DAYS: "30" })).toThrow();
});
it("validates deployment settings", () => {
  expect(() => readConfig(url(), { DAYS: "bad" })).toThrow();
  expect(() => readConfig(url(), { PROJECT_IDS: "other" })).toThrow();
  expect(() => readConfig(url(), { TITLE: "a".repeat(49) })).toThrow();
});
