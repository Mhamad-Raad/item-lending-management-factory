/**
 * After a deploy, a page loaded before it asks for code-split chunks the new build no longer has, and
 * the import fails (Q81). Reloading fetches the new index.html and its chunks. Once only: the time of
 * the last such reload is kept in sessionStorage (a timestamp, no secret), so a chunk that is missing
 * for another reason shows an error with a Reload button instead of reloading forever.
 */
const KEY = 'pallet.chunkReloadAt.v1';
/** A second failure this soon after the automatic reload means reloading did not help. */
const LOOP_WINDOW_MS = 30_000;

/** What browsers say when a dynamic import or a module preload fails. */
const CHUNK_FAILURE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk .* failed/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_FAILURE.test(error.message);
}

/** Reloads the page unless it already did so moments ago; true when a reload was started. */
export function reloadOnceForNewVersion(now = Date.now(), reload = () => window.location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < LOOP_WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Without storage there is no loop guard: leave it to the Reload button.
    return false;
  }
  reload();
  return true;
}

/** Vite dispatches `vite:preloadError` when a lazy route's chunk or one of its imports fails to load. */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    // Handled here: the page is about to reload. When it is not, the error reaches the route's error page.
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
