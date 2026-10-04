// Rolling Fiefdoms — player-like autoplay driver & interactive session controller.
// Works on BOTH touch (phone/tablet) and mouse (desktop) layouts — detects which to use at
// runtime, so one driver covers all breakpoints.
//
// Requires window.__rfTestHooks (enabled by setting window.__RF_ENABLE_TEST_HOOKS__ = true
// or by visiting with ?autoplay in the URL). Reads state via __rfTestHooks.state (read-only)
// and advances the game using ONLY real DOM element.click() calls (never calling action hooks
// directly), exercising the UI exactly like a player would.

export function isElementVisible(el) {
  if (!el) return false;
  if (el.offsetParent !== null) return true;
  if (typeof window !== "undefined" && window.navigator?.userAgent?.includes("jsdom")) {
    return el.style.display !== "none" && el.style.visibility !== "hidden" && !el.hidden;
  }
  return false;
}

// The only INTERACTIVE die badges live in #diceView; `#locDicePreview`/`#buildDicePreview` (the
// read-only "Pair & Build" preview panel — see AGENTS.md) render their own non-interactive
// `.die-badge` duplicates with no click handlers. Unscoped `.die-badge` queries can match those
// inert copies first and silently no-op the click, so every die-badge lookup must be scoped to
// `#diceView`.
const DIE_BADGE_SELECTOR = "#diceView .die-badge";

export async function tryAlternateLocationPair(h) {
  // Called when the building phase reports "No valid plots for that pair; choose a different
  // location pair." (optionally also offering to spend Influence, handled separately by the
  // caller). Deselects the current pair and cycles through the other 2-of-4 die combinations
  // until one produces a valid building phase, or all are exhausted.
  //
  // IMPORTANT: if every combo is invalid (the whole roll is a dead end), we must leave the game
  // back in "building" phase with 2 dice selected — the ORIGINAL pair — rather than fully
  // deselected. The advisory forfeit-via-empty-plot click (handled by the caller) only works
  // while locationSelection has length 2 (onCellClick's early "select two dice first" guard
  // blocks the click otherwise), so leaving dice deselected here would strand the caller.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const originalPair = (h.state.locationSelection || []).map(String);

  function deselectCurrentPair() {
    return (async () => {
      let tries = 0;
      while (h.currentTurnPhase() !== "splitting" && tries < 5) {
        const el = Array.from(document.querySelectorAll(DIE_BADGE_SELECTOR)).find(
          (d) => isElementVisible(d) && d.className.includes("location-selected")
        );
        if (!el) return false;
        el.click();
        await wait(50);
        tries++;
      }
      return h.currentTurnPhase() === "splitting";
    })();
  }

  function selectPair(a, b) {
    return (async () => {
      const da = Array.from(document.querySelectorAll(`${DIE_BADGE_SELECTOR}[data-idx="${a}"]`)).find(isElementVisible);
      const db = Array.from(document.querySelectorAll(`${DIE_BADGE_SELECTOR}[data-idx="${b}"]`)).find(isElementVisible);
      if (!da || !db) return false;
      da.click();
      await wait(50);
      db.click();
      await wait(50);
      return true;
    })();
  }

  if (!(await deselectCurrentPair())) return false;
  const combos = [
    ["0", "1"],
    ["0", "2"],
    ["0", "3"],
    ["1", "2"],
    ["1", "3"],
    ["2", "3"],
  ];
  for (const [a, b] of combos) {
    if (!(await selectPair(a, b))) continue;
    if (h.currentTurnPhase() === "building" && !/no valid/i.test(h.actionMessage())) return true;
    await deselectCurrentPair();
  }

  // Every combo was invalid: restore the original pair so the caller sees "building" phase with
  // the forfeit-eligible advisory message again, instead of being stuck in "splitting".
  if (originalPair.length === 2) {
    await selectPair(originalPair[0], originalPair[1]);
  }
  return false;
}

