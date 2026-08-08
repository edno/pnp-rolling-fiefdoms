/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

// Shared queues used by the dice mock to produce deterministic rolls.
const numberedQueue = [];
const xQueue = [];

vi.mock("../app/dice.js", () => {
  return {
    rollNumberedDie: vi.fn((label) => {
      const entry = numberedQueue.length ? numberedQueue.shift() : 1;
      const face = typeof entry === "object" ? entry.face ?? entry.resolved ?? 1 : entry;
      const resolved = typeof entry === "object" ? entry.resolved ?? face : face;
      const choices = Array.isArray(entry?.choices) ? entry.choices : [];
      return { label, face, resolved, choices };
    }),
    rollXDie: vi.fn((label) => {
      const entry = xQueue.length ? xQueue.shift() : "X";
      const face = typeof entry === "object" ? entry.face ?? entry.resolved ?? "X" : entry;
      const resolved = typeof face === "number" ? face : null;
      return { label, face, resolved, choices: [] };
    }),
    __queues: { numberedQueue, xQueue },
  };
});

const baseHtml = `
  <div id="loadingOverlay"></div>
  <div id="sheet"></div>
  <div id="board"></div>
  <div id="diceView"></div>
  <div id="turnHint"></div>
  <div id="locDicePreview"></div>
  <div id="buildDicePreview"></div>
  <ul id="log"></ul>
  <div id="scoreOverlayBuildings"></div>
  <div id="scoreOverlayGuilds"></div>
  <div id="scoreOverlayReputation"></div>
  <div id="turnTrackOverlay"></div>
  <div id="popHousingOverlay"></div>
  <button id="finishActivation"></button>
  <button id="newGameBtn"></button>
  <button id="fullscreenToggle"></button>
  <div id="actionBanner"></div>
  <span id="turnStatusChip"></span>
  <button id="rollBtn"></button>
  <input id="fiefdomInput" />
  <div id="buildingsOverlay"></div>
  <div id="guildsOverlay"></div>
`;

async function flushMicrotasks() {
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.runOnlyPendingTimersAsync();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function stubEnvironment() {
  document.body.innerHTML = baseHtml;
  document.body.classList.add("loading");
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  }
  if (window.HTMLMediaElement) {
    Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  }
  class InstantImage {
    set src(val) {
      this._src = val;
      if (typeof this.onload === "function") this.onload();
    }
  }
  // eslint-disable-next-line no-global-assign
  Image = InstantImage;
}

async function setupApp({ numbered = [], x = [], debug = false, enableHooks = false } = {}) {
  vi.resetModules();
  numberedQueue.length = 0;
  xQueue.length = 0;
  stubEnvironment();
  const url = new URL("http://localhost/");
  if (debug) url.searchParams.set("debug", "");
  location = url;
  if (enableHooks) {
    window.__RF_ENABLE_TEST_HOOKS__ = true;
  }
  const dice = await import("../app/dice.js");
  dice.__queues.numberedQueue.push(...numbered);
  dice.__queues.xQueue.push(...x);
  await import("../app/app.js");
  await flushMicrotasks();
}

function createEmptyBoard() {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
  );
}

function clickDie(idx) {
  const badge = document.querySelector(`.die-badge[data-idx="${idx}"]`);
  if (!badge) throw new Error(`Die badge ${idx} not found`);
  badge.click();
}

function clickRoll() {
  const btn = document.getElementById("rollBtn");
  if (!btn) throw new Error("Roll button not found");
  btn.click();
}

function latestLogs() {
  return Array.from(document.querySelectorAll("#log li")).map((li) => li.textContent);
}

describe("influence population handling (jsdom)", () => {
  it("applies influence adjustments when determining split population gain", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding } = hooks;
    state.buildDice = [
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.buildChoice = { code: "F", source: "die1", popGain: 3 };
    state.influenceAdjustments = { X2: { delta: 2 } };
    state.influenceTarget = "X2";
    state.influence = { earned: 2, spent: 0, pending: 0 };
    placeBuilding(0, 0, "F");
    expect(state.pendingPopulation?.remaining).toBe(5);
  });
});

