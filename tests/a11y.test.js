// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { setControlState, initKeyboardActivation, captureFocus, restoreFocus, moveGridFocus } from "../app/a11y.js";

function key(target, k) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe("setControlState", () => {
  it("sets role, label, pressed and tabindex for an enabled control", () => {
    const el = document.createElement("div");
    setControlState(el, { label: "Hi", pressed: true });
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Hi");
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.hasAttribute("aria-disabled")).toBe(false);
  });

  it("marks disabled controls and honours a tabindex override", () => {
    const el = document.createElement("div");
    setControlState(el, { label: "x", disabled: true });
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("tabindex")).toBe("-1");
    setControlState(el, { disabled: false, tabindex: -1 });
    expect(el.hasAttribute("aria-disabled")).toBe(false);
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(el.hasAttribute("aria-pressed")).toBe(false);
  });
});

describe("initKeyboardActivation", () => {
  it("activates role=button divs on Enter and Space, ignores disabled ones, and is idempotent", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    initKeyboardActivation(root);
    initKeyboardActivation(root);
    const div = document.createElement("div");
    setControlState(div, { label: "a" });
    const onClick = vi.fn();
    div.addEventListener("click", onClick);
    root.appendChild(div);
    expect(key(div, "Enter").defaultPrevented).toBe(true);
    key(div, " ");
    expect(onClick).toHaveBeenCalledTimes(2);
    key(div, "a");
    expect(onClick).toHaveBeenCalledTimes(2);
    setControlState(div, { label: "a", disabled: true });
    key(div, "Enter");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not double-activate native buttons", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    initKeyboardActivation(root);
    const btn = document.createElement("button");
    btn.setAttribute("role", "button");
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);
    root.appendChild(btn);
    key(btn, "Enter");
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("captureFocus / restoreFocus", () => {
  it("restores focus to the matching element after a rebuild", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const build = () => {
      container.innerHTML = "";
      [["0", "0"], ["1", "2"]].forEach(([r, c]) => {
        const d = document.createElement("div");
        d.tabIndex = 0;
        d.dataset.row = r;
        d.dataset.col = c;
        container.appendChild(d);
      });
    };
    build();
    container.children[1].focus();
    const token = captureFocus(container);
    build();
    expect(document.activeElement).not.toBe(container.children[1]);
    restoreFocus(container, token);
    expect(document.activeElement).toBe(container.children[1]);
  });

  it("works with data-code and is a no-op when focus is elsewhere", () => {
    const container = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(container, outside);
    const hit = document.createElement("div");
    hit.tabIndex = 0;
    hit.dataset.code = "GF";
    container.appendChild(hit);
    outside.focus();
    expect(captureFocus(container)).toBeNull();
    restoreFocus(container, null);
    expect(document.activeElement).toBe(outside);
    hit.focus();
    expect(captureFocus(container)).toEqual({ code: "GF" });
  });
});

describe("moveGridFocus", () => {
  it("moves focus with arrow keys and clamps at the edges", () => {
    const grid = document.createElement("div");
    document.body.appendChild(grid);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const d = document.createElement("div");
        d.className = "cell";
        d.dataset.row = r;
        d.dataset.col = c;
        d.tabIndex = -1;
        grid.appendChild(d);
      }
    }
    const at = (r, c) => grid.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    at(0, 0).focus();
    const send = (k) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      Object.defineProperty(e, "target", { value: document.activeElement });
      return moveGridFocus(grid, e);
    };
    send("ArrowLeft");
    expect(document.activeElement).toBe(at(0, 0));
    send("ArrowRight");
    expect(document.activeElement).toBe(at(0, 1));
    expect(at(0, 1).getAttribute("tabindex")).toBe("0");
    expect(at(0, 0).getAttribute("tabindex")).toBe("-1");
    send("ArrowRight");
    expect(document.activeElement).toBe(at(0, 1));
    send("ArrowDown");
    send("ArrowDown");
    expect(document.activeElement).toBe(at(1, 1));
    expect(send("Enter")).toBe(false);
  });
});
