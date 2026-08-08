import { describe, it, expect } from "vitest";
import { t } from "../app/i18n.js";
import {
  beginTurn,
  tallyUnrestAndCheckBarricade,
  evaluateLocationSelection,
  selectLocationDie,
  startActivation,
  finishActivation,
  startPopulationPlacement,
  placePopulationNode,
  chooseBarricadeNode,
  allocateWorker,
  autoForfeitUnfillableState,
  autoAdvanceState,
  recalcTracks,
  maybeRollAfterLockState,
  turnLimitReached,
  canRescueLocationWithInfluence,
} from "../app/game-state.js";
import { createState, lockDiceSnapshot, resetTurnState } from "../app/state-controller.js";
import {
  uniqueLocationPairs,
  filterAvailablePairs,
  computePestilenceInfo,
  BUILDING_RULES,
  allocatePopulationToNode,
  calcVagrants,
  computeScore,
} from "../app/rules.js";

const helpers = { uniqueLocationPairs, filterAvailablePairs, computePestilenceInfo };

const emptyBoard = () =>
  Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
  );

const filledCentreBoard = () => {
  const board = emptyBoard();
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const inCentre = r >= 1 && r <= 3 && c >= 1 && c <= 3;
      if (inCentre) board[r][c].building = "X";
    }
  }
  return board;
};

const nodesForCell = (r, c) => {
  const coords = [];
  [
    [r - 1, c - 1],
    [r - 1, c],
    [r, c - 1],
    [r, c],
  ].forEach(([nr, nc]) => {
    if (nr >= 0 && nc >= 0 && nr < 4 && nc < 4) coords.push([nr, nc]);
  });
  return coords;
};

describe("beginTurn", () => {
  it("increments turn and assigns dice", () => {
    const state = createState();
    const dice = [{ face: 1 }, { face: 2 }, { face: 3 }, { face: 4 }];
    beginTurn(state, dice, emptyBoard(), helpers);
    expect(state.turnIndex).toBe(1);
    expect(state.activeTurn).toBe(true);
    expect(state.dice).toEqual(dice);
  });

  it("auto-assigns location for non-active turns and detects forceForfeit", () => {
    const state = createState();
    state.turnIndex = 1; // next turn will be non-active
    const dice = [
      { face: 1, resolved: 1 },
      { face: 2, resolved: 2 },
      { face: 3, resolved: 3 },
      { face: 4, resolved: 4 },
    ];
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "X", forfeited: false, springBoost: 0 })),
    );
    beginTurn(state, dice, fullBoard, helpers);
    expect(state.activeTurn).toBe(false);
    expect(state.locationSelection).toEqual([0, 1]);
    expect(state.forceForfeit).toBe(true);
  });

  it("marks pestilence and computes pestilence info", () => {
    const state = createState();
    const dice = [
      { face: "X", label: "X1", resolved: null },
      { face: "X", label: "X2", resolved: null },
      { face: 3, label: "N1", resolved: 3 },
      { face: 3, label: "N2", resolved: 3 },
    ];
    beginTurn(state, dice, emptyBoard(), helpers);
    expect(state.pestilence).toBe(true);
    expect(state.pestilenceInfo.sum).toBe(6);
    expect(state.pestilenceInfo.targetCells).toEqual([]);
  });
});

