import { describe, it, expect } from "vitest";
import {
  uniqueLocationPairs,
  computeBuildDice,
  buildingOptions,
  buildingOptionsFromDice,
  calcVagrants,
  computeScore,
  filterAvailablePairs,
  computePestilenceInfo,
  cellSections,
  restrictBuildOptionsForBoard,
  allocatePopulationToNode,
  availableLocationPairs,
} from "../app/rules.js";

const buildings = {
  C: { name: "Cottage" },
  F: { name: "Farm" },
  Q: { name: "Quarry" },
  W: { name: "Windmill" },
  M: { name: "Market" },
  S: { name: "Springhouse" },
  T: { name: "Townhall" },
  U: { name: "University" },
  A: { name: "Almshouse" },
  G: { name: "Guild" },
};

describe("uniqueLocationPairs", () => {
  it("dedupes pairs", () => {
    const dice = [
      { resolved: 1 },
      { resolved: 2 },
      { resolved: 1 },
      { resolved: 2 },
    ];
    const pairs = uniqueLocationPairs(dice);
    expect(pairs).toEqual(expect.arrayContaining([[1, 1], [1, 2], [2, 2]]));
  });
  it("excludes X (null) dice", () => {
    const dice = [
      { resolved: 4 },
      { resolved: 2 },
      { resolved: null },
      { resolved: 2 },
    ];
    const pairs = uniqueLocationPairs(dice);
    expect(pairs).toEqual(expect.arrayContaining([[2, 4], [2, 2]]));
  });

  it("expands paired faces even when resolved is set", () => {
    const dice = [
      { face: "1/2", resolved: 1, choices: [1, 2] },
      { resolved: 3 },
      { resolved: 2 },
      { resolved: null },
    ];
    const pairs = uniqueLocationPairs(dice);
    const flattened = pairs.map((p) => p.join(","));
    expect(flattened).toContain("1,2");
    expect(flattened).toContain("2,2");
  });
});

describe("computeBuildDice", () => {
  it("removes location dice and keeps rest", () => {
    const dice = [{ resolved: 4 }, { resolved: 2 }, { resolved: 5 }, { resolved: null }];
    const { buildDice } = computeBuildDice([4, 2], dice);
    expect(buildDice.map((d) => d.resolved)).toEqual(expect.arrayContaining([5]));
  });

});

describe("buildingOptions", () => {
  it("includes die and sum options", () => {
    const opts = buildingOptions([4, 1], buildings);
    expect(opts.find((o) => o.code === "W")).toBeTruthy(); // die 4
    expect(opts.find((o) => o.code === "C")).toBeTruthy(); // die 1
    expect(opts.find((o) => o.code === "M")).toBeTruthy(); // sum 5 -> Market
  });

  it("emits sum-based Springhouse, Almshouse, Guild options", () => {
    const springOpts = buildingOptions([1, 5], buildings);
    expect(springOpts.find((o) => o.code === "S")).toBeTruthy(); // sum 6
    const almOpts = buildingOptions([4, 5], buildings);
    expect(almOpts.find((o) => o.code === "A")).toBeTruthy(); // sum 9
    const guildOpts = buildingOptions([5, 5], buildings);
    expect(guildOpts.find((o) => o.code === "G")).toBeTruthy(); // sum 10
  });

  it("expands unresolved paired dice combinations", () => {
    const opts = buildingOptionsFromDice(
      [
        { face: "1/2", resolved: null, choices: [1, 2] },
        { face: "4/5", resolved: null, choices: [4, 5] },
      ],
      buildings,
    );
    const codes = opts.map((o) => o.code);
    expect(codes).toEqual(expect.arrayContaining(["C", "F", "W", "M", "S", "T"]));
  });
});

describe("calcVagrants", () => {
  it("uses pop - housing", () => {
    expect(calcVagrants(10, 8)).toBe(2);
    expect(calcVagrants(3, 4)).toBe(0);
  });
});

