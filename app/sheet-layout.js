/**
 * Sheet layout - crop window scaling
 *
 * Each `.sheet-window` renders a crop of the full 1076x764 sheet coordinate
 * space, scaled to fit the window's current width via CSS vars on the
 * window element: --crop-x, --crop-y, --s.
 */

/**
 * Parse a "x,y,w,h" data-crop attribute string.
 * @param {string} str
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function parseCrop(str) {
  if (typeof str !== "string") return null;
  const parts = str.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function applyCropVars(win, crop) {
  const width = win.clientWidth;
  if (!width || !crop.w) return;
  const scale = width / crop.w;
  win.style.setProperty("--crop-x", String(crop.x));
  win.style.setProperty("--crop-y", String(crop.y));
  win.style.setProperty("--s", String(scale));
}

/**
 * Initialize crop-window scaling for all `.sheet-window` elements under root.
 * Returns a disposer function to remove observers/listeners.
 * @param {Document|Element} [root]
 * @returns {() => void}
 */
export function initSheetWindows(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return () => {};

  const windows = Array.from(scope.querySelectorAll(".sheet-window"));
  const entries = windows
    .map((win) => ({ win, crop: parseCrop(win.getAttribute("data-crop")) }))
    .filter((entry) => entry.crop);

  const updateAll = () => {
    entries.forEach(({ win, crop }) => applyCropVars(win, crop));
  };

  updateAll();

  let observer = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => updateAll());
    entries.forEach(({ win }) => observer.observe(win));
  } else if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("resize", updateAll);
  }

  return () => {
    if (observer) {
      observer.disconnect();
    } else if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("resize", updateAll);
    }
  };
}
