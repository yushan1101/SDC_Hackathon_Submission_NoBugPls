// Ease discrete desktop mouse-wheel ticks while preserving native trackpad,
// touch, keyboard, reduced-motion, and nested-panel scrolling.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

if (!reducedMotion && finePointer) {
  const root = document.scrollingElement || document.documentElement;
  let target = root.scrollTop;
  let frame = 0;
  let previous = 0;

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    target = root.scrollTop;
  };

  const hasScrollableParent = (node) => {
    for (let el = node instanceof Element ? node : null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return true;
    }
    return false;
  };

  const animate = (time) => {
    const elapsed = previous ? Math.min(50, time - previous) : 16;
    previous = time;
    const current = root.scrollTop;
    const distance = target - current;
    if (Math.abs(distance) < 0.6) {
      root.scrollTop = target;
      frame = 0;
      previous = 0;
      return;
    }
    root.scrollTop = current + distance * (1 - Math.exp(-elapsed / 105));
    frame = requestAnimationFrame(animate);
  };

  addEventListener("wheel", (event) => {
    if (event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    const modeScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1;
    const delta = event.deltaY * modeScale;
    if (!delta || hasScrollableParent(event.target)) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

    const max = Math.max(0, root.scrollHeight - innerHeight);
    if ((delta < 0 && root.scrollTop <= 0) || (delta > 0 && root.scrollTop >= max)) return;
    event.preventDefault();
    if (!frame) target = root.scrollTop;
    target = Math.max(0, Math.min(max, target + delta));
    if (!frame) frame = requestAnimationFrame(animate);
  }, { passive: false });

  addEventListener("hashchange", stop, { passive: true });
  addEventListener("pointerdown", stop, { passive: true });
  addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stop();
  }, { passive: true });
  addEventListener("touchstart", stop, { passive: true });
}
