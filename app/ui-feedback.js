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

/**
 * Wrap a button's label so it renders inline styled like the real button
 * (see .btn-label-inline in styles.css), for use inside t()-interpolated hints.
 */
export function formatButtonLabelHtml(label) {
  return `<span class="btn-label-inline">${escapeHtml(label)}</span>`;
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
    return t("activation.finishWhenReady", { finishBtn: formatButtonLabelHtml(t("html.finishActivation")) });
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
    return t("hints.pressRollToStart", { rollBtn: formatButtonLabelHtml(t("html.rollDice")) });
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
      return t("hints.selectBuildingFromOverlay");
    }
    return t("hints.clickHighlightedPlot");
  }

  if (!state.activeTurn) return t("hints.waitingForActivePlayer");
  return t("hints.rollDiceToBegin", { rollBtn: formatButtonLabelHtml(t("html.rollDice")) });
}

/**
 * Update the action banner with animation
 * currentPhase must be passed in from app.js
 */
export function updateActionBanner(state, currentPhase, options = {}) {
  if (!actionBannerEl) return;
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
}
