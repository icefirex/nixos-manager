/** Shared a11y helper: activate a handler via Enter/Space on focused elements. */
export function onKeyActivate(e: KeyboardEvent, action: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}
