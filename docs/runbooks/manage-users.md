# Runbook — add or deactivate a user

All user management happens in the web app (admin only): **Users** page (`/users`).

## Add a user

1. Users → **New user**: username (lowercase `a-z 0-9 . _ -`, 3–32 chars, cannot be changed later), display name, role, a temporary password (≥ 10 chars, not common).
2. For an employee, tick permissions on the user page; dependencies are ticked automatically.
3. Give the temporary password to the person in person; at first login they must choose a new one.

## Deactivate a user (leaver)

1. Users → open the user → **Deactivate** (confirm). All their sessions end immediately.
2. Their history (orders, audit entries) stays attributed to them. Users are never deleted.
3. You cannot deactivate yourself or the last active admin.

## Reset a forgotten password

Users → open the user → **Reset password** → give the temporary password in person. Their sessions end; they must change it at next login.

## Log a user out everywhere (lost phone)

Users → open the user → **Log out everywhere**.
