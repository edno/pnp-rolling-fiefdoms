import { describe, it, expect } from "vitest";
import { buildingTooltip, buildingTooltipParts } from "../app/building-info.js";

describe("buildingTooltip", () => {
  it("shows the sheet tooltip for Springhouse, including its category and on-build effect", () => {
    const text = buildingTooltip("S", { context: "sheet" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Springhouse (Special)");
    expect(lines).toContain("No Labourers needed");
    expect(lines).toContain("0 RP, −1 per adjacent forfeited plot.");
    expect(lines).toContain("On build: remove 1 Labourer requirement (min 0) from an adjacent building.");
  });

  it("shows the on-build housing effect only on the sheet for Cottage", () => {
    const sheet = buildingTooltip("C", { context: "sheet" });
    const board = buildingTooltip("C", { context: "board" });
    expect(sheet.split("\n")[0]).toBe("Cottage (Special)");
    expect(sheet).toContain("No Labourers needed");
    expect(sheet).toContain("On build: outline 1 Housing unit (houses 4 Population).");
    expect(board).not.toContain("On build:");
  });

  it("omits the on-build effect from the board tooltip for Springhouse", () => {
    const text = buildingTooltip("S", { context: "board" });
    expect(text).not.toContain("On build:");
    expect(text).toContain("Springhouse");
    expect(text).toContain("No Labourers needed");
  });

  it("shows the Springhouse-adjusted requirement and filled count on the board during activation", () => {
    const text = buildingTooltip("F", { context: "board", springBoost: 1, filled: 1 });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Farm (Basic)");
    expect(lines).toContain("Labourers: 1 (2 − 1 Springhouse)");
    expect(lines).toContain("Filled: 1/1");
    expect(lines).toContain("3 RP, +2 if adjacent to a Springhouse.");
  });

  it("shows the base requirement (no Springhouse note) on the sheet even with a springBoost supplied", () => {
    const text = buildingTooltip("F", { context: "sheet", springBoost: 1 });
    expect(text).toContain("Labourers: 2");
    expect(text).not.toContain("Springhouse)");
  });

  it("does not show a filled line outside activation mode (filled omitted)", () => {
    const text = buildingTooltip("Q", { context: "board" });
    expect(text).not.toContain("Filled:");
  });

  it("appends a sum-only/max-built note only on the sheet for advanced buildings", () => {
    const sheet = buildingTooltip("T", { context: "sheet" });
    const board = buildingTooltip("T", { context: "board" });
    expect(sheet).toContain("Max. 1");
    expect(board).not.toContain("Max. 1");
  });

  it("uses the Guilds-specific max-built note on the sheet's generic Guild row (no guildLabel)", () => {
    const text = buildingTooltip("G", { context: "sheet" });
    expect(text).toContain("Guild");
    expect(text).toContain("15 RP if its condition is met.");
    expect(text).toContain("Max. 2, unique types");
  });

  it("names and scores a specific guild hitbox by its target building", () => {
    const text = buildingTooltip("G", { context: "sheet", guildLabel: "GF" });
    expect(text).toContain("Farmers' Guild");
    expect(text).toContain("15 RP if 4+ active Farms form one contiguous group.");
  });

  it("follows a challenge's buildingOverrides for the Windmillers' Guild (W -> P)", () => {
    const text = buildingTooltip("G", {
      context: "sheet",
      guildLabel: "GW",
      buildingOverrides: { W: "P" },
    });
    expect(text).toContain("Piscators' Guild");
    expect(text).toContain("15 RP if an active Piscary stands on each of the 4 outer edges.");
  });

  it("does not apply the sum-only/max-built note to basic buildings", () => {
    const text = buildingTooltip("F", { context: "sheet" });
    expect(text).not.toContain("Max. 1");
  });

  it("appends a forfeited-labourers note as its own row on the board when given", () => {
    const text = buildingTooltip("F", {
      context: "board",
      filled: 1,
      forfeitedNote: "Labourers forfeited: 1/2",
    });
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toBe("Labourers forfeited: 1/2");
  });

  it("omits the forfeited note on the sheet even if supplied", () => {
    const text = buildingTooltip("F", { context: "sheet", forfeitedNote: "Labourers forfeited: 1/2" });
    expect(text).not.toContain("forfeited");
  });

  it("returns an empty string for an unknown code", () => {
    expect(buildingTooltip("Z")).toBe("");
  });
});

describe("buildingTooltipParts", () => {
  it("returns null for an unknown code", () => {
    expect(buildingTooltipParts("Z")).toBeNull();
  });

  it("returns structured name/category/rows for the Springhouse sheet tooltip", () => {
    const parts = buildingTooltipParts("S", { context: "sheet" });
    expect(parts.name).toBe("Springhouse");
    expect(parts.category).toBe("special");
    expect(parts.categoryLabel).toBe("Special");
    expect(parts.rows[0]).toEqual({ kind: "labourers", label: null, value: "No Labourers needed" });
    expect(parts.rows.some((r) => r.kind === "scoring")).toBe(true);
    expect(parts.rows.some((r) => r.kind === "secondary" && r.value.startsWith("On build:"))).toBe(true);
  });

  it("splits Labourers into a label/value row on the board", () => {
    const parts = buildingTooltipParts("F", { context: "board", springBoost: 1, filled: 1 });
    const labourersRow = parts.rows.find((r) => r.kind === "labourers");
    const filledRow = parts.rows.find((r) => r.kind === "filled");
    expect(labourersRow).toEqual({ kind: "labourers", label: "Labourers", value: "1 (2 − 1 Springhouse)" });
    expect(filledRow).toEqual({ kind: "filled", label: "Filled", value: "1/1" });
  });

  it("marks the category as basic/special/advanced for representative codes", () => {
    expect(buildingTooltipParts("F").category).toBe("basic");
    expect(buildingTooltipParts("C").category).toBe("special");
    expect(buildingTooltipParts("G").category).toBe("advanced");
  });

  it("adds a warning-kind row for a forfeited note", () => {
    const parts = buildingTooltipParts("F", { context: "board", filled: 1, forfeitedNote: "Labourers forfeited: 1/2" });
    expect(parts.rows.at(-1)).toEqual({ kind: "warning", label: null, value: "Labourers forfeited: 1/2" });
  });
});