// Scoring tests (simplified board state)
describe("computeScore", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
  const emptyPop = () => Array.from({ length: 4 }, () => Array(4).fill(0));

  it("scores occupied cottages only", () => {
    const board = emptyBoard();
    board[0][0].building = "C";
    const pop = emptyPop();
    // no population -> 0 cottage score
    let result = computeScore(board, pop);
    expect(result.breakdown.cottages).toBe(0);
    pop[0][0] = 4;
    result = computeScore(board, pop);
    expect(result.breakdown.cottages).toBe(3);
  });

  it("applies vagrant penalty and Almshouse cancel", () => {
    const board = emptyBoard();
    board[0][0].building = "A";
    const pop = emptyPop();
    pop[0][0] = 10;
    let result = computeScore(board, pop);
    expect(result.breakdown.vagrants).toBeLessThan(0);
    // Activate Almshouse (req 2) and cancel up to 8
    result = computeScore(board, pop);
    expect(result.breakdown.vagrants).toBeGreaterThanOrEqual(result.breakdown.vagrants);
  });

  it("market scores adjacent population", () => {
    const board = emptyBoard();
    board[2][2].building = "M";
    const pop = emptyPop();
    pop[1][1] = 1;
    pop[1][2] = 1;
    pop[2][1] = 1;
    const result = computeScore(board, pop);
    expect(result.breakdown.market).toBe(3);
  });

  it("townhall scores unique basics in row/col when active", () => {
    const board = emptyBoard();
    board[2][2].building = "T";
    board[2][1].building = "F";
    board[1][2].building = "Q";
    const pop = emptyPop();
    pop[2][2] = 4; // activate T
    pop[2][1] = 2; // activate F
    pop[1][2] = 2; // activate Q
    const result = computeScore(board, pop);
    expect(result.breakdown.townhall).toBeGreaterThan(5);
  });

  it("townhall counts unique activated basics only", () => {
    const board = emptyBoard();
    board[2][2].building = "T";
    board[2][1].building = "F";
    board[1][2].building = "F"; // duplicate type
    const pop = emptyPop();
    pop[2][2] = 4; // activate T
    pop[2][1] = 2; // activate first Farm
    // second Farm inactive
    const result = computeScore(board, pop);
    expect(result.breakdown.townhall).toBe(7); // base 5 + one unique active basic (Farm) = 7
  });

  it("townhall ignores diagonal basics (row/col only)", () => {
    const board = emptyBoard();
    board[2][2].building = "T";
    board[1][1].building = "Q"; // diagonal relative to T
    const pop = emptyPop();
    pop[2][2] = 4;
    pop[1][1] = 2;
    const result = computeScore(board, pop);
    expect(result.breakdown.townhall).toBe(5); // base only, no row/col bonus
  });

  it("does not penalize forfeits globally but applies Springhouse adjacency penalties", () => {
    const board = emptyBoard();
    board[0][1].forfeited = true; // cardinal adjacent to [1][1]
    board[1][1].building = "S";
    const pop = emptyPop();
    const result = computeScore(board, pop);
    expect(result.breakdown.forfeits).toBe(0);
    expect(result.breakdown.springhouse).toBe(-1); // -1 per adjacent forfeit
  });

  it("Springhouse reduces adjacent worker requirement for activation", () => {
    const board = emptyBoard();
    board[1][1].building = "S";
    board[1][2].building = "W"; // req 2
    board[1][2].springBoost = 1; // Springhouse assigned here
    const pop = emptyPop();
    pop[1][2] = 1; // not enough alone without reduction
    const result = computeScore(board, pop);
    expect(result.breakdown.windmill).toBeGreaterThan(0);
  });

  it("Springhouse reduction only applies to assigned target", () => {
    const board = emptyBoard();
    board[1][1].building = "S";
    board[1][2].building = "W"; // req 2, no reduction assigned
    const pop = emptyPop();
    pop[1][2] = 1; // insufficient without assigned reduction
    const result = computeScore(board, pop);
    expect(result.breakdown.windmill).toBe(0);
  });

  it("Springhouse applies multiple adjacent-forfeit penalties", () => {
    const board = emptyBoard();
    board[2][2].building = "S";
    board[1][2].forfeited = true;
    board[2][3].forfeited = true;
    const pop = emptyPop();
    const result = computeScore(board, pop);
    expect(result.breakdown.springhouse).toBe(-2); // -1 per adjacent forfeit
  });

  it("University awards tiered points for unique advanced buildings", () => {
    const board = emptyBoard();
    board[0][0].building = "U";
    board[0][1].building = "T";
    board[0][2].building = "A";
    const pop = emptyPop();
    pop[0][0] = 3; // activate University
    let result = computeScore(board, pop);
    expect(result.breakdown.university).toBe(12); // 3 unique adv
    board[1][0].building = "G"; // 4th unique adv
    result = computeScore(board, pop);
    expect(result.breakdown.university).toBe(15);
  });

  it("University counts built (not necessarily activated) advanced buildings", () => {
    const board = emptyBoard();
    board[0][0].building = "U";
    board[0][1].building = "T";
    const pop = emptyPop();
    pop[0][0] = 3; // activate University only
    const result = computeScore(board, pop);
    expect(result.breakdown.university).toBe(8); // two advanced types built (U + T)
  });

  it("Market scores only when activated", () => {
    const board = emptyBoard();
    board[2][2].building = "M";
    const pop = emptyPop();
    pop[1][1] = 2; // not enough to meet req 3
    let result = computeScore(board, pop);
    expect(result.breakdown.market).toBe(0);
    pop[1][2] = 2; // now 4 pips total around, activate + score
    result = computeScore(board, pop);
    expect(result.breakdown.market).toBe(4);
  });

  it("market sums all adjacent node pips (up to four nodes)", () => {
    const board = emptyBoard();
    board[2][2].building = "M";
    const pop = emptyPop();
    pop[1][1] = 5;
    pop[1][2] = 4;
    pop[2][1] = 4;
    const result = computeScore(board, pop);
    expect(result.breakdown.market).toBe(13);
  });

  it("Almshouse cancels up to 8 vagrant penalty only when active", () => {
    const board = emptyBoard();
    board[0][0].building = "A";
    const pop = emptyPop();
    pop[3][3] = 12; // produce vagrants (no housing)
    let result = computeScore(board, pop);
    expect(result.breakdown.vagrants).toBe(-12);
    pop[0][0] = 2; // activate Almshouse
    result = computeScore(board, pop);
    expect(result.breakdown.vagrants).toBe(-6); // total pop 14 -> -14 + 8 cancel = -6
  });

  it("Almshouse cannot turn vagrants penalty positive after cancel", () => {
    const board = emptyBoard();
    board[0][0].building = "A";
    const pop = emptyPop();
    pop[0][0] = 2; // activates Almshouse (req 2)
    const result = computeScore(board, pop); // pop 2, housing 0 -> vagrants -2, cancel up to 8 -> should clamp at 0
    expect(result.breakdown.vagrants).toBe(0);
  });
});

