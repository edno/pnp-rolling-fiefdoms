import { describe, it, expect } from "vitest";
import { popHousingTooltip, popHousingTooltipParts } from "../app/pop-housing-info.js";

describe("popHousingTooltip", () => {
  it("shows the EN title, stats line, and Cottage/vagrant/influence rows for pop 9, housing 8, vagrants 1", () => {
    const text = popHousingTooltip(9, 8, 1);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Population & Housing");
    expect(lines[1]).toBe("Population 9 · Housing 8 · Vagrants 1");
    expect(lines).toContain("Each Cottage outlines 1 Housing unit (4 Population).");
    expect(lines).toContain("Population above Housing becomes Vagrants: −1 RP each.");
    expect(lines).toContain("Covering a ★ on the track grants 1 Influence.");
  });

  it("flags the Vagrants stat as a warning only when vagrants > 0", () => {
    const withVagrants = popHousingTooltipParts(9, 8, 1);
    const stat = withVagrants.stats.find((s) => s.label === "Vagrants");
    expect(stat.warning).toBe(true);

    const none = popHousingTooltipParts(8, 8, 0);
    const noneStat = none.stats.find((s) => s.label === "Vagrants");
    expect(noneStat.warning).toBe(false);
    expect(noneStat.value).toBe("0");
  });

  it("swaps the Cottage line for the Barracks line during Challenge VII (buildingOverrides.C === 'B')", () => {
    const text = popHousingTooltip(9, 8, 1, { buildingOverrides: { C: "B" } });
    expect(text).not.toContain("Each Cottage outlines");
    expect(text).toContain("Each active Barracks provides 2 Housing units (8 Population).");
  });

  it("uses the plain Cottage line when no challenge override is active", () => {
    const text = popHousingTooltip(9, 8, 1, {});
    expect(text).toContain("Each Cottage outlines 1 Housing unit (4 Population).");
    expect(text).not.toContain("Barracks provides");
  });
});
