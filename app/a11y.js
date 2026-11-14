// Small DOM helpers for keyboard and screen-reader support. No game logic.

const NATIVE_INTERACTIVE = /^(button|a|input|select|textarea|summary)$/i;
const ID_ATTRS = [
  ["row", "col"],
  ["nodeRow", "nodeCol"],
  ["code"],
];

/**
 * Marks a non-native element as an accessible button.
 * tabindex defaults to "0" when enabled and "-1" when disabled unless overridden.
 */
export function setControlState(el, { label, disabled, pressed, tabindex } = {}) {
  if (!el) return;
  el.setAttribute("role", "button");
  if (label) el.setAttribute("aria-label", label);
  if (disabled) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
  if (typeof pressed === "boolean") el.setAttribute("aria-pressed", String(pressed));
  else el.removeAttribute("aria-pressed");
  el.setAttribute("tabindex", tabindex !== undefined ? String(tabindex) : disabled ? "-1" : "0");
}

const activationRoots = new WeakSet();

/** One delegated keydown listener: Enter/Space clicks role="button" non-native elements. */
export function initKeyboardActivation(root = document) {
  if (!root || activationRoots.has(root)) return;
  activationRoots.add(root);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const target = e.target;
    if (!target || typeof target.getAttribute !== "function") return;
    if (target.getAttribute("role") !== "button") return;
    if (NATIVE_INTERACTIVE.test(target.tagName)) return;
    if (target.getAttribute("aria-disabled") === "true") return;
    e.preventDefault();
    target.click();
  });
}

/** Returns a token identifying the focused element inside container, or null. */
export function captureFocus(container) {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!container || !active || active === container || !container.contains(active)) return null;
  for (const attrs of ID_ATTRS) {
    if (attrs.every((a) => active.dataset?.[a] !== undefined)) {
      const token = {};
      attrs.forEach((a) => {
        token[a] = active.dataset[a];
      });
      return token;
    }
  }
  return null;
}

/** Re-focuses the element matching a token from captureFocus() after a rebuild. */
export function restoreFocus(container, token) {
  if (!container || !token) return;
  // Compare dataset values directly rather than building a selector string from them.
  const keys = Object.keys(token);
  const next = Array.from(container.querySelectorAll("[data-row], [data-node-row], [data-code]")).find((el) =>
    keys.every((key) => el.dataset?.[key] === token[key]),
  );
  if (next && typeof next.focus === "function") next.focus({ preventScroll: true });
}

/** Arrow-key navigation among .cell elements by data-row/data-col, clamped at edges. */
export function moveGridFocus(container, event) {
  if (!container || !event) return false;
  const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = deltas[event.key];
  const current = event.target?.closest?.(".cell");
  if (!delta || !current || !container.contains(current)) return false;
  const cells = Array.from(container.querySelectorAll(".cell"));
  const rows = cells.map((c) => Number(c.dataset.row));
  const cols = cells.map((c) => Number(c.dataset.col));
  const r = Math.min(Math.max(Number(current.dataset.row) + delta[0], 0), Math.max(...rows));
  const c = Math.min(Math.max(Number(current.dataset.col) + delta[1], 0), Math.max(...cols));
  const next = container.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  event.preventDefault();
  if (next && next !== current) {
    cells.forEach((cell) => cell.setAttribute("tabindex", "-1"));
    next.setAttribute("tabindex", "0");
    next.focus();
  }
  return true;
}

const MODAL_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];

function modalFocusables(overlay) {
  return Array.from(overlay.querySelectorAll(MODAL_FOCUSABLE)).filter((el) => {
    if (el.hasAttribute("hidden") || el.style?.display === "none") return false;
    const hiddenAncestor = el.closest("[hidden]");
    return !(hiddenAncestor && overlay.contains(hiddenAncestor));
  });
}

// Wraps Tab / Shift+Tab inside the overlay (also pulls focus back in when it has escaped).
function trapModalTab(overlay, e) {
  if (e.key !== "Tab") return;
  const items = modalFocusables(overlay);
  const active = document.activeElement;
  const outside = !active || !overlay.contains(active) || active === overlay;
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (outside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (outside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Opens a modal overlay: makes the other body children inert, moves focus into the
 * overlay (initialFocus, else first focusable, else the dialog) and traps Tab inside it.
 * Dialogs nest via a module-level stack; calling it again for an open overlay is a no-op.
 */
export function openModal(overlay, { initialFocus } = {}) {
  if (!overlay || modalStack.some((entry) => entry.overlay === overlay)) return;
  const previous = typeof document !== "undefined" ? document.activeElement : null;
  const inerted = [];
  Array.from(document.body?.children || []).forEach((el) => {
    if (el === overlay || el.contains(overlay) || el.hasAttribute("inert")) return;
    el.setAttribute("inert", "");
    inerted.push(el);
  });
  const onKeydown = (e) => trapModalTab(overlay, e);
  overlay.addEventListener("keydown", onKeydown);
  modalStack.push({ overlay, previous, inerted, onKeydown });
  let target = initialFocus && initialFocus.isConnected ? initialFocus : modalFocusables(overlay)[0];
  if (!target) {
    const dialog = overlay.querySelector(".modal-dialog") || overlay;
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    target = dialog;
  }
  if (typeof target.focus === "function") target.focus({ preventScroll: true });
}

/**
 * Closes a modal opened with openModal(): removes the inert marks it set, drops its Tab
 * trap and returns focus to the element that was focused before it opened (if still usable).
 */
export function closeModal(overlay) {
  const index = modalStack.findIndex((entry) => entry.overlay === overlay);
  if (index === -1) return;
  const [entry] = modalStack.splice(index, 1);
  entry.overlay.removeEventListener("keydown", entry.onKeydown);
  entry.inerted.forEach((el) => el.removeAttribute("inert"));
  const prev = entry.previous;
  if (prev && prev.isConnected && typeof prev.focus === "function" && !prev.hasAttribute("disabled")) {
    try {
      prev.focus({ preventScroll: true });
    } catch {
      // Focus restoration is best-effort; ignore elements that refuse focus.
    }
  }
}
