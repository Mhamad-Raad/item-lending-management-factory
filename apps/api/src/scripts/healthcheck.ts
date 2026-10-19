import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Docker HEALTHCHECK for the api container (the slim image has no curl/wget), also the deploy script's wait.
 *
 * It asks whether the process is alive and reaches its database. A 503 whose reason is `disk` counts as alive
 * (Q61): `caddy` starts only once `api` is healthy, so failing this check on a nearly full disk would block
 * Caddy on the next `docker compose up -d` and take every read down with the writes. The low disk still
 * reaches the maintainer through the external uptime check, which reads `/api/health` directly, and
 * `disk-alert.sh`.
 *
 * It also restarts a hung API (Q152). Docker never restarts a container that is merely unhealthy, so a frozen
 * event loop or a stuck pool would stay down until someone acted. The check counts consecutive failures in
 * /tmp (tmpfs: the root file system is read-only) and, at the third, sends SIGTERM to the API process, at the
 * fourth and later SIGKILL (a frozen event loop never runs Nest's SIGTERM handler). The process exits, tini
 * (`init: true`, PID 1 — the kernel ignores signals to a PID 1 without a handler, even SIGKILL from inside)
 * exits with it, and `restart: unless-stopped` starts the container again. No autoheal sidecar, which would
 * need the Docker socket (root on the host). Signalling a process of the same uid needs no capability, so
 * `cap_drop: ALL` stays.
 */
export function isLive(status: number, body: unknown): boolean {
  if (status >= 200 && status < 300) return true;
  if (status !== 503 || typeof body !== 'object' || body === null) return false;
  const details = (body as { error?: { details?: { reason?: unknown } } }).error?.details;
  return details?.reason === 'disk';
}

/** Failures in the API process's first seconds are a slow start, not a hang (matches compose `start_period`). */
export const START_GRACE_SECONDS = 120;
export const TERM_AT = 3;
export const KILL_AT = 4;

/** The failure count, tied to one API process (`pid:starttime`), so a new process starts from zero. */
export interface Strikes {
  key: string;
  failures: number;
}

export interface Decision {
  next: Strikes;
  signal: 'SIGTERM' | 'SIGKILL' | null;
}

/** Pure: what one check's outcome does to the count, and whether to signal the API process. */
export function decide(previous: Strikes | null, key: string, ageSeconds: number, live: boolean): Decision {
  const carried = previous?.key === key ? previous.failures : 0;
  if (live) return { next: { key, failures: 0 }, signal: null };
  if (ageSeconds < START_GRACE_SECONDS) return { next: { key, failures: carried }, signal: null };
  const failures = carried + 1;
  const signal = failures >= KILL_AT ? 'SIGKILL' : failures >= TERM_AT ? 'SIGTERM' : null;
  return { next: { key, failures }, signal };
}

/** The Dockerfile's CMD exactly, as /proc/<pid>/cmdline holds it — never this check's own `node` process. */
const API_CMDLINE = 'node\0--enable-source-maps\0dist/main.js\0';
const STRIKES_FILE = '/tmp/healthcheck-strikes.json';
/** USER_HZ: /proc counts start times in ticks of 1/100 s on every Linux architecture Docker runs. */
const TICKS_PER_SECOND = 100;

interface ApiProcess {
  pid: number;
  key: string;
  ageSeconds: number;
}

function findApiProcess(): ApiProcess | null {
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'latin1') !== API_CMDLINE) continue;
      // Field 22 of /proc/<pid>/stat is the start time in ticks since boot; split after the `(comm)` field,
      // which may itself hold spaces. /proc/uptime is seconds since boot.
      const stat = readFileSync(`/proc/${pid}/stat`, 'latin1');
      const startTicks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
      const uptime = Number(readFileSync('/proc/uptime', 'latin1').split(' ')[0]);
      return { pid, key: `${pid}:${startTicks}`, ageSeconds: uptime - startTicks / TICKS_PER_SECOND };
    } catch {
      // The process ended while being read; look on.
    }
  }
  return null;
}

function readStrikes(): Strikes | null {
  try {
    return JSON.parse(readFileSync(STRIKES_FILE, 'utf8')) as Strikes;
  } catch {
    return null;
  }
}

async function probe(): Promise<boolean> {
  try {
    const port = process.env.API_PORT ?? '3000';
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
    const body: unknown = await res.json().catch(() => null);
    return isLive(res.status, body);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const live = await probe();
  // Outside the container (no /proc, or no process started by the image's CMD) only the answer counts.
  try {
    const api = findApiProcess();
    if (api) {
      const { next, signal } = decide(readStrikes(), api.key, api.ageSeconds, live);
      writeFileSync(STRIKES_FILE, JSON.stringify(next));
      if (signal) {
        console.error(`healthcheck: ${next.failures} failures in a row, sending ${signal} to the API (Q152)`);
        process.kill(api.pid, signal);
      }
    }
  } catch {
    // The restart is a safety net; it must never change the check's own answer.
  }
  process.exit(live ? 0 : 1);
}

// Guarded so the test can import `isLive` and `decide` without probing a server.
if (require.main === module) {
  main().catch(() => process.exit(1));
}