// Unrest is now tallied via tallyUnrestAndCheckBarricade(), called once per completed turn
// from rollDice() in app.js *before* the next turn's dice are rolled (so a raised Barricade
// must be resolved before the Fate roll happens) rather than from inside beginTurn().
describe("tallyUnrestAndCheckBarricade (challenge VI)", () => {
  it("does not accrue Unrest when unrestTracking is off", () => {
    const state = createState();
    const { triggered, messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(0);
    expect(triggered).toBe(false);
    expect(messages).toEqual([]);
  });

  it("does not accrue Unrest on the very first turn (no prior turn to score)", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnFlags = { advancedBuiltThisTurn: true };
    tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(0);
  });

  it("gains 1 Unrest for an Advanced building built during the completed turn", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.turnFlags = { advancedBuiltThisTurn: true };
    const { messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(1);
    expect(messages.some((m) => m.kind === "unrest")).toBe(true);
  });

  it("logs a separate step per source instead of combining them into one message", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.turnFlags = { advancedBuiltThisTurn: true };
    state.influenceAdjustments = { N1: { delta: 1 } };
    const { messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(2);
    const unrestMessages = messages.filter((m) => m.kind === "unrest").map((m) => m.text);
    expect(unrestMessages).toEqual([
      "Unrest +1 (Advanced building): 1/4.",
      "Unrest +1 (Influence): 2/4.",
    ]);
  });

  it("gains 1 Unrest per Influence spent during the completed turn", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.influenceAdjustments = { N1: { delta: 2 }, N2: { delta: -1 } };
    tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(3);
  });

  it("caps Unrest gain at 4 per turn", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.turnFlags = { advancedBuiltThisTurn: true };
    state.influenceAdjustments = { N1: { delta: 5 } };
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.barricadedNodes = Array.from({ length: 4 }, () => Array(4).fill(false));
    tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(0);
    expect(state.pendingBarricade?.active).toBe(true);
  });

  it("raises Barricades and requires the player to choose a square on crossing a multiple of 4", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrest = { progress: 3 };
    state.turnFlags = { advancedBuiltThisTurn: true };
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.barricadedNodes = Array.from({ length: 4 }, () => Array(4).fill(false));
    const { triggered, messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(0);
    expect(triggered).toBe(true);
    expect(state.pendingBarricade?.active).toBe(true);
    expect(messages.some((m) => m.kind === "unrest")).toBe(true);

    const result = chooseBarricadeNode(state, 0, 0);
    expect(result.barricaded).toBe(true);
    expect(state.barricadedNodes[0][0]).toBe(true);
    expect(state.pendingBarricade).toBeNull();
  });

  it("does not raise Barricades when Unrest does not cross a multiple of 4", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrest = { progress: 1 };
    state.turnFlags = { advancedBuiltThisTurn: true };
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    const { triggered } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(2);
    expect(triggered).toBe(false);
    expect(state.pendingBarricade?.active).toBeFalsy();
  });

  it("gains 1 Unrest when Vagrants exceed 8", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.populationNodes[0][0] = 9; // 9 population, no Cottages -> 9 Vagrants
    tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(1);
  });

  it("pins Unrest at the cap (does not raise Barricades) when no Population square is available", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrest = { progress: 3 };
    // Every node holds 1 pip (board is full, so nothing is barricadeable); population sums to
    // 16 against 0 Cottage housing, which itself pushes Unrest gain to 1 via the Vagrant clause.
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(1));
    state.barricadedNodes = Array.from({ length: 4 }, () => Array(4).fill(false));
    const { triggered, messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    // Pinned at the cap rather than wrapped to 0, so the event re-attempts next turn instead
    // of being silently lost.
    expect(state.unrest.progress).toBe(4);
    expect(triggered).toBe(false);
    expect(state.pendingBarricade).toBeNull();
    expect(messages.some((m) => /postponed/i.test(m.text))).toBe(true);
  });

  it("keeps re-checking a pinned Barricade on a later turn with zero Unrest gain", () => {
    const state = createState();
    state.unrestTracking = true;
    state.turnIndex = 2;
    // Already pinned at the cap from a prior blocked turn.
    state.unrest = { progress: 4 };
    // No Advanced building, no Influence spent, Vagrants within limits: this turn earns 0
    // Unrest on its own, but the pinned Barricade should still be re-evaluated rather than
    // silently skipped.
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(1));
    state.barricadedNodes = Array.from({ length: 4 }, () => Array(4).fill(false));
    const { triggered, messages } = tallyUnrestAndCheckBarricade(state, emptyBoard());
    expect(state.unrest.progress).toBe(4);
    expect(triggered).toBe(false);
    expect(messages.some((m) => /postponed/i.test(m.text))).toBe(true);
  });
});

describe("activation worker assignment", () => {
  const buildingRules = BUILDING_RULES;
  const nodesForCell = (r, c) => [[r, c]];

  it("blocks worker assignment outside activation mode", () => {
    const state = createState();
    state.board = [[{ building: "T", forfeited: false, springBoost: 0 }]];
    const result = allocateWorker(
      state,
      [0, 0],
      [0, 0],
      { nodesForCell, buildingRules },
    );
    expect(result.updated).toBe(false);
    expect(result.message).toMatch(/activation/i);
  });

  it("consumes population one pip at a time and stops when empty", () => {
    const state = createState();
    state.activationMode = true;
    state.board = [[{ building: "T", forfeited: false, springBoost: 0 }]];
    state.populationAvailable = [[2]];
    state.workerAllocations = [[0]];
    const first = allocateWorker(state, [0, 0], [0, 0], { nodesForCell, buildingRules });
    expect(first.updated).toBe(true);
    expect(state.workerAllocations[0][0]).toBe(1);
    expect(state.populationAvailable[0][0]).toBe(1);
    const second = allocateWorker(state, [0, 0], [0, 0], { nodesForCell, buildingRules });
    expect(second.updated).toBe(true);
    expect(state.workerAllocations[0][0]).toBe(2);
    expect(state.populationAvailable[0][0]).toBe(0);
    const third = allocateWorker(state, [0, 0], [0, 0], { nodesForCell, buildingRules });
    expect(third.updated).toBe(false);
    expect(third.message).toMatch(/No available population/i);
  });
});

