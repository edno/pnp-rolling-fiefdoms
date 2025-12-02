import { describe, it, expect } from "vitest";
import {
  beginTurn,
  evaluateLocationSelection,
  selectLocationDie,
  startActivation,
  finishActivation,
  startPopulationPlacement,
  placePopulationNode,
  allocateWorker,
  autoForfeitUnfillableState,
  autoAdvanceState,
  recalcTracks,
  maybeRollAfterLockState,
} from "../app/game-state.js";
import { createState, lockDiceSnapshot } from "../app/state-controller.js";
import {
  uniqueLocationPairs,
  filterAvailablePairs,
  computePestilenceInfo,
  BUILDING_RULES,
  allocatePopulationToNode,
  calcVagrants,
  computeScore,
} from "../app/rules.js";

const helpers = { uniqueLocationPairs, filterAvailablePairs, computePestilenceInfo, sectionLabels: { centre: "Centre" } };

const emptyBoard = () =>
  Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
  );

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

  it("marks pestilence and computes section label", () => {
    const state = createState();
    const dice = [
      { face: "X", label: "X1", resolved: null },
      { face: "X", label: "X2", resolved: null },
      { face: 3, label: "N1", resolved: 3 },
      { face: 3, label: "N2", resolved: 3 },
    ];
    beginTurn(state, dice, emptyBoard(), helpers);
    expect(state.pestilence).toBe(true);
    expect(state.pestilenceInfo.sectionLabel).toBeDefined();
    expect(state.pestilenceInfo.sum).toBe(6);
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
