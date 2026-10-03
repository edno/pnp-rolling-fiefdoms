/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setPopover, initPopovers, hidePopover } from "../app/popover.js";

describe("setPopover", () => {
  it("sets data.popover, aria-label, and has-popover class", () => {
    const el = document.createElement("button");
    setPopover(el, "Test text");

    expect(el.dataset.popover).toBe("Test text");
    expect(el.getAttribute("aria-label")).toBe("Test text");
    expect(el.classList.contains("has-popover")).toBe(true);
  });

  it("preserves existing aria-label", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Existing label");
    setPopover(el, "Test text");

    expect(el.dataset.popover).toBe("Test text");
    expect(el.getAttribute("aria-label")).toBe("Existing label");
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
