// Small body-level popover for menus that would be clipped by a card or scroll container.
let activeMenu = null;
let nextMenuId = 0;

export function floatingMenu(trigger, panel, { align = "end", maxHeight = 320, focusFirst = true, onClose } = {}) {
  panel.setAttribute("popover", "manual");
  panel.id ||= `floating-menu-${++nextMenuId}`;
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-haspopup", panel.getAttribute("role") === "menu" ? "menu" : "true");
  trigger.setAttribute("aria-expanded", "false");
  const supportsPopover = typeof panel.showPopover === "function";
  let open = false;
  let observer;

  const position = () => {
    if (!open) return;
    if (!trigger.isConnected) { close(); return; }
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || window.innerWidth);
    const bottom = top + (viewport?.height || window.innerHeight);
    const margin = 8, gap = 6;
    if (rect.bottom < top || rect.top > bottom) { close(); return; }
    for (let parent = trigger.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) continue;
      const clip = parent.getBoundingClientRect();
      if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) {
        close(); return;
      }
    }
    const width = panel.getBoundingClientRect().width;
    const below = Math.max(0, bottom - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - top - gap - margin);
    const desired = Math.min(panel.scrollHeight, maxHeight);
    const upward = below < desired && above > below;
    panel.style.maxHeight = `${Math.floor(Math.min(maxHeight, upward ? above : below))}px`;
    const height = panel.getBoundingClientRect().height;
    const x = align === "start" ? rect.left : rect.right - width;
    panel.style.left = `${Math.max(left + margin, Math.min(x, right - margin - width))}px`;
    panel.style.top = `${Math.max(top + margin, Math.min(upward ? rect.top - gap - height : rect.bottom + gap, bottom - margin - height))}px`;
  };
  const onOutside = (event) => {
    if (!panel.contains(event.target) && !trigger.contains(event.target)) close(false, event);
  };
  const onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    if (panel.getAttribute("role") !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...panel.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1) % items.length : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[next].focus();
  };
  const onScroll = (event) => { if (event.target !== panel && !panel.contains(event.target)) position(); };

  function close(restoreFocus = false, event = null) {
    if (!open) return;
    open = false;
    observer?.disconnect();
    document.removeEventListener("click", onOutside);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", position);
    window.visualViewport?.removeEventListener("resize", position);
    window.visualViewport?.removeEventListener("scroll", position);
    if (supportsPopover && panel.matches(":popover-open")) panel.hidePopover();
    panel.remove();
    trigger.setAttribute("aria-expanded", "false");
    if (activeMenu === controller) activeMenu = null;
    if (restoreFocus && trigger.isConnected) trigger.focus();
    onClose?.({ restoreFocus, event });
  }

  function show() {
    if (open) return;
    activeMenu?.close();
    // Other auto popovers should not compete with this menu.
    document.querySelectorAll("[popover]:popover-open").forEach((other) => other.hidePopover());
    document.body.append(panel);
    if (supportsPopover) panel.showPopover();
    else panel.hidden = false;
    open = true;
    activeMenu = controller;
    trigger.setAttribute("aria-expanded", "true");
    position();
    document.addEventListener("click", onOutside);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    observer = new MutationObserver(() => { if (!trigger.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
    if (focusFirst) panel.querySelector('input, button, select, [tabindex="0"]')?.focus();
  }

  const controller = { show, close, get isOpen() { return open; } };
  trigger.addEventListener("click", () => open ? close(true) : show());
  return controller;
}
