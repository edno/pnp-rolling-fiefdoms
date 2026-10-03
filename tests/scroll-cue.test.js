/* @vitest-environment jsdom */

import { describe, it, expect } from "vitest";
import { updateScrollCue } from "../app/scroll-cue.js";

function stubScrollMetrics(el, { scrollHeight, clientHeight, scrollTop = 0 }) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
}

describe("updateScrollCue", () => {
  it("does nothing when given no element", () => {
    expect(() => updateScrollCue(null)).not.toThrow();
  });

  it("marks an overflowing element as scrollable and not at end", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 400, clientHeight: 200, scrollTop: 0 });
    updateScrollCue(el);
    expect(el.classList.contains("is-scrollable")).toBe(true);
    expect(el.classList.contains("is-at-end")).toBe(false);
  });

  it("marks an overflowing element scrolled to the bottom as at-end", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 400, clientHeight: 200, scrollTop: 200 });
    updateScrollCue(el);
    expect(el.classList.contains("is-scrollable")).toBe(true);
    expect(el.classList.contains("is-at-end")).toBe(true);
  });

  it("marks a non-overflowing element as not scrollable and at-end", () => {
    const el = document.createElement("div");
    stubScrollMetrics(el, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    updateScrollCue(el);
    expect(el.classList.contains("is-scrollable")).toBe(false);
    expect(el.classList.contains("is-at-end")).toBe(true);
  });
});
