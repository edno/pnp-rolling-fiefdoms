/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guideTo } from "../app/scroll-guide.js";

function stubMatchMedia({ narrow = true, reduceMotion = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes("max-width") ? narrow : query.includes("prefers-reduced-motion") ? reduceMotion : false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
  }));
}

function stubActionBar(height = 50) {
  const bar = document.createElement("div");
  bar.className = "action-bar";
  bar.getBoundingClientRect = () => ({ height, top: 0, bottom: height });
  document.body.appendChild(bar);
  return bar;
}

describe("guideTo", () => {
  let originalMatchMedia;
  let originalInnerHeight;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalInnerHeight = window.innerHeight;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
  });

  it("does nothing when el is null", () => {
    stubMatchMedia({ narrow: true });
    expect(() => guideTo(null)).not.toThrow();
  });

  it("does nothing on wide screens", () => {
    stubMatchMedia({ narrow: false });
    stubActionBar();
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100 });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when the element is already fully visible below the action bar", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 100, bottom: 200 });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls smoothly to a hidden element on narrow screens", () => {
    stubMatchMedia({ narrow: true, reduceMotion: false });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100 });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("respects prefers-reduced-motion and a custom block option", () => {
    stubMatchMedia({ narrow: true, reduceMotion: true });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100 });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el, { block: "start" });

    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("scrolls when the element is hidden above the sticky action bar", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 10, bottom: 40 });
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(el.scrollIntoView).toHaveBeenCalled();
  });
});