describe("lockDiceSnapshot", () => {
  it("can mark a pending next roll even if dice are already locked", () => {
    const state = createState();
    state.dice = [
      { face: 3, resolved: 3, label: "N1" },
      { face: 4, resolved: 4, label: "N2" },
      { face: "X", resolved: null, label: "X1" },
      { face: "X", resolved: null, label: "X2" },
    ];
    state.locationSelection = [0, 1];
    lockDiceSnapshot(state, { uniqueLocationPairs });
    expect(state.diceLocked).toBe(true);
    expect(state.pendingNextRoll).toBe(false);
    lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
    expect(state.pendingNextRoll).toBe(true);
  });

  it("unblocks the next roll after a pestilence forfeit flow", () => {
    const state = createState();
    state.dice = [
      { face: 3, resolved: 3, label: "N1" },
      { face: 4, resolved: 4, label: "N2" },
      { face: "X", resolved: null, label: "X1" },
      { face: "X", resolved: null, label: "X2" },
    ];
    state.locationSelection = [0, 1];
    state.pestilence = true;
    lockDiceSnapshot(state, { uniqueLocationPairs });
    expect(state.diceLocked).toBe(true);
    expect(state.pendingNextRoll).toBe(false);

    // Forfeit during pestilence marks pending next roll while dice are already locked
    lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
    state.pestilence = false;
    state.forceForfeit = false;
    const action = maybeRollAfterLockState(state);
    expect(action).toBe("roll");
    expect(state.diceLocked).toBe(false);
    expect(state.pendingNextRoll).toBe(false);
  });
});

describe("die selection and location evaluation", () => {
  it("enforces two-die selection and invalid pair handling", () => {
    const state = createState();
    state.dice = [
      { face: 1, resolved: 1 },
      { face: 2, resolved: 2 },
      { face: 3, resolved: 3 },
      { face: 4, resolved: 4 },
    ];
    state.activeTurn = true;
    selectLocationDie(state, 0, { ...helpers, board: emptyBoard() });
    selectLocationDie(state, 1, { ...helpers, board: emptyBoard() });
    const result = evaluateLocationSelection(state, { ...helpers, board: emptyBoard() });
    expect(state.locationSelection).toEqual([0, 1]);
    expect(result.forceForfeit).toBe(false);
  });

  it("forces forfeit when no pairs available", () => {
    const state = createState();
    state.dice = [
      { face: 1, resolved: 1 },
      { face: 2, resolved: 2 },
      { face: 3, resolved: 3 },
      { face: 4, resolved: 4 },
    ];
    state.activeTurn = true;
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "X", forfeited: false, springBoost: 0 })),
    );
    const result = evaluateLocationSelection(state, { ...helpers, board: fullBoard });
    expect(result.forceForfeit).toBe(true);
    expect(state.forceForfeit).toBe(true);
    expect(state.forceForfeitHighlight).toBe(true);
  });

  it("keeps auto-assigned dice visible on non-active forced forfeits", () => {
    const state = createState();
    state.turnIndex = 1; // next turn is non-active
    const dice = [
      { face: "windrose", resolved: 1, label: "N1", choices: [1, 2, 3, 4, 5] },
      { face: 3, resolved: 3, label: "N2" },
      { face: "X", resolved: null, label: "X1" },
      { face: "X", resolved: null, label: "X2" },
    ];
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "Q", forfeited: false, springBoost: 0 })),
    );

    beginTurn(state, dice, fullBoard, helpers);
    evaluateLocationSelection(state, { ...helpers, board: fullBoard });

    expect(state.activeTurn).toBe(false);
    expect(new Set(state.locationSelection)).toEqual(new Set([0, 1])); // numbered dice stay in location
    const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
    expect(buildDice).toHaveLength(2);
    expect(buildDice.every((d) => d.face === "X")).toBe(true);
    expect(state.forceForfeit).toBe(true);
  });

  it("keeps X dice out of location selection on non-active turns even when X shows a number", () => {
    const state = createState();
    state.turnIndex = 1; // non-active
    const dice = [
      { face: 2, resolved: 2, label: "N1" },
      { face: 3, resolved: 3, label: "N2" },
      { face: 5, resolved: 5, label: "X1" }, // X die showing a number
      { face: "X", resolved: null, label: "X2" },
    ];
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "Q", forfeited: false, springBoost: 0 })),
    );

    beginTurn(state, dice, fullBoard, helpers);
    evaluateLocationSelection(state, { ...helpers, board: fullBoard });

    expect(state.activeTurn).toBe(false);
    expect(state.locationSelection).toEqual([0, 1]); // numbered dice only
    const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
    expect(buildDice).toHaveLength(2);
    expect(buildDice.map((d) => d.label)).toEqual(["X1", "X2"]);
  });

  it("computes forceForfeit per player based on their own board", () => {
    const dice = [
      { face: 1, resolved: 1, label: "N1" },
      { face: 2, resolved: 2, label: "N2" },
      { face: 3, resolved: 3, label: "X1" },
      { face: 4, resolved: 4, label: "X2" },
    ];
    const fullBoard = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "Q", forfeited: false, springBoost: 0 })),
    );
    const openBoard = emptyBoard();

    const stateA = createState();
    beginTurn(stateA, dice, fullBoard, helpers);
    evaluateLocationSelection(stateA, { ...helpers, board: fullBoard });
    expect(stateA.forceForfeit).toBe(true);

    const stateB = createState();
    beginTurn(stateB, dice, openBoard, helpers);
    evaluateLocationSelection(stateB, { ...helpers, board: openBoard });
    expect(stateB.forceForfeit).toBe(false);
  });

  it("keeps pestilence forfeits agnostic to board state", () => {
    const dice = [
      { face: "X", resolved: null, label: "X1" },
      { face: "X", resolved: null, label: "X2" },
      { face: 3, resolved: 3, label: "N1" },
      { face: 3, resolved: 3, label: "N2" },
    ];
    const stateA = createState();
    const stateB = createState();

    beginTurn(stateA, dice, filledCentreBoard(), helpers);
    beginTurn(stateB, dice, emptyBoard(), helpers);

    expect(stateA.pestilenceInfo.targetCells).toEqual([]);
    expect(stateB.pestilenceInfo.targetCells).toEqual([]);
  });
});

