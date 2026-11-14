// DOM-free save/resume helpers: the game state is plain JSON, stored in localStorage.
export const SAVE_KEY = "rf-game-v1";
export const SAVE_SCHEMA = 1;

function defaultStorage() {
  try {
    return typeof globalThis !== "undefined" && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function serializeGame(state) {
  const snapshot = { ...(state || {}), diceRolling: false };
  return JSON.stringify({ schema: SAVE_SCHEMA, savedAt: new Date().toISOString(), state: snapshot });
}

function isValidBoard(board) {
  return (
    Array.isArray(board) &&
    board.length === 5 &&
    board.every((row) => Array.isArray(row) && row.length === 5 && row.every((cell) => cell && typeof cell === "object"))
  );
}

export function parseSavedGame(json) {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== "object" || data.schema !== SAVE_SCHEMA) return null;
    const saved = data.state;
    if (!saved || typeof saved !== "object") return null;
    if (!isValidBoard(saved.board)) return null;
    if (!Array.isArray(saved.populationNodes)) return null;
    if (saved.finalScore !== null && saved.finalScore !== undefined) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveGame(state, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, serializeGame(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedGame(storage = defaultStorage()) {
  try {
    if (storage) storage.removeItem(SAVE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function loadGame(storage = defaultStorage()) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(SAVE_KEY);
    if (raw === null || raw === undefined) return null;
    const saved = parseSavedGame(raw);
    if (!saved) clearSavedGame(storage);
    return saved;
  } catch {
    return null;
  }
}
