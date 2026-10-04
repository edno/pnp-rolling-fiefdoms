// Rolling Fiefdoms — generic "player-like" autoplay driver for chrome-devtools-mcp evaluate_script.
// Works on BOTH touch (phone/tablet) and mouse (desktop) layouts — detects which to use at
// runtime, so one driver covers all breakpoints.
//
// Requires window.__RF_ENABLE_TEST_HOOKS__ = true (set via navigate_page initScript) so
// window.__rfTestHooks exists. Reads state via __rfTestHooks.state (read-only) and advances
// the game using ONLY real DOM element.click() calls (never calling action hooks directly),
// so it exercises the UI exactly like a player would.
//
// Usage: paste `autoplayStep` + the driver loop (bottom of this file) into evaluate_script as
// an async () => {...} body. Or call autoplayStep(window.__rfTestHooks) once per step if you
// want to screenshot between individual actions.
//
// Phase handling notes (TURN_PHASE values from app/ui-feedback.js):
//   awaiting-roll   -> click the inline banner button [data-target="rollBtn"] (the real #rollBtn
//                      is hidden at all widths in favor of the inline twin per AGENTS.md).
//   splitting       -> click up to 2 non-locked `.die-badge` elements (dedupe against
//                      state.locationSelection indices; Windrose dice auto-lock as wild).
//   building        -> TOUCH: check `.building-pick.selected` / `[aria-pressed="true"]` first
//                      (clicking an already-selected one toggles it OFF, infinite loop), then
//                      click the first NOT-YET-SELECTED `.building-pick`, then a `.cell.highlight`
//                      to pick a plot, then `#confirmPlotBtn`.
//                      MOUSE/DESKTOP: there is NO `.building-pick` picker UI and NO confirm
//                      step — instead click `#buildingsOverlay .building-hit.available` (an
//                      invisible hit-target layer over the "Buildings" reference panel rows),
//                      then click `.cell.highlight`; the plot click commits immediately.
//                      GOTCHA: a `.building-pick` element exists in the DOM at ALL breakpoints
//                      (just hidden via CSS on desktop) — detecting touch mode by mere
//                      `.building-pick` *existence* is wrong and causes a stuck loop (the
//                      element matches the selector but is non-interactive, so clickFirst()
//                      silently fails and the driver falls through to clicking stray
//                      `.cell.highlight` elements, looping on "Choose a building first").
//                      Always gate on VISIBILITY (`offsetParent !== null`), not existence.
//                      If no `.cell.highlight` exists but the banner says "no valid
//                      pairs/plots", fall back to clicking any EMPTY, NOT-already-forfeited
//                      `.cell.terrain` (forfeit path reuses the building phase's banner in
//                      some cases).
//                      TABLET LANDSCAPE >1100px GOTCHA: at widths like 1180x820 touch,landscape
//                      the app uses the DESKTOP overlay picker even though touch is present and
//                      `matchMedia("(pointer: coarse)")` is true — `isTouchMode()` alone is the
//                      wrong gate for THIS phase. The building phase uses the separate
//                      `buildingPickerVisible()` helper, which checks `.building-pick`
//                      offsetParent directly, instead of the matchMedia-based `isTouchMode()`.
//   population      -> click `.population-node.highlight`, then `#confirmPlotBtn` ONLY if it is
//                      actually visible (touch). On desktop/mouse the node click commits
//                      immediately — there is no confirm step there either.
//   forfeit/pestilence -> click `.cell.highlight` if present, else any empty non-forfeited
//                      `.cell.terrain`, then `#confirmPlotBtn` if visible.
//   activation      -> click a `.population-node.highlight:not(.selected-pop)` to pick a pop
//                      square, then click `.cell.highlight` (adjacent building) to assign a
//                      worker. Some selected population squares have ZERO valid adjacent
//                      buildings (`.cell.highlight` stays empty) — in that case just click
//                      `#finishActivation` (leftover workers are allowed to go unallocated).
//   activation-complete / final score -> click `#finishActivation` again, or `.btn` "Play again".
//
// Location-pair gotcha (both layouts, easy to miss): the two dice used for the location pair
// are NOT fixed to N1/N2 — any 2 of the 4 rolled dice (including the "build" dice X1/X2) can be
// selected during `splitting`. When the chosen pair yields "No valid plots for that pair;
// choose a different location pair." (sometimes also offering "spend Influence"), `tryAlternateLocationPair()`
// below deselects and cycles the other five 2-of-4 combinations before giving up — don't assume
// the first pair is the only option and fall straight to a forfeit-plot fallback.
//
// General gotcha (both layouts): the app appears to guard against clicks fired back-to-back
// with zero elapsed time in a tight synchronous loop (same-tick double clicks on cells/confirm
// buttons silently no-op), so a ~30-40ms setTimeout between steps is required for reliable
// automation.
//
// Confirm-step gotcha (desktop specifically): NEVER unconditionally click `#confirmPlotBtn`
// just because it exists in the DOM — on desktop it exists but stays hidden
// (`offsetParent === null`) because mouse plot/population clicks commit directly. Always check
// visibility before clicking it, otherwise you may click a stale/hidden confirm button from a
// previous phase.
//
// Known gotcha: `window.__rfTestHooks.state` is a plain object property, not a function —
// call `JSON.parse(JSON.stringify(h.state))` if you need a snapshot safe from later mutation.
// `actionMessage` and `currentTurnPhase` ARE functions: `h.actionMessage()`, `h.currentTurnPhase()`.