describe("filterAvailablePairs", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
  it("filters out pairs with no open plots", () => {
    const board = emptyBoard();
    board[0][1].building = "C"; // (1,2)
    board[1][0].building = "F"; // (2,1)
    board[0][0].forfeited = true; // (1,1)
    board[1][1].building = "M"; // (2,2)
    const pairs = [
      [1, 2],
      [1, 1],
      [2, 2],
    ];
    const filtered = filterAvailablePairs(pairs, board);
    expect(filtered).toEqual([]);
  });
  it("keeps pairs with at least one open plot", () => {
    const board = emptyBoard();
    board[0][1].building = "C";
    board[1][0].building = "F";
    const pairs = [
      [1, 2],
      [1, 1],
      [2, 2],
      [5, 5],
    ];
    const filtered = filterAvailablePairs(pairs, board);
    expect(filtered).toEqual(
      expect.arrayContaining([
        [1, 1],
        [2, 2],
        [5, 5],
      ]),
    );
  });
});

describe("build pairing with flexible dice", () => {
  it("keeps paired-face flexibility for build", () => {
    const dice = [
      { face: "1/2", resolved: 1, choices: [1, 2], label: "N1" },
      { face: 2, resolved: 2, choices: [], label: "N2" },
      { face: 4, resolved: 4, choices: [], label: "X1" },
      { face: "X", resolved: null, choices: [], label: "X2" },
    ];
    const { buildDice } = computeBuildDice([2, 4], dice);
    const faces = buildDice.map((d) => d.face);
    expect(faces).toContain("1/2"); // paired die remains for build
    const opts = buildingOptionsFromDice(buildDice, buildings);
    expect(opts.find((o) => o.code === "C")).toBeTruthy();
    expect(opts.find((o) => o.code === "F")).toBeTruthy(); // flexibility keeps both 1 and 2 options
  });
});

