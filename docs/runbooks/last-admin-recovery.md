# Runbook — recover when the last admin is locked out

Use when no active admin can sign in: a forgotten password, an admin deactivated or demoted by mistake, departed staff.
While another admin can still sign in, use the app instead (Users → the person → Reset password).

The `recover-admin` script (ARCHITECTURE.md Q130) does what an admin's password reset does, from the server: it sets a
**temporary password** that must be changed at the next sign-in, reactivates the user, signs them out of every device
(sessions revoked, access tokens invalidated), clears their login locks, and records it all in the history. With
`--promote` it also makes the user an admin. The password is read from the keyboard (typed twice, not shown) — never
put it on the command line, where the shell history would keep it.

## On the server

1. SSH to the VPS; `cd /opt/pallet`.
2. Run it for the admin's username (add `--promote` if the user is not, or is no longer, an admin):

   ```bash
   docker compose --profile migrate run --rm migrate node dist/scripts/recover-admin.js <username>
   # or: docker compose --profile migrate run --rm migrate node dist/scripts/recover-admin.js <username> --promote
   ```

   It runs in the one-shot `migrate` container: the same API image and database settings. Running it in the `api`
   service instead does not work while the API is up: that service has a fixed network address, which the running
   container already holds (Docker answers `Address already in use`).

   Type a temporary password of at least 10 characters (not a common one, not the username) twice. The script prints
   what it did, for example `"karwan" (ADMIN) has the new temporary password … and was signed out of 2 session(s)`.
   It refuses, changing nothing, when no user has that name or the password is too weak — read the message and run
   it again.

3. Sign in with the temporary password; you are asked to choose a new one straight away.
4. In the app, check History: the reset (and the reactivation or promotion) appear without a user, because nobody was
   signed in when they happened. Then fix what caused the lock-out (for example reactivate or add a second admin).

No admin row at all (every admin deleted or demoted)? Run step 2 with an existing employee's username and `--promote`.
No users at all? The first admin is created from `ADMIN_*` in `.env` by the next deploy (§13.4).

## In development

```bash
pnpm --filter @pallet/api build
pnpm --filter @pallet/api recover-admin <username>            # add --promote to make them an admin
```

It reads `DATABASE_URL` from the repository's `.env`. In scripts and tests the password can be piped instead:
`printf '%s\n' "$NEW_PASSWORD" | pnpm --filter @pallet/api recover-admin <username>` (only the first line is read).

## If the script cannot run

Only when the API image itself is broken (the script is part of it). Deploy a working version first (`rollback.md`);
editing the `users` table by hand skips the password policy, the session revocation and the history, so it is the very
last resort — if you must, ask for help before doing it.