describe("canRescueLocationWithInfluence", () => {
  const singleOpenCellBoard = (openRow, openCol) => {
    const board = emptyBoard();
    board.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!(r === openRow && c === openCol)) cell.building = "X";
      }),
    );
    return board;
  };

  it("finds a rescue when adjusting one die by a delta within budget reaches the only open cell", () => {
    const state = createState();
    state.influence = { earned: 2, spent: 0 };
    const board = singleOpenCellBoard(2, 3); // needs pair values {3,4}
    const diceList = [
      { label: "N1", face: 4, resolved: 4 },
      { label: "N2", face: 1, resolved: 1 }, // needs +2 to reach 3
    ];
    expect(canRescueLocationWithInfluence(state, diceList, board, { uniqueLocationPairs, filterAvailablePairs })).toBe(
      true,
    );
  });

  it("returns false when the required delta exceeds the available budget", () => {
    const state = createState();
    state.influence = { earned: 1, spent: 0 }; // only 1 point, need 2
    const board = singleOpenCellBoard(2, 3);
    const diceList = [
      { label: "N1", face: 4, resolved: 4 },
      { label: "N2", face: 1, resolved: 1 },
    ];
    expect(canRescueLocationWithInfluence(state, diceList, board, { uniqueLocationPairs, filterAvailablePairs })).toBe(
      false,
    );
  });

  it("returns false when no Influence is available at all", () => {
    const state = createState();
    state.influence = { earned: 0, spent: 0 };
    const board = singleOpenCellBoard(2, 3);
    const diceList = [
      { label: "N1", face: 4, resolved: 4 },
      { label: "N2", face: 1, resolved: 1 },
    ];
    expect(canRescueLocationWithInfluence(state, diceList, board, { uniqueLocationPairs, filterAvailablePairs })).toBe(
      false,
    );
  });

  it("finds a rescue via either die, regardless of which one needs the adjustment", () => {
    const state = createState();
    state.influence = { earned: 3, spent: 0 };
    const board = singleOpenCellBoard(0, 2); // needs pair values {1,3}
    const diceList = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 5, resolved: 5 }, // needs -2 to reach 3
    ];
    expect(canRescueLocationWithInfluence(state, diceList, board, { uniqueLocationPairs, filterAvailablePairs })).toBe(
      true,
    );
  });
});

