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
  { code: "S", col: 1, row: 6 },
  { code: "T", col: 1, row: 7 },
  { code: "U", col: 1, row: 8 },
  { code: "A", col: 1, row: 9 },
  { code: "G", col: 1, row: 10 },
];

export const guildHitboxes = [
  { code: "GF", col: 1, row: 1 },
  { code: "GQ", col: 1, row: 2 },
  { code: "GW", col: 1, row: 3 },
  { code: "GM", col: 1, row: 4 },
];

const buildingScoreSpots = [
  { key: "cottages", x: 6, y: 8 },
  { key: "farm", x: 6, y: 56 },
  { key: "quarry", x: 6, y: 104 },
  { key: "windmill", x: 6, y: 150 },
  { key: "market", x: 6, y: 198 },
  { key: "springhouse", x: 6, y: 246 },
  { key: "townhall", x: 6, y: 294 },
  { key: "university", x: 6, y: 342 },
];

const guildScoreSpots = [
  { key: "guilds-gf", x: 6, y: 6 },
  { key: "guilds-gw", x: 6, y: 54 },
  { key: "guilds-gq", x: 6, y: 102 },
  { key: "guilds-gm", x: 6, y: 150 },
];

const reputationScoreSpots = [
  { key: "buildings-total", x: 28, y: 92 },
  { key: "vagrants", x: 88, y: 92 },
  { key: "reputation", x: 56, y: 24 },
];

export const scoringSpots = [...buildingScoreSpots, ...guildScoreSpots, ...reputationScoreSpots];

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
