/**
 * UI Renderer - Constants and helpers for rendering
 * 
 * This module contains constants and helper functions used by rendering code.
 * The actual render implementations stay in app.js for now due to tight coupling with state.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const ICONS = {
  plotOutline: "assets/img/plot-outline.svg",
  housingOutline: "assets/img/housing-outline.svg",
  pipFill: "assets/img/pip-fill.svg",
  pipOutline: "assets/img/pip-outline.svg",
  influenceOutline: "assets/img/influence-outline.svg",
  influenceScribble: "assets/img/scribble.svg",
};

export const buildingHitboxes = [
  { code: "C", col: 1, row: 1 },
  { code: "F", col: 1, row: 2 },
  { code: "Q", col: 1, row: 3 },
  { code: "W", col: 1, row: 4 },
  { code: "M", col: 1, row: 5 },
  { code: "S", col: 2, row: 1 },
  { code: "T", col: 2, row: 2 },
  { code: "U", col: 2, row: 3 },
  { code: "A", col: 2, row: 4 },
  { code: "G", col: 2, row: 5 },
];

export const guildHitboxes = [
  { code: "GF", col: 1, row: 1 },
  { code: "GW", col: 2, row: 1 },
  { code: "GQ", col: 1, row: 2 },
  { code: "GM", col: 2, row: 2 },
];

const SCORE_SPOT_TOP = 28;
export const scoringSpots = [
  { key: "cottages", x: 20, y: SCORE_SPOT_TOP },
  { key: "farm", x: 66, y: SCORE_SPOT_TOP },
  { key: "quarry", x: 112, y: SCORE_SPOT_TOP },
  { key: "windmill", x: 156, y: SCORE_SPOT_TOP },
  { key: "market", x: 202, y: SCORE_SPOT_TOP },
  { key: "townhall", x: 244, y: SCORE_SPOT_TOP },
  { key: "university", x: 290, y: SCORE_SPOT_TOP },
  { key: "guilds", x: 334, y: SCORE_SPOT_TOP },
  { key: "springhouse", x: 380, y: SCORE_SPOT_TOP },
  { key: "vagrants", x: 424, y: SCORE_SPOT_TOP },
  { key: "reputation", x: 527, y: SCORE_SPOT_TOP },
];

export const TURN_TRACK_LENGTH = 25;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function countGuilds(board) {
  return board.flat().filter((cell) => cell.building === "G").length;
}

export function builtGuildTypes(board) {
  const set = new Set();
  board.flat().forEach((cell) => {
    if (cell.building === "G" && cell.buildingLabel) {
      set.add(cell.buildingLabel.toUpperCase());
    }
  });
  return set;
}


