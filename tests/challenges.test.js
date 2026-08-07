import { describe, it, expect } from "vitest";
import { CHALLENGES, CHALLENGE_ORDER } from "../app/challenges.js";
import { computeScore } from "../app/rules.js";

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
  it("has a 24-turn limit and a forced center Guild setup", () => {
    expect(CHALLENGES.socialContract.turnLimit).toBe(24);
    expect(CHALLENGES.socialContract.setup.forcedCenterBuilding.code).toBe("G");
  });

  it("fails when the vagrant penalty is negative", () => {
    const board = emptyBoard();
    const pop = emptyPop();
    pop[0][0] = 14; // population with no housing -> vagrant penalty
    const result = computeScore(board, pop);
    const outcome = CHALLENGES.socialContract.victory(result, { board });
    expect(outcome.reasons.find((r) => r.textKey === "challenges.reasons.vagrantPenalty").ok).toBe(false);
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

describe("foundations rule flags", () => {
  it("disables advanced buildings and forces split on 7-10 sums", () => {
    expect(CHALLENGES.foundations.rules.disabledBuildings).toEqual(["T", "U", "A", "G"]);
    expect(CHALLENGES.foundations.rules.forceSplitOnAdvancedSum).toBe(true);
  });
});
