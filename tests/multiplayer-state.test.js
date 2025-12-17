import { describe, it, expect } from "vitest";
import {
  ensureBuildDoneMap,
  ensureSplitUsedMap,
  resetBuildDoneMap,
  sanitizeBuildDoneMap,
  allBuildsMarkedDone,
  shouldAutoMarkBuildDone,
} from "../app/multiplayer-state.js";

describe("multiplayer-state", () => {
  describe("ensureBuildDoneMap", () => {
    it("creates map with all seats initialized to false", () => {
      const result = ensureBuildDoneMap(3);
      expect(result).toEqual({ 1: false, 2: false, 3: false });
    });

    it("uses seatsTotal from p2pUiState when total not provided", () => {
      const p2pUiState = { seatsTotal: 2 };
      const result = ensureBuildDoneMap(null, null, p2pUiState);
      expect(result).toEqual({ 1: false, 2: false });
    });

    it("merges seed values preserving existing booleans", () => {
      const seed = { 1: true, 2: false };
      const result = ensureBuildDoneMap(2, seed);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("uses buildDone from p2pUiState as fallback seed", () => {
      const p2pUiState = { seatsTotal: 2, buildDone: { 1: true, 2: false } };
      const result = ensureBuildDoneMap(null, null, p2pUiState);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("defaults to 1 seat when total is invalid", () => {
      const result = ensureBuildDoneMap(0);
      expect(result).toEqual({ 1: false });
    });

    it("coerces non-boolean seed values to booleans", () => {
      const seed = { 1: "true", 2: 0, 3: null };
      const result = ensureBuildDoneMap(3, seed);
      expect(result).toEqual({ 1: true, 2: false, 3: false });
    });
  });

  describe("ensureSplitUsedMap", () => {
    it("creates map with all seats initialized to false", () => {
      const result = ensureSplitUsedMap(3);
      expect(result).toEqual({ 1: false, 2: false, 3: false });
    });

    it("uses seatsTotal from p2pUiState when total not provided", () => {
      const p2pUiState = { seatsTotal: 2 };
      const result = ensureSplitUsedMap(null, null, p2pUiState);
      expect(result).toEqual({ 1: false, 2: false });
    });

    it("merges seed values preserving existing booleans", () => {
      const seed = { 1: true, 2: false };
      const result = ensureSplitUsedMap(2, seed);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("uses splitUsed from p2pUiState as fallback seed", () => {
      const p2pUiState = { seatsTotal: 2, splitUsed: { 1: true, 2: false } };
      const result = ensureSplitUsedMap(null, null, p2pUiState);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("defaults to 1 seat when total is invalid", () => {
      const result = ensureSplitUsedMap(0);
      expect(result).toEqual({ 1: false });
    });
  });

  describe("resetBuildDoneMap", () => {
    it("creates fresh map with all values false", () => {
      const result = resetBuildDoneMap(3);
      expect(result).toEqual({ 1: false, 2: false, 3: false });
    });

    it("defaults to 1 seat when total is invalid", () => {
      const result = resetBuildDoneMap(0);
      expect(result).toEqual({ 1: false });
    });

    it("handles large seat counts", () => {
      const result = resetBuildDoneMap(6);
      expect(Object.keys(result).length).toBe(6);
      expect(result[6]).toBe(false);
    });
  });

  describe("sanitizeBuildDoneMap", () => {
    it("sanitizes valid buildDone map", () => {
      const map = { 1: true, 2: false };
      const result = sanitizeBuildDoneMap(map, 2);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("returns null for null input", () => {
      const result = sanitizeBuildDoneMap(null, 2);
      expect(result).toBeNull();
    });

    it("returns null for non-object input", () => {
      const result = sanitizeBuildDoneMap("invalid", 2);
      expect(result).toBeNull();
    });

    it("coerces non-boolean values to booleans", () => {
      const map = { 1: "true", 2: 0, 3: null, 4: undefined };
      const result = sanitizeBuildDoneMap(map, 4);
      expect(result).toEqual({ 1: true, 2: false, 3: false, 4: false });
    });

    it("fills missing seats with false", () => {
      const map = { 1: true };
      const result = sanitizeBuildDoneMap(map, 3);
      expect(result).toEqual({ 1: true, 2: false, 3: false });
    });

    it("ignores extra seats beyond total", () => {
      const map = { 1: true, 2: true, 3: true, 4: true };
      const result = sanitizeBuildDoneMap(map, 2);
      expect(result).toEqual({ 1: true, 2: true });
    });
  });

  describe("allBuildsMarkedDone", () => {
    it("returns true when all seats are done", () => {
      const map = { 1: true, 2: true, 3: true };
      const result = allBuildsMarkedDone(map, 3);
      expect(result).toBe(true);
    });

    it("returns false when any seat is not done", () => {
      const map = { 1: true, 2: false, 3: true };
      const result = allBuildsMarkedDone(map, 3);
      expect(result).toBe(false);
    });

    it("returns false when map is missing entries", () => {
      const map = { 1: true };
      const result = allBuildsMarkedDone(map, 2);
      expect(result).toBe(false);
    });

    it("returns true for single player when marked done", () => {
      const map = { 1: true };
      const result = allBuildsMarkedDone(map, 1);
      expect(result).toBe(true);
    });

    it("handles empty map", () => {
      const map = {};
      const result = allBuildsMarkedDone(map, 2);
      expect(result).toBe(false);
    });
  });

  describe("shouldAutoMarkBuildDone", () => {
    it("returns true when all conditions met", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: true,
          seatId: 1,
          buildDone: { 1: false, 2: false },
        },
        state: {
          pestilence: false,
          forceForfeit: false,
          pendingPopulation: null,
          pendingSpringhouseTarget: null,
        },
      });
      expect(result).toBe(true);
    });

    it("returns false when multiplayer not active", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: false,
        p2pUiState: {
          splitLocked: true,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {},
      });
      expect(result).toBe(false);
    });

    it("returns false when split not locked and no pestilence/forfeit", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: false,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pestilence: false,
          forceForfeit: false,
        },
      });
      expect(result).toBe(false);
    });

    it("returns true when split not locked but pestilence active", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: false,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pestilence: true,
          forceForfeit: false,
          pendingPopulation: null,
          pendingSpringhouseTarget: null,
        },
      });
      expect(result).toBe(true);
    });

    it("returns true when split not locked but forceForfeit active", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: false,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pestilence: false,
          forceForfeit: true,
          pendingPopulation: null,
          pendingSpringhouseTarget: null,
        },
      });
      expect(result).toBe(true);
    });

    it("returns false when already marked done", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: true,
          seatId: 1,
          buildDone: { 1: true },
        },
        state: {},
      });
      expect(result).toBe(false);
    });

    it("returns false when population placement pending", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: true,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pendingPopulation: { remaining: 1 },
          pendingSpringhouseTarget: null,
        },
      });
      expect(result).toBe(false);
    });

    it("returns false when springhouse target pending", () => {
      const result = shouldAutoMarkBuildDone({
        force: false,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: true,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pendingPopulation: null,
          pendingSpringhouseTarget: [1, 2],
        },
      });
      expect(result).toBe(false);
    });

    it("returns true when force is true regardless of other conditions", () => {
      const result = shouldAutoMarkBuildDone({
        force: true,
        isMultiplayerActive: true,
        p2pUiState: {
          splitLocked: false,
          seatId: 1,
          buildDone: { 1: false },
        },
        state: {
          pestilence: false,
          forceForfeit: false,
          pendingPopulation: null,
          pendingSpringhouseTarget: null,
        },
      });
      expect(result).toBe(true);
    });
  });

  describe("mergeStateMap", () => {
    it("preserves true values from either map", async () => {
      const { mergeStateMap } = await import("../app/multiplayer-state.js");
      const local = { 1: true, 2: false };
      const incoming = { 1: false, 2: true };
      const result = mergeStateMap(local, incoming, 2, 1);
      expect(result).toEqual({ 1: true, 2: true });
    });

    it("ensures own seat's true value is preserved", async () => {
      const { mergeStateMap } = await import("../app/multiplayer-state.js");
      const local = { 1: true, 2: false };
      const incoming = { 1: false, 2: false };
      const result = mergeStateMap(local, incoming, 2, 1);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("handles null or undefined maps", async () => {
      const { mergeStateMap } = await import("../app/multiplayer-state.js");
      const result = mergeStateMap(null, { 1: true }, 2, 1);
      expect(result).toEqual({ 1: true, 2: false });
    });

    it("creates entries for all seats", async () => {
      const { mergeStateMap } = await import("../app/multiplayer-state.js");
      const local = { 1: true };
      const incoming = { 2: true };
      const result = mergeStateMap(local, incoming, 3, 1);
      expect(result).toEqual({ 1: true, 2: true, 3: false });
    });
  });

  describe("validateMultiplayerState", () => {
    it("returns valid when all checks pass", async () => {
      const { validateMultiplayerState } = await import("../app/multiplayer-state.js");
      const result = validateMultiplayerState({
        p2pUiState: {
          seatId: 1,
          splitLocked: true,
          splitUsed: { 1: true, 2: false },
          buildDone: { 1: true, 2: false },
        },
        state: { dice: [{ face: 2 }] },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("detects splitLocked without any splitUsed", async () => {
      const { validateMultiplayerState } = await import("../app/multiplayer-state.js");
      const result = validateMultiplayerState({
        p2pUiState: {
          seatId: 1,
          splitLocked: true,
          splitUsed: { 1: false, 2: false },
          buildDone: { 1: false, 2: false },
        },
        state: { dice: [{ face: 2 }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('splitLocked is true but no player has splitUsed set');
    });

    it("detects buildDone without splitUsed for same player", async () => {
      const { validateMultiplayerState } = await import("../app/multiplayer-state.js");
      const result = validateMultiplayerState({
        p2pUiState: {
          seatId: 1,
          splitLocked: false,
          splitUsed: { 1: false, 2: false },
          buildDone: { 1: true, 2: false },
        },
        state: { dice: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Player 1 has buildDone but not splitUsed');
    });

    it("detects own seat inconsistency", async () => {
      const { validateMultiplayerState } = await import("../app/multiplayer-state.js");
      const result = validateMultiplayerState({
        p2pUiState: {
          seatId: 1,
          splitLocked: false,
          splitUsed: { 1: false, 2: true },
          buildDone: { 1: true, 2: false },
        },
        state: { dice: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Own seat 1 has buildDone but not splitUsed');
    });

    it("allows splitLocked without splitUsed when no dice", async () => {
      const { validateMultiplayerState } = await import("../app/multiplayer-state.js");
      const result = validateMultiplayerState({
        p2pUiState: {
          seatId: 1,
          splitLocked: true,
          splitUsed: { 1: false, 2: false },
          buildDone: { 1: false, 2: false },
        },
        state: { dice: [] },
      });
      expect(result.valid).toBe(true);
    });
  });
});
