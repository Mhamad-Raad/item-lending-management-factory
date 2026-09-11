import type { Request } from 'express';

/**
 * The route path of a request, normalised. Express routing is non-strict, so `/api/auth/logout/`
 * reaches the same handler as `/api/auth/logout`; any allow-list or exemption keyed on the path
 * string has to see the same value for both.
 */
export function requestPath(req: Pick<Request, 'baseUrl' | 'path'>): string {
  const path = `${req.baseUrl}${req.path}`;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
