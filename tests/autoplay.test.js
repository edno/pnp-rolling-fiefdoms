/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autoplayStep,
  startAutoplaySession,
  initAutoplay,
  stopAutoplay,
  progressKey,
  tryAlternateLocationPair,
  exhaustedActivationPopNodes,
  popNodeKey,
} from "../app/autoplay.js";

describe("autoplay module", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__rfTestHooks;
    delete window.rfAutoplay;
    stopAutoplay();
  });

  afterEach(() => {
    stopAutoplay();
    document.body.innerHTML = "";
  });

  it("throws error if __rfTestHooks is missing", () => {
    expect(() => startAutoplaySession()).toThrow(/requires window.__rfTestHooks/);
  });

  it("executes autoplayStep when awaiting roll", async () => {
    const rollBtn = document.createElement("button");
    rollBtn.id = "rollBtn";
    let rolled = false;
    rollBtn.addEventListener("click", () => {
      rolled = true;
    });
    document.body.appendChild(rollBtn);

    const mockHooks = {
      state: { turn: 1 },
      currentTurnPhase: () => "awaiting-roll",
      actionMessage: () => "Press Roll Dice",
    };

    const action = await autoplayStep(mockHooks);
    expect(action).toBe("roll");
    expect(rolled).toBe(true);
  });

  it("creates HUD and controls session in initAutoplay", async () => {
    const rollBtn = document.createElement("button");
    rollBtn.id = "rollBtn";
    document.body.appendChild(rollBtn);

    const mockHooks = {
      state: { turn: 1 },
      currentTurnPhase: () => "awaiting-roll",
      actionMessage: () => "Press Roll",
    };
    window.__rfTestHooks = mockHooks;

    const session = initAutoplay({ speed: "fast", paused: true });
    expect(session).toBeDefined();

    const hud = document.getElementById("rfAutoplayHud");
    expect(hud).not.toBeNull();

    const pauseBtn = document.getElementById("rfAutoplayPauseBtn");
    const stepBtn = document.getElementById("rfAutoplayStepBtn");
    const closeBtn = document.getElementById("rfAutoplayClose");

    expect(pauseBtn).not.toBeNull();
    expect(stepBtn).not.toBeNull();

    // Check pause toggling
    session.pause();
    expect(session.isPaused).toBe(true);

    session.resume();
    expect(session.isPaused).toBe(false);

    // Speed setting
    session.setSpeed(100);
    expect(session.stepDelay).toBe(100);

    // Close HUD
    closeBtn.click();
    expect(document.getElementById("rfAutoplayHud")).toBeNull();
    expect(session.isStopped).toBe(true);
  });

  describe("progressKey (monotonic progress fingerprint)", () => {
    function hooksFor(stateOverrides) {
      return {
        state: {
          turnIndex: 1,
          board: [[{}, {}], [{}, {}]],
          populationNodes: [[0, 0], [0, 0]],
          workerAllocations: [[0, 0], [0, 0]],
          influence: { earned: 0, spent: 0, pending: 0 },
          activationComplete: false,
          ...stateOverrides,
        },
      };
    }

    it("stays the same while only UI-selection-ish fields change", () => {
      const h1 = hooksFor({ locationSelection: [0, 1], pendingPlot: null });
      const h2 = hooksFor({ locationSelection: [2, 3], pendingPlot: { r: 0, c: 0 } });
      // progressKey intentionally ignores locationSelection/pendingPlot/phase/banner text.
      expect(progressKey(h1)).toBe(progressKey(h2));
    });

    it("changes when a building is actually placed", () => {
      const before = hooksFor({});
      const after = hooksFor({ board: [[{ building: "C" }, {}], [{}, {}]] });
      expect(progressKey(before)).not.toBe(progressKey(after));
    });

    it("changes when population, workers, influence spent, turn, or activation move", () => {
      const base = hooksFor({});
      const basePk = progressKey(base);
      expect(progressKey(hooksFor({ turnIndex: 2 }))).not.toBe(basePk);
      expect(progressKey(hooksFor({ populationNodes: [[1, 0], [0, 0]] }))).not.toBe(basePk);
      expect(progressKey(hooksFor({ workerAllocations: [[1, 0], [0, 0]] }))).not.toBe(basePk);
      expect(progressKey(hooksFor({ influence: { earned: 1, spent: 1, pending: 0 } }))).not.toBe(basePk);
      expect(progressKey(hooksFor({ activationComplete: true }))).not.toBe(basePk);
    });
  });

  describe("session stuck/stall detection (real bug: multi-state cycles that never repeat the same action twice in a row)", () => {
    it("stops with stuck-no-progress when progressKey never changes, even though the dice selection keeps oscillating", async () => {
      document.body.innerHTML = `
        <div id="diceView">
          <div class="die-badge" data-idx="0"></div>
          <div class="die-badge" data-idx="1"></div>
        </div>
      `;
      let selected = [];
      const flip = () => {
        selected = selected.length ? [] : ["0"];
      };
      Array.from(document.querySelectorAll(".die-badge")).forEach((b) => {
        Object.defineProperty(b, "offsetParent", { value: {}, configurable: true });
        b.click = vi.fn(flip);
      });
      const h = {
        state: {
          turnIndex: 1,
          board: [[{}, {}], [{}, {}]],
          populationNodes: [[0, 0], [0, 0]],
          workerAllocations: [[0, 0], [0, 0]],
          influence: { earned: 0, spent: 0, pending: 0 },
          activationComplete: false,
          get locationSelection() {
            // Alternates between 0 and 1 selected dice (toggled by the die-badge click handler
            // above) but never reaches 2 — never actually commits to a pair — so the game never
            // advances: turnIndex/board/pop/workers/influence/activationComplete (what
            // progressKey tracks) all stay fixed, even though autoplayStep returns a genuinely
            // different action string ("die-pick:0" / "die-pick:1") each time.
            return selected;
          },
        },
        currentTurnPhase: () => "splitting",
        actionMessage: () => "Select two location dice.",
      };
      const onStop = vi.fn();
      const onStuck = vi.fn();

      const session = startAutoplaySession({
        h,
        stepDelay: 1,
        maxSteps: 5000,
        onStop,
        onStuck,
      });
      await session.promise;

      expect(onStop).toHaveBeenCalled();
      const result = onStop.mock.calls[0][0];
      expect(result.stopReason).toMatch(/^stuck-no-progress/);
      expect(onStuck).toHaveBeenCalled();
    });
  });

  describe("tryAlternateLocationPair restores the original pair when every combo fails", () => {
    it("re-selects the original two dice instead of leaving the game deselected", async () => {
      document.body.innerHTML = `
        <div id="diceView">
          <div class="die-badge" data-idx="0"></div>
          <div class="die-badge" data-idx="1"></div>
          <div class="die-badge" data-idx="2"></div>
          <div class="die-badge" data-idx="3"></div>
        </div>
      `;
      const badges = Array.from(document.querySelectorAll(".die-badge"));
      // Simulate every die-badge click toggling a shared "location-selected" class so
      // deselect/select calls are observable, and the game never reports a valid building phase
      // (every combo is a dead end for this roll).
      badges.forEach((b) => {
        b.click = vi.fn(() => {
          b.classList.toggle("location-selected");
        });
        Object.defineProperty(b, "offsetParent", { value: {}, configurable: true });
      });
      badges[0].classList.add("location-selected");
      badges[1].classList.add("location-selected");

      const h = {
        state: { locationSelection: ["0", "1"] },
        currentTurnPhase: () => "splitting",
        actionMessage: () => "No valid location pairs; spend Influence or click on any empty plot to forfeit it.",
      };

      const result = await tryAlternateLocationPair(h);
      expect(result).toBe(false);
      // The original pair (0 and 1) must end up re-selected (an even number of clicks each)
      // rather than left deselected.
      expect(badges[0].classList.contains("location-selected")).toBe(true);
      expect(badges[1].classList.contains("location-selected")).toBe(true);
    });
  });

  describe("activation: cycling past a population node with no reachable building", () => {
    beforeEach(() => {
      exhaustedActivationPopNodes.clear();
    });

    it("switches to a different highlighted population node instead of re-selecting the dead-end one forever", async () => {
      document.body.innerHTML = `
        <div class="population-node highlight selected-pop" data-node-row="1" data-node-col="2"></div>
        <div class="population-node highlight" data-node-row="0" data-node-col="0"></div>
      `;
      const deadEnd = document.querySelector('[data-node-row="1"][data-node-col="2"]');
      const other = document.querySelector('[data-node-row="0"][data-node-col="0"]');
      Object.defineProperty(deadEnd, "offsetParent", { value: {}, configurable: true });
      Object.defineProperty(other, "offsetParent", { value: {}, configurable: true });
      other.click = vi.fn();

      const h = {
        state: { activationComplete: false },
        currentTurnPhase: () => "activation",
        actionMessage: () => "Activation: population selected (4 remaining). Click a highlighted building to assign 1 worker.",
      };

      const action = await autoplayStep(h);
      expect(action).toBe("activation-pop-switch");
      expect(other.click).toHaveBeenCalled();
      expect(exhaustedActivationPopNodes.has(popNodeKey(deadEnd))).toBe(true);
    });

    it("does not click a building cell before a population node is selected (that click is a no-op in the real app)", async () => {
      document.body.innerHTML = `
        <div class="cell highlight" data-row="0" data-col="0"></div>
        <div class="population-node highlight" data-node-row="0" data-node-col="0"></div>
      `;
      const cell = document.querySelector(".cell.highlight");
      const popNode = document.querySelector(".population-node.highlight");
      Object.defineProperty(cell, "offsetParent", { value: {}, configurable: true });
      Object.defineProperty(popNode, "offsetParent", { value: {}, configurable: true });
      cell.click = vi.fn();
      popNode.click = vi.fn();

      const h = {
        state: { activationComplete: false },
        currentTurnPhase: () => "activation",
        actionMessage: () => "Activation: select a population square to allocate workers.",
      };

      await autoplayStep(h);
      expect(cell.click).not.toHaveBeenCalled();
      expect(popNode.click).toHaveBeenCalled();
    });
  });

  describe("center-building phase (Social Contract forced choice)", () => {
    it("clicks the available building-hit choice", async () => {
      document.body.innerHTML = `
        <div id="buildingsOverlay">
          <div class="building-hit available" data-code="T"></div>
        </div>
        <div id="guildsOverlay"></div>
      `;
      const hit = document.querySelector(".building-hit.available");
      Object.defineProperty(hit, "offsetParent", { value: {}, configurable: true });
      hit.click = vi.fn();

      const h = {
        state: {},
        currentTurnPhase: () => "center-building",
        actionMessage: () => "Choose a building for the center plot: Townhall or Guild.",
      };

      const action = await autoplayStep(h);
      expect(action).toBe("center-building-hit");
      expect(hit.click).toHaveBeenCalled();
    });
  });

  describe("barricade phase (Embers of Revolt forced placement)", () => {
    it("only targets the population node, ignoring a stale .cell.highlight", async () => {
      document.body.innerHTML = `
        <div class="cell highlight" data-row="1" data-col="1"></div>
        <div class="population-node highlight" data-node-row="2" data-node-col="2"></div>
      `;
      const cell = document.querySelector(".cell.highlight");
      const popNode = document.querySelector(".population-node.highlight");
      Object.defineProperty(cell, "offsetParent", { value: {}, configurable: true });
      Object.defineProperty(popNode, "offsetParent", { value: {}, configurable: true });
      cell.click = vi.fn();
      popNode.click = vi.fn();

      const h = {
        state: {},
        currentTurnPhase: () => "barricade",
        actionMessage: () => "Choose an empty Population square to barricade.",
      };

      const action = await autoplayStep(h);
      expect(action).toBe("barricade-pop");
      expect(cell.click).not.toHaveBeenCalled();
      expect(popNode.click).toHaveBeenCalled();
    });
  });
});

