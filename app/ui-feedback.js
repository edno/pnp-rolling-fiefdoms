/**
 * UI Feedback - Action banners, hints, and user feedback messages
 * 
 * This module contains functions for displaying user feedback including:
 * - Action banner messages (primary user guidance)
 * - Turn hints and helper text
 */

import { actionBannerEl } from "./dom-manager.js";
import { BUILDING_RULES } from "./rules.js";
import { t, escapeHtml } from "./i18n.js";
import { isCompactLayout } from "./layout-mode.js";

/**
 * Wrap a button's label so it renders inline styled like the real button
 * (see .btn-label-inline in styles.css), for use inside t()-interpolated hints.
 * When targetId is provided, the inline label is itself a real button that
 * triggers the control with that id (see delegated click handler in app.js).
 */
export function formatButtonLabelHtml(label, targetId) {
  if (targetId) {
    return `<button type="button" class="btn-label-inline btn-inline-action" data-target="${escapeHtml(targetId)}">${escapeHtml(label)}</button>`;
  }
  return `<span class="btn-label-inline">${escapeHtml(label)}</span>`;
}

/**
 * app.js owns syncActionBarState() (it reads/toggles classes on #actionBar,
 * which this module doesn't have references to) but flashHint() needs to
 * re-run it whenever it replaces/restores the banner HTML, since that HTML
 * determines `.has-inline-roll` / `.has-inline-finish`. Registered once from
 * app.js to avoid a circular import.
 */
let actionBarSyncHook = null;
export function registerActionBarSync(fn) {
  actionBarSyncHook = fn;
}

/**
 * Keep inline-action buttons inside the action banner disabled/enabled in
 * sync with the real controls they target (#rollBtn, #finishActivation).
 */
export function syncInlineActionButtons() {
  if (!actionBannerEl) return;
  const inlineButtons = actionBannerEl.querySelectorAll(".btn-inline-action");
  inlineButtons.forEach((btn) => {
    const target = document.getElementById(btn.dataset.target);
    const targetUnavailable = !target || target.disabled || target.style.display === "none";
    btn.disabled = targetUnavailable;
  });
}

const SCORE_RANKS = [
  { min: 90, titleKey: "score.rankLegendaryTitle", descriptionKey: "score.rankLegendaryDesc" },
  { min: 80, titleKey: "score.rankIllustriousTitle", descriptionKey: "score.rankIllustriousDesc" },
  { min: 70, titleKey: "score.rankDistinguishedTitle", descriptionKey: "score.rankDistinguishedDesc" },
  { min: 60, titleKey: "score.rankProsperousTitle", descriptionKey: "score.rankProsperousDesc" },
  { min: 50, titleKey: "score.rankModestTitle", descriptionKey: "score.rankModestDesc" },
  { min: 0, titleKey: "score.rankForgottenTitle", descriptionKey: "score.rankForgottenDesc" },
];

function describeScoreRank(score) {
  const numeric = Number(score) || 0;
  const entry = SCORE_RANKS.find((rank) => numeric >= rank.min) || SCORE_RANKS[SCORE_RANKS.length - 1];
  return { title: t(entry.titleKey), description: t(entry.descriptionKey) };
}

/**
 * Turn phases for determining current game state
 */
export const TURN_PHASE = {
  AWAIT_ROLL: "awaiting-roll",
  SPLITTING: "splitting",
  BUILDING: "building",
  POPULATION: "population",
  BARRICADE: "barricade",
  CENTER_BUILDING: "center-building",
  FORFEIT: "forfeit",
  PESTILENCE: "pestilence",
  ACTIVATION: "activation",
  ACTIVATION_DONE: "activation-complete",
};

/**
 * Generate text for non-active turn auto-hint
 */
export function nonActiveAutoHintText(soloSwapAvailable = false) {
  const base = t("turn.nonActive");
  return soloSwapAvailable ? t("turn.nonActiveWithSwap", { base }) : base;
}

/**
 * Generate the primary action message for the user
 * currentPhase must be passed in from app.js since it has complex logic
 */
