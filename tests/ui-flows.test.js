/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

// Shared queues used by the dice mock to produce deterministic rolls.
const numberedQueue = [];
const xQueue = [];

// Records every guideTo() target element so tests can assert which control a
// guided scroll was aimed at, while still exercising the real scroll logic.
const guideToCalls = [];
vi.mock("../app/scroll-guide.js", async () => {
  const actual = await vi.importActual("../app/scroll-guide.js");
  return {
    ...actual,
    guideTo: (el, options) => {
      guideToCalls.push(el);
      return actual.guideTo(el, options);
    },
  };
});

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
  <div class="action-bar" id="actionBar">
    <div id="actionBanner"></div>
    <div class="action-bar-controls">
      <button id="rollBtn"></button>
      <button id="finishActivation"></button>
    </div>
    <div class="action-bar-aux" id="actionBarAux">
      <button id="confirmPlotBtn" style="display: none"></button>
      <button id="cancelPlotBtn" style="display: none"></button>
      <div id="buildingPicker" hidden></div>
    </div>
  </div>
  <div class="panel" id="turnHintPanel">
    <div id="turnHint"></div>
  </div>
  <div id="board"></div>
  <div id="diceView"></div>
  <div id="locDicePreview"></div>
  <div id="buildDicePreview"></div>
  <div id="influenceStepper" hidden>
    <span id="influenceStepperFace"></span>
    <span id="influenceStepperDieLabel"></span>
    <span id="influenceStepperValue"></span>
    <button id="influenceStepperMinus" type="button">-</button>
    <button id="influenceStepperPlus" type="button">+</button>
    <button id="influenceStepperReset" type="button" hidden>reset</button>
  </div>
  <ul id="log"></ul>
  <details id="logDrawer"><span id="logUnreadBadge" class="hidden"></span></details>
  <div id="scoreOverlayBuildings"></div>
  <div id="scoreOverlayGuilds"></div>
  <div id="scoreOverlayReputation"></div>
  <div id="turnTrackOverlay"></div>
  <div id="popHousingOverlay"></div>
  <button id="newGameBtn"></button>
  <button id="fullscreenToggle"></button>
  <span id="turnStatusChip"></span>
  <input id="fiefdomInput" />
  <div id="buildingsOverlay"></div>
  <div id="guildsOverlay"></div>
`;

const challengePickerHtml = `
  <div id="challengePicker" class="modal-overlay" hidden>
    <div class="modal-dialog">
      <select id="challengePickerLocaleSelect"></select>
      <button id="challengeCancelBtn"></button>
      <div id="challengeCards" class="challenge-carousel"></div>
      <button id="challengeConfirmBtn"></button>
    </div>
  </div>
