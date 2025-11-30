import { describe, it, expect, vi } from "vitest";
import { rollNumberedDie, rollXDie, getCryptoRange } from "../app/dice.js";

describe("dice utils", () => {
  it("rollNumberedDie returns die shape", () => {
    const die = rollNumberedDie("N1");
    expect(die).toHaveProperty("face");
    expect(die).toHaveProperty("resolved");
    expect(die.label).toBe("N1");
  });

  it("rollXDie returns die shape", () => {
    const die = rollXDie("X1");
    expect(die).toHaveProperty("face");
    expect(die.label).toBe("X1");
  });

  it("getCryptoRange falls back to Math.random when crypto is missing", () => {
    const originalCrypto = globalThis.crypto;
    // Some environments prevent redefining; use delete on a shadow copy.
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const val = getCryptoRange(1, 6);
    expect(val).toBeGreaterThanOrEqual(1);
    expect(val).toBeLessThanOrEqual(6);
    spy.mockRestore();
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  });
});