export function actionMessage(state, currentPhase, options = {}) {
  const { currentScore } = options;

  if (state.bannerOverride) return state.bannerOverride;
  const phase = currentPhase;

  if (phase === TURN_PHASE.ACTIVATION_DONE) {
    const score = typeof state.finalScore === "number"
      ? state.finalScore
      : currentScore?.({ allowPopulationActivation: true }).total || 0;
    const rank = describeScoreRank(score);
    return t("score.label", { score, title: rank.title, description: rank.description });
  }

  if (phase === TURN_PHASE.ACTIVATION) {
    const anyRemaining = state.board.some((row, r) =>
      row.some((cell, c) => {
        if (!cell.building || cell.forfeited || cell.activationForfeit) return false;
        const req = Math.max(0, (BUILDING_RULES[cell.building]?.requirement || 0) - (Number(cell.springBoost) || 0));
        const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
        return req > filled;
      }),
    );
    if (state.activationSelection.pop) {
      const [pr, pc] = state.activationSelection.pop;
      const remaining = Math.max(0, state.populationAvailable?.[pr]?.[pc] || 0);
      return t("activation.populationSelected", { remaining });
    }
    if (anyRemaining) return t("activation.selectPopulationNode");
    return t("activation.finishWhenReady", { finishBtn: formatButtonLabelHtml(t("html.finishActivation"), "finishActivation") });
  }

  if (state.pendingSpringhouseTarget) {
    return t("springhouse.selectAdjacentForBanner");
  }

  if (state.activeTurn && state.invalidSelection && state.invalidSelectionMessage) {
    return state.invalidSelectionMessage;
  }

  if (state.forceForfeitAdvisory) {
    return t("location.noValidPairsSpendInfluence");
  }

  if (phase === TURN_PHASE.PESTILENCE) {
    return t("pestilence.forfeitBanner");
  }

  if (phase === TURN_PHASE.FORFEIT) {
    return t("forfeit.emptyPlotBanner");
  }

  if (phase === TURN_PHASE.BARRICADE) {
    return t("challenges.barricadeChoose");
  }

  if (phase === TURN_PHASE.CENTER_BUILDING) {
    return state.pendingCenterBuilding?.awaitingGuildType
      ? t("challenges.socialContract.chooseGuildType")
      : t("challenges.socialContract.chooseCenterBuilding");
  }

  if (phase === TURN_PHASE.POPULATION) {
    return t("population.placeOnAdjacentIntersection", { count: state.pendingPopulation.remaining });
  }

  if (phase === TURN_PHASE.AWAIT_ROLL) {
    return t("hints.pressRollToStart", { rollBtn: formatButtonLabelHtml(t("html.rollDice"), "rollBtn") });
  }

  if (phase === TURN_PHASE.SPLITTING) {
    if (state.locationSelection.length < 2 && !(state.diceLocked && state.lockedLocationDice?.length === 2)) {
      if ((state.forcedLocationDice || []).length) {
        return t("location.windroseSelectSecond");
      }
      return t("location.selectTwoInTurnPanel");
    }
    return t("hints.lockSplitToContinue");
  }

  if (phase === TURN_PHASE.BUILDING) {
    if (!state.buildChoice) {
      return isCompactLayout() ? t("turn.selectBuildingPicker") : t("hints.selectBuildingFromOverlay");
    }
    return t("hints.clickHighlightedPlot");
  }

  if (!state.activeTurn) return t("hints.waitingForActivePlayer");
  return t("hints.rollDiceToBegin", { rollBtn: formatButtonLabelHtml(t("html.rollDice"), "rollBtn") });
}

/**
 * Update the action banner with animation
 * currentPhase must be passed in from app.js
 */
export function updateActionBanner(state, currentPhase, options = {}) {
  if (!actionBannerEl) return;
  if (flashHintTimer) {
    clearTimeout(flashHintTimer);
    flashHintTimer = null;
    flashHintText = null;
  }
  const newText = actionMessage(state, currentPhase, options);
  const prevText = actionBannerEl.dataset.msg || "";
  const changed = prevText !== newText;
  actionBannerEl.dataset.msg = newText;
  if (newText && newText.includes("<")) {
    actionBannerEl.innerHTML = newText;
  } else {
    actionBannerEl.textContent = newText;
  }
  if (changed) {
    actionBannerEl.classList.remove("bump");
    void actionBannerEl.offsetWidth; // restart animation
    actionBannerEl.classList.add("bump");
  }
  actionBannerEl.classList.toggle("is-final", currentPhase === TURN_PHASE.ACTIVATION_DONE);
  syncInlineActionButtons();
}

let flashHintTimer = null;
let flashHintText = null;

/**
 * Briefly show a transient hint message in the action banner, without
 * permanently replacing the phase banner. The previous banner text is
 * restored after ~3s (or overwritten sooner by the next updateActionBanner()).
 */
export function flashHint(text) {
  if (!actionBannerEl || !text) return;
  if (flashHintTimer) clearTimeout(flashHintTimer);
  flashHintText = text;
  const restoreText = actionBannerEl.dataset.msg || "";
  if (text.includes("<")) {
    actionBannerEl.innerHTML = text;
  } else {
    actionBannerEl.textContent = text;
  }
  actionBannerEl.classList.remove("bump");
  void actionBannerEl.offsetWidth; // restart animation
  actionBannerEl.classList.add("bump");
  syncInlineActionButtons();
  actionBarSyncHook?.();
  flashHintTimer = setTimeout(() => {
    flashHintTimer = null;
    if (!actionBannerEl) return;
    // Only restore if the banner is still showing this flash's text - if
    // updateActionBanner() rendered a newer prompt in the meantime, leave it alone.
    if (flashHintText !== text) return;
    flashHintText = null;
    actionBannerEl.dataset.msg = restoreText;
    if (restoreText && restoreText.includes("<")) {
      actionBannerEl.innerHTML = restoreText;
    } else {
      actionBannerEl.textContent = restoreText;
    }
    syncInlineActionButtons();
    actionBarSyncHook?.();
  }, 3000);
}
