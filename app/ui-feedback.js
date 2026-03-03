/**
 * UI Feedback - Action banners, hints, and user feedback messages
 * 
 * This module contains functions for displaying user feedback including:
 * - Action banner messages (primary user guidance)
 * - Turn hints and helper text
 */

import { actionBannerEl } from "./dom-manager.js";
import { BUILDING_RULES } from "./rules.js";

const SCORE_RANKS = [
  { min: 90, title: "Legendary", description: "Your name will echo through the ages." },
  { min: 80, title: "Illustrious", description: "Your fief shines as a beacon of order and prosperity." },
  { min: 70, title: "Distinguished", description: "Your rule is respected across neighboring fiefdoms." },
  { min: 60, title: "Prosperous", description: "Your lands flourish and your people thrive." },
  { min: 50, title: "Modest", description: "A small but stable holding, quietly enduring." },
  { min: 0, title: "Forgotten", description: "Your fief leaves little mark upon the chronicles." },
];

function describeScoreRank(score) {
  const numeric = Number(score) || 0;
  return SCORE_RANKS.find((entry) => numeric >= entry.min) || SCORE_RANKS[SCORE_RANKS.length - 1];
}

/**
 * Turn phases for determining current game state
 */
export const TURN_PHASE = {
  AWAIT_ROLL: "awaiting-roll",
  SPLITTING: "splitting",
  BUILDING: "building",
  POPULATION: "population",
  FORFEIT: "forfeit",
  PESTILENCE: "pestilence",
  ACTIVATION: "activation",
  ACTIVATION_DONE: "activation-complete",
};

/**
 * Generate text for non-active turn auto-hint
 */
export function nonActiveAutoHintText(soloSwapAvailable = false) {
  const base = "Non-active turn. Dice automatically assigned.";
  return soloSwapAvailable ? `${base} Use the swap button to swap pairs.` : base;
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
    return `Final score ${score} - ${rank.title} — ${rank.description}`;
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
      return `Activation: population selected (${remaining} remaining). Click a highlighted building to assign 1 worker.`;
    }
    if (anyRemaining) return "Activation: select a population node to allocate workers.";
    return "Activation: finish allocation when ready.";
  }

  if (state.pendingSpringhouseTarget) {
    return "Select an adjacent building for Springhouse to reduce worker requirement by 1.";
  }

  if (state.activeTurn && state.invalidSelection && state.invalidSelectionMessage) {
    return state.invalidSelectionMessage;
  }

  if (state.forceForfeitAdvisory) {
    return "No valid location pairs; spend Influence or forfeit a plot.";
  }

  if (phase === TURN_PHASE.PESTILENCE || phase === TURN_PHASE.FORFEIT) {
    return "Forfeit an empty plot.";
  }

  if (phase === TURN_PHASE.POPULATION) {
    return `Place ${state.pendingPopulation.remaining} population on an adjacent intersection.`;
  }

  if (phase === TURN_PHASE.AWAIT_ROLL) {
    return "Press Roll Dice to start your turn.";
  }

  if (phase === TURN_PHASE.SPLITTING) {
    if (state.locationSelection.length < 2 && !(state.diceLocked && state.lockedLocationDice?.length === 2)) {
      return "Select two location dice in the Turn panel.";
    }
    return "Lock the split to continue building.";
  }

  if (phase === TURN_PHASE.BUILDING) {
    if (!state.buildChoice) {
      return "Select a building from the Buildings overlay.";
    }
    return "Click a highlighted plot to place the chosen building.";
  }

  if (!state.activeTurn) return "Waiting for the active player.";
  return "Roll dice to begin.";
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