describe("Unrest tally on turn completion (jsdom)", () => {
  it("tallies Unrest for Influence spent when a build (not a Roll Dice click) completes the turn", async () => {
    // Regression test: a build completing the turn goes through
    // autoAdvance()+maybeRollAfterLock(), not autoAdvance() alone - the Unrest tally must run
    // from maybeRollAfterLock() too, or Influence/Advanced-building/Vagrant Unrest gained on
    // an ordinary build turn is silently dropped.
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding } = hooks;
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrestCheckedTurnIndex = null;
    state.unrest = { progress: 0 };
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.locationSelection = [0, 1];
    state.buildDice = [state.dice[2], state.dice[3]];
    state.buildChoice = { code: "F" };
    state.influenceAdjustments = { X2: { delta: 1 } };
    state.influenceTarget = "X2";
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.rollAvailable = false;

    placeBuilding(0, 0, "F");

    expect(state.unrestCheckedTurnIndex).toBe(1);
    expect(state.unrest.progress).toBe(1);
    expect(latestLogs().some((m) => m.includes("Unrest +1"))).toBe(true);
  });

  it("tallies Unrest for Influence spent via the real adjustDieWithInfluence() flow", async () => {
    // Uses adjustDieWithInfluence() (what the +/- buttons actually call) instead of writing
    // state.influenceAdjustments directly, so it also exercises influenceSelectionKey - if
    // updateDiceAssignments() spuriously decided the selection "changed" it would clear the
    // adjustment before the tally ever saw it.
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding, adjustDieWithInfluence } = hooks;
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrestCheckedTurnIndex = null;
    state.unrest = { progress: 0 };
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.locationSelection = [0, 1];
    state.buildDice = [state.dice[2], state.dice[3]];
    state.buildChoice = { code: "F" };
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.rollAvailable = false;

    adjustDieWithInfluence(3, 1);
    expect(state.influenceAdjustments?.X2?.delta).toBe(1);

    placeBuilding(0, 0, "F");

    expect(state.unrestCheckedTurnIndex).toBe(1);
    expect(state.unrest.progress).toBe(1);
    expect(latestLogs().some((m) => m.includes("Unrest +1"))).toBe(true);
  });

  it("tallies Unrest for Influence spent when the build also grants population", async () => {
    // Same as above, but through beginPopulationPlacement()'s deferred completion path
    // (source: "die1" grants population, so the turn only finishes once population is
    // placed via onPopulationNodeClick, not immediately in placeBuilding()).
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding, onPopulationNodeClick } = hooks;
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrestCheckedTurnIndex = null;
    state.unrest = { progress: 0 };
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.locationSelection = [0, 1];
    state.buildDice = [state.dice[2], state.dice[3]];
    state.buildChoice = { code: "F", source: "die1" };
    state.influenceAdjustments = { X2: { delta: 1 } };
    state.influenceTarget = "X2";
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.rollAvailable = false;

    placeBuilding(0, 0, "F");

    expect(state.pendingPopulation?.remaining).toBeGreaterThan(0);
    expect(state.unrestCheckedTurnIndex).toBe(null);

    onPopulationNodeClick(0, 0);
    if (state.pendingPopulation?.remaining > 0) {
      // Spot capacity may split the placement across more than one node.
      onPopulationNodeClick(0, 1);
    }
    expect(state.pendingPopulation).toBeNull();

    expect(state.unrestCheckedTurnIndex).toBe(1);
    expect(state.unrest.progress).toBe(1);
    expect(latestLogs().some((m) => m.includes("Unrest +1"))).toBe(true);
  });

  it("lets the player resolve a Barricade triggered by a build and completes the turn afterward", async () => {
    // Regression test for the fix above: since the tally (and any Barricade it raises) now
    // runs from maybeRollAfterLock() before diceLocked/pendingNextRoll get cleared, resolving
    // the Barricade must still actually finish the turn transition afterward.
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding, onPopulationNodeClick } = hooks;
    state.unrestTracking = true;
    state.turnIndex = 1;
    state.unrestCheckedTurnIndex = null;
    state.unrest = { progress: 3 };
    state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.locationSelection = [0, 1];
    state.buildDice = [state.dice[2], state.dice[3]];
    state.buildChoice = { code: "F" };
    state.influenceAdjustments = { X2: { delta: 1 } };
    state.influenceTarget = "X2";
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.rollAvailable = false;

    placeBuilding(0, 0, "F");

    expect(state.unrest.progress).toBe(0);
    expect(state.pendingBarricade?.active).toBe(true);
    expect(state.diceLocked).toBe(true);

    onPopulationNodeClick(0, 0);

    expect(state.pendingBarricade).toBeNull();
    expect(state.barricadedNodes[0][0]).toBe(true);
    expect(state.diceLocked).toBe(false);
    expect(state.pendingNextRoll).toBe(false);
  });
});

