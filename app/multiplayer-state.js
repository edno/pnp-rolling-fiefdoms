/**
 * Multiplayer state management
 * Pure functions for managing P2P multiplayer state (buildDone, splitUsed, seats)
 */

/**
 * Ensure buildDone map has entries for all seats
 * @param {number|null} total - Total number of seats
 * @param {Object|null} seed - Seed values for buildDone map
 * @param {Object} p2pUiState - Current P2P UI state (for fallback)
 * @returns {Object} Map of seat IDs to buildDone booleans
 */
export function ensureBuildDoneMap(total = null, seed = null, p2pUiState = {}) {
  const seats = Math.max(1, Number(total || p2pUiState.seatsTotal) || 1);
  const merged = {};
  const source = seed || p2pUiState.buildDone || {};
  for (let i = 1; i <= seats; i += 1) {
    merged[i] = Boolean(source[i]);
  }
  return merged;
}

/**
 * Ensure splitUsed map has entries for all seats
 * @param {number|null} total - Total number of seats
 * @param {Object|null} seed - Seed values for splitUsed map
 * @param {Object} p2pUiState - Current P2P UI state (for fallback)
 * @returns {Object} Map of seat IDs to splitUsed booleans
 */
export function ensureSplitUsedMap(total = null, seed = null, p2pUiState = {}) {
  const seats = Math.max(1, Number(total || p2pUiState.seatsTotal) || 1);
  const merged = {};
  const source = seed || p2pUiState.splitUsed || {};
  for (let i = 1; i <= seats; i += 1) {
    merged[i] = Boolean(source[i]);
  }
  return merged;
}

/**
 * Reset buildDone map for all seats to false
 * @param {number} total - Total number of seats
 * @returns {Object} Fresh buildDone map with all values false
 */
export function resetBuildDoneMap(total) {
  const seats = Math.max(1, Number(total) || 1);
  const entries = {};
  for (let i = 1; i <= seats; i += 1) {
    entries[i] = false;
  }
  return entries;
}

/**
 * Sanitize a buildDone map from untrusted source (e.g., network)
 * @param {*} map - The map to sanitize
 * @param {number} seats - Total number of seats
 * @returns {Object|null} Sanitized map or null if invalid
 */
export function sanitizeBuildDoneMap(map, seats = 1) {
  if (!map || typeof map !== "object") return null;
  const total = Math.max(1, Number(seats) || 1);
  const clean = {};
  for (let i = 1; i <= total; i += 1) {
    clean[i] = Boolean(map?.[i]);
  }
  return clean;
}

/**
 * Check if all players have marked their build as done
 * @param {Object} buildDoneMap - Map of seat IDs to buildDone booleans
 * @param {number} total - Total number of seats
 * @returns {boolean} True if all seats are marked done
 */
export function allBuildsMarkedDone(buildDoneMap, total) {
  const seats = Math.max(1, Number(total) || 1);
  for (let i = 1; i <= seats; i += 1) {
    if (!buildDoneMap?.[i]) return false;
  }
  return true;
}

/**
 * Determine if this player's build should be auto-marked as done
 * @param {Object} params - Parameters
 * @param {boolean} params.force - Force mark done regardless of conditions
 * @param {boolean} params.isMultiplayerActive - Whether multiplayer is active
 * @param {Object} params.p2pUiState - P2P UI state
 * @param {Object} params.state - Game state
 * @returns {boolean} True if should auto-mark done
 */
export function shouldAutoMarkBuildDone({ force = false, isMultiplayerActive, p2pUiState, state }) {
  return (
    isMultiplayerActive &&
    ((p2pUiState.splitLocked || state.pestilence || state.forceForfeit) || force) &&
    !p2pUiState.buildDone?.[p2pUiState.seatId] &&
    !state.pendingPopulation?.remaining &&
    !state.pendingSpringhouseTarget
  );
}

/**
 * Merge two state maps (buildDone or splitUsed), preserving true values
 * @param {Object} local - Local state map
 * @param {Object} incoming - Incoming state map from peer
 * @param {number} seats - Total number of seats
 * @param {number} ownSeatId - This player's seat ID (to ensure preservation)
 * @returns {Object} Merged state map where any true value from either map is preserved
 */
export function mergeStateMap(local, incoming, seats, ownSeatId) {
  const merged = {};
  for (let i = 1; i <= seats; i += 1) {
    merged[i] = Boolean(local?.[i]) || Boolean(incoming?.[i]);
  }
  // Extra insurance: preserve own seat's true value if it was set locally
  if (ownSeatId && local?.[ownSeatId]) {
    merged[ownSeatId] = true;
  }
  return merged;
}

/**
 * Validate multiplayer state consistency
 * @param {Object} params - Parameters
 * @param {Object} params.p2pUiState - P2P UI state to validate
 * @param {Object} params.state - Game state
 * @returns {Object} Validation result with valid boolean and errors array
 */
export function validateMultiplayerState({ p2pUiState, state }) {
  const errors = [];
  const seatId = p2pUiState.seatId;
  
  // Check if splitUsed is consistent with splitLocked
  if (p2pUiState.splitLocked && p2pUiState.splitUsed) {
    const anyUsed = Object.values(p2pUiState.splitUsed).some(v => v === true);
    if (!anyUsed && state?.dice?.length > 0) {
      errors.push('splitLocked is true but no player has splitUsed set');
    }
  }
  
  // Check if buildDone is set but splitUsed is not for same player
  if (p2pUiState.buildDone && p2pUiState.splitUsed) {
    for (const sid in p2pUiState.buildDone) {
      if (p2pUiState.buildDone[sid] && !p2pUiState.splitUsed[sid]) {
        errors.push(`Player ${sid} has buildDone but not splitUsed`);
      }
    }
  }
  
  // Check if our own seat has inconsistent flags
  if (seatId && p2pUiState.buildDone?.[seatId] && !p2pUiState.splitUsed?.[seatId]) {
    errors.push(`Own seat ${seatId} has buildDone but not splitUsed`);
  }
  
  return { valid: errors.length === 0, errors };
}
