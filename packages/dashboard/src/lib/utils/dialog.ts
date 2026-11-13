/**
 * Modern Web Guidance (`light-dismiss-a-dialog`):
 * Native `<dialog closedby="any">` handles Esc + backdrop click in supporting browsers.
 * Where `HTMLDialogElement.prototype.closedBy` is absent, attach a coordinate-box fallback
 * so clicks outside the dialog box dismiss cleanly without breaking `<select>` menus inside.
 */
export function attachDialogLightDismiss(dialogEl: HTMLDialogElement) {
  if (typeof window === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) {
    return { destroy() {} };
  }

  function handleClick(event: MouseEvent) {
    if (event.target !== dialogEl) return;
    const rect = dialogEl.getBoundingClientRect();
    const clickedOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (clickedOutside) {
      dialogEl.close('dismiss');
    }
  }

  dialogEl.addEventListener('click', handleClick);
  return {
    destroy() {
      dialogEl.removeEventListener('click', handleClick);
    }
  };
}