export function isTouchMode() {
  const visiblePicker = Array.from(document.querySelectorAll(".building-pick")).some(isElementVisible);
  return visiblePicker || window.matchMedia("(pointer: coarse)").matches;
}

export function buildingPickerVisible() {
  return Array.from(document.querySelectorAll(".building-pick")).some(isElementVisible);
}

// Tracks population nodes (by "r,c") already proven to have no reachable building needing a
// worker during the current activation phase, so the activation case below cycles to a
// different node instead of reselecting the same dead end forever. Cleared whenever a worker is
// successfully assigned (availability changed) or a new autoplay session starts.
export const exhaustedActivationPopNodes = new Set();

// Rotation cursor for the "no valid pairs, try influence" fallback (see the "building" case
// below): remembers the last die index we applied -1 to, so repeated stuck cycles rotate through
// ALL eligible dice instead of hammering the same one. Reset on session start/progress.
export let lastInfluenceDieIdx = -1;
export function resetInfluenceRotation() {
  lastInfluenceDieIdx = -1;
}

export function popNodeKey(el) {
  return `${el.dataset.nodeRow},${el.dataset.nodeCol}`;
}

export async function autoplayStep(h) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function clickFirst(selector) {
    const els = Array.from(document.querySelectorAll(selector));
    const el = els.find((e) => isElementVisible(e) && !e.disabled);
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  function clickEmptyPlot() {
    const cells = Array.from(document.querySelectorAll(".cell.terrain"));
    const empty = cells.find(
      (c) => isElementVisible(c) && !c.textContent.trim() && !c.className.includes("forfeited")
    );
    if (empty) {
      empty.click();
      return true;
    }
    return false;
  }

  function confirmBtnVisible() {
    const b = document.getElementById("confirmPlotBtn");
    return !!(b && isElementVisible(b));
  }

  const s = h.state;
  const phase = h.currentTurnPhase();

  // A pending plot/population placement always takes priority: commit it before anything else
  // — but ONLY if the confirm button is actually visible (desktop commits on the plot click
  // itself and never shows this button).
  if ((s.pendingPlot || s.pendingPopulation) && confirmBtnVisible() && clickFirst("#confirmPlotBtn")) {
    return "confirm:" + phase;
  }

  switch (phase) {
    case "awaiting-roll":
      if (clickFirst('[data-target="rollBtn"]')) return "roll-inline";
      if (clickFirst("#rollBtn")) return "roll";
      return null;

    case "splitting": {
      const needed = 2 - (s.locationSelection ? s.locationSelection.length : 0);
      if (needed <= 0) return null;
      const unlocked = Array.from(document.querySelectorAll(`${DIE_BADGE_SELECTOR}:not(.dice-locked)`)).filter(
        isElementVisible
      );
      const already = new Set((s.locationSelection || []).map(String));
      const target = unlocked.find((e) => !already.has(e.dataset.idx)) || unlocked[0];
      if (target) {
        target.click();
        return "die-pick:" + target.dataset.idx;
      }
      return null;
    }

    case "building": {
      if (buildingPickerVisible()) {
        const hasSelected = document.querySelector(".building-pick.selected, .building-pick[aria-pressed='true']");
        if (!hasSelected && clickFirst(".building-pick")) return "building-pick";
      } else {
        const alreadySelected = document.querySelector("#buildingsOverlay .building-hit.selected");
        if (!alreadySelected && clickFirst("#buildingsOverlay .building-hit.available")) return "building-hit";
      }
      if (clickFirst(".cell.highlight")) return "cell-highlight-build";
      if (/no valid/i.test(h.actionMessage())) {
        if (await tryAlternateLocationPair(h)) return "alt-location-pair";
        if (/forfeit/i.test(h.actionMessage()) && clickEmptyPlot()) return "empty-plot-forfeit-fallback";
        if (/influence/i.test(h.actionMessage())) {
          // Always targeting the first `.influence-target-btn` (and only ever decrementing)
          // repeatedly adjusts the SAME die the same way forever if that single -1 doesn't open
          // up a valid pair — a real dead end when dice repeat/duplicate values and most of the
          // board is already built. Rotate through the other eligible dice instead, so a stuck
          // roll (e.g. 4/1/1/2 with all 4 resulting cell-pairs occupied) actually explores the
          // other candidates before giving up.
          const targets = Array.from(document.querySelectorAll(`${DIE_BADGE_SELECTOR} .influence-target-btn`)).filter(
            isElementVisible
          );
          if (targets.length) {
            const dieIdx = (btn) => Number(btn.closest(".die-badge")?.dataset.idx ?? -1);
            const next =
              targets.find((b) => dieIdx(b) > lastInfluenceDieIdx) ||
              targets.slice().sort((a, b) => dieIdx(a) - dieIdx(b))[0];
            next.click();
            await wait(50);
            const minus = Array.from(document.querySelectorAll("button")).find(
              (b) => (b.textContent.trim() === "−" || b.textContent.trim() === "-") && isElementVisible(b)
            );
            if (minus) {
              minus.click();
              lastInfluenceDieIdx = dieIdx(next);
              return "influence-adjust:" + lastInfluenceDieIdx;
            }
          }
        }
      }
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-build";
      if (clickEmptyPlot()) return "empty-plot-forfeit-fallback";
      return null;
    }

    case "center-building": {
      // Social Contract's forced center-plot choice: first pick Townhall ("T") or the Guild
      // category ("G") from the buildings overlay (or its narrow-screen `.building-pick`
      // mirror); choosing Guild then re-prompts with the actual guild types in the guild
      // overlay. Neither sub-step is handled by the generic "building" case above (this is a
      // distinct phase, not TURN_PHASE.BUILDING), so it needs its own handling.
      if (buildingPickerVisible()) {
        if (clickFirst(".building-pick:not(.selected)")) return "center-building-pick";
      } else {
        if (clickFirst("#buildingsOverlay .building-hit.available:not(.selected)")) return "center-building-hit";
        if (clickFirst("#guildsOverlay .guild-hit.available:not(.selected)")) return "center-building-guild-hit";
      }
      return null;
    }

    case "barricade": {
      // Embers of Revolt's forced Barricade placement on an empty, unbarricaded population
      // square. Unrelated board cells can still carry a stale `.cell.highlight` class at this
      // point, so the generic `default` case's cell-first fallback clicks those instead of the
      // population node and never progresses — this phase must only target population nodes.
      if (clickFirst(".population-node.highlight")) return "barricade-pop";
      return null;
    }

    case "population": {
      if (clickFirst(".population-node.highlight")) return "population-node";
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-population";
      return null;
    }

    case "forfeit":
    case "pestilence": {
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-forfeit";
      if (clickFirst(".cell.highlight")) return "cell-highlight-forfeit";
      if (clickEmptyPlot()) return "empty-plot-forfeit";
      return null;
    }

    case "activation": {
      // A population node may be selected but have no reachable building that still needs a
      // worker (e.g. its only adjacent buildings are already fully staffed or forfeited) — the
      // banner text doesn't distinguish this from "pick a building", so clicking the same
      // dead-end node forever would spin without progress. Track nodes already proven dead-end
      // (`exhaustedActivationPopNodes`) and cycle to a different highlighted node instead.
      const popSelected = document.querySelector(".population-node.selected-pop");
      // Clicking a building cell only does something once a population square is selected
      // (otherwise the game just shows a hint and no-ops) — so don't attempt it first.
      if (popSelected && clickFirst(".cell.highlight")) {
        exhaustedActivationPopNodes.clear();
        return "activation-cell";
      }
      if (popSelected) {
        exhaustedActivationPopNodes.add(popNodeKey(popSelected));
      }
      const nextPopNode = Array.from(document.querySelectorAll(".population-node.highlight"))
        .filter(isElementVisible)
        .find((n) => !n.classList.contains("selected-pop") && !exhaustedActivationPopNodes.has(popNodeKey(n)));
      if (nextPopNode) {
        nextPopNode.click();
        return "activation-pop-switch";
      }
      if (clickFirst("#finishActivation")) return "finish-activation";
      if (clickFirst('[data-target="finishActivation"]')) return "finish-activation-inline";
      return null;
    }

    case "activation-complete": {
      if (clickFirst("#finishActivation")) return "finish-activation-2";
      if (clickFirst('[data-target="finishActivation"]')) return "finish-activation-inline-2";
      return null;
    }

    default:
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-default";
      if (clickFirst(".cell.highlight")) return "cell-default";
      if (clickFirst(".population-node.highlight")) return "pop-default";
      return null;
  }
}

