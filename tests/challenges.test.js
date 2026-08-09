import { describe, it, expect } from "vitest";
import { CHALLENGES, CHALLENGE_ORDER } from "../app/challenges.js";
import { computeScore, buildingOptionsFromDice, restrictBuildOptionsForBoard } from "../app/rules.js";

const emptyBoard = () =>
  Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
  );
const emptyPop = () => Array.from({ length: 4 }, () => Array(4).fill(0));

describe("CHALLENGE_ORDER", () => {
  it("lists every challenge exactly once", () => {
    expect(new Set(CHALLENGE_ORDER).size).toBe(CHALLENGE_ORDER.length);
    expect(CHALLENGE_ORDER.length).toBe(Object.keys(CHALLENGES).length);
    CHALLENGE_ORDER.forEach((id) => expect(CHALLENGES[id]).toBeDefined());
  });
});

describe("requiredRP", () => {
  it("matches the reputation reason's need value for every challenge", () => {
    CHALLENGE_ORDER.forEach((id) => {
      const challenge = CHALLENGES[id];
      const board = emptyBoard();
      const result = computeScore(board, emptyPop());
      const outcome = challenge.victory(result, { board });
      const repReason = outcome.reasons.find((r) => r.textKey === "challenges.reasons.reputation");
      expect(repReason.params.need).toBe(challenge.requiredRP);
    });
  });
});

describe("liveProgress", () => {
  it("reports raw counts without clamping past the target", () => {
    const board = emptyBoard();
    for (let i = 0; i < 5; i++) board[Math.floor(i / 5)][i % 5].building = "S"; // 5 Springhouses, need 3
    const result = computeScore(board, emptyPop());
    const progress = CHALLENGES.waterRights.liveProgress(result, { board });
    expect(progress).toEqual({ have: 5, need: 3, labelKey: "challenges.badgeLabels.springhouses" });
  });

  it("is defined for all non-embersOfRevolt challenges", () => {
    CHALLENGE_ORDER.filter((id) => id !== "embersOfRevolt").forEach((id) => {
      expect(typeof CHALLENGES[id].liveProgress).toBe("function");
    });
  });

  it("tracks Charters' Guild count, not Guild RP", () => {
    const board = emptyBoard();
    board[0][0].building = "G";
    board[0][1].building = "G";
    const result = computeScore(board, emptyPop());
    const progress = CHALLENGES.charters.liveProgress(result, { board });
    expect(progress).toEqual({ have: 2, need: 2, labelKey: "challenges.badgeLabels.guilds" });
  });
});

describe("foundations victory", () => {
  it("fails when reputation and cottages are both short", () => {
    const board = emptyBoard();
    const result = computeScore(board, emptyPop());
    const outcome = CHALLENGES.foundations.victory(result, { board });
    expect(outcome.passed).toBe(false);
  });

  it("passes with 40+ RP and 6+ occupied cottages", () => {
    const board = emptyBoard();
    const pop = emptyPop();
    // 20 occupied Cottages (2 RP each) clears the 40 RP bar on their own and stays well under
    // their 80-pip housing capacity, so there's no Vagrant penalty to offset the score.
    for (let i = 0; i < 20; i++) {
      board[Math.floor(i / 5)][i % 5].building = "C";
    }
    pop[0][0] = 20;
    const result = computeScore(board, pop);
    const outcome = CHALLENGES.foundations.victory(result, { board });
    expect(result.total).toBeGreaterThanOrEqual(40);
    expect(outcome.reasons.find((r) => r.textKey === "challenges.reasons.cottages").ok).toBe(true);
    expect(outcome.reasons.find((r) => r.textKey === "challenges.reasons.reputation").ok).toBe(true);
    expect(outcome.passed).toBe(true);
  });
});

describe("waterRights victory", () => {
  it("fails when fewer than 3 springhouses are built", () => {
    const board = emptyBoard();
    board[0][0].building = "S";
    const result = computeScore(board, emptyPop());
    const outcome = CHALLENGES.waterRights.victory(result, { board });
    expect(outcome.passed).toBe(false);
  });

  it("fails the springhouse-penalty reason when a forfeited plot sits adjacent to a Springhouse", () => {
    const board = emptyBoard();
    board[0][0].building = "S";
    board[0][1].forfeited = true; // adjacent forfeit drags this Springhouse's score negative
    board[2][2].building = "S";
    board[4][4].building = "S";
    const result = computeScore(board, emptyPop());
    const outcome = CHALLENGES.waterRights.victory(result, { board });
    expect(result.breakdown.springhouse).toBeLessThan(0);
    expect(outcome.reasons.find((r) => r.textKey === "challenges.reasons.springhousePenalty").ok).toBe(false);
    expect(outcome.passed).toBe(false);
  });
});

describe("charters victory", () => {
  it("requires 30 RP of scored guilds", () => {
    const board = emptyBoard();
    const result = computeScore(board, emptyPop());
    const outcome = CHALLENGES.charters.victory(result, { board });
    expect(outcome.passed).toBe(false);
  });

  it("starts with 1 influence in its setup config", () => {
    expect(CHALLENGES.charters.setup.startingInfluence).toBe(1);
  });
});

