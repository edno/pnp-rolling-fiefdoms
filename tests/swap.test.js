import { describe, it, expect } from "vitest";
import {
  computeSwapChoice,
  soloBaseSelections,
  soloSwapUnavailableReasonKey,
} from "../app/swap.js";
import { createState } from "../app/state-controller.js";

const N = (label, face) => ({ label, face, resolved: face });
const X = (label, resolved = null) => ({ label, face: "X", resolved });
const W = (label) => ({ label, face: "windrose", resolved: null });

describe("computeSwapChoice", () => {
  it("does not swap by default", () => {
    const baseLoc = [N("N1", 3), N("N2", 4)];
    const baseBuild = [N("X1", 2), N("X2", 5)];
    const choice = computeSwapChoice(baseLoc, baseBuild, false);
    expect(choice.swapped).toBe(false);
    expect(choice.swapAllowed).toBe(true);
    expect(choice.locDice).toBe(baseLoc);
    expect(choice.buildDice).toBe(baseBuild);
  });

  it("swaps when swapFlag is set and swapping is allowed", () => {
    const baseLoc = [N("N1", 3), N("N2", 4)];
    const baseBuild = [N("X1", 2), N("X2", 5)];
    const choice = computeSwapChoice(baseLoc, baseBuild, true);
    expect(choice.swapped).toBe(true);
    expect(choice.swapAllowed).toBe(true);
    expect(choice.locDice).toBe(baseBuild);
    expect(choice.buildDice).toBe(baseLoc);
  });

  it("forces a swap when the location pair has an X die without a resolved number", () => {
    const baseLoc = [X("X1"), N("N1", 3)];
    const baseBuild = [N("N2", 4), N("N3", 2)];
    const choice = computeSwapChoice(baseLoc, baseBuild, false);
    expect(choice.swapped).toBe(true);
    expect(choice.swapAllowed).toBe(false);
    expect(choice.locDice).toBe(baseBuild);
    expect(choice.buildDice).toBe(baseLoc);
  });

  it("forces a swap when only the build pair has a windrose", () => {
    const baseLoc = [N("N1", 3), N("N2", 4)];
    const baseBuild = [W("X1"), N("X2", 2)];
    const choice = computeSwapChoice(baseLoc, baseBuild, false);
    expect(choice.swapped).toBe(true);
    expect(choice.swapAllowed).toBe(false);
    expect(choice.locDice).toBe(baseBuild);
  });

  it("disallows swap when the location pair has a windrose and the build pair does not", () => {
    const baseLoc = [W("N1"), N("N2", 3)];
    const baseBuild = [N("X1", 2), N("X2", 4)];
    const choice = computeSwapChoice(baseLoc, baseBuild, true);
    expect(choice.swapAllowed).toBe(false);
    expect(choice.swapped).toBe(false);
    expect(choice.locDice).toBe(baseLoc);
  });
});

describe("soloBaseSelections", () => {
  it("returns null with fewer than four dice", () => {
    const state = createState();
    state.dice = [N("N1", 3), N("N2", 4), N("X1", 2)];
    expect(soloBaseSelections(state)).toBeNull();
  });

  it("defaults to the two N-labelled dice as the location pair", () => {
    const state = createState();
    state.dice = [N("N1", 3), N("N2", 4), X("X1", 2), X("X2", 5)];
    const base = soloBaseSelections(state);
    expect(base.baseLocIdx).toEqual([0, 1]);
    expect(base.baseBuildIdx).toEqual([2, 3]);
    expect(base.baseLocDice).toEqual([state.dice[0], state.dice[1]]);
    expect(base.baseBuildDice).toEqual([state.dice[2], state.dice[3]]);
  });

  it("honours state.autoLocationSelection", () => {
    const state = createState();
    state.dice = [N("N1", 3), N("N2", 4), X("X1", 2), X("X2", 5)];
    state.autoLocationSelection = [2, 3];
    const base = soloBaseSelections(state);
    expect(base.baseLocIdx).toEqual([2, 3]);
    expect(base.baseBuildIdx).toEqual([0, 1]);
  });
});