async function tryAlternateLocationPair(h) {
  // Called when the building phase reports "No valid plots for that pair; choose a different
  // location pair." (optionally also offering to spend Influence, handled separately by the
  // caller). Deselects the current pair and cycles through the other 2-of-4 die combinations
  // until one produces a valid building phase, or all are exhausted.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function deselectCurrentPair() {
    return (async () => {
      let tries = 0;
      while (h.currentTurnPhase() !== "splitting" && tries < 5) {
        const el = Array.from(document.querySelectorAll(".die-badge")).find(
          (d) => d.offsetParent !== null && d.className.includes("location-selected")
        );
        if (!el) return false;
        el.click();
        await wait(50);
        tries++;
      }
      return h.currentTurnPhase() === "splitting";
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
    const da = Array.from(document.querySelectorAll(`.die-badge[data-idx="${a}"]`)).find((e) => e.offsetParent !== null);
    const db = Array.from(document.querySelectorAll(`.die-badge[data-idx="${b}"]`)).find((e) => e.offsetParent !== null);
    if (!da || !db) continue;
    da.click();
    await wait(50);
    db.click();
    await wait(50);
    if (h.currentTurnPhase() === "building" && !/no valid/i.test(h.actionMessage())) return true;
    await deselectCurrentPair();
  }
  return false;
}

// Kept as a helper for ad-hoc checks (see notes above on why the building phase uses
// buildingPickerVisible() instead).
// eslint-disable-next-line no-unused-vars
function isTouchMode() {
  // Gate on VISIBILITY, not existence — a `.building-pick` node exists in the DOM even on
  // desktop (just CSS-hidden). Checking existence alone causes a stuck loop (see note above).
  const visiblePicker = Array.from(document.querySelectorAll(".building-pick")).some(
    (e) => e.offsetParent !== null
  );
  return visiblePicker || window.matchMedia("(pointer: coarse)").matches;
}

function buildingPickerVisible() {
  // GOTCHA (found live, tablet landscape >1100px with touch, e.g. 1180x820 touch,landscape):
  // isTouchMode() above returns true there purely from `matchMedia("(pointer: coarse)")`, but at
  // that width the app actually switches to the DESKTOP-style layout — `.building-pick` is
  // hidden and building selection goes through `#buildingsOverlay .building-hit` instead, same
  // as mouse/desktop. Using the matchMedia-based `isTouchMode()` result to choose the building
  // phase's picker UI is wrong there: it tries `.building-pick` (not visible, no-op), falls
  // through to `.cell.highlight`, and clicks a plot with NO building selected — a no-op that
  // "succeeds" every call and loops forever on "Select a building from the Buildings panel."
  // The building phase must check which control is ACTUALLY visible, independent of
  // isTouchMode()/pointer type.
  return Array.from(document.querySelectorAll(".building-pick")).some((e) => e.offsetParent !== null);
}

// Called from evaluate_script (see the example loop at the bottom), not from app code.
// eslint-disable-next-line no-unused-vars
async function autoplayStep(h) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function clickFirst(selector) {
    const els = Array.from(document.querySelectorAll(selector));
    const el = els.find((e) => e.offsetParent !== null && !e.disabled);
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  function clickEmptyPlot() {
    const cells = Array.from(document.querySelectorAll(".cell.terrain"));
    const empty = cells.find(
      (c) => c.offsetParent !== null && !c.textContent.trim() && !c.className.includes("forfeited")
    );
    if (empty) {
      empty.click();
      return true;
    }
    return false;
  }

  function confirmBtnVisible() {
    const b = document.getElementById("confirmPlotBtn");
    return !!(b && b.offsetParent !== null);
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
      // GOTCHA: "location dice" are NOT fixed to the first two dice (N1/N2) — ANY 2 of the 4
      // dice (including the two "build" dice X1/X2) can be picked as the location pair. If the
      // naive first-two-unlocked pair produces "No valid plots for that pair; choose a
      // different location pair." in the building phase (see that case below), the driver
      // deselects and retries the OTHER three 2-combinations before giving up.
      const needed = 2 - (s.locationSelection ? s.locationSelection.length : 0);
      if (needed <= 0) return null;
      const unlocked = Array.from(document.querySelectorAll(".die-badge:not(.dice-locked)")).filter(
        (e) => e.offsetParent !== null
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
        // Desktop: pick via the invisible hit-target overlay on the Buildings reference panel.
        // GOTCHA: once a building is picked, its `.building-hit` keeps BOTH `.available` and
        // a NEW `.selected` class (other buildings' hits stay `.available` too, since
        // selecting one doesn't remove the others as options) — so re-querying
        // `.building-hit.available` after a pick matches it (or a different available one)
        // again and clicking it re-picks/re-toggles, looping forever instead of advancing to
        // `.cell.highlight`. Must check `.building-hit.selected` first and skip the pick step
        // once one exists.
        const alreadySelected = document.querySelector("#buildingsOverlay .building-hit.selected");
        if (!alreadySelected && clickFirst("#buildingsOverlay .building-hit.available")) return "building-hit";
      }
      if (clickFirst(".cell.highlight")) return "cell-highlight-build";
      if (/no valid/i.test(h.actionMessage())) {
        // Try a different die pair first (deterministic, no side effects if it fails).
        if (await tryAlternateLocationPair(h)) return "alt-location-pair";
        // If the banner explicitly allows forfeiting an empty plot, do that over spending
        // Influence (it's unconditionally available and resolves in one click).
        if (/forfeit/i.test(h.actionMessage()) && clickEmptyPlot()) return "empty-plot-forfeit-fallback";
        // Last resort: open the Influence stepper AND immediately spend one point in the same
        // step — opening it alone (without following through) just leaves the SAME "no valid"
        // banner showing on the next loop iteration and this branch fires again, looping
        // forever instead of progressing.
        if (/influence/i.test(h.actionMessage())) {
          const btn = document.querySelector(".influence-target-btn");
          if (btn) {
            btn.click();
            await wait(50);
            const minus = Array.from(document.querySelectorAll("button")).find(
              (b) => (b.textContent.trim() === "−" || b.textContent.trim() === "-") && b.offsetParent !== null
            );
            if (minus) {
              minus.click();
              return "influence-adjust";
            }
          }
        }
      }
      // GOTCHA (found live): confirmBtnVisible() MUST be checked BEFORE clickEmptyPlot() here.
      // Forfeiting an empty plot in the "no valid pairs" building-phase fallback does NOT
      // reliably set state.pendingPlot (the top-of-function priority check can miss it), so once
      // the forfeit click leaves a pending confirmation, calling clickEmptyPlot() again on the
      // SAME still-empty, still-not-yet-"forfeited"-class cell just toggles it back off
      // (cancels the pending forfeit) instead of confirming it. That produces an infinite
      // oscillation: empty-plot-forfeit-fallback <-> die-pick (loop never trips the simple
      // repeat-guard because the two action strings alternate). Always try to confirm a pending
      // click before attempting a new one.
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-build";
      if (clickEmptyPlot()) return "empty-plot-forfeit-fallback"; // "no valid pairs/plots" case
      return null;
    }

    case "population": {
      if (clickFirst(".population-node.highlight")) return "population-node";
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-population";
      return null;
    }

    case "forfeit":
    case "pestilence": {
      // Same confirm-before-new-click ordering fix as the "building" case above.
      if (confirmBtnVisible() && clickFirst("#confirmPlotBtn")) return "confirm-forfeit";
      if (clickFirst(".cell.highlight")) return "cell-highlight-forfeit";
      if (clickEmptyPlot()) return "empty-plot-forfeit";
      return null;
    }

    case "activation": {
      // GOTCHA (found live): `.cell.highlight` (available buildings) can be present in the DOM
      // BEFORE any population square is selected — the app highlights all buildings with spare
      // capacity, not just ones adjacent to the current pop pick. Checking `.cell.highlight`
      // first (the old order) clicks a building with no population square selected
      // (activationSelection.pop === null), which is a no-op: the click "succeeds" (element
      // exists, offsetParent !== null) but assigns zero workers, so the driver reports progress
      // every step while workerAllocations stays all-zero and the loop never advances —
      // invisible to the simple same-action repeat guard only once distinct cells get clicked in
      // turn, but still stuck relative to real game progress. ALWAYS select a population square
      // (`.selected-pop`) before clicking an adjacent building cell.
      const popSelected = document.querySelector(".population-node.selected-pop");
      if (!popSelected) {
        if (clickFirst(".population-node.highlight:not(.selected-pop)")) return "activation-pop-unselected";
      }
      if (clickFirst(".cell.highlight")) return "activation-cell";
      if (clickFirst(".population-node.highlight:not(.selected-pop)")) return "activation-pop-unselected";
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

// Example driver loop (paste into evaluate_script as an async () => {...} body):
//
// const h = window.__rfTestHooks;
// const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// const trace = [];
// let safety = 600, stopReason = "exhausted", repeatGuard = 0, lastAction = null;
// // GOTCHA: a same-action repeat guard alone does NOT catch 2-cycle oscillations (e.g.
// // empty-plot-forfeit-fallback <-> die-pick:0, seen live when a pending forfeit confirmation
// // got toggled back off — see the "building"/"forfeit" ordering fix above). Track a short
// // history of (phase + turn + locationSelection.length) signatures too, and bail if the same
// // signature recurs too many times even while the action string keeps changing.
// const sigHistory = [];
// while (safety-- > 0) {
//   if (h.state.finalScore) { stopReason = "final-score"; break; }
//   const action = await autoplayStep(h);
//   if (!action) { stopReason = "stuck"; break; }
//   trace.push(action);
//   if (action === lastAction) { if (++repeatGuard > 10) { stopReason = "loop:" + action; break; } }
//   else { repeatGuard = 0; lastAction = action; }
//   const sig = h.currentTurnPhase() + ":" + h.state.turn + ":" + (h.state.locationSelection || []).length;
//   sigHistory.push(sig);
//   if (sigHistory.length > 16) sigHistory.shift();
//   if (sigHistory.length === 16 && sigHistory.every((x) => sigHistory[0] === x || x === sig)) {
//     const counts = {};
//     sigHistory.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
//     if (Object.values(counts).some((c) => c >= 12)) { stopReason = "loop-signature:" + sig; break; }
//   }
//   await wait(40);
// }
// return { stopReason, trace: trace.slice(-20), phase: h.currentTurnPhase(), msg: h.actionMessage() };
