/**
 * The live suite's fixed values (Q63), shared by `playwright.live.config.ts` (which hands them to the API it starts)
 * and the tests. The API runs on the test database only, with a throwaway secret: nothing here is a real credential.
 */
/** Uncommon on purpose: 3000/3100/4173 are often held by other local dev servers (Q33). */
export const LIVE_API_PORT = 3197;
export const LIVE_WEB_PORT = 4197;

export const LIVE_ADMIN = {
  username: 'admin',
  displayName: 'Administrator',
  password: 'e2e-admin-password-2026',
} as const;
