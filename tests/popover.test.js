/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setPopover, initPopovers, hidePopover } from "../app/popover.js";

describe("setPopover", () => {
  it("sets data.popover, a describedby description, and has-popover class", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text");

    expect(el.dataset.popover).toBe("Test text");
    expect(el.hasAttribute("aria-label")).toBe(false);
    const descId = el.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const descEl = document.getElementById(descId);
    expect(descEl.textContent).toBe("Test text");
    expect(descEl.className).toBe("visually-hidden");
    expect(el.classList.contains("has-popover")).toBe(true);
  });

  it("preserves existing aria-label", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Existing label");
    setPopover(el, "Test text");

    expect(el.dataset.popover).toBe("Test text");
    expect(el.getAttribute("aria-label")).toBe("Existing label");
  });

  it("preserves an existing aria-describedby id and appends its own", () => {
    const el = document.createElement("button");
    const authorDesc = document.createElement("span");
    authorDesc.id = "author-desc";
    document.body.appendChild(authorDesc);
    el.setAttribute("aria-describedby", "author-desc");
    setPopover(el, "Test text");

    const ids = el.getAttribute("aria-describedby").split(/\s+/);
    expect(ids).toContain("author-desc");
    expect(ids.length).toBe(2);
    authorDesc.remove();
  });

  it("updates the description text in place without creating a new span", () => {
    const el = document.createElement("button");
    setPopover(el, "First text");
    const descId = el.getAttribute("aria-describedby");

    setPopover(el, "Second text");
    expect(el.getAttribute("aria-describedby")).toBe(descId);
    expect(document.getElementById(descId).textContent).toBe("Second text");
  });

  it("doesn't leak description spans when targets are replaced across re-renders", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    for (let i = 0; i < 100; i += 1) {
      container.innerHTML = ""; // simulate clearElement() discarding the old target
      const el = document.createElement("button");
      container.appendChild(el);
      setPopover(el, `Text ${i}`);
    }
    // The sweep that removes stale description spans is amortized to a single
    // microtask per batch of setPopover() calls rather than running inline on
    // every call, so give it a tick to run before asserting.
    await Promise.resolve();
    const spans = document.querySelectorAll("[id^='rf-pop-desc-']");
    expect(spans.length).toBe(1);
    container.remove();
  });

  it("amortizes the sweep to a single pass per microtask instead of per call", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const spanCount = () => document.querySelectorAll("[id^='rf-pop-desc-']").length;

    // A previous test's sweep may still be pending (the amortized sweep only
    // runs on the *next* setPopover() call after an element disconnects, not
    // immediately), so run one dummy call-and-flush cycle first to settle
    // the map before measuring this test's own baseline.
    const flusher = document.createElement("button");
    container.appendChild(flusher);
    setPopover(flusher, "flush");
    await Promise.resolve();
    const baseline = spanCount();
    const els = [];
    for (let i = 0; i < 10; i += 1) {
      const el = document.createElement("button");
      container.appendChild(el);
      els.push(el);
      setPopover(el, `Text ${i}`);
    }
    // All 10 owned description spans should exist immediately...
    expect(spanCount() - baseline).toBe(10);

    // ...removing one target from the DOM shouldn't synchronously sweep it...
    els[0].remove();
    setPopover(els[1], "Updated text");
    expect(spanCount() - baseline).toBe(10);

    // ...but it should be gone after the scheduled sweep runs.
    await Promise.resolve();
    expect(spanCount() - baseline).toBe(9);

    container.remove();
  });

  it("removes only the description span and id it owns when cleared", () => {
    const el = document.createElement("button");
    const authorDesc = document.createElement("span");
    authorDesc.id = "author-desc";
    document.body.appendChild(authorDesc);
    el.setAttribute("aria-describedby", "author-desc");
    setPopover(el, "Test text");
    const ownedId = el.dataset.popoverDescId;

    setPopover(el, null);
    expect(el.getAttribute("aria-describedby")).toBe("author-desc");
    expect(document.getElementById(ownedId)).toBeNull();
    authorDesc.remove();
  });

  it("removes title attribute", () => {
    const el = document.createElement("button");
    el.setAttribute("title", "Old title");
    setPopover(el, "Test text");

    expect(el.hasAttribute("title")).toBe(false);
  });

  it("removes popover data with null/empty text", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text");
    expect(el.dataset.popover).toBe("Test text");

    setPopover(el, null);
    expect(el.dataset.popover).toBeUndefined();
    expect(el.classList.contains("has-popover")).toBe(false);

    setPopover(el, "Test again");
    setPopover(el, "");
    expect(el.dataset.popover).toBeUndefined();
  });

  it("handles null element gracefully", () => {
    // Should not throw
    setPopover(null, "Test text");
  });

  it("sets data-popover-tap to false when tap option is false", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text", { tap: false });

    expect(el.dataset.popoverTap).toBe("false");
  });

  it("removes data-popover-tap when tap option is true or omitted", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text", { tap: false });
    expect(el.dataset.popoverTap).toBe("false");

    setPopover(el, "Test text", { tap: true });
    expect(el.dataset.popoverTap).toBeUndefined();

    setPopover(el, "Test text");
    expect(el.dataset.popoverTap).toBeUndefined();
  });

  it("clears data-popover-tap when popover is removed", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text", { tap: false });
    expect(el.dataset.popoverTap).toBe("false");

    setPopover(el, null);
    expect(el.dataset.popoverTap).toBeUndefined();
  });

  it("adds tabindex=0 to a non-focusable element like a div", () => {
    const el = document.createElement("div");
    setPopover(el, "Test text");

    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("does not add tabindex to a non-focusable element when tap is false (e.g. board cells)", () => {
    const el = document.createElement("div");
    setPopover(el, "Test text", { tap: false });

    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  it("does not add tabindex to a naturally focusable element like a button", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text");

    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  it("removes the tabindex it added when the popover is cleared", () => {
    const el = document.createElement("div");
    setPopover(el, "Test text");
    expect(el.getAttribute("tabindex")).toBe("0");

    setPopover(el, null);
    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  it("does not remove a pre-existing tabindex when the popover is cleared", () => {
    const el = document.createElement("div");
    el.setAttribute("tabindex", "-1");
    setPopover(el, "Test text");
    expect(el.getAttribute("tabindex")).toBe("-1");

    setPopover(el, null);
    expect(el.getAttribute("tabindex")).toBe("-1");
  });

  it("still stores the plain-text version in dataset.popover and the description span when a render option is given", () => {
    const el = document.createElement("button");
    setPopover(el, "Plain text version", { render: (container) => (container.textContent = "Rich version") });

    expect(el.dataset.popover).toBe("Plain text version");
    const descId = el.getAttribute("aria-describedby");
    expect(document.getElementById(descId).textContent).toBe("Plain text version");
  });

  it("drops a previously set render option when a later setPopover call omits it", () => {
    const el = document.createElement("button");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const existing = document.querySelector(".rf-popover");
    if (existing) existing.remove();
    initPopovers(container);
    container.appendChild(el);

    setPopover(el, "First", { render: (c) => (c.textContent = "Rich First") });
    el.click();
    const popover = document.querySelector(".rf-popover");
    expect(popover.textContent).toBe("Rich First");
    el.click(); // toggle off

    setPopover(el, "Second");
    el.click();
    expect(popover.textContent).toBe("Second");

    popover.remove();
    container.remove();
  });
});

describe("initPopovers", () => {
  let root;

  beforeEach(() => {
    // Clear any existing popover element
    const existing = document.querySelector(".rf-popover");
    if (existing) {
      existing.remove();
    }

    root = document.createElement("div");
    document.body.appendChild(root);

    // Reset the module's initialized flag by creating a fresh root
    // Note: We can't directly reset the flag, but initPopovers should be idempotent
  });

  afterEach(() => {
    const popover = document.querySelector(".rf-popover");
    if (popover) {
      popover.remove();
    }
    if (root && root.parentNode) {
      root.remove();
    }
  });

  it("creates popover element on first call", () => {
    initPopovers(root);
    const popover = document.querySelector(".rf-popover");
    expect(popover).toBeTruthy();
    expect(popover.getAttribute("role")).toBe("tooltip");
    expect(popover.hidden).toBe(true);
  });

  it("shows popover on click of element with data-popover", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Click text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");
    btn.click();

    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toBe("Click text");
  });

  it("builds rich DOM content via the render option when shown, instead of the plain text", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    root.appendChild(btn);
    setPopover(btn, "Cottage (Special)\nNo Labourers needed", {
      tap: true,
      render: (container) => {
        const strong = document.createElement("strong");
        strong.textContent = "Cottage";
        container.appendChild(strong);
      },
    });

    const popover = document.querySelector(".rf-popover");
    btn.click();

    expect(popover.hidden).toBe(false);
    expect(popover.querySelector("strong")?.textContent).toBe("Cottage");
    expect(popover.textContent).toBe("Cottage");
  });

  it("toggles popover on second click", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Click text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    btn.click();
    expect(popover.hidden).toBe(false);

    btn.click();
    expect(popover.hidden).toBe(true);
  });

  it("does not show popover on click when tap is false", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Click text";
    btn.dataset.popoverTap = "false";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    btn.click();
    expect(popover.hidden).toBe(true);
  });

  it("hides popover on click outside", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Click text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    btn.click();
    expect(popover.hidden).toBe(false);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.click();

    expect(popover.hidden).toBe(true);
    outside.remove();
  });

  it("tap-to-show works: pointerdown -> focusin -> click shows (not hides) the popover; a second click toggles it off", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Tap text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    // Realistic touch-tap sequence on a target made focusable by setPopover.
    btn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    btn.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(popover.hidden).toBe(false);
    btn.click();
    expect(popover.hidden).toBe(false);

    // A later, deliberate click toggles it off.
    btn.click();
    expect(popover.hidden).toBe(true);
  });

  it("hides a stale popover whose target was removed by a re-render (e.g. renderBoard rebuilding cells)", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Stale text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");
    btn.click();
    expect(popover.hidden).toBe(false);

    // Simulate a render replacing the target element entirely, without ever
    // calling hidePopover/setPopover(null) on the old one.
    btn.remove();

    // The next setPopover call elsewhere in that render pass should notice the
    // stale target and hide the popover.
    const other = document.createElement("button");
    setPopover(other, "Other text");

    expect(popover.hidden).toBe(true);
  });

  it("hides popover on Escape key", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Click text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    btn.click();
    expect(popover.hidden).toBe(false);

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);

    expect(popover.hidden).toBe(true);
  });

  it("shows popover on mouse pointerenter and hides on pointerleave", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Hover text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    // Simulate mouse pointerenter
    const enterEvent = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    btn.dispatchEvent(enterEvent);
    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toBe("Hover text");

    // Simulate mouse pointerleave
    const leaveEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveEvent, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    btn.dispatchEvent(leaveEvent);
    expect(popover.hidden).toBe(true);
  });

  it("does not hide popover when pointer moves to a descendant of the same target", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Hover text";
    const child = document.createElement("span");
    btn.appendChild(child);
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    const enterEvent = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent, "pointerType", { value: "mouse", enumerable: true });
    btn.dispatchEvent(enterEvent);
    expect(popover.hidden).toBe(false);

    // Leaving the target towards a child it contains (relatedTarget is the
    // descendant) must not hide the tooltip.
    const leaveEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveEvent, "pointerType", { value: "mouse", enumerable: true });
    Object.defineProperty(leaveEvent, "relatedTarget", { value: child, enumerable: true });
    btn.dispatchEvent(leaveEvent);
    expect(popover.hidden).toBe(false);

    // Leaving the target entirely (relatedTarget outside) must hide it.
    const outside = document.createElement("div");
    root.appendChild(outside);
    const leaveOutsideEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveOutsideEvent, "pointerType", { value: "mouse", enumerable: true });
    Object.defineProperty(leaveOutsideEvent, "relatedTarget", { value: outside, enumerable: true });
    btn.dispatchEvent(leaveOutsideEvent);
    expect(popover.hidden).toBe(true);
  });

  it("shows popover on focusin and hides on focusout", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Focus text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    // Focus
    btn.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toBe("Focus text");

    // Unfocus
    btn.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(popover.hidden).toBe(true);
  });

  it("shows popover when focusing a div target via setPopover", () => {
    initPopovers(root);
    const div = document.createElement("div");
    setPopover(div, "Div focus text");
    root.appendChild(div);

    const popover = document.querySelector(".rf-popover");

    div.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toBe("Div focus text");
  });

  it("handles non-Element targets in event handlers without throwing", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);

    // Dispatch a pointerover on document (e.target will be document, not an Element)
    // This should not throw
    expect(() => {
      const event = new Event("pointerover", { bubbles: true });
      Object.defineProperty(event, "pointerType", {
        value: "mouse",
        enumerable: true,
      });
      document.dispatchEvent(event);
    }).not.toThrow();
  });

  it("hides popover on window scroll event", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    // Show popover
    btn.click();
    expect(popover.hidden).toBe(false);

    // Dispatch scroll event on window
    window.dispatchEvent(new Event("scroll"));

    // Popover should be hidden
    expect(popover.hidden).toBe(true);
  });

  it("hides popover on scroll of nested scrollable element (capture phase)", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);

    // Create a nested scrollable container
    const scrollContainer = document.createElement("div");
    scrollContainer.style.overflow = "auto";
    scrollContainer.style.height = "100px";
    root.appendChild(scrollContainer);

    const popover = document.querySelector(".rf-popover");

    // Show popover
    btn.click();
    expect(popover.hidden).toBe(false);

    // Dispatch scroll event on the nested container (bubbles: false by default)
    // This tests that capture phase listening catches it
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: false }));

    // Popover should be hidden
    expect(popover.hidden).toBe(true);
  });

  it("hides popover on window resize event", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");

    // Show popover
    btn.click();
    expect(popover.hidden).toBe(false);

    // Dispatch resize event on window
    window.dispatchEvent(new Event("resize"));

    // Popover should be hidden
    expect(popover.hidden).toBe(true);
  });
});