describe("Unrest tally across a real multi-turn sequence (jsdom)", () => {
  it("tallies Unrest for Influence spent on a later turn after an earlier plain turn", async () => {
    await setupApp({
      enableHooks: true,
      numbered: [1, 2, 1, 4],
      x: [2, 3, 2, 3],
    });
    const hooks = window.__rfTestHooks;
    const { state, placeBuilding, adjustDieWithInfluence } = hooks;
    state.unrestTracking = true;
    state.unrest = { progress: 0 };
    state.board = createEmptyBoard();
    state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    state.barricadedNodes = Array.from({ length: 4 }, () => Array(4).fill(false));

    clickRoll();
    await flushMicrotasks();
    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    placeBuilding(0, 0, "F");
    await flushMicrotasks();
    expect(state.unrest.progress).toBe(0);

    clickRoll();
    await flushMicrotasks();
    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    state.influence = { earned: 1, spent: 0, pending: 0 };
    const buildDieIdx = [2, 3].find((idx) => typeof state.dice[idx]?.resolved === "number");
    adjustDieWithInfluence(buildDieIdx, 1);
    await flushMicrotasks();
    expect(Object.keys(state.influenceAdjustments || {}).length).toBeGreaterThan(0);
    placeBuilding(1, 0, "F");
    await flushMicrotasks();

    expect(state.unrest.progress).toBe(1);
    expect(latestLogs().some((m) => m.includes("Unrest +1"))).toBe(true);
  });
});

describe("activation prompts (jsdom)", () => {
  it("shows population-selection prompt then remaining pips when a node is selected", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.activationMode = true;
    hooks.state.board = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
    hooks.state.board[0][0].building = "W";
    hooks.state.populationAvailable = Array.from({ length: 4 }, () => Array(4).fill(0));
    hooks.state.populationAvailable[0][0] = 3;
    hooks.state.workerAllocations = Array.from({ length: 5 }, () => Array(5).fill(0));
    hooks.state.rollAvailable = false;
    hooks.state.bannerOverride = null;
    hooks.state.activationSelection = { pop: null, building: null };
    const initialMsg = hooks.actionMessage(hooks.state, null, hooks.TURN_PHASE.ACTIVATION);
    expect(initialMsg.toLowerCase()).toContain("select a population square");
    hooks.state.activationSelection.pop = [0, 0];
    const selectedMsg = hooks.actionMessage(hooks.state, null, hooks.TURN_PHASE.ACTIVATION);
    expect(selectedMsg.toLowerCase()).toContain("3");
    expect(selectedMsg.toLowerCase()).toContain("1 worker");
  });
});

describe("score rank banner (jsdom)", () => {
  it("summarizes the final score with a rank label", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.activationComplete = true;
    hooks.state.finalScore = 91;
    const msg = hooks.actionMessage(hooks.state, null, hooks.TURN_PHASE.ACTIVATION_DONE);
    expect(msg).toContain("Final score 91");
    expect(msg).toContain("Legendary");
    expect(msg).toContain("echo through the ages");
  });
});

describe("blocked build flow (jsdom)", () => {
  it("logs and advances when no valid buildings are available for the split", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "B1", face: 7, resolved: 7 },
      { label: "B2", face: 7, resolved: 7 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.board = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
    );
    hooks.state.board[0][0].building = "T";
    hooks.updateDiceAssignments();
    await flushMicrotasks();
    expect(hooks.state.forceForfeit).toBe(true);
    const msg = hooks.actionMessage();
    expect(msg.toLowerCase()).toContain("forfeit");
    expect(hooks.state.diceLocked).toBe(true);
  });
});

describe("dice selection UI (jsdom)", () => {
  it("clears build dice assignment when fewer than two location dice are selected", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "N3", face: 3, resolved: 3 },
      { label: "N4", face: 4, resolved: 4 },
    ];
    hooks.state.rollAvailable = false;
    hooks.state.activeTurn = true;
    hooks.state.board = createEmptyBoard();
    hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    hooks.state.locationSelection = [];
    hooks.state.forceForfeit = false;

    hooks.updateDiceAssignments();
    await flushMicrotasks();

    const buildPreviewDice = () => document.querySelectorAll("#buildDicePreview .die-badge:not(.die-placeholder)");

    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    expect(document.querySelectorAll(".die-badge.build-assigned").length).toBe(2);
    expect(buildPreviewDice().length).toBe(2);

    clickDie(0);
    await flushMicrotasks();
    expect(hooks.state.locationSelection.length).toBe(1);
    expect(document.querySelectorAll(".die-badge.build-assigned").length).toBe(0);
    expect(buildPreviewDice().length).toBe(0);
    expect(document.querySelectorAll("#buildDicePreview .die-placeholder").length).toBe(2);
    expect(document.querySelectorAll("#locDicePreview .die-badge:not(.die-placeholder)").length).toBe(1);
    expect(document.querySelectorAll("#locDicePreview .die-placeholder").length).toBe(1);
  });
});

