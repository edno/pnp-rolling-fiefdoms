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
export const finishSplitBtn = document.getElementById("finishSplitBtn");
export const swapPairBtn = document.getElementById("swapPairBtn");

// UI Controls
export const fullscreenBtn = document.getElementById("fullscreenToggle");
export const sfxToggleBtn = document.getElementById("sfxToggle");
export const sfxToggleLabel = document.getElementById("sfxToggleLabel");
export const sfxToggleIcon = document.getElementById("sfxToggleIcon");
export const actionBannerEl = document.getElementById("actionBanner");
export const turnStatusChip = document.getElementById("turnStatusChip");
export const loadingOverlay = document.getElementById("loadingOverlay");
export const sheetBaseImage = document.getElementById("sheetBaseImage");

// P2P Multiplayer Elements
export const p2pPanel = document.getElementById("p2pPanel");
export const p2pStatusEl = document.getElementById("p2pStatus");
export const p2pCodeEl = document.getElementById("p2pCode");
export const p2pCodeLabel = document.querySelector('label[for="p2pCode"]');
export const p2pCopyBtn = document.getElementById("p2pCopyBtn");
export const p2pApplyBtn = document.getElementById("p2pApplyBtn");
export const p2pHostBtn = document.getElementById("p2pHostBtn");
export const p2pJoinBtn = document.getElementById("p2pJoinBtn");
export const p2pDisconnectBtn = document.getElementById("p2pDisconnectBtn");
export const p2pSendAnswerBtn = document.getElementById("p2pSendAnswerBtn");
export const p2pHintEl = document.getElementById("p2pHint");
export const p2pMeeplesEl = document.getElementById("p2pMeeples");
export const p2pInviteRow = p2pCodeEl ? p2pCodeEl.closest(".p2p-row") : null;
export const p2pQrImg = document.getElementById("p2pQrImg");
export const p2pQrCaption = document.getElementById("p2pQrCaption");
export const p2pQrModal = document.getElementById("p2pQrModal");
export const p2pQrClose = document.getElementById("p2pQrClose");
export const p2pShowQrBtn = document.getElementById("p2pShowQrBtn");

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
