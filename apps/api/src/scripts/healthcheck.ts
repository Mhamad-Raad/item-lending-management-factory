/** Docker HEALTHCHECK for the api container (the slim image has no curl/wget). */
const port = process.env.API_PORT ?? '3000';

fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) })
  .then((res) => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
