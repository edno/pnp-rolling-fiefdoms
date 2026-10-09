import { describe, it, expect } from "vitest";
import fr from "../app/locales/fr.js";

function collectStrings(node, path = [], out = []) {
  if (typeof node === "string") out.push([path.join("."), node]);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collectStrings(v, [...path, k], out);
  }
  return out;
}

describe("French typography", () => {
  it("uses a non-breaking space (not a regular space) before ? ! : ;", () => {
    const offenders = collectStrings(fr).filter(([, s]) => / [?!:;]/.test(s)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});