describe("socialContract victory", () => {
  it("has a 24-turn limit and offers a center-building choice", () => {
    expect(CHALLENGES.socialContract.turnLimit).toBe(24);
    expect(CHALLENGES.socialContract.setup.forcedCenterBuilding.choices).toEqual(["T", "GF", "GQ", "GW", "GM"]);
  });

  it("fails when the vagrant penalty is negative, reporting its magnitude as have/need", () => {
    const board = emptyBoard();
    const pop = emptyPop();
    pop[0][0] = 14; // population with no housing -> vagrant penalty
    const result = computeScore(board, pop);
    const outcome = CHALLENGES.socialContract.victory(result, { board });
    const reason = outcome.reasons.find((r) => r.textKey === "challenges.reasons.vagrantPenalty");
    expect(reason.ok).toBe(false);
    expect(reason.params).toEqual({ have: 14, need: 0 });
    expect(outcome.passed).toBe(false);
  });
});

describe("enlightenment victory", () => {
  it("requires at least 15 RP from the University", () => {
    const board = emptyBoard();
    const result = computeScore(board, emptyPop());
    const outcome = CHALLENGES.enlightenment.victory(result, { board });
    expect(outcome.passed).toBe(false);
  });
});

describe("embersOfRevolt", () => {
  it("only checks the 80 RP reputation threshold", () => {
    expect(CHALLENGES.embersOfRevolt.victoryKeys).toEqual(["challenges.embersOfRevolt.victory1"]);
    expect(CHALLENGES.embersOfRevolt.rules.unrestTracking).toBe(true);
  });
});

describe("drumsOfWar", () => {
  const emptyWorkers = () => Array.from({ length: 5 }, () => Array(5).fill(0));

  it("replaces Cottage with Barracks via rules.buildingOverrides", () => {
    expect(CHALLENGES.drumsOfWar.rules.buildingOverrides).toEqual({ C: "B" });
  });

  it("buildingOptionsFromDice never yields Barracks without the override (unreachable in other challenges)", () => {
    const dice = [{ resolved: 1 }, { resolved: 2 }];
    const opts = buildingOptionsFromDice(dice);
    expect(opts.some((o) => o.code === "B")).toBe(false);
  });

  it("liveProgress excludes off-diagonal Barracks, since they can never score and would overstate progress", () => {
    const board = emptyBoard();
    board[0][0].building = "B"; // diagonal
    board[0][1].building = "B"; // off-diagonal
    board[0][2].building = "B"; // off-diagonal
    const result = computeScore(board, emptyPop());
    expect(CHALLENGES.drumsOfWar.liveProgress(result, { board }).have).toBe(1);
  });

  it("fails on reputation alone when fewer than 4 Barracks are scored", () => {
    const board = emptyBoard();
    board[0][0].building = "B"; // diagonal, active -> 5 RP
    const workers = emptyWorkers();
    workers[0][0] = 3;
    const result = computeScore(board, emptyPop(), workers);
    const outcome = CHALLENGES.drumsOfWar.victory(result, { board });
    expect(outcome.passed).toBe(false);
    expect(CHALLENGES.drumsOfWar.liveProgress(result, { board }).have).toBe(1);
  });

  it("satisfies the Barracks victory condition once 4 active diagonal Barracks are scored", () => {
    const board = emptyBoard();
    const diagonalCells = [
      [0, 0],
      [1, 1],
      [3, 3],
      [4, 4],
    ];
    const workers = emptyWorkers();
    diagonalCells.forEach(([r, c]) => {
      board[r][c].building = "B";
      workers[r][c] = 3;
    });
    const result = computeScore(board, emptyPop(), workers);
    const outcome = CHALLENGES.drumsOfWar.victory(result, { board });
    expect(CHALLENGES.drumsOfWar.liveProgress(result, { board }).have).toBe(4);
    expect(result.breakdown.barracks).toBe(20);
    // Reputation is still short of 80 RP with only Barracks on the board, so overall victory
    // isn't reached yet, but the Barracks-specific reason should now read as satisfied.
    const barracksReason = outcome.reasons.find((r) => r.textKey === "challenges.reasons.barracks");
    expect(barracksReason.ok).toBe(true);
  });
});

describe("foundations rule flags", () => {
  it("disables advanced buildings", () => {
    expect(CHALLENGES.foundations.rules.disabledBuildings).toEqual(["T", "U", "A", "G"]);
  });

  it("forces Split on a 7-10 build-pair sum by disabling the resulting Advanced building", () => {
    // Sum 9 -> Almshouse (A), one of Foundations' disabled codes. Excluding it from the
    // sum-based option is how "you must use Split instead" is satisfied without any
    // dedicated enforcement code (a single die can only reach 1-6, so the 7-10 range is
    // reachable only via this sum option).
    const dice = [{ resolved: 4 }, { resolved: 5 }];
    const rawOptions = buildingOptionsFromDice(dice);
    expect(rawOptions.some((o) => o.code === "A")).toBe(true);
    const restricted = restrictBuildOptionsForBoard(rawOptions, emptyBoard(), CHALLENGES.foundations.rules.disabledBuildings);
    expect(restricted.some((o) => o.code === "A")).toBe(false);
  });
});
