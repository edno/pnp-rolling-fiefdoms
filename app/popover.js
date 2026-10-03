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
let windowListenersAdded = false;

/**
 * Stores text in el.dataset.popover, sets aria-label if not present,
 * removes title attribute, adds class "has-popover".
 * Empty/null text removes the popover data.
 *
 * @param {Element} el
 * @param {string|null} text
 * @param {Object} options - { tap: boolean } - if tap is false, popover won't show on click
 */
export function setPopover(el, text, options = {}) {
  if (!el) return;

  if (!text) {
    delete el.dataset.popover;
    el.classList.remove("has-popover");
    delete el.dataset.popoverTap;
    if (el.dataset.popoverAddedTabindex === "true") {
      el.removeAttribute("tabindex");
      delete el.dataset.popoverAddedTabindex;
    }
    return;
  }

  el.dataset.popover = text;
  if (!el.getAttribute("aria-label")) {
    el.setAttribute("aria-label", text);
  }
  el.removeAttribute("title");
  el.classList.add("has-popover");

  // Ensure keyboard users can focus non-interactive elements (e.g. divs/spans)
  // so the existing focusin handler can show the popover.
  const isNativelyFocusable = /^(button|a|input|select|textarea)$/i.test(el.tagName);
  if (!isNativelyFocusable && !el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "0");
    el.dataset.popoverAddedTabindex = "true";
  }

  // Store tap option (default true)
  if (options.tap === false) {
    el.dataset.popoverTap = "false";
  } else {
    delete el.dataset.popoverTap;
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
    if (target && target.dataset.popoverTap !== "false") {
      togglePopover(target);
    }
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
  popoverEl.textContent = target.dataset.popover || "";
  popoverEl.hidden = false;

  const rect = target.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();

  // Try positioning above
  let top = rect.top - popoverRect.height - 8;
  let left = rect.left + rect.width / 2 - popoverRect.width / 2;

  // Check if above fits, flip below if not
  if (top < 8) {
    top = rect.bottom + 8;
  }

  // Clamp to viewport horizontally
  const margin = 8;
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
