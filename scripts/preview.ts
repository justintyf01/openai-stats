// Generated examples use deterministic synthetic data; no API key or network access.
import { mkdir, writeFile } from "node:fs/promises";
import { renderSvg } from "../src/svg.ts";
import { sampleDays } from "../test/fixtures.ts";

await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
for (const theme of ["github-dark", "github-light"] as const) {
  await writeFile(new URL(`../docs/preview-${theme}.svg`, import.meta.url), renderSvg(sampleDays(), {
    title: "Token activity", theme, hideBorder: false,
  }));
}
console.log("Generated docs/preview-github-dark.svg and docs/preview-github-light.svg (synthetic data).");
