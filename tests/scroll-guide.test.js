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

function stubActionBarAux(bottom, { visible = true } = {}) {
  const aux = document.createElement("div");
  aux.className = "action-bar-aux";
  aux.getBoundingClientRect = () => ({ top: 0, bottom, height: bottom });
  if (!visible) aux.style.visibility = "hidden";
  document.body.appendChild(aux);
  return aux;
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

  it("tall element with block center aligns its top below the bar", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(83);
    const el = document.createElement("div");
    // Viewport: 390, Bar: 83, Available: 390-83-16=291
    // Element height: 330 (>= 291, so triggers tall condition)
    // Element at top=1000, bottom=1330
    el.getBoundingClientRect = () => ({ top: 1000, bottom: 1330, height: 330 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 390, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

    guideTo(el, { block: "center" });

    // Expected: top = 0 + 1000 - 83 - 8 = 909
    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 909,
      }),
    );
  });

  it("treats an open aux drawer as part of the obstruction when deciding visibility", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    stubActionBarAux(90, { visible: true });
    const el = document.createElement("div");
    // Element sits below the bar (50) but under the open drawer (bottom 90).
    el.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("ignores a closed (hidden) aux drawer when deciding visibility", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(50);
    stubActionBarAux(90, { visible: false });
    const el = document.createElement("div");
    // Element is clear of the bar (50) and would only be obstructed if the
    // hidden drawer's bottom (90) were (wrongly) counted.
    el.getBoundingClientRect = () => ({ top: 60, bottom: 150, height: 90 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    guideTo(el);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("short element centering never places top under the bar", () => {
    stubMatchMedia({ narrow: true });
    stubActionBar(83);
    const el = document.createElement("div");
    // Viewport: 390, Bar: 83, Available: 390-83-16=291
    // Element height: 100 (< 291, so uses center logic)
    // Element at top=500, bottom=600
    el.getBoundingClientRect = () => ({ top: 500, bottom: 600, height: 100 });
    document.body.appendChild(el);
    Object.defineProperty(window, "innerHeight", { value: 390, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

    guideTo(el, { block: "center" });

    // Calculate:
    // availableHeight = 390 - 83 = 307
    // centerOffset = (307 - 100) / 2 = 103.5
    // top (before clamp) = 0 + 500 - 83 - 103.5 = 313.5
    // Clamp to max: min(313.5, 0 + 500 - 83 - 8) = min(313.5, 409) = 313.5
    // After scroll to 313.5, element's viewport top is 500 - 313.5 = 186.5 (>= 83+8=91, OK)
    expect(window.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 313.5,
      }),
    );
  });
});
