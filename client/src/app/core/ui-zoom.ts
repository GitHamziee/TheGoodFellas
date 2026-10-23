/**
 * The root `zoom` set by `--ui-zoom` in styles.css. getBoundingClientRect() and
 * window.innerWidth/innerHeight report unzoomed viewport pixels, while a `top`/`left`
 * written onto a zoomed element is scaled by it — divide by this before writing one.
 */
export function uiZoom(): number {
  return (document.documentElement as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
}
