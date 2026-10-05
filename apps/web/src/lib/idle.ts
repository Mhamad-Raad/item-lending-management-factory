import { SESSION_IDLE_MINUTES, SESSION_IDLE_WARNING_SECONDS } from '@pallet/shared';
import { useSyncExternalStore } from 'react';
import { authStore } from './auth-store';
import { ACTIVITY_KEY, clearLastActivity, readLastActivity, writeLastActivity } from './idle-storage';

export const IDLE_LIMIT_MS = SESSION_IDLE_MINUTES * 60_000;
const WARNING_MS = SESSION_IDLE_WARNING_SECONDS * 1_000;
/** The shared record is written at most this often: every key press would otherwise be a storage write. */
const WRITE_EVERY_MS = 5_000;
const CHECK_EVERY_MS = 1_000;
/** What counts as the user being there. Moving the pointer does: someone reading a report is not idle. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/**
 * Once the warning is up it wants an answer — a press, a key, a touch — and these are not one: a pointer on its
 * way to "Stay signed in" would otherwise take the dialog away from under it.
 */
const NOT_AN_ANSWER: ReadonlySet<string> = new Set(['pointermove', 'wheel', 'scroll']);

/** This tab's own last activity; other tabs' reaches it through the shared record. */
let ownActivity = 0;
let lastWritten = 0;
let trailingWrite: ReturnType<typeof setTimeout> | undefined;
/**
 * This tab has read a record of the session it holds. From then on a missing record means another tab ended that
 * session — the tabs of a browser share one — and not that nothing was written yet.
 */
let recordSeen = false;
/** Seconds until the sign-out while the warning shows, otherwise null. */
let secondsLeft: number | null = null;
let watching = false;
const listeners = new Set<() => void>();

function setSecondsLeft(next: number | null): void {
  if (next === secondsLeft) return;
  secondsLeft = next;
  for (const listener of listeners) listener();
}

function sharedActivity(): number {
  const at = readLastActivity();
  if (at !== null) recordSeen = true;
  return at ?? 0;
}

function lastActivity(): number {
  return Math.max(ownActivity, sharedActivity());
}

function write(at: number, now: number): void {
  clearTimeout(trailingWrite);
  trailingWrite = undefined;
  lastWritten = now;
  writeLastActivity(at);
}

/**
 * True once the limit has passed with nothing done. The page stops renewing the session then: the sign-out is on
 * its way, and a refresh beside it — every timer fires at once when a laptop wakes — would race it.
 */
export function idleLimitReached(now = Date.now()): boolean {
  const last = lastActivity();
  return last !== 0 && now - last >= IDLE_LIMIT_MS;
}

/**
 * Called for every sign of life, and by "Stay signed in". The record other tabs read is written at once or, inside
 * the throttle, when it ends: a tab must never count from an activity older than the last one by more than that.
 */
export function noteActivity(now = Date.now()): void {
  ownActivity = now;
  // Answered: the warning goes at once, not at the next look at the clock.
  setSecondsLeft(null);
  const wait = lastWritten + WRITE_EVERY_MS - now;
  if (wait <= 0) write(now, now);
  else trailingWrite ??= setTimeout(() => write(ownActivity, Date.now()), wait);
}

/**
 * The tab that ends a session — a sign-out, the idle limit, a refusal by the server — removes the record its other
 * tabs count from, which is how they learn of it.
 */
export function endSharedRecord(): void {
  clearTimeout(trailingWrite);
  trailingWrite = undefined;
  clearLastActivity();
}

/**
 * A session starts, or is restored by a page load — which is the user being there: whatever was on record is
 * replaced. (A load after the whole limit has passed is refused before it gets here: `wasLeftIdle`.)
 */
export function startActivity(now = Date.now()): void {
  lastWritten = 0;
  noteActivity(now);
}

/**
 * True when the record says nobody has touched the app for the whole limit — asked on a page load, before the
 * refresh cookie is used: a browser closed last night must not open signed in this morning.
 */
export function wasLeftIdle(now = Date.now()): boolean {
  const last = readLastActivity();
  return last !== null && now - last >= IDLE_LIMIT_MS;
}

/** "Stay signed in", and anything else that dismisses the warning — while there is still a session to keep. */
export function answerWarning(): void {
  if (authStore.getSnapshot().status === 'authenticated') noteActivity();
}

/**
 * Starts the watch, once per page load: any activity in any tab keeps the session, the warning counts the last
 * minute down, and at the limit `expire` signs the user out. `endedElsewhere` is for a session another tab ended
 * — signed out there, or idle there a moment sooner. Timers sleep with the laptop and crawl in a hidden tab, so
 * the clock is asked again whenever the page is looked at.
 */
export function watchForIdleness(on: { expire: () => void; endedElsewhere: () => void }): void {
  if (watching) return;
  watching = true;

  const check = (): void => {
    if (authStore.getSnapshot().status !== 'authenticated') return;
    const now = Date.now();
    const shared = sharedActivity();
    if (shared === 0 && recordSeen) {
      // The record this tab was counting from is gone: the session was ended in another tab.
      on.endedElsewhere();
      return;
    }
    // Nothing on record and nothing done here: storage is disabled, so this tab counts alone, from now.
    if (shared === 0 && ownActivity === 0) startActivity(now);
    const remaining = Math.max(ownActivity, shared) + IDLE_LIMIT_MS - now;
    if (remaining > 0) setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1_000) : null);
    else on.expire();
  };

  for (const type of ACTIVITY_EVENTS) {
    window.addEventListener(
      type,
      () => {
        if (authStore.getSnapshot().status !== 'authenticated') return;
        if (secondsLeft !== null && NOT_AN_ANSWER.has(type)) return;
        noteActivity();
      },
      { capture: true, passive: true },
    );
  }
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  // Told at once when another tab removes the record, rather than at the next look at the clock.
  window.addEventListener('storage', (event) => {
    if (event.key !== ACTIVITY_KEY || event.newValue !== null) return;
    // The event may be an old one, delivered to a tab the browser had put to sleep: if a record is there now, a
    // session has been started since, and this is not the news of its end.
    if (readLastActivity() !== null) return;
    if (authStore.getSnapshot().status === 'authenticated') on.endedElsewhere();
  });

  // Signed out, however it happened: this tab has nothing left to count. The shared record is not removed here —
  // that is `endSharedRecord`, for the tab that ends the session; one that only follows would otherwise remove
  // the record of a session started since.
  authStore.subscribe(() => {
    if (authStore.getSnapshot().status !== 'anonymous') return;
    clearTimeout(trailingWrite);
    trailingWrite = undefined;
    ownActivity = 0;
    lastWritten = 0;
    recordSeen = false;
    setSecondsLeft(null);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Seconds until the idle sign-out while its warning shows, otherwise null. */
export function useIdleSecondsLeft(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => secondsLeft,
    () => secondsLeft,
  );
}