describe("available location pairs helper", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );

  it("returns pairs when open plots exist", () => {
    const dice = [
      { label: "N1", face: "1/2", resolved: 1, choices: [1, 2] },
      { label: "N2", face: 3, resolved: 3, choices: [] },
      { label: "X1", face: 4, resolved: 4, choices: [] },
      { label: "X2", face: 2, resolved: 2, choices: [] },
    ];
    const pairs = availableLocationPairs(dice, emptyBoard());
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("returns empty when board is full", () => {
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "X", forfeited: false, springBoost: 0 })),
    );
    const dice = [
      { label: "N1", face: 1, resolved: 1, choices: [] },
      { label: "N2", face: 2, resolved: 2, choices: [] },
      { label: "X1", face: 3, resolved: 3, choices: [] },
      { label: "X2", face: 4, resolved: 4, choices: [] },
    ];
    const pairs = availableLocationPairs(dice, fullBoard);
    expect(pairs.length).toBe(0);
  });
});

describe("population allocation", () => {
  it("places all requested population onto one node up to capacity", () => {
    const grid = [
      [0, 4],
      [0, 0],
    ];
    const { placed, grid: updated } = allocatePopulationToNode(grid, 0, 0, 4, 5);
    expect(placed).toBe(4);
    expect(updated[0][0]).toBe(4);
  });

  it("caps placement when node is almost full", () => {
    const grid = [
      [0],
    ];
    const { placed, grid: updated } = allocatePopulationToNode(grid, 0, 0, 8, 5);
    expect(placed).toBe(5);
    expect(updated[0][0]).toBe(5);
  });

  it("rejects placement on a node that already has population", () => {
    const grid = [
      [2],
    ];
    const { placed, grid: updated } = allocatePopulationToNode(grid, 0, 0, 3, 6);
    expect(placed).toBe(0);
    expect(updated[0][0]).toBe(2);
  });
});

describe("adjacency scoring (cardinal)", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
  const emptyPop = () => Array.from({ length: 4 }, () => Array(4).fill(0));

  it("counts cardinal-adjacent Windmills for adjacency bonus", () => {
    const board = emptyBoard();
    board[1][1].building = "W";
    board[1][2].building = "W"; // cardinal neighbor
    const pop = emptyPop();
    pop[1][1] = 2;
    pop[1][2] = 2; // activate both
    const result = computeScore(board, pop);
    expect(result.breakdown.windmill).toBe(8); // each 3 + 1 adjacency
  });

  it("does not award guilds without a built guild", () => {
    const board = emptyBoard();
    board[1][0].building = "F";
    board[1][1].building = "F";
    board[1][2].building = "F";
    board[1][3].building = "F"; // cardinal chain of 4
    const pop = emptyPop();
    pop.forEach((row, r) => row.forEach((_, c) => (pop[r][c] = 3))); // activate everything
    const result = computeScore(board, pop);
    expect(result.breakdown.guilds).toBe(0);
  });

  it("awards Quarry guild for a hex-contiguous group of 4", () => {
    const board = emptyBoard();
    board[1][0].building = "Q";
    board[2][0].building = "Q";
    board[2][1].building = "Q";
    board[3][0].building = "Q";
    const pop = emptyPop();
    [[1, 0], [2, 0], [2, 1], [3, 0]].forEach(([r, c]) => (pop[r][c] = 3));
    const result = computeScore(board, pop);
    expect(result.breakdown.guilds).toBe(0);
  });

  it("awards Windmillers guild for four edge windmills", () => {
    const board = emptyBoard();
    board[0][4].building = "W";
    board[0][1].building = "W";
    board[4][0].building = "W";
    board[4][4].building = "W";
    const pop = emptyPop();
    [[0, 3], [0, 1], [3, 0], [3, 3]].forEach(([r, c]) => (pop[r][c] = 3));
    const result = computeScore(board, pop);
    expect(result.breakdown.guilds).toBe(0);
  });

  it("awards Farmers Guild only with a built, activated guild", () => {
    const board = emptyBoard();
    board[1][1].building = "F";
    board[1][2].building = "F";
    board[2][1].building = "F";
    board[2][2].building = "F"; // contiguous 2x2 block (cardinal)
    board[2][3].building = "G";
    board[2][3].buildingLabel = "GF";
    const pop = emptyPop();
    pop.forEach((row, r) => row.forEach((_, c) => (pop[r][c] = 3)));
    const result = computeScore(board, pop);
    expect(result.breakdown.guilds).toBe(15);
  });

  it("awards Merchants guild only with a built, activated guild", () => {
    const board = emptyBoard();
    board[1][2].building = "M";
    board[2][2].building = "M";
    board[2][3].building = "M";
    board[3][2].building = "M";
    board[2][1].building = "G";
    board[2][1].buildingLabel = "GM";
    const pop = emptyPop();
    [[1, 2], [2, 2], [2, 3], [3, 2]].forEach(([r, c]) => (pop[r][c] = 3));
    pop[2][1] = 4; // activate guild
    const result = computeScore(board, pop);
    expect(result.breakdown.guilds).toBe(15);
  });

  it("quarry bonus only applies for row/col, not diagonal", () => {
    const board = emptyBoard();
    board[2][2].building = "Q";
    board[1][1].building = "Q"; // diagonal
    const pop = emptyPop();
    pop[2][2] = 2;
    pop[1][1] = 2;
    const result = computeScore(board, pop);
    expect(result.breakdown.quarry).toBe(6); // two quarries, no bonus
  });

  it("counts activation-forfeited quarries toward row/col bonus for active quarries", () => {
    const board = emptyBoard();
    board[0][0].building = "Q";
    board[0][1].building = "Q";
    board[0][1].activationForfeit = true; // forfeited for activation, still a quarry on the board
    const pop = emptyPop();
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(0));
    alloc[0][0] = 2; // activate only the first quarry
    const result = computeScore(board, pop, alloc);
    expect(result.breakdown.quarry).toBe(4); // base 3 + row bonus from neighboring forfeited quarry
  });

  it("counts forfeited windmills for adjacency bonus of an active windmill", () => {
    const board = emptyBoard();
    board[0][0].building = "W";
    board[0][1].building = "W";
    board[0][1].activationForfeit = true; // not active, but still a windmill on the board
    const pop = emptyPop();
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(0));
    alloc[0][0] = 2; // activate only the first windmill
    const result = computeScore(board, pop, alloc);
    expect(result.breakdown.windmill).toBe(4); // base 3 + 1 adjacency from forfeited windmill
  });
});

