/*
Suggested CSS (coordinator will add to styles.css):

.rf-popover{
  position:fixed;
  z-index:1000;
  max-width:min(280px,calc(100vw - 16px));
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:8px;
  padding:6px 10px;
  font-size:15px;
  box-shadow:0 4px 12px rgba(0,0,0,.25);
  pointer-events:none;
}
*/

let currentTarget = null;
const listeners = new WeakMap();
// Optional rich-content renderers, keyed by target element: setPopover(el, text, { render })
// stores `render` here instead of stuffing DOM/markup into el.dataset (which only holds
// strings). `text` is still stored on el.dataset.popover and mirrored into the hidden
// description span, so assistive tech and the plain-text fallback are unaffected either way.
const richRenderers = new WeakMap();
let windowListenersAdded = false;
let descCounter = 0;
// Tracks description spans this helper owns, keyed by id, via a WeakRef to the
// owning element so re-renders that discard the old element (e.g. clearElement
// + rebuild) don't leak a description span per target forever: each setPopover
// call sweeps entries whose owner has been disconnected from the document.
const descOwners = new Map();

function sweepDisconnectedDescriptions() {
  for (const [descId, ref] of descOwners) {
    const owner = ref.deref();
    if (!owner || !owner.isConnected) {
      const descEl = document.getElementById(descId);
      if (descEl) descEl.remove();
      descOwners.delete(descId);
    }
  }
}

// setPopover() runs for every target on every render pass (40+ targets per
// pass), and a per-call sweep over descOwners (40-80 entries, each requiring
// a getElementById) made that quadratic. Instead, amortize to a single sweep
// per microtask: each setPopover() call just schedules a sweep (a no-op if
// one is already pending), which runs once after the whole synchronous
// render pass completes rather than once per target. By the time it runs,
// any element that's still meant to be connected (including the one just
// passed to setPopover) has already been attached by the synchronous render
// code that called setPopover, so it's never wrongly swept.
let sweepPending = false;

function scheduleSweep() {
  if (sweepPending) return;
  sweepPending = true;
  queueMicrotask(() => {
    sweepPending = false;
    sweepDisconnectedDescriptions();
  });
}
// Tracks the target/time a focusin just showed the popover for, so the click
// that follows a tap (pointerdown -> focusin -> click) doesn't immediately
// toggle it back off. A second, deliberate click (outside this window) still
// toggles normally.
let lastFocusShowTarget = null;
let lastFocusShowTime = 0;
const FOCUS_CLICK_IGNORE_MS = 300;

/**
 * Removes a popover-owned aria-describedby id (if any) from el, restoring
 * any other ids that were present, and removes the associated hidden
 * description span from the DOM.
 *
 * @param {Element} el
 */
function removePopoverDescription(el) {
  const descId = el.dataset.popoverDescId;
  if (!descId) return;
  const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== descId);
  if (ids.length) {
    el.setAttribute("aria-describedby", ids.join(" "));
  } else {
    el.removeAttribute("aria-describedby");
  }
  const descEl = document.getElementById(descId);
  if (descEl) descEl.remove();
  descOwners.delete(descId);
  delete el.dataset.popoverDescId;
}

/**
 * Stores text in el.dataset.popover, exposes it to assistive tech via a
 * hidden description element referenced through aria-describedby (appended
 * to any author-provided ids rather than overwriting them), removes the
 * title attribute, adds class "has-popover". Empty/null text removes the
 * popover data and the description this helper owns.
 *
 * @param {Element} el
 * @param {string|null} text - plain-text version, used for the aria description and shown
 *   verbatim when no `render` is given.
 * @param {Object} options - { tap: boolean, render: (container: Element) => void } - if tap is
 *   false, popover won't show on click; if `render` is given, it builds the popover's DOM
 *   content (via createElement/textContent - never innerHTML) instead of the plain text.
 */
