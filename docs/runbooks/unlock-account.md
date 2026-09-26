# Runbook — unlock a locked account

Lockouts are per (IP, username) and expire by themselves after at most 15 minutes. Because the whole factory shares one public IP, a lockout affects that username from the office only.

There is also an account-wide ceiling (ARCHITECTURE.md Q68): after 20 failures on one username within an hour, from any addresses — failed sign-ins and wrong current passwords on the change-password page count together — addresses that have **never** signed in to that account must wait 5, 10, 20, 40 and then 60 minutes; the sign-in page says "too many failed sign-ins on this account" with the wait. Addresses the user has signed in from before can still sign in; changing the password is refused from every address until the wait is over (the page says the current password was entered wrongly too many times). "Signed in from before" means the same IP address, not the same phone: a user on mobile data usually gets a new address and is held back too — tell them to use the factory's network or wait. It shows in the History as `LOCKOUT` with `scope = ACCOUNT`, and the API logs a warning `login ceiling reached for one account`. The `DELETE` below clears it too (it is the row with `ip = '*'`).

Wait it out when possible. To clear immediately (maintainer, on the VPS):

```bash
cd /opt/pallet
docker compose exec -T postgres psql -U pallet_owner -d pallet \
  -c "DELETE FROM login_throttles WHERE username = lower('<username>');"
```

Then check the History page (filter action = LOGIN_FAILURE / LOCKOUT) to see whether the failures were the user mistyping or an attack from another IP (an account-wide `LOCKOUT` almost always means an attack from many). If an attack: reset that user's password (docs/runbooks/manage-users.md).