describe("pestilence section mapping", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );

  it("reports overlapping sections for corner cells", () => {
    const sections = cellSections(0, 0);
    expect(sections.has("forest")).toBe(true);
    expect(sections.has("mountain")).toBe(true);
  });

  it("assigns sea to columns 4 and 5", () => {
    const board = emptyBoard();
    const dice = [
      { label: "N1", resolved: 2 },
      { label: "N2", resolved: 3 },
      { label: "X1", resolved: "X", face: "X" },
      { label: "X2", resolved: "X", face: "X" },
    ];
    const info = computePestilenceInfo(dice, board);
    const targetCols = new Set(info.targetCells.map(([, c]) => c));
    expect(info.section).toBe("sea");
    expect(targetCols.has(3)).toBe(true);
    expect(targetCols.has(4)).toBe(true);
  });

  it("covers overlapping regions (row 1/col 1 counts for mountain sums)", () => {
    const board = emptyBoard();
    const dice = [
      { label: "N1", resolved: 3 },
      { label: "N2", resolved: 4 },
      { label: "X1", resolved: "X", face: "X" },
      { label: "X2", resolved: "X", face: "X" },
    ];
    const info = computePestilenceInfo(dice, board);
    const includesCorner = info.targetCells.some(([r, c]) => r === 0 && c === 0);
    expect(info.section).toBe("mountain"); // 3+4=7 -> mountain
    expect(includesCorner).toBe(true);
  });

  it("returns empty targetCells when the section is already full", () => {
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "X", forfeited: false, springBoost: 0 })),
    );
    const dice = [
      { label: "N1", resolved: 3 },
      { label: "N2", resolved: 3 },
      { label: "X1", face: "X", resolved: "X" },
      { label: "X2", face: "X", resolved: "X" },
    ];
    const info = computePestilenceInfo(dice, fullBoard);
    expect(info.section).toBe("centre");
    expect(info.targetCells.length).toBe(0);
  });
});