// A monotonic progress fingerprint of real game advancement — deliberately excludes
// transient UI state (phase, locationSelection, pendingPlot, banner text) which can legitimately
// cycle (e.g. autoplay trying 2-of-4 die combos, or opening/closing the influence stepper)
// without the game actually being stuck. Only used to detect genuine stalls.
export function progressKey(h) {
  const s = h.state || {};
  const board = s.board || [];
  let built = 0;
  let forfeited = 0;
  board.forEach((row) =>
    (row || []).forEach((cell) => {
      if (cell?.building) built++;
      if (cell?.forfeited) forfeited++;
    })
  );
  const totalPop = (s.populationNodes || []).flat().reduce((a, b) => a + (b || 0), 0);
  const totalWorkers = (s.workerAllocations || []).flat().reduce((a, b) => a + (b || 0), 0);
  const influenceSpent = (s.influence?.spent || 0) + (s.influence?.pending || 0);
  const activationDone = s.activationComplete ? 1 : 0;
  return [s.turnIndex || 0, built, forfeited, totalPop, totalWorkers, influenceSpent, activationDone].join("|");
}

let activeSession = null;

export function stopAutoplay() {
  if (activeSession) {
    activeSession.stop();
    activeSession = null;
  }
}

export function startAutoplaySession(options = {}) {
  stopAutoplay();
  exhaustedActivationPopNodes.clear();
  resetInfluenceRotation();

  const h = options.h || (typeof window !== "undefined" && window.__rfTestHooks);
  if (!h) {
    throw new Error("startAutoplaySession requires window.__rfTestHooks (set window.__RF_ENABLE_TEST_HOOKS__ = true)");
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let stepDelay = options.stepDelay ?? 350;
  let safety = options.maxSteps ?? 1000;
  let repeatGuard = 0;
  let lastAction = null;
  const trace = [];
  const STALL_STEP_LIMIT = 60;
  const STALL_TIME_LIMIT_MS = 20000;
  let lastProgressKey = null;
  let lastProgressAt = Date.now();
  let stepsSinceProgress = 0;
  let isPaused = options.paused ?? false;
  let isStopped = false;
  let singleStepRequested = false;

  const session = {
    get isPaused() { return isPaused; },
    get isStopped() { return isStopped; },
    get trace() { return trace; },
    get stepDelay() { return stepDelay; },
    setSpeed(ms) {
      stepDelay = Math.max(10, Number(ms) || 350);
    },
    pause() {
      isPaused = true;
      if (options.onPause) options.onPause();
    },
    resume() {
      isPaused = false;
      if (options.onResume) options.onResume();
    },
    step() {
      if (isPaused) {
        singleStepRequested = true;
      }
    },
    stop() {
      isStopped = true;
      if (activeSession === session) activeSession = null;
      if (options.onStop) options.onStop({ stopReason: "user-stopped", trace });
    },
  };

  activeSession = session;

  const runLoop = async () => {
    let stopReason = "exhausted";

    while (safety-- > 0 && !isStopped) {
      if (isPaused) {
        if (singleStepRequested) {
          singleStepRequested = false;
        } else {
          await wait(100);
          continue;
        }
      }

      if (h.state.finalScore !== undefined && h.state.finalScore !== null) {
        stopReason = "final-score";
        if (options.onStep) options.onStep("final-score", { stopReason, finalScore: h.state.finalScore });

        if (options.loop && !isStopped) {
          await wait(1500);
          if (isStopped) break;
          if (typeof h.newGame === "function") {
            h.newGame();
          } else {
            const playAgainBtn = Array.from(document.querySelectorAll("button, .btn")).find(
              (b) => isElementVisible(b) && /play again/i.test(b.textContent)
            );
            if (playAgainBtn) playAgainBtn.click();
          }
          repeatGuard = 0;
          lastAction = null;
          lastProgressKey = null;
          stepsSinceProgress = 0;
          lastProgressAt = Date.now();
          exhaustedActivationPopNodes.clear();
          resetInfluenceRotation();
          await wait(stepDelay);
          continue;
        }
        break;
      }

      const action = await autoplayStep(h);
      if (!action) {
        stopReason = "stuck";
        break;
      }

      trace.push(action);
      if (options.onStep) {
        options.onStep(action, {
          phase: h.currentTurnPhase(),
          turn: h.state.turn,
          message: typeof h.actionMessage === "function" ? h.actionMessage() : "",
        });
      }

      if (action === lastAction) {
        if (++repeatGuard > 10) {
          stopReason = "loop:" + action;
          break;
        }
      } else {
        repeatGuard = 0;
        lastAction = action;
      }

      // Stall detection: the game must show real progress (a build/forfeit, population placed,
      // influence spent, activation finished, or the turn advancing) within STALL_STEP_LIMIT
      // steps / STALL_TIME_LIMIT_MS, regardless of how much UI-only state (phase, dice
      // selection, pending preview) churns in between.
      const pk = progressKey(h);
      if (pk !== lastProgressKey) {
        lastProgressKey = pk;
        lastProgressAt = Date.now();
        stepsSinceProgress = 0;
        resetInfluenceRotation();
      } else {
        stepsSinceProgress++;
        if (stepsSinceProgress > STALL_STEP_LIMIT || Date.now() - lastProgressAt > STALL_TIME_LIMIT_MS) {
          const diag = {
            phase: h.currentTurnPhase(),
            message: typeof h.actionMessage === "function" ? h.actionMessage() : "",
            lastActions: trace.slice(-10),
          };
          console.warn(
            `[autoplay] stuck: ${diag.phase} — ${diag.message} (last actions: ${diag.lastActions.join(", ")})`
          );
          if (options.onStuck) options.onStuck(diag);
          stopReason = "stuck-no-progress:" + diag.phase;
          break;
        }
      }

      await wait(stepDelay);
    }

    if (activeSession === session) activeSession = null;
    const result = {
      stopReason,
      trace: trace.slice(-20),
      phase: typeof h.currentTurnPhase === "function" ? h.currentTurnPhase() : null,
      msg: typeof h.actionMessage === "function" ? h.actionMessage() : null,
    };
    if (options.onStop) options.onStop(result);
    return result;
  };

  session.promise = runLoop();
  return session;
}

export function initAutoplay(options = {}) {
  if (typeof document === "undefined") return null;

  let delay = 350;
  const speedParam = options.speed || "normal";
  if (speedParam === "fast") delay = 80;
  else if (speedParam === "instant" || speedParam === "max") delay = 25;
  else if (/^\d+$/.test(speedParam)) delay = Math.max(10, parseInt(speedParam, 10));

  let loop = !!options.loop;

  let hud = document.getElementById("rfAutoplayHud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "rfAutoplayHud";
    hud.className = "rf-autoplay-hud";
    hud.setAttribute("role", "region");
    hud.setAttribute("aria-label", "Autoplay controls");
    hud.innerHTML = `
      <div class="rf-autoplay-header">
        <span class="rf-autoplay-title">🤖 Autoplay</span>
        <span id="rfAutoplayStatus" class="rf-autoplay-status">Running</span>
        <button id="rfAutoplayClose" class="rf-autoplay-close" type="button" aria-label="Stop autoplay" title="Stop & Dismiss">&times;</button>
      </div>
      <div id="rfAutoplayDetail" class="rf-autoplay-detail">Initializing...</div>
      <div class="rf-autoplay-controls">
        <div class="rf-autoplay-btn-group">
          <button id="rfAutoplayPauseBtn" class="rf-autoplay-btn" type="button">⏸ Pause</button>
          <button id="rfAutoplayStepBtn" class="rf-autoplay-btn" type="button" disabled>⏭ Step</button>
        </div>
        <div class="rf-autoplay-btn-group">
          <button class="rf-autoplay-btn rf-speed-btn" data-speed="350" type="button">1x</button>
          <button class="rf-autoplay-btn rf-speed-btn" data-speed="80" type="button">Fast</button>
          <button class="rf-autoplay-btn rf-speed-btn" data-speed="25" type="button">Max</button>
        </div>
        <label class="rf-autoplay-loop-label">
          <input type="checkbox" id="rfAutoplayLoopToggle" ${loop ? "checked" : ""} /> Loop
        </label>
      </div>
    `;
    document.body.appendChild(hud);
  }

  const statusEl = document.getElementById("rfAutoplayStatus");
  const detailEl = document.getElementById("rfAutoplayDetail");
  const pauseBtn = document.getElementById("rfAutoplayPauseBtn");
  const stepBtn = document.getElementById("rfAutoplayStepBtn");
  const closeBtn = document.getElementById("rfAutoplayClose");
  const loopToggle = document.getElementById("rfAutoplayLoopToggle");
  const speedBtns = Array.from(hud.querySelectorAll(".rf-speed-btn"));

  const updateSpeedButtons = (currentDelay) => {
    speedBtns.forEach((btn) => {
      const s = parseInt(btn.dataset.speed, 10);
      btn.classList.toggle("active", s === currentDelay);
    });
  };
  updateSpeedButtons(delay);

  let session = null;

  const startSession = () => {
    session = startAutoplaySession({
      stepDelay: delay,
      loop,
      onStep: (action, meta) => {
        if (detailEl) detailEl.textContent = `T${meta?.turn ?? "?"} [${meta?.phase ?? ""}] ${action}`;
        if (statusEl) statusEl.textContent = "Running";
      },
      onPause: () => {
        if (pauseBtn) pauseBtn.textContent = "▶ Resume";
        if (stepBtn) stepBtn.disabled = false;
        if (statusEl) statusEl.textContent = "Paused";
      },
      onResume: () => {
        if (pauseBtn) pauseBtn.textContent = "⏸ Pause";
        if (stepBtn) stepBtn.disabled = true;
        if (statusEl) statusEl.textContent = "Running";
      },
      onStuck: (diag) => {
        if (statusEl) statusEl.textContent = "Stuck";
        if (detailEl) {
          detailEl.textContent = `Autoplay stuck: ${diag.phase} — ${diag.message}`;
        }
      },
      onStop: (result) => {
        if (statusEl) statusEl.textContent = `Stopped: ${result.stopReason}`;
        if (detailEl && !/^stuck-no-progress/.test(result.stopReason)) {
          detailEl.textContent = `Final: ${result.phase || "done"}`;
        }
        if (pauseBtn) pauseBtn.disabled = true;
        if (stepBtn) stepBtn.disabled = true;
      },
    });

    if (typeof window !== "undefined") {
      window.rfAutoplay = session;
    }
  };

  pauseBtn.onclick = () => {
    if (!session) return;
    if (session.isPaused) {
      session.resume();
    } else {
      session.pause();
    }
  };

  stepBtn.onclick = () => {
    if (session && session.isPaused) {
      session.step();
    }
  };

  speedBtns.forEach((btn) => {
    btn.onclick = () => {
      delay = parseInt(btn.dataset.speed, 10);
      updateSpeedButtons(delay);
      if (session) session.setSpeed(delay);
    };
  });

  if (loopToggle) {
    loopToggle.onchange = () => {
      loop = loopToggle.checked;
      if (session) session.loop = loop;
    };
  }

  closeBtn.onclick = () => {
    if (session) session.stop();
    hud.remove();
  };

  startSession();
  return session;
}
