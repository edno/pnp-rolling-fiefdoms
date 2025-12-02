import { describe, expect, it } from "vitest";
import { splitForcedDice } from "../app/dice-display.js";

describe("splitForcedDice", () => {
  it("keeps numbered/windrose dice in location and X dice in build even when X shows numbers", () => {
    const dice = [
      { label: "N1", face: 3 },
      { label: "N2", face: "windrose" },
      { label: "X1", face: 5 },
      { label: "X2", face: "X" },
    ];
    const { locationDice, buildDice } = splitForcedDice(dice);
    expect(locationDice.map((d) => d.label)).toEqual(["N1", "N2"]);
    expect(buildDice.map((d) => d.label)).toEqual(["X1", "X2"]);
  });
});
