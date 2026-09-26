/**
 * Only a path on this site is followed, so `?redirect=` cannot send anyone to another one: not `//host`, not
 * `/\host` (browsers read a backslash as a slash), nothing with control characters, and nothing that resolves to
 * another origin.
 */
export function safeRedirect(target: string | undefined, origin: string = window.location.origin): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
  if (!target || !target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(target)) {
    return '/';
  }
  try {
    const url = new URL(target, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