export function setPopover(el, text, options = {}) {
  if (!el) return;

  // setPopover is called throughout each render pass; piggyback on that to
  // notice when the currently-shown popover's target was replaced (e.g.
  // renderBoard rebuilding cells) without ever calling hidePopover/setPopover
  // (null) on the stale element, which would otherwise leave the popover
  // stuck open pointing at a detached element.
  if (currentTarget && !currentTarget.isConnected) {
    hidePopover();
  }

  // Migrate away from the old behavior of setting aria-label: if a previous
  // version of this helper added one, remove it now that we use a
  // description element instead.
  if (el.dataset.popoverAddedAriaLabel === "true") {
    el.removeAttribute("aria-label");
    delete el.dataset.popoverAddedAriaLabel;
  }

  if (!text) {
    delete el.dataset.popover;
    el.classList.remove("has-popover");
    delete el.dataset.popoverTap;
    if (el.dataset.popoverAddedTabindex === "true") {
      el.removeAttribute("tabindex");
      delete el.dataset.popoverAddedTabindex;
    }
    removePopoverDescription(el);
    richRenderers.delete(el);
    return;
  }

  el.dataset.popover = text;
  el.removeAttribute("title");
  el.classList.add("has-popover");
  if (typeof options.render === "function") {
    richRenderers.set(el, options.render);
  } else {
    richRenderers.delete(el);
  }

  // Re-renders (clearElement + rebuild) discard the old target elements without
  // ever calling setPopover(el, null) on them, so sweep description spans whose
  // owner is no longer connected. Amortized to one sweep per microtask (see
  // scheduleSweep) instead of running over the whole map on every call.
  scheduleSweep();

  // Reuse the description span this helper owns (if any); otherwise create
  // a new one and append its id to any existing aria-describedby ids.
  let descId = el.dataset.popoverDescId;
  let descEl = descId ? document.getElementById(descId) : null;
  if (!descEl) {
    descId = `rf-pop-desc-${++descCounter}`;
    descEl = document.createElement("span");
    descEl.id = descId;
    descEl.className = "visually-hidden";
    document.body.appendChild(descEl);
    el.dataset.popoverDescId = descId;
    const existing = (el.getAttribute("aria-describedby") || "").trim();
    el.setAttribute("aria-describedby", existing ? `${existing} ${descId}` : descId);
  }
  descOwners.set(descId, new WeakRef(el));
  descEl.textContent = text;

  // Store tap option (default true)
  if (options.tap === false) {
    el.dataset.popoverTap = "false";
  } else {
    delete el.dataset.popoverTap;
  }

  // Ensure keyboard users can focus non-interactive elements (e.g. divs/spans)
  // so the existing focusin handler can show the popover. Targets with
  // tap:false (e.g. board cells that are already interactive via click, not
  // via this popover) don't need this: adding tabindex there would make a
  // plain tap focus the cell and pop the tooltip open unexpectedly.
  const isNativelyFocusable = /^(button|a|input|select|textarea)$/i.test(el.tagName);
  if (options.tap !== false && !isNativelyFocusable && !el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "0");
    el.dataset.popoverAddedTabindex = "true";
  }
}

/**
 * Get or create the popover element.
 * @returns {Element}
 */
function getPopoverEl() {
  let popoverEl = document.querySelector(".rf-popover");
  if (!popoverEl) {
    popoverEl = document.createElement("div");
    popoverEl.className = "rf-popover";
    popoverEl.setAttribute("role", "tooltip");
    popoverEl.hidden = true;
    document.body.appendChild(popoverEl);
  }
  return popoverEl;
}

/**
 * Idempotent initialization. Creates a single shared popover element
 * appended to document.body. Sets up delegated listeners on root.
 *
 * @param {Element} root - defaults to document
 */
