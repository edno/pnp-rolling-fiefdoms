/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { onMouseHover } from "../app/hover.js";

describe("onMouseHover", () => {
  it("calls enter/leave on mouse pointer events", () => {
    const el = document.createElement("div");
    let enterCalled = false;
    let leaveCalled = false;

    const dispose = onMouseHover(
      el,
      () => {
        enterCalled = true;
      },
      () => {
        leaveCalled = true;
      }
    );

    // Create a pointerenter event with pointerType="mouse"
    const enterEvent = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    el.dispatchEvent(enterEvent);
    expect(enterCalled).toBe(true);

    // Create a pointerleave event with pointerType="mouse"
    const leaveEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveEvent, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    el.dispatchEvent(leaveEvent);
    expect(leaveCalled).toBe(true);

    dispose();
  });

  it("ignores touch pointer events", () => {
    const el = document.createElement("div");
    let enterCalled = false;
    let leaveCalled = false;

    const dispose = onMouseHover(
      el,
      () => {
        enterCalled = true;
      },
      () => {
        leaveCalled = true;
      }
    );

    // Create a pointerenter event with pointerType="touch"
    const enterEvent = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent, "pointerType", {
      value: "touch",
      enumerable: true,
    });
    el.dispatchEvent(enterEvent);
    expect(enterCalled).toBe(false);

    // Create a pointerleave event with pointerType="touch"
    const leaveEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveEvent, "pointerType", {
      value: "touch",
      enumerable: true,
    });
    el.dispatchEvent(leaveEvent);
    expect(leaveCalled).toBe(false);

    dispose();
  });

  it("ignores pen pointer events", () => {
    const el = document.createElement("div");
    let enterCalled = false;
    let leaveCalled = false;

    const dispose = onMouseHover(
      el,
      () => {
        enterCalled = true;
      },
      () => {
        leaveCalled = true;
      }
    );

    // Create a pointerenter event with pointerType="pen"
    const enterEvent = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent, "pointerType", {
      value: "pen",
      enumerable: true,
    });
    el.dispatchEvent(enterEvent);
    expect(enterCalled).toBe(false);

    // Create a pointerleave event with pointerType="pen"
    const leaveEvent = new Event("pointerleave", { bubbles: true });
    Object.defineProperty(leaveEvent, "pointerType", {
      value: "pen",
      enumerable: true,
    });
    el.dispatchEvent(leaveEvent);
    expect(leaveCalled).toBe(false);

    dispose();
  });

  it("returns a no-op disposer if element is null", () => {
    const dispose = onMouseHover(null, () => {}, () => {});
    expect(typeof dispose).toBe("function");
    // Should not throw
    dispose();
  });

  it("removes listeners when disposer is called", () => {
    const el = document.createElement("div");
    let enterCalled = false;

    const dispose = onMouseHover(
      el,
      () => {
        enterCalled = true;
      },
      () => {}
    );

    // Trigger before dispose
    const enterEvent1 = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent1, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    el.dispatchEvent(enterEvent1);
    expect(enterCalled).toBe(true);

    // Reset for test
    enterCalled = false;

    // Dispose
    dispose();

    // Trigger after dispose
    const enterEvent2 = new Event("pointerenter", { bubbles: true });
    Object.defineProperty(enterEvent2, "pointerType", {
      value: "mouse",
      enumerable: true,
    });
    el.dispatchEvent(enterEvent2);
    expect(enterCalled).toBe(false);
  });
});
