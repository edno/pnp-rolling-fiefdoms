/**
 * @param {Element} el
 * @param {Function} enter - called on pointerenter if pointerType is "mouse"
 * @param {Function} leave - called on pointerleave if pointerType is "mouse"
 * @returns {Function} disposer function that removes both listeners
 *
 * Guard: if !el return a no-op disposer.
 *
 * Note: on touch, emulated mouseenter fires on tap and mouseleave never fires,
 * leaving previews stuck. This uses pointerenter/pointerleave to listen only
 * for actual mouse interactions.
 */
export function onMouseHover(el, enter, leave) {
  if (!el) {
    return () => {};
  }

  const handlePointerEnter = (e) => {
    if (e.pointerType === "mouse" && typeof enter === "function") {
      enter(e);
    }
  };

  const handlePointerLeave = (e) => {
    if (e.pointerType === "mouse" && typeof leave === "function") {
      leave(e);
    }
  };

  el.addEventListener("pointerenter", handlePointerEnter);
  el.addEventListener("pointerleave", handlePointerLeave);

  return () => {
    el.removeEventListener("pointerenter", handlePointerEnter);
    el.removeEventListener("pointerleave", handlePointerLeave);
  };
}