`;

async function flushMicrotasks() {
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.runOnlyPendingTimersAsync();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function stubEnvironment({ withChallengePicker = false } = {}) {
  document.body.innerHTML = baseHtml + (withChallengePicker ? challengePickerHtml : "");
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

async function setupApp({ numbered = [], x = [], debug = false, enableHooks = false, withChallengePicker = false } = {}) {
  vi.resetModules();
  numberedQueue.length = 0;
  xQueue.length = 0;
  stubEnvironment({ withChallengePicker });
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

  it("shows adjusted die face in #diceView after applying influence", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, adjustDieWithInfluence, updateDiceAssignments } = hooks;
    state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    state.locationSelection = [];
    state.influence = { earned: 1, spent: 0, pending: 0 };
    state.rollAvailable = false;

    // Render the dice view
    updateDiceAssignments();
    await flushMicrotasks();

    // Check that die at index 0 shows 2 pips before adjustment
    let badge = document.querySelector('#diceView .die-badge[data-idx="0"]');
    let pipCount = badge.querySelectorAll(".pip-svg").length;
    expect(pipCount).toBe(2);

    // Apply +1 influence to die at index 0
    adjustDieWithInfluence(0, 1);
    await flushMicrotasks();

    // Re-render dice view
    updateDiceAssignments();
    await flushMicrotasks();

    // Check that die at index 0 now shows 3 pips
    badge = document.querySelector('#diceView .die-badge[data-idx="0"]');
    pipCount = badge.querySelectorAll(".pip-svg").length;
    expect(pipCount).toBe(3);
  });
});

describe("Social Contract center-building choices (jsdom)", () => {
  it("only offers the guild subtypes listed in pendingCenterBuilding.choices", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, handleCenterBuildingChoice } = hooks;
    state.pendingCenterBuilding = { active: true, awaitingGuildType: false, choices: ["T", "GF"] };

    handleCenterBuildingChoice("G");

    const availableCodes = Array.from(document.querySelectorAll("#guildsOverlay .guild-hit.available")).map(
      (el) => el.dataset.code,
    );
    expect(availableCodes).toEqual(["GF"]);
  });

  it("mirrors guild-type options in the narrow-screen building picker while awaiting a guild type", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, handleCenterBuildingChoice } = hooks;
    state.pendingCenterBuilding = { active: true, awaitingGuildType: false, choices: ["T", "GF", "GQ"] };

    handleCenterBuildingChoice("G");
    await flushMicrotasks();

    const picker = document.getElementById("buildingPicker");
    expect(picker.hidden).toBe(false);
    const pickerCodes = Array.from(picker.querySelectorAll(".building-pick")).map((el) => el.dataset.code);
    const overlayCodes = Array.from(document.querySelectorAll("#guildsOverlay .guild-hit.available")).map(
      (el) => el.dataset.code,
    );
    expect(pickerCodes.sort()).toEqual(overlayCodes.sort());

    const pickBtn = picker.querySelector('.building-pick[data-code="GF"]');
    expect(pickBtn).toBeTruthy();
    pickBtn.click();
    await flushMicrotasks();

    expect(document.querySelector('#guildsOverlay .guild-hit[data-code="GF"]').classList.contains("selected")).toBe(
      false,
    );
    expect(state.pendingCenterBuilding).toBeNull();
    expect(state.board[2][2]?.building).toBe("G");
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

describe("inline action button in banner (jsdom)", () => {
  it("renders the pre-roll banner with a real inline button targeting #rollBtn", async () => {
    await setupApp({ enableHooks: true });
    const inlineBtn = document.querySelector('#actionBanner .btn-inline-action[data-target="rollBtn"]');
    expect(inlineBtn).toBeTruthy();
    expect(inlineBtn.tagName).toBe("BUTTON");
  });

  it("clicking the inline roll button rolls the dice like #rollBtn", async () => {
    await setupApp({ enableHooks: true, numbered: [1, 2, 3, 4], x: ["X", "X"] });
    const hooks = window.__rfTestHooks;
    expect(Array.isArray(hooks.state.dice) ? hooks.state.dice.length : 0).toBe(0);
    const inlineBtn = document.querySelector('#actionBanner .btn-inline-action[data-target="rollBtn"]');
    expect(inlineBtn).toBeTruthy();
    inlineBtn.click();
    await flushMicrotasks();
    expect(Array.isArray(hooks.state.dice) && hooks.state.dice.length > 0).toBe(true);
  });

  it("disables the inline button when its target real button is disabled", async () => {
    vi.resetModules();
    stubEnvironment();
    const { syncInlineActionButtons } = await import("../app/ui-feedback.js");
    const rollBtn = document.getElementById("rollBtn");
    rollBtn.disabled = true;
    document.getElementById("actionBanner").innerHTML =
      '<button type="button" class="btn-label-inline btn-inline-action" data-target="rollBtn">Roll Dice</button>';
    syncInlineActionButtons();
    const inlineBtn = document.querySelector('#actionBanner .btn-inline-action');
    expect(inlineBtn.disabled).toBe(true);
  });

  it("delegates clicks on the finishActivation inline button to the real control", async () => {
    await setupApp({ enableHooks: true });
    const finishBtn = document.getElementById("finishActivation");
    const onClick = vi.fn();
    finishBtn.onclick = onClick;
    finishBtn.disabled = false;
    document.getElementById("actionBanner").innerHTML =
      '<button type="button" class="btn-label-inline btn-inline-action" data-target="finishActivation">Finish Activation</button>';
    document.querySelector('#actionBanner .btn-inline-action').click();
    expect(onClick).toHaveBeenCalled();
  });
});

describe("fitActionBanner (jsdom)", () => {
  const mockHeights = (banner, scrollHeight, clientHeight) => {
    Object.defineProperty(banner, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(banner, "clientHeight", { value: clientHeight, configurable: true });
  };

  it("adds is-dense when content overflows the slot", async () => {
    vi.resetModules();
    stubEnvironment();
    const { fitActionBanner } = await import("../app/ui-feedback.js");
    const banner = document.getElementById("actionBanner");
    mockHeights(banner, 75, 48);
    fitActionBanner();
    expect(banner.classList.contains("is-dense")).toBe(true);
  });

  it("removes is-dense when overflow is within the threshold", async () => {
    vi.resetModules();
    stubEnvironment();
    const { fitActionBanner } = await import("../app/ui-feedback.js");
    const banner = document.getElementById("actionBanner");
    banner.classList.add("is-dense");
    mockHeights(banner, 51, 48);
    fitActionBanner();
    expect(banner.classList.contains("is-dense")).toBe(false);
  });

  it("never densifies the single-line (nowrap) short-landscape banner", async () => {
    vi.resetModules();
    stubEnvironment();
    const { fitActionBanner } = await import("../app/ui-feedback.js");
    const banner = document.getElementById("actionBanner");
    banner.classList.add("is-dense");
    banner.style.whiteSpace = "nowrap";
    mockHeights(banner, 75, 22);
    fitActionBanner();
    expect(banner.classList.contains("is-dense")).toBe(false);
    banner.style.whiteSpace = "";
  });

  it("measures with the touch-area ::after hidden (is-measuring) and cleans up", async () => {
    vi.resetModules();
    stubEnvironment();
    const { fitActionBanner } = await import("../app/ui-feedback.js");
    const banner = document.getElementById("actionBanner");
    let measuringDuringRead = false;
    Object.defineProperty(banner, "scrollHeight", {
      configurable: true,
      get: () => {
        measuringDuringRead = banner.classList.contains("is-measuring");
        return 48;
      },
    });
    Object.defineProperty(banner, "clientHeight", { value: 48, configurable: true });
    fitActionBanner();
    expect(measuringDuringRead).toBe(true);
    expect(banner.classList.contains("is-measuring")).toBe(false);
    expect(banner.classList.contains("is-dense")).toBe(false);
  });
});

describe("score rank banner (jsdom)", () => {
  it("summarizes the final score with a rank label", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.activationComplete = true;
    hooks.state.finalScore = 91;
    const msg = hooks.actionMessage(hooks.state, null, hooks.TURN_PHASE.ACTIVATION_DONE);
    expect(msg).toContain("Reputation 91");
    expect(msg).toContain("Legendary");
    expect(msg).toContain("echo through the ages");
  });

  it("marks the action banner as final once activation is complete, and not otherwise", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const banner = document.getElementById("actionBanner");

    hooks.updateActionBanner();
    expect(banner.classList.contains("is-final")).toBe(false);

    hooks.state.activationComplete = true;
    hooks.state.finalScore = 42;
    hooks.updateActionBanner();
    expect(banner.classList.contains("is-final")).toBe(true);
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

describe("plot confirm step (jsdom)", () => {
  async function setupBuildReady(hooks) {
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "B1", face: 7, resolved: 7 },
      { label: "B2", face: 7, resolved: 7 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.board = createEmptyBoard();
    hooks.updateDiceAssignments();
    await flushMicrotasks();
    hooks.state.buildChoice = { code: "F" };
  }

  it("does not place a building until Confirm is tapped (coarse pointer)", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.board[0][1].building).toBeFalsy();
      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 1, kind: "build", code: "F" });
      const refreshedCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      expect(refreshedCell.classList.contains("cell-pending")).toBe(true);
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");

      hooks.confirmPendingPlot();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(hooks.state.board[0][1].building).toBe("F");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("restores a pre-existing banner override after the confirm prompt is cancelled", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      hooks.state.bannerOverride = "CUSTOM OVERRIDE";

      document.querySelector('.cell[data-row="0"][data-col="1"]').click();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toBeTruthy();
      // The confirm prompt took over the banner...
      expect(hooks.state.bannerOverride).not.toBe("CUSTOM OVERRIDE");

      hooks.cancelPendingPlot();
      await flushMicrotasks();

      // ...but cancelling restores the override that was showing before it.
      expect(hooks.state.bannerOverride).toBe("CUSTOM OVERRIDE");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("hides stale Confirm/Change buttons when a reset path (new roll/new game) clears pendingPlot directly", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      document.querySelector('.cell[data-row="0"][data-col="1"]').click();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toBeTruthy();
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");
      expect(document.getElementById("cancelPlotBtn").style.display).not.toBe("none");

      // newGame() -> resetState() -> resetTurnState() clears state.pendingPlot
      // directly, without going through hidePlotConfirmControls().
      hooks.newGame();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(document.getElementById("confirmPlotBtn").style.display).toBe("none");
      expect(document.getElementById("cancelPlotBtn").style.display).toBe("none");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("Change plot clears the pending preview without building", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      document.querySelector('.cell[data-row="0"][data-col="1"]').click();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toBeTruthy();

      hooks.cancelPendingPlot();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(hooks.state.board[0][1].building).toBeFalsy();
      expect(document.getElementById("confirmPlotBtn").style.display).toBe("none");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("tapping another valid plot moves the pending plot", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      document.querySelector('.cell[data-row="0"][data-col="1"]').click();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 1 });

      document.querySelector('.cell[data-row="1"][data-col="0"]').click();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toMatchObject({ r: 1, c: 0 });

      hooks.confirmPendingPlot();
      await flushMicrotasks();
      expect(hooks.state.board[0][1].building).toBeFalsy();
      expect(hooks.state.board[1][0].building).toBe("F");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("confirming the pending plot results in the same board state as a direct click", async () => {
    await setupApp({ enableHooks: true });
    const hooksCoarse = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    await setupBuildReady(hooksCoarse);
    document.querySelector('.cell[data-row="0"][data-col="1"]').click();
    await flushMicrotasks();
    hooksCoarse.confirmPendingPlot();
    await flushMicrotasks();
    const coarseBuilding = hooksCoarse.state.board[0][1].building;
    setConfirmStepOverride(null);

    await setupApp({ enableHooks: true });
    const hooksMouse = window.__rfTestHooks;
    setConfirmStepOverride(false);
    try {
      await setupBuildReady(hooksMouse);
      document.querySelector('.cell[data-row="0"][data-col="1"]').click();
      await flushMicrotasks();
      expect(hooksMouse.state.board[0][1].building).toBe(coarseBuilding);
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("forfeit requires Confirm on coarse pointers", async () => {
    await setupApp({ enableHooks: true, numbered: [3, 3, 1, 1], x: ["X", "X", 2, 2] });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      clickRoll();
      await flushMicrotasks();
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="0"]');

      targetCell.click();
      await flushMicrotasks();
      expect(hooks.state.board[0][0].forfeited).toBeFalsy();
      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 0, kind: "forfeit" });

      hooks.confirmPendingPlot();
      await flushMicrotasks();
      expect(hooks.state.board[0][0].forfeited).toBe(true);
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("population placement requires Confirm on coarse pointers", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { placeBuilding, onPopulationNodeClick } = hooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.buildDice = [hooks.state.dice[2], hooks.state.dice[3]];
    hooks.state.buildChoice = { code: "F", source: "die1" };
    hooks.state.rollAvailable = false;
    placeBuilding(0, 0, "F");
    expect(hooks.state.pendingPopulation?.remaining).toBeGreaterThan(0);

    setConfirmStepOverride(true);
    try {
      onPopulationNodeClick(0, 0);
      await flushMicrotasks();
      expect(hooks.state.pendingPopulation?.remaining).toBeGreaterThan(0);
      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 0, kind: "population" });

      hooks.confirmPendingPlot();
      await flushMicrotasks();
      expect(hooks.state.pendingPlot).toBeNull();
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("influence stepper is hidden without influence available", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 3, resolved: 3 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 0, spent: 0, pending: 0 };
    hooks.updateDiceAssignments();
    await flushMicrotasks();

    const stepper = document.getElementById("influenceStepper");
    expect(stepper.hidden).toBe(true);
    expect(document.querySelectorAll("#diceView .influence-target-btn").length).toBe(0);
  });

  it("stepper adjusts the die chosen with its ± badge", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 3, resolved: 3 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 5, resolved: 5 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 2, spent: 0, pending: 0 };
    hooks.updateDiceAssignments(true);
    await flushMicrotasks();

    document.querySelector('#diceView .die-badge[data-idx="0"] .influence-target-btn').click();
    await flushMicrotasks();
    const stepper = document.getElementById("influenceStepper");
    expect(stepper.hidden).toBe(false);
    expect(document.getElementById("influenceStepperValue").textContent).toContain("3");

    document.getElementById("influenceStepperPlus").click();
    await flushMicrotasks();
    expect(hooks.state.influenceAdjustments?.N1?.delta).toBe(1);

    document.getElementById("influenceStepperMinus").click();
    await flushMicrotasks();
    expect(hooks.state.influenceAdjustments?.N1?.delta ?? 0).toBe(0);
  });

  it("moves the influence target ring when another die's ± badge is tapped", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 2, spent: 0, pending: 0 };
    hooks.updateDiceAssignments(true);
    await flushMicrotasks();

    document.querySelector('#diceView .die-badge[data-idx="2"] .influence-target-btn').click();
    await flushMicrotasks();
    expect(document.querySelector('#diceView .die-badge[data-idx="2"]').classList.contains("influence-target")).toBe(true);

    document.querySelector('#diceView .die-badge[data-idx="3"] .influence-target-btn').click();
    await flushMicrotasks();
    expect(document.querySelector('#diceView .die-badge[data-idx="3"]').classList.contains("influence-target")).toBe(true);
    expect(document.querySelector('#diceView .die-badge[data-idx="2"]').classList.contains("influence-target")).toBe(false);
    expect(document.getElementById("influenceStepperFace").classList.contains("die-special")).toBe(true);
  });

  it("offers influence only once both location dice are chosen", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [0];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 2, spent: 0, pending: 0 };
    hooks.updateDiceAssignments(true);
    await flushMicrotasks();
    expect(document.getElementById("influenceStepper").hidden).toBe(true);
    expect(document.querySelectorAll("#diceView .influence-target-btn").length).toBe(0);

    hooks.state.locationSelection = [0, 1];
    hooks.updateDiceAssignments(true);
    await flushMicrotasks();
    expect(document.querySelectorAll("#diceView .influence-target-btn").length).toBeGreaterThan(0);
  });

  it("± badges target the stepper without changing location selection; only one control set exists", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 2, spent: 0, pending: 0 };
    hooks.updateDiceAssignments();
    await flushMicrotasks();

    // No die chosen yet (multiple eligible dice): stepper stays hidden until a badge is tapped.
    const stepper = document.getElementById("influenceStepper");
    expect(stepper.hidden).toBe(true);

    expect(document.querySelectorAll("#diceView .die-influence-controls").length).toBe(0);
    expect(document.querySelectorAll(".influence-btn").length).toBe(0);
    expect(document.querySelectorAll("#locDicePreview .influence-target-btn").length).toBe(0);
    expect(document.querySelectorAll("#buildDicePreview .influence-target-btn").length).toBe(0);

    // Every eligible die (including X dice with a resolved value, per the
    // "influence can apply to any numeric die" rule) shows a titled ± badge.
    document.querySelectorAll("#diceView .influence-target-btn").forEach((btn) => {
      expect(btn.title.length).toBeGreaterThan(0);
    });

    const badgeN2 = document.querySelector('#diceView .die-badge[data-idx="1"] .influence-target-btn');
    expect(badgeN2).toBeTruthy();
    const selectionBefore = hooks.state.locationSelection.slice();
    badgeN2.click();
    await flushMicrotasks();
    expect(hooks.state.locationSelection).toEqual(selectionBefore);
    expect(stepper.hidden).toBe(false);
    expect(document.getElementById("influenceStepperValue").textContent).toContain("4");
    expect(document.getElementById("influenceStepperDieLabel").textContent).toBe("N2");

    // Re-rendering the dice (as any subsequent influence/selection change does)
    // gives the targeted die a distinct ring and its badge an active state.
    hooks.updateDiceAssignments();
    await flushMicrotasks();
    expect(document.querySelector('#diceView .die-badge[data-idx="1"]').classList.contains("influence-target")).toBe(
      true,
    );
    expect(
      document
        .querySelector('#diceView .die-badge[data-idx="1"] .influence-target-btn')
        .classList.contains("active"),
    ).toBe(true);

    // Tapping another die's badge moves the stepper target without touching selection.
    const badgeN1 = document.querySelector('#diceView .die-badge[data-idx="0"] .influence-target-btn');
    badgeN1.click();
    await flushMicrotasks();
    expect(hooks.state.locationSelection).toEqual(selectionBefore);
    expect(document.getElementById("influenceStepperValue").textContent).toContain("2");
    hooks.updateDiceAssignments();
    await flushMicrotasks();
    expect(document.querySelector('#diceView .die-badge[data-idx="0"]').classList.contains("influence-target")).toBe(
      true,
    );
    expect(document.querySelector('#diceView .die-badge[data-idx="1"]').classList.contains("influence-target")).toBe(
      false,
    );

    document.getElementById("influenceStepperPlus").click();
    await flushMicrotasks();
    expect(hooks.state.influenceAdjustments?.N1?.delta).toBeGreaterThan(0);

    const resetBtn = document.getElementById("influenceStepperReset");
    expect(resetBtn.hidden).toBe(false);
    resetBtn.click();
    await flushMicrotasks();
    expect(hooks.state.influenceAdjustments?.N1?.delta ?? 0).toBe(0);
  });

  it("keeps the influence stepper/badges available during a forced forfeit when an adjustment already exists", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    hooks.state.dice = [
      { label: "N1", face: 2, resolved: 2 },
      { label: "N2", face: 4, resolved: 4 },
      { label: "X1", face: 2, resolved: 2 },
      { label: "X2", face: 3, resolved: 3 },
    ];
    hooks.state.locationSelection = [];
    hooks.state.rollAvailable = false;
    hooks.state.influence = { earned: 2, spent: 0, pending: 0 };
    hooks.state.forceForfeit = true;
    hooks.state.forceForfeitAdvisory = false;
    hooks.state.influenceAdjustments = { N1: { delta: 1 } };
    hooks.state.influenceTarget = "N1";
    hooks.updateDiceAssignments();
    await flushMicrotasks();

    const stepper = document.getElementById("influenceStepper");
    expect(stepper.hidden).toBe(false);
    expect(document.querySelectorAll("#diceView .influence-target-btn").length).toBeGreaterThan(0);

    const resetBtn = document.getElementById("influenceStepperReset");
    expect(resetBtn.hidden).toBe(false);
    resetBtn.click();
    await flushMicrotasks();
    expect(hooks.state.influenceAdjustments?.N1?.delta ?? 0).toBe(0);
  });

  it("rolling again clears a stale pending-plot confirm prompt", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeTruthy();
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");

      hooks.state.rollAvailable = true;
      hooks.rollDice();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(document.getElementById("confirmPlotBtn").style.display).toBe("none");
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("rolling again removes the stale pending-plot preview from the board", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeTruthy();
      expect(document.querySelector(".cell.cell-pending")).toBeTruthy();
      expect(document.querySelector(".building-preview")).toBeTruthy();

      hooks.state.rollAvailable = true;
      hooks.rollDice();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(document.querySelector(".cell.cell-pending")).toBeNull();
      expect(document.querySelector(".building-preview")).toBeNull();
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("a dice-selection change removes the stale pending-plot preview from the board", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      await setupBuildReady(hooks);
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeTruthy();
      expect(document.querySelector(".cell.cell-pending")).toBeTruthy();
      expect(document.querySelector(".building-preview")).toBeTruthy();

      // Re-running updateDiceAssignments (as onDieClick does on a dice/pair change)
      // should clear the pending plot and its stale DOM preview.
      hooks.updateDiceAssignments();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeNull();
      expect(document.querySelector(".cell.cell-pending")).toBeNull();
      expect(document.querySelector(".building-preview")).toBeNull();
    } finally {
      setConfirmStepOverride(null);
    }
  });

  it("guided scroll targets population node, not buildings, after Confirm on a build that grants population (narrow viewport)", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      // Stub matchMedia to simulate a narrow phone viewport (390x844)
      const narrowMatchMedia = (query) => {
        const isNarrow = query.includes("max-width: 1100px");
        return {
          matches: isNarrow,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
      };
      window.matchMedia = narrowMatchMedia;

      // Track scrollTo calls
      const scrollToCalls = [];
      const originalScrollTo = window.scrollTo;
      window.scrollTo = vi.fn((...args) => {
        scrollToCalls.push(args);
      });

      try {
        // Set up state for a building with population grant. Doubled location
        // dice (1,1) make (row 0, col 0) a valid plot for onCellClick's pair match.
        hooks.state.dice = [
          { label: "N1", face: 1, resolved: 1 },
          { label: "N2", face: 1, resolved: 1 },
          { label: "X1", face: 2, resolved: 2 },
          { label: "X2", face: 3, resolved: 3 },
        ];
        hooks.state.locationSelection = [0, 1];
        hooks.state.buildDice = [hooks.state.dice[2], hooks.state.dice[3]];
        hooks.state.buildChoice = { code: "F", source: "die1" };
        hooks.state.rollAvailable = false;
        hooks.state.board = createEmptyBoard();
        hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
        hooks.updateDiceAssignments();
        await flushMicrotasks();

        // Go through the real touch confirm path: tap the plot (sets a pending
        // build, does NOT place it yet), then Confirm.
        const targetCell = document.querySelector('.cell[data-row="0"][data-col="0"]');
        targetCell.click();
        await flushMicrotasks();

        expect(hooks.state.board[0][0].building).toBeFalsy();
        expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 0, kind: "build", code: "F" });

        guideToCalls.length = 0;
        scrollToCalls.length = 0;

        hooks.confirmPendingPlot();
        await flushMicrotasks();

        // The building is now placed and should have granted pending population.
        expect(hooks.state.board[0][0].building).toBe("F");
        expect(hooks.state.pendingPopulation?.remaining).toBeGreaterThan(0);

        // The population guide is deferred via requestAnimationFrame; flush it.
        if (vi.isFakeTimers()) {
          await vi.runOnlyPendingTimersAsync();
        } else {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        await flushMicrotasks();

        const populationNode = document.querySelector(".population-node.highlight");
        expect(populationNode).toBeTruthy();

        // The last guided-scroll target must be the population node, not the
        // buildings picker/sheet, and it must have actually triggered a scroll.
        expect(guideToCalls.length).toBeGreaterThan(0);
        const lastTarget = guideToCalls[guideToCalls.length - 1];
        expect(lastTarget).toBeTruthy();
        expect(lastTarget.classList.contains("population-node")).toBe(true);
        expect(lastTarget.closest(".building-picker, #buildingsOverlay, #guildsOverlay")).toBeNull();
        expect(scrollToCalls.length).toBeGreaterThan(0);
      } finally {
        window.scrollTo = originalScrollTo;
        window.matchMedia = undefined;
      }
    } finally {
      setConfirmStepOverride(null);
    }
  });
});

describe("narrow-screen building picker (jsdom)", () => {
  function stubNarrowMatchMedia() {
    const narrowMatchMedia = (query) => ({
      matches: query.includes("max-width: 1100px"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    window.matchMedia = narrowMatchMedia;
  }

  async function setupPairedForBuild(hooks) {
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "B1", face: 1, resolved: 1 },
      { label: "B2", face: 2, resolved: 2 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.board = createEmptyBoard();
    hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    hooks.updateDiceAssignments();
    await flushMicrotasks();
  }

  it("shows exactly the available options after pairing, mirroring the sheet overlay", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    stubNarrowMatchMedia();
    await setupPairedForBuild(hooks);

    const overlayCodes = Array.from(document.querySelectorAll("#buildingsOverlay .building-hit.available")).map(
      (el) => el.dataset.code,
    );
    const pickerCodes = Array.from(document.querySelectorAll("#buildingPicker .building-pick")).map(
      (el) => el.dataset.code,
    );
    expect(overlayCodes.length).toBeGreaterThan(0);
    expect(pickerCodes.sort()).toEqual(overlayCodes.sort());
    expect(document.getElementById("buildingPicker").hidden).toBe(false);
  });

  it("clicking a picker button selects the same building as the overlay", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    stubNarrowMatchMedia();
    await setupPairedForBuild(hooks);

    const pickBtn = document.querySelector('#buildingPicker .building-pick[data-code="F"]');
    expect(pickBtn).toBeTruthy();
    pickBtn.click();
    await flushMicrotasks();

    expect(hooks.state.buildChoice?.code).toBe("F");
    const overlayHit = document.querySelector('#buildingsOverlay .building-hit[data-code="F"]');
    expect(overlayHit.classList.contains("selected")).toBe(true);
    const refreshedPickBtn = document.querySelector('#buildingPicker .building-pick[data-code="F"]');
    expect(refreshedPickBtn.classList.contains("selected")).toBe(true);
  });

  it("shows guild type picker buttons when the Guild building is chosen", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    stubNarrowMatchMedia();
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "B1", face: 5, resolved: 5 },
      { label: "B2", face: 5, resolved: 5 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.board = createEmptyBoard();
    hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    hooks.updateDiceAssignments();
    await flushMicrotasks();

    const guildPick = document.querySelector('#buildingPicker .building-pick[data-code="G"]');
    expect(guildPick).toBeTruthy();
    guildPick.click();
    await flushMicrotasks();

    const guildTypeBtn = document.querySelector('#buildingPicker .building-pick[data-code="GF"]');
    expect(guildTypeBtn).toBeTruthy();
    guildTypeBtn.click();
    await flushMicrotasks();

    expect(hooks.state.selectedGuildType).toBe("GF");
    const guildHit = document.querySelector('#guildsOverlay .guild-hit[data-code="GF"]');
    expect(guildHit.classList.contains("selected")).toBe(true);
  });

  it("selecting a guild type updates the picker button and advances the banner to the plot prompt", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    stubNarrowMatchMedia();
    hooks.state.dice = [
      { label: "N1", face: 1, resolved: 1 },
      { label: "N2", face: 2, resolved: 2 },
      { label: "B1", face: 5, resolved: 5 },
      { label: "B2", face: 5, resolved: 5 },
    ];
    hooks.state.locationSelection = [0, 1];
    hooks.state.rollAvailable = false;
    hooks.state.board = createEmptyBoard();
    hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
    hooks.updateDiceAssignments();
    await flushMicrotasks();

    const guildPick = document.querySelector('#buildingPicker .building-pick[data-code="G"]');
    guildPick.click();
    await flushMicrotasks();

    const bannerBefore = document.getElementById("actionBanner").textContent;

    // Click the guild-type hitbox directly (not the picker delegate) to exercise
    // the overlay's own click handler.
    const guildHit = document.querySelector('#guildsOverlay .guild-hit[data-code="GF"]');
    guildHit.click();
    await flushMicrotasks();

    expect(hooks.state.selectedGuildType).toBe("GF");
    expect(guildHit.classList.contains("selected")).toBe(true);

    const pickerBtn = document.querySelector('#buildingPicker .building-pick[data-code="GF"]');
    expect(pickerBtn).toBeTruthy();
    expect(pickerBtn.classList.contains("selected")).toBe(true);
    expect(pickerBtn.getAttribute("aria-pressed")).toBe("true");

    const bannerAfter = document.getElementById("actionBanner").textContent;
    expect(bannerAfter).not.toBe(bannerBefore);
  });

  it("hides the picker once the building has been placed", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    stubNarrowMatchMedia();
    await setupPairedForBuild(hooks);
    hooks.state.buildChoice = { code: "F", source: "die2" };

    hooks.placeBuilding(0, 1, "F");
    await flushMicrotasks();

    expect(hooks.state.board[0][1].building).toBe("F");
    expect(document.getElementById("buildingPicker").hidden).toBe(true);
    expect(document.querySelectorAll("#buildingPicker .building-pick").length).toBe(0);
  });

  it("changing guild type clears pending plot", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      // Pair dice so the Guild building is a real, available option, then
      // select it through the real `.building-hit` overlay click handler.
      hooks.state.dice = [
        { label: "N1", face: 1, resolved: 1 },
        { label: "N2", face: 2, resolved: 2 },
        { label: "B1", face: 5, resolved: 5 },
        { label: "B2", face: 5, resolved: 5 },
      ];
      hooks.state.locationSelection = [0, 1];
      hooks.state.rollAvailable = false;
      hooks.state.board = createEmptyBoard();
      hooks.state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
      hooks.updateDiceAssignments();
      await flushMicrotasks();

      const buildingHit = document.querySelector('#buildingsOverlay .building-hit[data-code="G"]');
      expect(buildingHit).toBeTruthy();
      buildingHit.click();
      await flushMicrotasks();

      // Choose a guild type through the real rendered `.guild-hit` picker.
      const guildHitGF = document.querySelector('#guildsOverlay .guild-hit[data-code="GF"]');
      expect(guildHitGF).toBeTruthy();
      guildHitGF.click();
      await flushMicrotasks();
      expect(hooks.state.selectedGuildType).toBe("GF");

      // Create a pending plot via the real touch-confirm path.
      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      expect(targetCell).toBeTruthy();
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toBeTruthy();
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");

      // Click a different real rendered `.guild-hit` to change the guild type.
      const guildHitGQ = document.querySelector('#guildsOverlay .guild-hit[data-code="GQ"]');
      expect(guildHitGQ).toBeTruthy();
      guildHitGQ.click();
      await flushMicrotasks();

      expect(hooks.state.selectedGuildType).toBe("GQ");
      expect(hooks.state.pendingPlot).toBeNull();
      expect(document.getElementById("confirmPlotBtn").style.display).toBe("none");
    } finally {
      setConfirmStepOverride(null);
    }
  });
});

describe("challenge picker scroll cue (jsdom)", () => {
  it("marks challenge cards as scrollable once the picker is revealed", async () => {
    await setupApp({ enableHooks: true, withChallengePicker: true });

    // The picker is already open from init(); re-open it (as clicking "New
    // game" would) now that the cards can be stubbed as scrollable, since
    // openChallengePicker() re-renders the cards into fresh DOM nodes.
    document.getElementById("newGameBtn")?.click();

    // Stub overflow metrics as if the card content is taller than its box,
    // the way it would be once the modal is actually visible (jsdom always
    // reports 0 for both, which the fix's requestAnimationFrame re-measure
    // after reveal is meant to pick up). Must happen before the fix's own
    // rAF callback fires.
    const cards = Array.from(document.querySelectorAll("#challengeCards .challenge-card"));
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => {
      Object.defineProperty(card, "scrollHeight", { value: 400, configurable: true });
      Object.defineProperty(card, "clientHeight", { value: 200, configurable: true });
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flushMicrotasks();

    expect(document.getElementById("challengePicker").hidden).toBe(false);
    cards.forEach((card) => {
      expect(card.classList.contains("is-scrollable")).toBe(true);
      expect(card.classList.contains("is-at-end")).toBe(false);
    });
  });
});

describe("challenge picker carousel selection on small screens (jsdom)", () => {
  it("selects the card nearest the carousel center once scroll settles, only on small screens", async () => {
    await setupApp({ enableHooks: true, withChallengePicker: true });
    document.getElementById("newGameBtn")?.click();

    const carousel = document.getElementById("challengeCards");
    const cards = Array.from(carousel.querySelectorAll(".challenge-card"));
    expect(cards.length).toBeGreaterThan(1);

    // The "normal game" card (idx 0) is selected by default; stub geometry so
    // the *second* card (idx 1) is the one centered in the carousel, to prove
    // the scroll-settle logic actually moves the selection off the default.
    Object.defineProperty(carousel, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 300, top: 0, height: 100, right: 300, bottom: 100 }),
      configurable: true,
    });
    cards.forEach((card, idx) => {
      Object.defineProperty(card, "getBoundingClientRect", {
        value: () => ({
          left: idx === 1 ? 100 : 400,
          width: 100,
          top: 0,
          height: 100,
          right: idx === 1 ? 200 : 500,
          bottom: 100,
        }),
        configurable: true,
      });
    });

    // Simulate a small (<=600px) screen where carousel arrows are hidden.
    window.matchMedia = (query) => ({
      matches: query.includes("max-width: 600px"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    carousel.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushMicrotasks();

    expect(cards[1].classList.contains("selected")).toBe(true);
    expect(cards[0].classList.contains("selected")).toBe(false);
  });

  it("does not auto-select on larger screens", async () => {
    await setupApp({ enableHooks: true, withChallengePicker: true });
    document.getElementById("newGameBtn")?.click();

    const carousel = document.getElementById("challengeCards");
    const cards = Array.from(carousel.querySelectorAll(".challenge-card"));
    expect(cards.length).toBeGreaterThan(1);

    window.matchMedia = (query) => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    // The "normal game" card (id === null, the default pickedChallengeId) is
    // selected by default on render; capture that baseline before scrolling.
    const selectedBefore = cards.map((card) => card.classList.contains("selected"));

    carousel.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushMicrotasks();

    const selectedAfter = cards.map((card) => card.classList.contains("selected"));
    expect(selectedAfter).toEqual(selectedBefore);
  });

  it("on small screens tapping a peeking card selects it, and tapping the selected card starts the game", async () => {
    await setupApp({ enableHooks: true, withChallengePicker: true });
    document.getElementById("newGameBtn")?.click();
    window.matchMedia = (query) => ({
      matches: query.includes("max-width: 600px"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const picker = document.getElementById("challengePicker");
    const cards = Array.from(document.querySelectorAll("#challengeCards .challenge-card:not(.challenge-card-disabled)"));
    expect(picker.hidden).toBe(false);

    cards[1].click();
    expect(cards[1].classList.contains("selected")).toBe(true);
    expect(picker.hidden).toBe(false);

    cards[1].click();
    expect(picker.hidden).toBe(true);
  });

  it("on larger screens tapping the selected card does not start the game", async () => {
    await setupApp({ enableHooks: true, withChallengePicker: true });
    document.getElementById("newGameBtn")?.click();
    window.matchMedia = () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });

    const picker = document.getElementById("challengePicker");
    const cards = Array.from(document.querySelectorAll("#challengeCards .challenge-card:not(.challenge-card-disabled)"));
    cards[1].click();
    cards[1].click();
    expect(cards[1].classList.contains("selected")).toBe(true);
    expect(picker.hidden).toBe(false);
  });
});

describe("unread log badge (jsdom)", () => {
  it("resets the unread log counter and badge when starting a new game", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;

    hooks.log("First test log entry");
    hooks.log("Second test log entry");
    await flushMicrotasks();

    const badge = document.getElementById("logUnreadBadge");
    expect(badge.classList.contains("hidden")).toBe(false);
    expect(Number(badge.textContent)).toBeGreaterThan(0);

    const countBeforeNewGame = Number(badge.textContent);
    hooks.newGame();
    await flushMicrotasks();

    // newGame() resets the counter (rather than leaving the stale count from the
    // previous game) and then logs its own "game started" message, so the badge
    // should reflect only that fresh entry, not the old unread count.
    const countAfterNewGame = Number(badge.textContent);
    expect(countAfterNewGame).toBeLessThan(countBeforeNewGame);
    expect(countAfterNewGame).toBeGreaterThan(0);
  });
});

describe("locale-only re-render preserves pending plot (jsdom)", () => {
  it("updateDiceAssignments(true) (locale switch) does not cancel a pending touch confirmation", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { setConfirmStepOverride } = await import("../app/confirm-step.js");
    setConfirmStepOverride(true);
    try {
      hooks.state.dice = [
        { label: "N1", face: 1, resolved: 1 },
        { label: "N2", face: 2, resolved: 2 },
        { label: "B1", face: 7, resolved: 7 },
        { label: "B2", face: 7, resolved: 7 },
      ];
      hooks.state.locationSelection = [0, 1];
      hooks.state.rollAvailable = false;
      hooks.state.board = createEmptyBoard();
      hooks.updateDiceAssignments();
      await flushMicrotasks();
      hooks.state.buildChoice = { code: "F" };

      const targetCell = document.querySelector('.cell[data-row="0"][data-col="1"]');
      targetCell.click();
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 1, kind: "build", code: "F" });
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");

      // Simulate a locale switch, which re-renders via updateDiceAssignments(true)
      // without mutating game state.
      hooks.updateDiceAssignments(true);
      await flushMicrotasks();

      expect(hooks.state.pendingPlot).toMatchObject({ r: 0, c: 1, kind: "build", code: "F" });
      expect(document.getElementById("confirmPlotBtn").style.display).not.toBe("none");
    } finally {
      setConfirmStepOverride(null);
    }
  });
});

describe("flashHint / updateActionBanner interplay (jsdom)", () => {
  it("a stale flashHint restore timer does not overwrite a newer banner rendered in the meantime", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      document.body.innerHTML = '<div id="actionBanner"></div>';
      const uiFeedback = await import("../app/ui-feedback.js");
      const banner = document.getElementById("actionBanner");

      banner.dataset.msg = "Original prompt";
      banner.textContent = "Original prompt";

      uiFeedback.flashHint("Transient hint");
      expect(banner.textContent).toBe("Transient hint");

      // Before the 3s restore timer fires, a real banner update happens (e.g.
      // the player advances to a new step). Simulate updateActionBanner()
      // update (e.g. the player advanced a step) - this should clear the
      // stale flash-restore timer so it can't fire later and clobber this.
      const state = { activeTurn: true };
      uiFeedback.updateActionBanner(state, undefined, {});
      const rendered = banner.textContent;
      expect(rendered).not.toBe("Transient hint");
      expect(rendered).not.toBe("Original prompt");

      await vi.runOnlyPendingTimersAsync();

      // The now-stale flash timer must not have fired and restored the old
      // "Original prompt" text over the freshly rendered banner.
      expect(banner.textContent).toBe(rendered);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("syncActionBarState (jsdom) - JS-managed action-bar/aux classes", () => {
  it("keeps the aux drawer closed before the roll, with the pre-roll class set", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { syncActionBarState } = hooks;
    const actionBar = document.getElementById("actionBar");
    const actionBarAux = document.getElementById("actionBarAux");
    const actionBanner = document.getElementById("actionBanner");

    actionBanner.innerHTML = '<button class="btn-inline-action" data-target="rollBtn">Roll Dice</button>';
    document.getElementById("diceView").innerHTML = "";

    syncActionBarState();

    expect(actionBar.classList.contains("is-pre-roll")).toBe(true);
    expect(actionBar.classList.contains("has-inline-roll")).toBe(true);
    expect(actionBarAux.classList.contains("is-open")).toBe(false);
    expect(actionBarAux.classList.contains("has-confirm")).toBe(false);
  });

  it("opens the drawer (without has-confirm) when only the building picker is visible on a compact layout", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { syncActionBarState } = hooks;
    window.matchMedia = () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const picker = document.getElementById("buildingPicker");
    picker.hidden = false;

    syncActionBarState();

    const actionBarAux = document.getElementById("actionBarAux");
    expect(actionBarAux.classList.contains("is-open")).toBe(true);
    expect(actionBarAux.classList.contains("has-confirm")).toBe(false);
  });

  it("does not open the drawer for the building picker on a non-compact (desktop) layout", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { syncActionBarState } = hooks;
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const picker = document.getElementById("buildingPicker");
    picker.hidden = false;

    syncActionBarState();

    const actionBarAux = document.getElementById("actionBarAux");
    expect(actionBarAux.classList.contains("is-open")).toBe(false);
  });

  it("sets has-confirm (and opens the drawer) once a plot is pending confirm", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state } = hooks;
    state.pendingPlot = { r: 0, c: 0, kind: "build", code: "C" };
    // showPlotConfirmControls isn't exposed on the hooks object; drive the
    // same effect directly via the confirm button + syncActionBarState.
    const confirmBtn = document.getElementById("confirmPlotBtn");
    confirmBtn.style.display = "inline-block";
    hooks.syncActionBarState();

    const actionBarAux = document.getElementById("actionBarAux");
    expect(actionBarAux.classList.contains("is-open")).toBe(true);
    expect(actionBarAux.classList.contains("has-confirm")).toBe(true);
  });

  it("closes the drawer again once Confirm is hidden and no other aux content is visible", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const confirmBtn = document.getElementById("confirmPlotBtn");
    confirmBtn.style.display = "none";
    document.getElementById("buildingPicker").hidden = true;
    document.getElementById("influenceStepper").hidden = true;

    hooks.syncActionBarState();

    const actionBarAux = document.getElementById("actionBarAux");
    expect(actionBarAux.classList.contains("is-open")).toBe(false);
    expect(actionBarAux.classList.contains("has-confirm")).toBe(false);
  });

  it("sets has-inline-roll / has-inline-finish from the banner's inline action buttons", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const actionBar = document.getElementById("actionBar");
    const actionBanner = document.getElementById("actionBanner");

    actionBanner.innerHTML =
      '<button class="btn-inline-action" data-target="finishActivation">Finish</button>';
    hooks.syncActionBarState();
    expect(actionBar.classList.contains("has-inline-finish")).toBe(true);
    expect(actionBar.classList.contains("has-inline-roll")).toBe(false);

    actionBanner.innerHTML = '<button class="btn-inline-action" data-target="rollBtn">Roll</button>';
    hooks.syncActionBarState();
    expect(actionBar.classList.contains("has-inline-roll")).toBe(true);
    expect(actionBar.classList.contains("has-inline-finish")).toBe(false);
  });

  it("marks #board as has-pending only while a build/forfeit plot awaits confirm", async () => {
    await setupApp({ enableHooks: true });
    const hooks = window.__rfTestHooks;
    const { state, renderBoard } = hooks;
    state.board = createEmptyBoard();
    state.pendingPlot = { r: 0, c: 0, kind: "build", code: "C" };

    renderBoard();
    expect(document.getElementById("board").classList.contains("has-pending")).toBe(true);

    state.pendingPlot = null;
    renderBoard();
    expect(document.getElementById("board").classList.contains("has-pending")).toBe(false);

    // Pending population placements use a different pending marker
    // (.population-node.cell-pending) and must not dim board highlights.
    state.pendingPlot = { r: 0, c: 0, kind: "population" };
    renderBoard();
    expect(document.getElementById("board").classList.contains("has-pending")).toBe(false);
  });
});