describe("soloSwapUnavailableReasonKey", () => {
  const fourDice = () => [N("N1", 3), N("N2", 4), N("N3", 2), N("N4", 5)];

  it("returns 'hidden' while a turn, pestilence or activation is in progress", () => {
    const active = createState();
    active.dice = fourDice();
    active.activeTurn = true;
    expect(soloSwapUnavailableReasonKey(active)).toBe("hidden");

    const pest = createState();
    pest.dice = fourDice();
    pest.pestilence = true;
    expect(soloSwapUnavailableReasonKey(pest)).toBe("hidden");

    const activation = createState();
    activation.dice = fourDice();
    activation.activationMode = "building";
    expect(soloSwapUnavailableReasonKey(activation)).toBe("hidden");
  });

  it("returns the only-one-pairing key when swap is not allowed", () => {
    const state = createState();
    state.activeTurn = false;
    state.dice = [W("N1"), N("N2", 3), N("X1", 2), N("X2", 4)];
    expect(soloSwapUnavailableReasonKey(state)).toBe("html.swapUnavailableOnlyOnePairing");
  });

  it("returns null when both pairings have valid locations on a fresh board", () => {
    const state = createState();
    state.activeTurn = false;
    state.board = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
    state.dice = fourDice();
    expect(soloSwapUnavailableReasonKey(state)).toBeNull();
  });

  // Base pairing = N1/N2 (3,4) -> plots (row 3, col 4) / (row 4, col 3); alt pairing = N3/N4
  // (2,5) -> plots (row 2, col 5) / (row 5, col 2).
  const emptyBoard = () =>
    Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
  const block = (board, cells) => cells.forEach(([r, c]) => { board[r][c].building = "C"; });
  const BASE_PLOTS = [[2, 3], [3, 2]];
  const ALT_PLOTS = [[1, 4], [4, 1]];
  const soloState = ({ blocked = [], nonActiveSwap = false, influenceEarned = 0 } = {}) => {
    const state = createState();
    state.activeTurn = false;
    state.board = emptyBoard();
    block(state.board, blocked);
    state.dice = fourDice();
    state.nonActiveSwap = nonActiveSwap;
    state.influence = { earned: influenceEarned, spent: 0, pending: 0 };
    return state;
  };

  it("allows swapping away from a blocked base pairing to the viable alt pairing", () => {
    const state = soloState({ blocked: BASE_PLOTS, nonActiveSwap: false });
    expect(soloSwapUnavailableReasonKey(state)).toBeNull();
  });

  it("refuses to swap from the viable alt pairing back to a blocked base pairing", () => {
    const state = soloState({ blocked: BASE_PLOTS, nonActiveSwap: true });
    expect(soloSwapUnavailableReasonKey(state)).toBe("html.swapUnavailableNoValidLocationOnSwap");
  });

  it("refuses to swap from the viable base pairing to a blocked alt pairing", () => {
    const state = soloState({ blocked: ALT_PLOTS, nonActiveSwap: false });
    expect(soloSwapUnavailableReasonKey(state)).toBe("html.swapUnavailableNoValidLocationOnSwap");
  });

  it("allows swapping back from a blocked alt pairing to the viable base pairing", () => {
    const state = soloState({ blocked: ALT_PLOTS, nonActiveSwap: true });
    expect(soloSwapUnavailableReasonKey(state)).toBeNull();
  });

  it("reports no valid pairing when both are blocked and there is no influence", () => {
    const state = soloState({ blocked: [...BASE_PLOTS, ...ALT_PLOTS] });
    expect(soloSwapUnavailableReasonKey(state)).toBe("html.swapUnavailableNoValidPairing");
  });

  it("treats a blocked target pairing as viable when influence can rescue it", () => {
    // Swapping back to the blocked base pairing: 1 influence can nudge a die (e.g. 3 -> 2)
    // onto an open plot, so the swap stays available.
    const state = soloState({ blocked: BASE_PLOTS, nonActiveSwap: true, influenceEarned: 1 });
    expect(soloSwapUnavailableReasonKey(state)).toBeNull();
  });
});
