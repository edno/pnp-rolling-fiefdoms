/**
 * DOM Manager - Centralized DOM element references and utilities
 * 
 * This module provides:
 * - Single source of truth for all DOM element references
 * - DOM manipulation utilities
 * - Helper functions for common DOM operations
 */

// ============================================================================
// DOM ELEMENT REFERENCES
// ============================================================================

// Game Board & Dice
export const boardEl = document.getElementById("board");
export const diceView = document.getElementById("diceView");
export const turnHintEl = document.getElementById("turnHint");
export const locDicePreview = document.getElementById("locDicePreview");
export const buildDicePreview = document.getElementById("buildDicePreview");

// Log & Overlays
export const logEl = document.getElementById("log");
export const scoreOverlayBuildingsEl = document.getElementById("scoreOverlayBuildings");
export const scoreOverlayGuildsEl = document.getElementById("scoreOverlayGuilds");
export const scoreOverlayReputationEl = document.getElementById("scoreOverlayReputation");
export const popHousingOverlay = document.getElementById("popHousingOverlay");
export const influenceOverlay = document.getElementById("influenceOverlay");
export const turnTrackOverlay = document.getElementById("turnTrackOverlay");

// Action Buttons
export const finishActivationBtn = document.getElementById("finishActivation");
export const newGameBtn = document.getElementById("newGameBtn");
export const swapPairBtn = document.getElementById("swapPairBtn");

// UI Controls
export const fullscreenBtn = document.getElementById("fullscreenToggle");
export const sfxToggleBtn = document.getElementById("sfxToggle");
export const sfxToggleLabel = document.getElementById("sfxToggleLabel");
export const sfxToggleIcon = document.getElementById("sfxToggleIcon");
export const localeSelect = document.getElementById("localeSelect");
export const localeFlagIcon = document.getElementById("localeFlagIcon");
export const actionBannerEl = document.getElementById("actionBanner");
export const turnStatusChip = document.getElementById("turnStatusChip");
export const unrestBadge = document.getElementById("unrestBadge");
export const challengeProgressBadge = document.getElementById("challengeProgressBadge");
export const activeChallengeBadge = document.getElementById("activeChallengeBadge");
export const challengeInfoModal = document.getElementById("challengeInfoModal");
export const challengeInfoTitle = document.getElementById("challengeInfoTitle");
export const challengeInfoDifficulty = document.getElementById("challengeInfoDifficulty");
export const challengeInfoDescription = document.getElementById("challengeInfoDescription");
export const challengeInfoVictory = document.getElementById("challengeInfoVictory");
export const challengeInfoRules = document.getElementById("challengeInfoRules");
export const challengeInfoSetup = document.getElementById("challengeInfoSetup");
export const challengeInfoCloseBtn = document.getElementById("challengeInfoCloseBtn");
export const loadingOverlay = document.getElementById("loadingOverlay");
export const sheetBaseImage = document.getElementById("sheetBaseImage");
export const challengePickerEl = document.getElementById("challengePicker");
export const challengeCardsEl = document.getElementById("challengeCards");
export const challengeConfirmBtn = document.getElementById("challengeConfirmBtn");
export const challengeCancelBtn = document.getElementById("challengeCancelBtn");
export const challengePickerLocaleSelect = document.getElementById("challengePickerLocaleSelect");
export const challengePickerLocaleFlagIcon = document.getElementById("challengePickerLocaleFlagIcon");
export const challengeCarouselPrev = document.getElementById("challengeCarouselPrev");
export const challengeCarouselNext = document.getElementById("challengeCarouselNext");
export const challengeCarouselDots = document.getElementById("challengeCarouselDots");
export const challengeOutcomeOverlay = document.getElementById("challengeOutcomeOverlay");
export const challengeOutcomeText = document.getElementById("challengeOutcomeText");
export const challengeOutcomeComparison = document.getElementById("challengeOutcomeComparison");
export const challengeOutcomeReasons = document.getElementById("challengeOutcomeReasons");
export const barricadeAlertOverlay = document.getElementById("barricadeAlertOverlay");
export const barricadeAlertText = document.getElementById("barricadeAlertText");

// ============================================================================
// DOM UTILITIES
// ============================================================================

/**
 * Helper to iterate over board cells
 * @param {Function} callback - Function to call for each cell element
 */
export function forEachCell(callback) {
  if (!boardEl) return;
  boardEl.querySelectorAll(".cell").forEach(callback);
}

/**
 * Helper to create octagon element for highlighting
 * @returns {HTMLElement} Octagon div element
 */
export function createOctagon() {
  const oct = document.createElement("div");
  oct.className = "octagon";
  return oct;
}

/**
 * Clear innerHTML of an element safely
 * @param {HTMLElement} element - Element to clear
 */
export function clearElement(element) {
  if (element) element.innerHTML = "";
}

/**
 * Debug logging helper (logs only in debug mode)
 * @param {boolean} debugMode - Whether debug mode is enabled
 * @param  {...any} args - Arguments to log
 */
export function debugLog(debugMode, ...args) {
  if (debugMode && typeof console !== "undefined") {
    console.log(...args);
  }
}
