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

  it("adds tabindex=0 to a non-focusable element like a div", () => {
    const el = document.createElement("div");
    setPopover(el, "Test text");

    expect(el.getAttribute("tabindex")).toBe("0");
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
