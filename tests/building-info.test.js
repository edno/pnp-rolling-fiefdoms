import { describe, it, expect } from "vitest";
import { buildingTooltip } from "../app/building-info.js";

describe("buildingTooltip", () => {
  it("shows the sheet tooltip for Springhouse, including its on-build effect", () => {
    const text = buildingTooltip("S", { context: "sheet" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Springhouse");
    expect(lines).toContain("Workers: 0");
    expect(lines).toContain("0 RP, −1 per adjacent forfeited plot.");
    expect(lines).toContain("On build: reduces one adjacent building's worker requirement by 1.");
  });

  it("omits the on-build effect from the board tooltip for Springhouse", () => {
    const text = buildingTooltip("S", { context: "board" });
    expect(text).not.toContain("On build:");
    expect(text).toContain("Springhouse");
    expect(text).toContain("Workers: 0");
  });

  it("shows the Springhouse-adjusted requirement and filled count on the board during activation", () => {
    const text = buildingTooltip("F", { context: "board", springBoost: 1, filled: 1 });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Farm");
    expect(lines).toContain("Workers: 1 (2 − 1 Springhouse)");
    expect(lines).toContain("Filled: 1/1");
    expect(lines).toContain("3 RP, +2 if adjacent to a Springhouse.");
  });

  it("shows the base requirement (no Springhouse note) on the sheet even with a springBoost supplied", () => {
    const text = buildingTooltip("F", { context: "sheet", springBoost: 1 });
    expect(text).toContain("Workers: 2");
    expect(text).not.toContain("Springhouse)");
  });

  it("does not show a filled line outside activation mode (filled omitted)", () => {
    const text = buildingTooltip("Q", { context: "board" });
    expect(text).not.toContain("Filled:");
  });

  it("appends the one-per-game note only on the sheet for advanced buildings", () => {
    const sheet = buildingTooltip("T", { context: "sheet" });
    const board = buildingTooltip("T", { context: "board" });
    expect(sheet).toContain("Built once per game.");
    expect(board).not.toContain("Built once per game.");
  });

  it("uses the generic guild condition on the sheet's generic Guild row (no guildLabel)", () => {
    const text = buildingTooltip("G", { context: "sheet" });
    expect(text).toContain("Guild");
    expect(text).toContain("15 RP if its condition is met.");
    expect(text).toContain("Up to 2 Guilds, each a different type, per game.");
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

  it("does not apply the one-per-game note to basic buildings", () => {
    const text = buildingTooltip("F", { context: "sheet" });
    expect(text).not.toContain("Built once per game.");
  });

  it("returns an empty string for an unknown code", () => {
    expect(buildingTooltip("Z")).toBe("");
  });
});