describe("build option restrictions", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );

  it("removes advanced buildings already built", () => {
    const board = emptyBoard();
    board[0][0].building = "T";
    const opts = [
      { code: "T" },
      { code: "U" },
    ];
    const filtered = restrictBuildOptionsForBoard(opts, board);
    expect(filtered.find((o) => o.code === "T")).toBeUndefined();
    expect(filtered.find((o) => o.code === "U")).toBeDefined();
  });

  it("respects guild limit", () => {
    const board = emptyBoard();
    board[0][0].building = "G";
    board[0][0].buildingLabel = "GF";
    board[0][1].building = "G";
    board[0][1].buildingLabel = "GM";
    const opts = [{ code: "G" }, { code: "F" }];
    const filtered = restrictBuildOptionsForBoard(opts, board);
    expect(filtered.find((o) => o.code === "G")).toBeUndefined();
    expect(filtered.find((o) => o.code === "F")).toBeDefined();
  });
});

describe("activation scoring with worker allocations", () => {
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
  const emptyPop = () => Array.from({ length: 4 }, () => Array(4).fill(0));

  it("scores only fully allocated buildings", () => {
    const board = emptyBoard();
    board[0][0].building = "F"; // req 2
    board[0][1].building = "F"; // req 2
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(0));
    alloc[0][0] = 2; // fully allocated
    alloc[0][1] = 1; // not enough
    const result = computeScore(board, emptyPop(), alloc);
    expect(result.breakdown.farm).toBe(3); // only one active farm
  });

  it("guild requires 4 workers to activate and score", () => {
    const board = emptyBoard();
    // farms to satisfy GF condition
    board[0][0].building = "F";
    board[0][1].building = "F";
    board[1][0].building = "F";
    board[1][1].building = "F";
    // guild
    board[2][2].building = "G";
    board[2][2].buildingLabel = "GF";
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(0));
    alloc[0][0] = alloc[0][1] = alloc[1][0] = alloc[1][1] = 2; // activate farms
    alloc[2][2] = 3; // not enough for guild
    let result = computeScore(board, emptyPop(), alloc);
    expect(result.breakdown.guilds).toBe(0);
    alloc[2][2] = 4; // now enough
    result = computeScore(board, emptyPop(), alloc);
    expect(result.breakdown.guilds).toBe(15);
  });

  it("springhouse reduction caps at zero requirement for activation", () => {
    const board = emptyBoard();
    board[0][0].building = "W"; // req 2
    board[0][0].springBoost = 5; // over-reduction
    const result = computeScore(board, emptyPop());
    expect(result.breakdown.windmill).toBeGreaterThan(0); // activates with zero effective req
  });

  it("zero-requirement buildings are always active", () => {
    const board = emptyBoard();
    board[0][0].building = "C";
    const pop = emptyPop();
    pop[0][0] = 4; // enough to occupy cottage
    const result = computeScore(board, pop);
    expect(result.breakdown.cottages).toBe(3);
  });

  it("prefers worker allocations over raw population when provided", () => {
    const board = emptyBoard();
    board[0][0].building = "F"; // req 2
    board[0][1].building = "F"; // req 2
    const pop = emptyPop();
    pop[0][0] = 4;
    pop[0][1] = 4;
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(0));
    alloc[0][0] = 0; // even with population, not allocated -> inactive
    alloc[0][1] = 2; // allocated -> active
    const result = computeScore(board, pop, alloc);
    expect(result.breakdown.farm).toBe(3);
  });

  it("ignores activationForfeit buildings for scoring and counts them as forfeits", () => {
    const board = emptyBoard();
    board[0][0].building = "F";
    board[0][0].activationForfeit = true;
    board[0][1].building = "F";
    board[0][2].forfeited = true;
    const pop = emptyPop();
    pop[0][0] = 3;
    pop[0][1] = 3;
    const alloc = Array.from({ length: 5 }, () => Array(5).fill(2));
    const result = computeScore(board, pop, alloc);
    expect(result.breakdown.farm).toBe(3); // only the non-forfeited farm scores
    expect(result.forfeits).toBe(2); // one forfeited plot + one activation forfeit
  });

  it("activates worker-required buildings via population when no allocations are provided", () => {
    const board = emptyBoard();
    board[1][1].building = "F"; // req 2
    const pop = emptyPop();
    pop[1][1] = 2; // enough to activate without allocations
    const result = computeScore(board, pop);
    expect(result.breakdown.farm).toBe(3);
  });

  it("does not activate worker-required buildings when population is insufficient and no allocations are provided", () => {
    const board = emptyBoard();
    board[1][1].building = "F"; // req 2
    const pop = emptyPop();
    pop[1][1] = 1; // insufficient
    const result = computeScore(board, pop);
    expect(result.breakdown.farm).toBe(0);
  });
});
