import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHALLENGES } from "../app/challenges.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEFAULT_LOCALE = "en";

function swSuffixes() {
  const sw = readFileSync(path.join(root, "sw.js"), "utf8");
  const match = sw.match(/SHEET_VARIANT_SUFFIXES\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error("SHEET_VARIANT_SUFFIXES not found in sw.js");
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

function localizedLocales() {
  const app = readFileSync(path.join(root, "app/app.js"), "utf8");
  const match = app.match(/LOCALIZED_SHEET_LOCALES\s*=\s*new Set\(\[([^\]]*)\]\)/);
  if (!match) throw new Error("LOCALIZED_SHEET_LOCALES not found in app.js");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Mirrors app.js's sheetBasePathForLocale(), expressed as a filename suffix.
function suffixFor(variant, locale, localized) {
  if (variant) {
    const localizedSuffix = variant.locales?.[locale];
    if (localizedSuffix) return `-${localizedSuffix}`;
    if (!localized.includes(locale)) return `-${variant.default}`;
  }
  if (localized.includes(locale)) return `-${locale}`;
  return "";
}

function expectedSuffixes() {
  const localized = localizedLocales();
  const locales = [DEFAULT_LOCALE, ...localized];
  const variants = [undefined, ...Object.values(CHALLENGES).map((c) => c.sheetVariant).filter(Boolean)];
  const out = new Set();
  for (const variant of variants) {
    for (const locale of locales) out.add(suffixFor(variant, locale, localized));
  }
  return out;
}

describe("service worker sheet variants", () => {
  it("keeps sw.js's SHEET_VARIANT_SUFFIXES in sync with the app's sheet variants", () => {
    expect(new Set(swSuffixes())).toEqual(expectedSuffixes());
  });

  it("has both 1x and 2x artwork on disk for every suffix", () => {
    for (const suffix of swSuffixes()) {
      for (const scale of ["", "@2x"]) {
        const file = path.join(root, "resources", `rolling-fiefdoms-player-sheet${suffix}${scale}.webp`);
        expect(existsSync(file), file).toBe(true);
      }
    }
  });
});