describe("popover positioning clamp", () => {
  let root;

  beforeEach(() => {
    const existing = document.querySelector(".rf-popover");
    if (existing) existing.remove();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    const popover = document.querySelector(".rf-popover");
    if (popover) popover.remove();
    if (root && root.parentNode) root.remove();
  });

  it("clamps the popover's top within the viewport when flipped below on a short screen", () => {
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });

    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);
    const popover = document.querySelector(".rf-popover");

    // Target near the top, so showPopover() flips below; stub rects so the
    // flipped position would otherwise render off the bottom of a short
    // viewport.
    btn.getBoundingClientRect = () => ({ top: 5, bottom: 20, left: 10, right: 90, width: 80, height: 15 });
    popover.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 100, width: 100, height: 60 });

    btn.click();

    const top = parseFloat(popover.style.top);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(window.innerHeight - 60 - 8);
  });

  it("caps max-height and enables overflow auto when taller than the viewport", () => {
    Object.defineProperty(window, "innerHeight", { value: 50, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });

    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test text";
    root.appendChild(btn);
    const popover = document.querySelector(".rf-popover");

    btn.getBoundingClientRect = () => ({ top: 5, bottom: 20, left: 10, right: 90, width: 80, height: 15 });
    popover.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 100, width: 100, height: 200 });

    btn.click();

    expect(popover.style.maxHeight).toBe("34px");
    expect(popover.style.overflow).toBe("auto");
  });

  it("clears a stale maxHeight cap before measuring a new popover (border-box re-measure bug)", () => {
    Object.defineProperty(window, "innerHeight", { value: 50, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });

    initPopovers(root);
    const btn1 = document.createElement("button");
    btn1.dataset.popover = "First";
    const btn2 = document.createElement("button");
    btn2.dataset.popover = "Second";
    root.appendChild(btn1);
    root.appendChild(btn2);
    const popover = document.querySelector(".rf-popover");

    btn1.getBoundingClientRect = () => ({ top: 5, bottom: 20, left: 10, right: 90, width: 80, height: 15 });
    btn2.getBoundingClientRect = () => ({ top: 5, bottom: 20, left: 10, right: 90, width: 80, height: 15 });

    // Simulate real border-box layout: once a maxHeight/overflow cap is
    // applied, getBoundingClientRect() reports the *clamped* height until
    // the cap is cleared again (jsdom doesn't lay out CSS, so a plain fixed
    // stub can't reproduce this, which is why the bug wasn't caught before).
    let realHeight = 200; // first popover: way over the viewport
    popover.getBoundingClientRect = () => {
      const capped = parseFloat(popover.style.maxHeight);
      const height = Number.isFinite(capped) ? Math.min(realHeight, capped) : realHeight;
      return { top: 0, bottom: height, left: 0, right: 100, width: 100, height };
    };

    btn1.click(); // caps at 34px (innerHeight 50 - 2*margin 8)
    expect(popover.style.maxHeight).toBe("34px");

    // Second popover is shorter (40px) than the stale cap's measured value
    // would suggest, but still taller than the 34px cap, so it must be
    // capped again. If the stale maxHeight isn't cleared before measuring,
    // the element measures as min(40, 34) = 34, "34 > 34" is false, the cap
    // is wrongly removed, and the popover renders at its real 40px past the
    // viewport bottom.
    realHeight = 40;
    btn2.click();

    expect(popover.style.maxHeight).toBe("34px");
    expect(popover.style.overflow).toBe("auto");
    const top = parseFloat(popover.style.top);
    const finalHeight = Math.min(realHeight, 34);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(window.innerHeight - finalHeight - 8);
  });
});

describe("hidePopover", () => {
  let root;

  beforeEach(() => {
    const existing = document.querySelector(".rf-popover");
    if (existing) {
      existing.remove();
    }

    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    const popover = document.querySelector(".rf-popover");
    if (popover) {
      popover.remove();
    }
    if (root && root.parentNode) {
      root.remove();
    }
  });

  it("hides the popover", () => {
    initPopovers(root);
    const btn = document.createElement("button");
    btn.dataset.popover = "Test";
    root.appendChild(btn);

    const popover = document.querySelector(".rf-popover");
    btn.click();
    expect(popover.hidden).toBe(false);

    hidePopover();
    expect(popover.hidden).toBe(true);
  });
});
