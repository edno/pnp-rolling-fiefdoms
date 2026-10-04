import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

describe("asset version consistency", () => {
  it("keeps index.html's app.js/CSS ?v= tokens in sync with sw.js's precache entries", () => {
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    const sw = readFileSync(path.join(root, "sw.js"), "utf8");

    const htmlAppVersions = [...html.matchAll(/app\/app\.js\?v=([\w.]+)/g)].map((m) => m[1]);
    const htmlStyleVersions = [...html.matchAll(/assets\/css\/styles\.css\?v=([\w.]+)/g)].map((m) => m[1]);
    const htmlFontsVersions = [...html.matchAll(/assets\/css\/fonts\.css\?v=([\w.]+)/g)].map((m) => m[1]);

    expect(htmlAppVersions.length).toBeGreaterThan(0);
    expect(htmlStyleVersions.length).toBeGreaterThan(0);
    expect(htmlFontsVersions.length).toBeGreaterThan(0);

    const allHtmlVersions = [...htmlAppVersions, ...htmlStyleVersions, ...htmlFontsVersions];
    // All asset references in index.html must share one version token so a
    // CSS/JS change can't be bumped in one place and forgotten in another.
    expect(new Set(allHtmlVersions).size).toBe(1);
    const htmlVersion = allHtmlVersions[0];

    const appVersionMatch = sw.match(/const APP_VERSION = "([\w.]+)"/);
    expect(appVersionMatch).not.toBeNull();
    expect(appVersionMatch[1]).toBe(htmlVersion);

    expect(sw).toContain(`/app/app.js?v=\${APP_VERSION}`);
    expect(sw).toContain(`/assets/css/styles.css?v=\${APP_VERSION}`);
    expect(sw).toContain(`/assets/css/fonts.css?v=\${APP_VERSION}`);
  });
});
