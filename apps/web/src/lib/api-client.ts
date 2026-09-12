import type { ApiErrorBody, UploadDto, UploadKind } from '@pallet/shared';
import { ApiError } from './api-error';
import { authStore } from './auth-store';
import { refreshAccessToken } from './refresh-lock';

/**
 * What to do when a 401 survives a refresh: clear the session, drop cached data and send the user
 * to the login page (§7.7.2). Installed by the application shell, which owns the router and the
 * query cache; the client itself must not import either.
 */
let onSessionEnded: (() => void) | undefined;

export function setSessionEndedHandler(handler: () => void): void {
  onSessionEnded = handler;
}

export type QueryValue = string | number | boolean | (string | number)[] | undefined | null;

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Set on the auth endpoints themselves: refreshing in response to their 401 would loop. */
  skipAuthRetry?: boolean;
}

/** `undefined` and `null` are omitted; an array repeats its key (`type=A&type=B`). */
export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(body.error.code, response.status, body.error.details, body.error.fields, body.requestId);
  } catch {
    return new ApiError('UNKNOWN_ERROR', response.status);
  }
}

async function send(path: string, options: ApiRequest): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  // Required on every state-changing request, public ones included (§10.1 S16).
  if (method !== 'GET') headers['X-Requested-With'] = 'pallet-web';
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  try {
    return await fetch(`/api${path}${buildQueryString(options.query)}`, {
      method,
      headers,
      // The refresh cookie is path-scoped to /api/auth, so it only travels to the auth endpoints.
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    // A cancelled request is not a failure; letting it through as NETWORK_ERROR would have the
    // query client retry something the caller deliberately abandoned.
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError('NETWORK_ERROR', 0);
  }
}

/**
 * Sends a request and, on a 401 that a refresh could fix, refreshes once and sends it once more —
 * the same request, idempotency key included, so a retried write is the same write (§7.7.2). A 401
 * that survives the refresh means the session is gone: the store is cleared and the shell told, or
 * the app would keep rendering as signed in while every request inside it fails.
 */
async function withAuthRetry(sendOnce: () => Promise<Response>, skipAuthRetry = false): Promise<Response> {
  let response = await sendOnce();

  if (response.status === 401 && !skipAuthRetry) {
    const error = await toApiError(response.clone());
    if (error.isAuthExpired) {
      response = (await refreshAccessToken()) ? await sendOnce() : response;
      if (response.status === 401) {
        authStore.clear();
        onSessionEnded?.();
        throw await toApiError(response);
      }
    }
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function apiFetch<T>(path: string, options: ApiRequest = {}): Promise<T> {
  const response = await withAuthRetry(() => send(path, options), options.skipAuthRetry);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * One image upload with progress (§7.7.5). `XMLHttpRequest` rather than `fetch`, because only it
 * reports upload progress; its answer is wrapped in a `Response` so it takes exactly the path every
 * other request takes — error codes, refresh-once-and-retry, session end.
 */
export async function apiUpload(
  kind: UploadKind,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadDto> {
  const response = await withAuthRetry(() => sendUpload(kind, file, onProgress));
  return (await response.json()) as UploadDto;
}

function sendUpload(kind: UploadKind, file: File, onProgress?: (fraction: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads${buildQueryString({ kind })}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'pallet-web');
    if (authStore.token) xhr.setRequestHeader('Authorization', `Bearer ${authStore.token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      resolve(
        new Response(xhr.status === 204 ? null : xhr.responseText, {
          status: xhr.status,
          headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' },
        }),
      );
    };
    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 0));

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