describe("autoplay SFX muting (app/app.js integration)", () => {
  const SFX_STORAGE_KEY = "rf-sfx-enabled";
  const baseHtml = `
    <div id="loadingOverlay"></div>
    <div id="sheet"></div>
    <div id="board"></div>
    <div id="diceView"></div>
    <div id="turnHint"></div>
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
    <button id="finishActivation"></button>
    <button id="newGameBtn"></button>
    <button id="confirmPlotBtn" style="display: none"></button>
    <button id="cancelPlotBtn" style="display: none"></button>
    <button id="fullscreenToggle"></button>
    <div id="actionBanner"></div>
    <span id="turnStatusChip"></span>
    <button id="rollBtn"></button>
    <input id="fiefdomInput" />
    <div id="buildingsOverlay"></div>
    <div id="guildsOverlay"></div>
    <div id="buildingPicker" hidden></div>
    <button id="sfxToggle" type="button" aria-pressed="true">
      <img id="sfxToggleIcon" />
      <span id="sfxToggleLabel"></span>
    </button>
  `;

  let playSpy;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = baseHtml;
    document.body.classList.add("loading");
    if (!window.matchMedia) {
      window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    }
    if (window.HTMLMediaElement) {
      playSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
        configurable: true,
        writable: true,
        value: playSpy,
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
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("forces SFX off and leaves the saved preference untouched when ?autoplay is present", async () => {
    window.localStorage.setItem(SFX_STORAGE_KEY, "true");
    const url = new URL("http://localhost/?autoplay=0");
    location = url;

    await import("../app/app.js");
    await Promise.resolve();

    const rollBtn = document.getElementById("rollBtn");
    rollBtn.click();
    await Promise.resolve();

    // No audio playback attempted at all, no matter what the saved preference says.
    expect(playSpy).not.toHaveBeenCalled();
    // The saved preference in localStorage is untouched by autoplay.
    expect(window.localStorage.getItem(SFX_STORAGE_KEY)).toBe("true");

    const sfxToggle = document.getElementById("sfxToggle");
    expect(sfxToggle.disabled).toBe(true);
    expect(sfxToggle.getAttribute("aria-pressed")).toBe("false");

    // Clicking the (disabled) toggle must not flip or persist the preference either.
    sfxToggle.click();
    await Promise.resolve();
    expect(window.localStorage.getItem(SFX_STORAGE_KEY)).toBe("true");
  });

  it("plays SFX normally and honors the saved preference without ?autoplay", async () => {
    window.localStorage.setItem(SFX_STORAGE_KEY, "true");
    const url = new URL("http://localhost/");
    location = url;

    await import("../app/app.js");
    await Promise.resolve();

    const sfxToggle = document.getElementById("sfxToggle");
    expect(sfxToggle.disabled).toBe(false);
    expect(sfxToggle.getAttribute("aria-pressed")).toBe("true");
  });
});
