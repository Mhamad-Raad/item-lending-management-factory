/**
 * Docker HEALTHCHECK for the api container (the slim image has no curl/wget), also the deploy script's wait.
 *
 * It asks whether the process is alive and reaches its database. A 503 whose reason is `disk` counts as alive
 * (Q61): `caddy` starts only once `api` is healthy, so failing this check on a nearly full disk would block
 * Caddy on the next `docker compose up -d` and take every read down with the writes. The low disk still
 * reaches the maintainer through the external uptime check, which reads `/api/health` directly, and
 * `disk-alert.sh`.
 */
export function isLive(status: number, body: unknown): boolean {
  if (status >= 200 && status < 300) return true;
  if (status !== 503 || typeof body !== 'object' || body === null) return false;
  const details = (body as { error?: { details?: { reason?: unknown } } }).error?.details;
  return details?.reason === 'disk';
}

async function main(): Promise<void> {
  const port = process.env.API_PORT ?? '3000';
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
  const body: unknown = await res.json().catch(() => null);
  process.exit(isLive(res.status, body) ? 0 : 1);
}

// Guarded so the test can import `isLive` without probing a server.
if (require.main === module) {
  main().catch(() => process.exit(1));
}
