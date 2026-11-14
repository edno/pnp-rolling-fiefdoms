// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setControlState,
  initKeyboardActivation,
  captureFocus,
  restoreFocus,
  moveGridFocus,
  openModal,
  closeModal,
} from "../app/a11y.js";

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

describe("openModal / closeModal", () => {
  function buildPage() {
    document.body.innerHTML = `
      <main id="page"><button id="behind">behind</button></main>
      <div id="modalA" class="modal-overlay">
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <button id="a1">first</button>
          <button id="a2" hidden>hidden</button>
          <button id="a3">last</button>
        </div>
      </div>
      <div id="modalB" class="modal-overlay">
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <p>no controls</p>
        </div>
      </div>
    `;
    return {
      page: document.getElementById("page"),
      behind: document.getElementById("behind"),
      overlayA: document.getElementById("modalA"),
      overlayB: document.getElementById("modalB"),
    };
  }

  function press(target, k, shiftKey = false) {
    const e = new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  }

  afterEach(() => {
    closeModal(document.getElementById("modalA"));
    closeModal(document.getElementById("modalB"));
    document.body.innerHTML = "";
  });

  it("makes the other body children inert but not the overlay itself", () => {
    const { page, overlayA } = buildPage();
    openModal(overlayA);
    expect(page.hasAttribute("inert")).toBe(true);
    expect(overlayA.hasAttribute("inert")).toBe(false);
  });

  it("leaves a pre-existing inert alone on close", () => {
    const { page, overlayA } = buildPage();
    page.setAttribute("inert", "");
    openModal(overlayA);
    closeModal(overlayA);
    expect(page.hasAttribute("inert")).toBe(true);
  });

  it("focuses initialFocus when given and connected", () => {
    const { overlayA } = buildPage();
    const target = document.getElementById("a3");
    openModal(overlayA, { initialFocus: target });
    expect(document.activeElement).toBe(target);
  });

  it("focuses the first focusable element, skipping hidden ones", () => {
    const { overlayA } = buildPage();
    openModal(overlayA);
    expect(document.activeElement.id).toBe("a1");
  });

  it("falls back to the dialog when nothing inside is focusable", () => {
    const { overlayB } = buildPage();
    openModal(overlayB);
    const dialog = overlayB.querySelector(".modal-dialog");
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("tabindex")).toBe("-1");
  });

  it("wraps Tab from the last focusable element to the first", () => {
    const { overlayA } = buildPage();
    openModal(overlayA);
    document.getElementById("a3").focus();
    const e = press(document.getElementById("a3"), "Tab");
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe("a1");
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    const { overlayA } = buildPage();
    openModal(overlayA);
    const e = press(document.getElementById("a1"), "Tab", true);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe("a3");
  });

  it("removes inert and returns focus to the previously focused element on close", () => {
    const { page, behind, overlayA } = buildPage();
    behind.focus();
    openModal(overlayA);
    expect(document.activeElement.id).toBe("a1");
    closeModal(overlayA);
    expect(page.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(behind);
  });

  it("restores nested modals in reverse order", () => {
    const { page, behind, overlayA, overlayB } = buildPage();
    behind.focus();
    openModal(overlayA);
    openModal(overlayB);
    expect(overlayA.hasAttribute("inert")).toBe(true);
    closeModal(overlayB);
    expect(overlayA.hasAttribute("inert")).toBe(false);
    expect(page.hasAttribute("inert")).toBe(true);
    expect(document.activeElement.id).toBe("a1");
    closeModal(overlayA);
    expect(page.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(behind);
  });

  it("is a no-op when the same overlay is opened twice", () => {
    const { behind, overlayA } = buildPage();
    behind.focus();
    openModal(overlayA);
    document.getElementById("a3").focus();
    openModal(overlayA);
    expect(document.activeElement.id).toBe("a3");
    closeModal(overlayA);
    expect(document.activeElement).toBe(behind);
  });
});
