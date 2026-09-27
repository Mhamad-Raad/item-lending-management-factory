/** The `error.code` of an API error response body (§6.3), or undefined when the body carries none. */
export function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | null | undefined)?.error?.code;
}