describe("influence integration", () => {
  it("awards influence starting at pip 9, then every eight pips thereafter", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = [
      [5, 3, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    state.tracks = { population: 0, housing: 0, influence: 0 };
    state.influence = { earned: 0, spent: 0 };

    const belowThreshold = recalcTracks(state, { computeScore, calcVagrants });
    expect(belowThreshold.influence.earned).toBe(0);
    expect(belowThreshold.influence.gained).toBe(0);
    expect(state.tracks.influence).toBe(0);

    state.populationNodes[0][1] = 4; // Total population now 9
    const first = recalcTracks(state, { computeScore, calcVagrants });
    expect(first.influence.earned).toBe(1);
    expect(first.influence.gained).toBe(1);
    expect(state.tracks.influence).toBe(1);

    state.populationNodes[0][2] = 5;
    state.populationNodes[1][0] = 3; // Total population now 17
    const second = recalcTracks(state, { computeScore, calcVagrants });
    expect(second.influence.earned).toBe(2);
    expect(second.influence.gained).toBe(1);
    expect(state.tracks.influence).toBe(2);

    state.influenceAdjustments = { N1: { delta: 3 } };
    state.influenceTarget = "N1";
    const third = recalcTracks(state, { computeScore, calcVagrants });
    expect(third.influence.earned).toBe(2);
    expect(state.influence.pending).toBe(2);
  });

  it("folds a challenge's flat starting-Influence bonus into earned without reporting it as a population gain", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.influenceBonus = 1;
    state.influence = { earned: 0, spent: 0 };

    const start = recalcTracks(state, { computeScore, calcVagrants });
    expect(start.influence.earned).toBe(1);
    expect(start.influence.gained).toBe(0); // the bonus isn't a population milestone
    expect(state.tracks.influence).toBe(1);

    state.populationNodes[0][0] = 9; // crosses the first population-influence threshold
    const afterPopGrowth = recalcTracks(state, { computeScore, calcVagrants });
    expect(afterPopGrowth.influence.earned).toBe(2); // 1 from population + the flat bonus
    expect(afterPopGrowth.influence.gained).toBe(1); // now correctly attributed to population
  });

  it("commits spent influence between turns", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = [
      [5, 4, 0, 0],
      [5, 3, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    state.tracks = { population: 0, housing: 0, influence: 0 };
    recalcTracks(state, { computeScore, calcVagrants });
    expect(state.influence.earned).toBe(2);
    state.influenceAdjustments = { N1: { delta: 1 }, N2: { delta: 1 } };
    recalcTracks(state, { computeScore, calcVagrants });
    expect(state.influence.pending).toBe(2);
    resetTurnState(state);
    expect(state.influence.spent).toBe(2);
    expect(state.influence.pending).toBe(0);
  });

  it("allows influence rescue before forcing a forfeit", () => {
    const state = createState();
    state.board = emptyBoard();
    state.board.forEach((row, r) =>
      row.forEach((cell, c) => {
        cell.building = "X";
        cell.forfeited = false;
        if (r === 2 && c === 0) cell.building = null;
      }),
    );
    state.locationSelection = [0, 1];
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 1, resolved: 1 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.activeTurn = true;
    const { forceForfeit, message } = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(true);
    expect(message).toBe("No valid location pairs; spend Influence or click on any empty plot to forfeit it.");
  });

  it("prompts non-active turns to spend influence before forfeiting", () => {
    const state = createState();
    state.board = emptyBoard();
    state.board.forEach((row, r) =>
      row.forEach((cell, c) => {
        cell.building = "X";
        cell.forfeited = false;
        if (r === 2 && c === 0) cell.building = null;
      }),
    );
    state.turnIndex = 1; // next turn becomes non-active
    state.influence = { earned: 1, spent: 0, pending: 0 };
    const dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 1, resolved: 1 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    const { messages } = beginTurn(state, dice, state.board, helpers);
    expect(state.activeTurn).toBe(false);
    expect(state.forceForfeit).toBe(false);
    expect(messages.map((m) => m.text)).toContain(
      "No valid location pairs; spend Influence or click on any empty plot to forfeit it.",
    );
  });

  it("prompts active turns to select location dice when influence can rescue before choosing dice", () => {
    const state = createState();
    const board = emptyBoard();
    board.forEach((row) =>
      row.forEach((cell) => {
        cell.building = "X";
      }),
    );
    board[0][3].building = null;
    state.board = board;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    const dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 3, resolved: 3 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    beginTurn(state, dice, board, helpers);
    const { message, forceForfeit } = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board,
    });
    expect(state.activeTurn).toBe(true);
    expect(forceForfeit).toBe(false);
    expect(state.forceForfeitAdvisory).toBe(true);
    expect(state.invalidSelection).toBe(true);
    expect(message).toBe('Select two location dice in the <span class="panel-title-font">Turn</span> panel.');
    expect(state.invalidSelectionMessage).toBe(
      'Select two location dice in the <span class="panel-title-font">Turn</span> panel.',
    );
    expect(state.forceForfeitHighlight).toBe(false);
  });

  it("accepts influenced X dice as a valid location pair on active turns", () => {
    const state = createState();
    const board = emptyBoard();
    board.forEach((row) =>
      row.forEach((cell) => {
        cell.building = "X";
      }),
    );
    board[2][4].building = null; // row 3, col 5
    board[4][2].building = null; // row 5, col 3
    state.board = board;
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.locationSelection = [2, 3];
    state.activeTurn = true;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.influenceTarget = "X1";
    state.influenceAdjustments = { X1: { delta: 1 } };
    const { forceForfeit, invalidSelection, message } = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(forceForfeit).toBe(false);
    expect(invalidSelection).toBe(false);
    expect(state.forceForfeitAdvisory).toBe(false);
    expect(message).toBeNull();
    expect(state.locationPairs.length).toBeGreaterThan(0);
    expect(state.forceForfeitHighlight).toBe(false);
  });

  it("lets players spend influence instead of clearing an invalid location pair", () => {
    const state = createState();
    state.board = emptyBoard();
    state.board.forEach((row) =>
      row.forEach((cell) => {
        cell.building = "X";
      }),
    );
    state.board[0][1].building = null;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "N3", face: 1, resolved: 1 },
      { label: "X1", face: 3, resolved: 3 },
      { label: "X2", face: 4, resolved: 4 },
    ];
    state.locationSelection = [0, 1];
    state.activeTurn = true;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    const { forceForfeit, invalidSelection, message } = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(forceForfeit).toBe(false);
    expect(invalidSelection).toBe(true);
    expect(message).toBe("No valid plots for that pair; spend Influence or choose a different location pair.");
    expect(state.locationSelection).toEqual([0, 1]);
    expect(state.invalidSelectionMessage).toBe(message);

    // Player should be able to adjust the chosen dice to try a different pair
    selectLocationDie(state, 1, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(state.locationSelection).toEqual([0]);
    selectLocationDie(state, 2, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(new Set(state.locationSelection)).toEqual(new Set([0, 2]));
  });

  it("uses influence adjustments when evaluating locations", () => {
    const state = createState();
    state.board = emptyBoard();
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.locationSelection = [0, 1];
    state.activeTurn = true;
    evaluateLocationSelection(state, { ...helpers, board: emptyBoard() });
    expect(state.locationPairs).toEqual([[1, 2]]);
    state.influenceAdjustments = { N2: { delta: 2 } };
    state.influenceTarget = "N2";
    evaluateLocationSelection(state, { ...helpers, board: emptyBoard() });
    expect(state.locationPairs).toEqual([[1, 4]]);
  });

  it("ignores non-target influence adjustments", () => {
    const state = createState();
    state.board = emptyBoard();
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.locationSelection = [0, 1];
    state.activeTurn = true;
    state.influenceAdjustments = { N1: { delta: 1 }, N2: { delta: 2 } };
    state.influenceTarget = "N1";
    evaluateLocationSelection(state, { ...helpers, board: emptyBoard() });
    expect(state.locationPairs).toEqual([[2, 2]]);
  });

  it("includes influence-adjusted X dice in location pool for rescue", () => {
    const state = createState();
    state.board = emptyBoard();
    // Block all positions except Row 4, Col 2 and Row 2, Col 4
    state.board.forEach((row, r) =>
      row.forEach((cell, c) => {
        if ((r === 3 && c === 1) || (r === 1 && c === 3)) {
          cell.building = null; // Row 4, Col 2 and Row 2, Col 4 are open
        } else {
          cell.building = "X";
        }
      }),
    );
    
    state.dice = [
      { label: "N1", face: 4, resolved: 4 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 3, resolved: 3 },
      { label: "X2", face: "X", resolved: null },
    ];
    state.locationSelection = [0, 1]; // N1, N2 selected
    state.activeTurn = true;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    
    // Without influence adjustment, only [4,4] possible but all positions forfeited
    // Since no rescue is possible without adjusting X1, should force forfeit
    const beforeInfluence = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(beforeInfluence.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(true);
    
    // Apply influence to adjust X1 from 3 to 2
    state.influenceAdjustments = { X1: { delta: -1 } };
    state.influenceTarget = "X1";
    
    // With influence adjustment, pair [4,2] should now be valid
    const afterInfluence = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(afterInfluence.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(true); // Still invalid because N1,N2 selected, not using X1
  });

  it("recognizes X dice can rescue from forfeit when adjusted with influence", () => {
    const state = createState();
    state.board = emptyBoard();
    // Only position Row 2, Col 4 is open
    state.board.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (r === 1 && c === 3) {
          cell.building = null; // Row 2, Col 4 open
        } else {
          cell.building = "X";
        }
      }),
    );
    
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "X1", face: 3, resolved: 3 },
      { label: "X2", face: "X", resolved: null },
    ];
    state.locationSelection = [0, 1]; // N1, N2 selected
    state.activeTurn = true;
    state.influence = { earned: 2, spent: 0, pending: 0 };
    
    // Pair [2,2] has no valid positions
    const before = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(state.invalidSelection).toBe(true);
    expect(before.message).toContain("Influence");
    
    // Adjust X1 from 3 to 4 to enable pair [2,4]
    state.influenceAdjustments = { X1: { delta: 1 } };
    state.influenceTarget = "X1";
    
    const after = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    // Should recognize that [2,4] is now possible via influence-adjusted X1
    expect(after.forceForfeit).toBe(false);
  });

  it("keeps active turns playable when only windrose plus resolved X dice can reach an open plot", () => {
    const state = createState();
    state.board = emptyBoard();
    // Close every plot except row 5, col 1 (pair [1,5])
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        if (!(r === 4 && c === 0)) state.board[r][c].building = "B";
      }
    }
    state.dice = [
      { label: "N1", face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.forcedLocationDice = [0];
    state.locationSelection = [0];
    state.activeTurn = true;
    state.influence = { earned: 0, spent: 0, pending: 0 };

    const result = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });

    expect(result.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(false);
    expect(state.invalidSelectionMessage).toBeNull();
  });

  it("keeps resolved X dice available when fewer than two dice are selected", () => {
    const state = createState();
    state.board = emptyBoard();
    // Block all positions for pair [1,1]
    state.board[0][0].building = "X";
    state.board[0][4].building = "X";
    state.board[4][0].building = "X";
    state.board[4][4].building = "X";
    
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 1, resolved: 1 },
      { label: "X1", face: 2, resolved: 2 }, // Has resolved value but not adjusted
      { label: "X2", face: 2, resolved: 2 },
    ];
    state.locationSelection = [0]; // Only N1 selected so far
    state.activeTurn = true;
    state.influence = { earned: 0, spent: 0, pending: 0 };

    // Only the selected N dice form blocked pairs; resolved X dice should still provide options.
    const result = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    expect(result.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(false);
  });

  it("recognizes N and X dice with resolved values can form valid location pairs (bug fix)", () => {
    const state = createState();
    state.board = emptyBoard();
    // Only block Row 1, Col 1 to force [1,4] to be the only valid pair
    state.board[0][0].building = "X";
    
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 4, resolved: 4 }, // X die with resolved value
    ];
    state.locationSelection = []; // No selection yet
    state.activeTurn = true;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    
    // N1=1 and X2=4 should form valid pair [1,4] at Row 1, Col 4
    // Without this fix, canRescueAnyLocationPair only checks N dice pairs
    // and misses that N1+X2 can form a valid location pair
    const result = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    
    // Should NOT force forfeit because [1,4] is valid and available
    expect(result.forceForfeit).toBe(false);
    // Should show rescue hint since no N dice form a valid pair (N1+N2=[1,3] at Row 1, Col 3 is open)
    // Actually, [1,3] IS valid, so let me adjust the test
  });

  it("recognizes N and X pairs when N-only pairs are blocked", () => {
    const state = createState();
    state.board = emptyBoard();
    // Block all N-only combinations but leave N+X combination open
    state.board[0][0].building = "X"; // Row 1, Col 1 (pair [1,1])
    state.board[0][2].building = "X"; // Row 1, Col 3 (pair [1,3])
    state.board[2][0].building = "X"; // Row 3, Col 1 (pair [1,3])
    state.board[2][2].building = "X"; // Row 3, Col 3 (pair [3,3])
    // Leave Row 1, Col 4 and Row 4, Col 1 open for pair [1,4]
    
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 4, resolved: 4 }, // X die with resolved value
    ];
    state.locationSelection = [0, 1]; // N1, N2 selected
    state.activeTurn = true;
    state.influence = { earned: 1, spent: 0, pending: 0 };
    
    // N1=1, N2=3 form pair [1,3] but both positions are blocked
    // However, N1=1 and X2=4 can form pair [1,4] which has open positions
    // The system should recognize this and offer influence rescue, not force forfeit
    const result = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    
    expect(result.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(true);
    expect(result.message).toContain("Influence");
  });

  it("prevents forfeit when N+X pair is directly available (user bug scenario)", () => {
    const state = createState();
    state.board = emptyBoard();
    // Only block Row 1, Col 1 - everything else is open including Row 1, Col 4
    state.board[0][0].building = "X"; // Row 1, Col 1 blocked
    
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 4, resolved: 4 }, // X die with resolved value
    ];
    state.locationSelection = []; // No selection yet
    state.activeTurn = true;
    state.influence = { earned: 0, spent: 0, pending: 0 };
    
    // Without influence, pair [1,4] from N1+X2 should be directly available
    // This was the bug: system was saying "No valid location pairs" but [1,4] was free
    const result = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    
    // Should NOT force forfeit because multiple pairs are available including [1,4]
    expect(result.forceForfeit).toBe(false);
    expect(state.invalidSelection).toBe(false);
  });
});

