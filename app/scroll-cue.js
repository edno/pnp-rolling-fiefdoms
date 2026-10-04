// Toggles scroll-affordance classes on a scrollable element so CSS can show/hide
// a bottom fade mask only when there is more content to scroll to.
// - "is-scrollable": the element's content overflows its box.
// - "is-at-end": the element is scrolled to (or past) its bottom edge.
export function updateScrollCue(el) {
  if (!el) return;
  const scrollable = el.scrollHeight > el.clientHeight + 1;
  el.classList.toggle("is-scrollable", scrollable);
  const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  el.classList.toggle("is-at-end", !scrollable || atEnd);
}