export function initPopovers(root = document) {
  // Use WeakMap to track per-root initialization
  if (listeners.has(root)) return;

  // Ensure popover element exists
  getPopoverEl();

  // Helper to safely get target element, handling non-Element targets
  const targetEl = (e) => (e.target instanceof Element ? e.target : e.target?.parentElement ?? null);

  // Delegated click handler on root
  const handleClick = (e) => {
    const target = targetEl(e)?.closest("[data-popover]");
    if (!target || target.dataset.popoverTap === "false") return;
    if (target === lastFocusShowTarget && Date.now() - lastFocusShowTime < FOCUS_CLICK_IGNORE_MS) {
      // This click is the tail end of a tap that already showed the popover
      // via focusin; treat it as a no-op instead of toggling it closed, but
      // consume the flag so a deliberate second click toggles normally.
      lastFocusShowTarget = null;
      return;
    }
    togglePopover(target);
  };

  // Click outside handler - hide popover on any document click not on a popover element
  const handleDocumentClick = (e) => {
    const target = targetEl(e)?.closest("[data-popover]");
    if (!target) {
      hidePopover();
    }
  };

  // Delegated pointerenter handler
  const handlePointerEnter = (e) => {
    if (e.pointerType === "mouse") {
      const target = targetEl(e)?.closest("[data-popover]");
      // Moving between descendants of the same target re-fires pointerenter
      // (capture mode); skip re-showing to avoid flicker.
      if (target && target !== currentTarget) {
        showPopover(target);
      }
    }
  };

  // Delegated pointerleave handler
  const handlePointerLeave = (e) => {
    if (e.pointerType === "mouse") {
      const target = targetEl(e)?.closest("[data-popover]");
      if (!target || currentTarget !== target) return;
      // In capture mode, pointerleave also fires when moving between a
      // descendant and its ancestor target (e.g. a label/image inside the
      // target back to the target itself); only hide once the pointer has
      // actually left the whole target.
      const related = e.relatedTarget;
      if (related && target.contains(related)) return;
      hidePopover();
    }
  };

  // Delegated focusin handler
  const handleFocusIn = (e) => {
    const target = targetEl(e)?.closest("[data-popover]");
    if (target) {
      lastFocusShowTarget = target;
      lastFocusShowTime = Date.now();
      showPopover(target);
    }
  };

  // Delegated focusout handler
  const handleFocusOut = (e) => {
    const target = targetEl(e)?.closest("[data-popover]");
    if (target && currentTarget === target) {
      hidePopover();
    }
  };

  // Escape key handler
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      hidePopover();
    }
  };

  root.addEventListener("click", handleClick);
  document.addEventListener("click", handleDocumentClick);
  root.addEventListener("pointerenter", handlePointerEnter, true);
  root.addEventListener("pointerleave", handlePointerLeave, true);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("focusout", handleFocusOut);
  document.addEventListener("keydown", handleEscape);

  // Add window scroll and resize listeners (idempotent, once globally)
  if (!windowListenersAdded) {
    window.addEventListener("scroll", hidePopover, { capture: true, passive: true });
    window.addEventListener("resize", hidePopover, { passive: true });
    windowListenersAdded = true;
  }

  // Store listener references for tracking initialization
  listeners.set(root, {
    handleClick,
    handleDocumentClick,
    handlePointerEnter,
    handlePointerLeave,
    handleFocusIn,
    handleFocusOut,
    handleEscape,
  });
}

/**
 * Show popover for a target element, positioning it above.
 * Flips below if no room. Clamped to viewport with 8px margin.
 *
 * @param {Element} target
 */
function showPopover(target) {
  const popoverEl = getPopoverEl();

  currentTarget = target;

  // Reset any maxHeight/overflow cap left over from a previous popover
  // before setting content and measuring. With border-box sizing, an
  // uncleared cap from a prior (taller) popover would make this one measure
  // as exactly maxHeight regardless of its real content height, so the
  // "is it taller than the viewport" check below would wrongly pass and the
  // cap (and the top computed from it) would be wrong.
  popoverEl.style.maxHeight = "";
  popoverEl.style.overflow = "";

  const render = richRenderers.get(target);
  if (render) {
    render(popoverEl);
  } else {
    popoverEl.textContent = target.dataset.popover || "";
  }
  popoverEl.hidden = false;

  const rect = target.getBoundingClientRect();
  let popoverRect = popoverEl.getBoundingClientRect();

  const margin = 8;

  // If the popover is taller than the viewport, cap its height instead of
  // letting it render off-screen, and clamp its top so it always stays
  // within [margin, innerHeight - height - margin]. Re-measure after
  // applying the cap so top/left below are computed from the final
  // (possibly capped) height, not the pre-cap one.
  const maxHeight = window.innerHeight - margin * 2;
  if (popoverRect.height > maxHeight) {
    popoverEl.style.maxHeight = maxHeight + "px";
    popoverEl.style.overflow = "auto";
    popoverRect = popoverEl.getBoundingClientRect();
  }

  // Try positioning above
  let top = rect.top - popoverRect.height - 8;
  let left = rect.left + rect.width / 2 - popoverRect.width / 2;

  // Check if above fits, flip below if not
  if (top < 8) {
    top = rect.bottom + 8;
  }

  const maxTop = window.innerHeight - popoverRect.height - margin;
  if (top > maxTop) {
    top = maxTop;
  }
  if (top < margin) {
    top = margin;
  }

  // Clamp to viewport horizontally
  const maxLeft = window.innerWidth - popoverRect.width - margin;
  if (left < margin) {
    left = margin;
  } else if (left > maxLeft) {
    left = maxLeft;
  }

  popoverEl.style.top = top + "px";
  popoverEl.style.left = left + "px";
}

/**
 * Toggle popover visibility for a target element.
 *
 * @param {Element} target
 */
function togglePopover(target) {
  const popoverEl = getPopoverEl();
  if (currentTarget === target && !popoverEl.hidden) {
    hidePopover();
  } else {
    showPopover(target);
  }
}

/**
 * Hide the popover.
 */
export function hidePopover() {
  const popoverEl = document.querySelector(".rf-popover");
  if (!popoverEl) return;
  popoverEl.hidden = true;
  currentTarget = null;
}