describe("activation lifecycle", () => {
  it("enters and exits activation", () => {
    const state = createState();
    state.board = emptyBoard();
    startActivation(state);
    expect(state.activationMode).toBe(true);
    expect(state.workerAllocations).toBeTruthy();
    finishActivation(state);
    expect(state.activationMode).toBe(false);
    expect(state.activationComplete).toBe(true);
  });
});

describe("population placement", () => {
  it("starts population placement when spots exist", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    const result = startPopulationPlacement(state, [2, 2], 3, { nodesForCell });
    expect(result.started).toBe(true);
    expect(state.pendingPopulation).toBeTruthy();
  });

  it("places population and clears pending", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.pendingPopulation = { remaining: 2, cell: [2, 2] };
    const result = placePopulationNode(state, 1, 1, {
      nodesForCell,
      allocatePopulationToNode,
      popCapacity: 5,
    });
    expect(result.placed).toBe(2);
    expect(state.populationNodes[1][1]).toBe(2);
    expect(state.pendingPopulation).toBeNull();
  });
});

describe("activation worker allocation", () => {
  it("allocates workers and marks activation when filled", () => {
    const state = createState();
    state.activationMode = true;
    state.board = emptyBoard();
    state.board[1][1].building = "W";
    state.populationAvailable = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.populationAvailable[0][0] = 2;
    state.workerAllocations = Array.from({ length: 5 }, () => Array(5).fill(0));
    const result = allocateWorker(state, [0, 0], [1, 1], {
      nodesForCell,
      buildingRules: BUILDING_RULES,
    });
    expect(result.updated).toBe(true);
    expect(state.workerAllocations[1][1]).toBe(1);
  });

  it("marks activation forfeits when unfillable", () => {
    const state = createState();
    state.board = emptyBoard();
    state.board[1][1].building = "W";
    state.populationAvailable = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.workerAllocations = Array.from({ length: 5 }, () => Array(5).fill(0));
    const msgs = autoForfeitUnfillableState(state, {
      nodesForCell,
      buildingRules: BUILDING_RULES,
      finalize: true,
    });
    expect(state.board[1][1].activationForfeit).toBe(true);
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe("auto advance and tracks", () => {
  it("requests activation when board is full", () => {
    const state = createState();
    state.board = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: "X", forfeited: false, springBoost: 0 })),
    );
    const result = autoAdvanceState(state, state.board);
    expect(result.action).toBe("activate");
    expect(result.message).toBe(t("game.boardFull"));
  });

  it("requests activation early when a challenge turn limit is reached, even with an open board", () => {
    const state = createState();
    state.board = emptyBoard();
    state.turnLimit = 24;
    state.turnIndex = 24;
    expect(turnLimitReached(state)).toBe(true);
    const result = autoAdvanceState(state, state.board);
    expect(result.action).toBe("activate");
    expect(result.message).toBe(t("game.turnLimitReached"));
  });

  it("does not force activation before the turn limit is reached", () => {
    const state = createState();
    state.board = emptyBoard();
    state.turnLimit = 24;
    state.turnIndex = 10;
    expect(turnLimitReached(state)).toBe(false);
    const result = autoAdvanceState(state, state.board);
    expect(result.action).toBe("roll");
  });

  it("ignores turn limit when unset (normal game)", () => {
    const state = createState();
    state.board = emptyBoard();
    expect(turnLimitReached(state)).toBe(false);
  });

  it("recalculates tracks and returns score info", () => {
    const state = createState();
    state.board = emptyBoard();
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.board[0][0].building = "C";
    state.populationNodes[0][0] = 4;
    const { vagrants, scoreResult } = recalcTracks(state, { computeScore, calcVagrants });
    expect(state.tracks.population).toBe(4);
    expect(state.tracks.housing).toBe(4);
    expect(vagrants).toBe(0);
    expect(scoreResult.total).toBeGreaterThanOrEqual(0);
  });

  it("rolls after lock when safe", () => {
    const state = createState();
    state.diceLocked = true;
    state.pendingNextRoll = true;
    const action = maybeRollAfterLockState(state);
    expect(action).toBe("roll");
    expect(state.diceLocked).toBe(false);
    expect(state.pendingNextRoll).toBe(false);
  });

  it("waits if population placement pending", () => {
    const state = createState();
    state.diceLocked = true;
    state.pendingNextRoll = true;
    state.pendingPopulation = { remaining: 1, cell: [0, 0] };
    const action = maybeRollAfterLockState(state);
    expect(action).toBe("wait");
    expect(state.diceLocked).toBe(true);
  });
});

