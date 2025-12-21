/**
 * UI Feedback - Action banners, hints, and user feedback messages
 * 
 * This module contains functions for displaying user feedback including:
 * - Action banner messages (primary user guidance)
 * - Turn hints and helper text
 * - P2P status and hint messages
 */

import { actionBannerEl, p2pHintEl, p2pStatusEl, p2pPanel } from "./dom-manager.js";
import { BUILDING_RULES } from "./rules.js";

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
export function actionMessage(state, p2pUiState, currentPhase, options = {}) {
  const {
    currentScore,
    lockedPairChoice,
    isMultiplayerActive,
  } = options;

  if (state.bannerOverride) return state.bannerOverride;
  const isMultiplayer = isMultiplayerActive?.() || (p2pUiState.seatsTotal > 1 && p2pUiState.signallingActive);
  const phase = currentPhase;

  if (phase === TURN_PHASE.ACTIVATION_DONE) {
    const score = typeof state.finalScore === "number"
      ? state.finalScore
      : currentScore?.({ allowPopulationActivation: true }).total || 0;
    return `Game over. Final score ${score}.`;
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
    if (isMultiplayer && p2pUiState.activeSeat !== p2pUiState.seatId) {
      return "Waiting for the active player to roll dice.";
    }
    return "Press Roll Dice to start your turn.";
  }

  if (isMultiplayer && !p2pUiState.splitLocked && p2pUiState.activeSeat !== p2pUiState.seatId) {
    return "Waiting for the active player to finish the split.";
  }

  if (isMultiplayer && p2pUiState.splitLocked) {
    const choice = lockedPairChoice?.() || { swapAllowed: false };
    if (p2pUiState.buildDone?.[p2pUiState.seatId]) {
      return "Waiting for other players to finish building.";
    }
    if (choice.swapAllowed) {
      return "Locked split: swap pairs if needed, then build.";
    }
    return "Build with this split.";
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
export function updateActionBanner(state, p2pUiState, currentPhase, options = {}) {
  if (!actionBannerEl) return;
  const newText = actionMessage(state, p2pUiState, currentPhase, options);
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

/**

/**
 * Generate P2P status description
 */
function describeRemoteSnapshot(snapshot) {
  if (!snapshot) return "";
  const turn = snapshot.turnNumber || 0;
  const score = snapshot.score || 0;
  return ` | Remote: Turn ${turn}, Score ${score}`;
}

/**
 * Update P2P status and hint messages
 */
export function updateP2PStatus(p2pUiState, p2p, p2pFeatureEnabled, hintOverride = null) {
  if (!p2pFeatureEnabled) return;
  if (!p2pPanel) return;
  if (p2pUiState.signallingDisabled) {
    if (p2pStatusEl) p2pStatusEl.textContent = "P2P disabled: signalling unavailable.";
    if (p2pHintEl) {
      p2pHintEl.textContent = "";
      p2pHintEl.style.display = "none";
    }
    if (p2pPanel) p2pPanel.classList.add("disabled");
    return;
  }
  const status = typeof p2p?.getStatus === "function" ? p2p.getStatus() : { supported: false };
  const main =
    !status.supported
      ? "Manual P2P is not available in this browser."
      : status.channelOpen
        ? "Connected via P2P (2 players maximum)."
        : p2pUiState.awaitingAnswer
          ? "Hosting: waiting for 1 player to join (2 players max)."
          : p2pUiState.mode === "answerReady"
            ? "Answer generated. Send it back to the host."
            : p2pUiState.mode === "joining"
              ? "Joining: paste an invite code, then apply to craft your answer."
              : p2pUiState.mode === "hosting"
                ? "Preparing an invite…"
                : "Idle. Host to create an invite or join with one.";

  const errorText = status.lastError ? ` (${status.lastError})` : "";
  const remoteText =
    status.channelOpen && p2pUiState.remoteSnapshot ? describeRemoteSnapshot(p2pUiState.remoteSnapshot) : "";
  if (p2pStatusEl) p2pStatusEl.textContent = `${main}${remoteText}${errorText}`;
  if (p2pHintEl) {
    p2pHintEl.textContent = "";
    p2pHintEl.style.display = "none";
  }

  if (hintOverride) {
    if (p2pHintEl) {
      p2pHintEl.textContent = hintOverride;
      p2pHintEl.style.display = "block";
    }
  }
}