describe("pestilence UI flow (jsdom)", () => {
  it("advances after forfeiting during pestilence", async () => {
    await setupApp({
      numbered: [3, 4, 1, 2, 1, 1],
      x: ["X", "X", 2, 5, 1, 1],
    });
    clickRoll();
    const turnHint = document.getElementById("turnHint");
    expect(turnHint.textContent).toContain("Double X");
    const targetCell = document.querySelector('.cell[data-row="0"][data-col="0"]');
    expect(targetCell).toBeTruthy();
    targetCell.click();
    await flushMicrotasks();

    clickRoll();
    await flushMicrotasks();

    const logs = latestLogs();
    expect(logs.some((m) => m.includes("Forfeited row 1, col 1"))).toBe(true);
    expect(logs.some((m) => /Rolled W1:1, W2:2/i.test(m))).toBe(true);
    expect(document.getElementById("turnHint").textContent).not.toContain("Double X");
  });

  it("clears dice lock and enables next roll after pestilence forfeit", async () => {
    await setupApp({ enableHooks: true, numbered: [3, 3, 1, 1], x: ["X", "X", 2, 2] });
    const hooks = window.__rfTestHooks;
    clickRoll();
    const targetCell = document.querySelector('.cell[data-row="0"][data-col="0"]');
    expect(targetCell).toBeTruthy();
    targetCell.click();
    await flushMicrotasks();
    expect(hooks.state.pestilence).toBe(false);
    expect(hooks.state.forceForfeit).toBe(false);
    expect(hooks.state.diceLocked).toBe(false);
    expect(hooks.state.rollAvailable).toBe(true);
  });
});

describe("windrose handling (jsdom)", () => {
  it("locks windrose into the location pair and keeps it out of build dice", async () => {
    await setupApp({
      numbered: [{ face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] }, 4, 2, 2],
      x: [3, 3, 1, 1],
    });
    clickRoll();
    await flushMicrotasks();

    const windroseBadge = document.querySelector('.die-badge[data-idx="0"]');
    expect(windroseBadge.classList.contains("dice-locked")).toBe(true);
    clickDie(0);
    await flushMicrotasks();
    const logsAfterClick = latestLogs();
    expect(logsAfterClick.some((m) => m.includes("Windrose dice must stay in the location pair"))).toBe(true);

    clickDie(1);
    await flushMicrotasks();
    const locBadges = document.querySelectorAll("#locDicePreview .die-badge");
    expect(locBadges.length).toBe(2);
    const buildForced = document.querySelector("#buildDicePreview .dice-locked");
    expect(buildForced).toBeFalsy();
  });
});

describe("pestilence windrose reroll (jsdom)", () => {
  it("rerolls when pestilence shows two windroses and uses the next roll", async () => {
    await setupApp({
      numbered: [
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        2,
        3,
      ],
      x: ["X", "X", "X", "X"],
    });
    clickRoll();
    let logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("double windrose rolled"))).toBe(true);
    expect(document.querySelectorAll("#locDicePreview .die-badge:not(.die-placeholder)").length).toBe(0);
    expect(document.querySelectorAll("#buildDicePreview .die-badge:not(.die-placeholder)").length).toBe(0);
    clickRoll();
    logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("windrose") && m.toLowerCase().includes("reroll"))).toBe(true);
    expect(document.getElementById("turnHint").textContent).toContain("Double X");
    expect(logs.some((m) => m.includes("Rolled W1:2") && m.includes("W2:3"))).toBe(true);
  });

  it("rerolls double windrose even without pestilence", async () => {
    await setupApp({
      numbered: [
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        2,
        3,
      ],
      x: [1, 2, 3, 4],
    });
    clickRoll();
    clickRoll();
    const logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("double windrose rolled"))).toBe(true);
  });
});
