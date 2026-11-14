import { describe, expect, it } from "vitest";
import { createState } from "../app/state-controller.js";
import {
  SAVE_KEY,
  SAVE_SCHEMA,
  serializeGame,
  parseSavedGame,
  saveGame,
  loadGame,
  clearSavedGame,
} from "../app/persistence.js";

function boardedState() {
  const s = createState();
  s.board = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({ building: null, forfeited: false, springBoost: 0 })),
  );
  s.board[1][2].building = "F";
  s.populationNodes = Array.from({ length: 6 }, () => Array(6).fill(0));
  s.finalScore = null;
  return s;
}

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const throwingStorage = {
  getItem() {
    throw new Error("boom");
  },
  setItem() {
    throw new Error("boom");
  },
  removeItem() {
    throw new Error("boom");
  },
};

describe("persistence", () => {
  it("round-trips a state", () => {
    const s = boardedState();
    const parsed = parseSavedGame(serializeGame(s));
    expect(parsed.board[1][2].building).toBe("F");
    expect(parsed.populationNodes).toEqual(s.populationNodes);
  });

  it("rejects invalid saves", () => {
    const s = boardedState();
    const wrap = (state, schema = SAVE_SCHEMA) => JSON.stringify({ schema, state });
    expect(parseSavedGame("garbage")).toBeNull();
    expect(parseSavedGame(wrap({ ...s, log: null }))).toBeNull();
    expect(parseSavedGame(wrap({ ...s, log: [1, 2] }))).toBeNull();
    expect(parseSavedGame(null)).toBeNull();
    expect(parseSavedGame(wrap(s, 99))).toBeNull();
    expect(parseSavedGame(JSON.stringify({ schema: SAVE_SCHEMA }))).toBeNull();
    expect(parseSavedGame(wrap({ ...s, board: undefined }))).toBeNull();
    expect(parseSavedGame(wrap({ ...s, board: s.board.slice(0, 4) }))).toBeNull();
    expect(parseSavedGame(wrap({ ...s, populationNodes: null }))).toBeNull();
    expect(parseSavedGame(wrap({ ...s, finalScore: 12 }))).toBeNull();
  });

  it("saves diceRolling as false without mutating the live state", () => {
    const s = boardedState();
    s.diceRolling = true;
    expect(parseSavedGame(serializeGame(s)).diceRolling).toBe(false);
    expect(s.diceRolling).toBe(true);
  });

  it("saves, loads and clears via storage", () => {
    const storage = fakeStorage();
    expect(loadGame(storage)).toBeNull();
    expect(saveGame(boardedState(), storage)).toBe(true);
    expect(loadGame(storage).board[1][2].building).toBe("F");
    clearSavedGame(storage);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it("never throws on a failing storage", () => {
    expect(saveGame(boardedState(), throwingStorage)).toBe(false);
    expect(loadGame(throwingStorage)).toBeNull();
    expect(() => clearSavedGame(throwingStorage)).not.toThrow();
  });

  it("removes an invalid save on load", () => {
    const storage = fakeStorage();
    storage.setItem(SAVE_KEY, "{oops");
    expect(loadGame(storage)).toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });
});