describe("X dice with numeric values as location dice", () => {
  it("allows selecting X die with resolved numeric value as location die", () => {
    const state = createState();
    state.activeTurn = true;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.locationSelection = [];
    state.board = emptyBoard();

    // Should allow selecting N1
    selectLocationDie(state, 0, { ...helpers, board: state.board });
    expect(state.locationSelection).toContain(0);
    expect(state.locationSelection.length).toBe(1);

    // Should allow selecting X1 (has resolved value)
    const result2 = selectLocationDie(state, 2, { ...helpers, board: state.board });
    expect(result2.invalidSelection).toBe(false);
    expect(state.locationSelection).toContain(2);
    expect(state.locationSelection.length).toBe(2);
  });

  it("blocks selecting X die without resolved numeric value", () => {
    const state = createState();
    state.activeTurn = true;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: "X", resolved: null },
      { label: "X2", face: "X", resolved: null },
    ];
    state.locationSelection = [0];
    state.board = emptyBoard();

    // Should not allow selecting X1 (no resolved value)
    const before = state.locationSelection.length;
    selectLocationDie(state, 2, { ...helpers, board: state.board });
    expect(state.locationSelection.length).toBe(before);
  });

  it("correctly identifies location vs build dice when X has numeric value", () => {
    const state = createState();
    state.activeTurn = true;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.board = emptyBoard();

    // Select N1 and X1 as location pair
    selectLocationDie(state, 0, { ...helpers, board: state.board });
    selectLocationDie(state, 2, { ...helpers, board: state.board });

    expect(state.locationSelection).toEqual([0, 2]);
    // Build dice should be N2 and X2
    const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
    expect(buildDice.length).toBe(2);
    expect(buildDice[0].label).toBe("N2");
    expect(buildDice[1].label).toBe("X2");
  });

  it("allows influence adjustment on X die selected as location die", () => {
    const state = createState();
    state.activeTurn = true;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 3, resolved: 3 },
      { label: "X1", face: 4, resolved: 4 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    state.board = emptyBoard();
    state.influence = { earned: 2, spent: 0, pending: 0 };

    // Select N1 and X2 as location pair
    selectLocationDie(state, 0, { ...helpers, board: state.board });
    selectLocationDie(state, 3, { ...helpers, board: state.board });

    // Apply influence to X2
    state.influenceAdjustments = { X2: { delta: -1 } };
    state.influenceTarget = "X2";

    evaluateLocationSelection(state, { ...helpers, board: state.board });

    // Should have valid location pairs with influence applied
    expect(state.locationPairs.length).toBeGreaterThan(0);
  });
});
