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
  let originalScrollY;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalInnerHeight = window.innerHeight;
    originalScrollY = window.scrollY;
    document.body.innerHTML = "";
    window.scrollTo = vi.fn();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    Object.defineProperty(window, "scrollY", { value: originalScrollY, configurable: true });
    vi.clearAllMocks();
  });

  it("does nothing when el is null", () => {
    stubMatchMedia({ narrow: true });
    expect(() => guideTo(null)).not.toThrow();
  });

  it("does nothing on wide screens", () => {
    stubMatchMedia({ narrow: false });
    stubActionBar();
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when the element is fully visible within the comfort zone", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    // Element at top=100 (>= 50+8=58) and bottom=200 (<= 800-8=792)
    el.getBoundingClientRect = () => ({ top: 100, bottom: 200, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls when the element sits at the bottom edge (fully visible but uncomfortable)", () => {
    stubMatchMedia({ narrow: true, reduceMotion: false });
    stubActionBar(50);
    const el = document.createElement("div");
    // Element at top=800, bottom=837 in a 844px viewport (outside 8px margin from bottom)
    // bottom=837 > (844-8)=836, so triggers scroll
    el.getBoundingClientRect = () => ({ top: 800, bottom: 837, height: 37 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

    guideTo(el);

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "smooth",
      }),
    );
  });

  it("scrolls smoothly to a hidden element on narrow screens", () => {
    stubMatchMedia({ narrow: true, reduceMotion: false });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "smooth",
      }),
    );
  });

  it("respects prefers-reduced-motion", () => {
    stubMatchMedia({ narrow: true, reduceMotion: true });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "auto",
      }),
    );
  });

  it("scrolls block start with correct offset including bar height", () => {
    stubMatchMedia({ narrow: true, reduceMotion: false });
    stubActionBar(50);
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 100, configurable: true });

    guideTo(el, { block: "start" });

    // Expected top = 100 (scrollY) + 2000 (rect.top) - 50 (barHeight) - 8 (margin) = 2042
    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 2042,
        behavior: "smooth",
      }),
    );
  });

  it("scrolls when element is under the action bar", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    // Element at top=10 (< 50+8=58), under the action bar
    el.getBoundingClientRect = () => ({ top: 10, bottom: 40, height: 30 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("uses minVisible fraction to check if enough of element is visible", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    // Element from top=750 to bottom=850 (100px tall)
    // With viewport height 844, available is 844-50=794
    // Visible part is 844-750=94px
    // With minVisible=0.6, need 0.6*min(100, 794)=0.6*100=60px visible
    // 94px >= 60px, so element is considered visible
    el.getBoundingClientRect = () => ({ top: 750, bottom: 850, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });

    guideTo(el, { minVisible: 0.6 });

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls when minVisible fraction requirement is not met", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    const el = document.createElement("div");
    // Element from top=800 to bottom=900 (100px tall)
    // With viewport height 844, available is 844-50=794
    // Visible part is 844-800=44px
    // With minVisible=0.6, need 0.6*min(100, 794)=0.6*100=60px visible
    // 44px < 60px, so need to scroll
    el.getBoundingClientRect = () => ({ top: 800, bottom: 900, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });

    guideTo(el, { minVisible: 0.6 });

    expect(window.scrollTo).toHaveBeenCalled();
  });
});
