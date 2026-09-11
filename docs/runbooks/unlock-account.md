# Runbook — unlock a locked account

Lockouts are per (IP, username) and expire by themselves after at most 15 minutes. Because the whole factory shares one public IP, a lockout affects that username from the office only.

Wait it out when possible. To clear immediately (maintainer, on the VPS):

```bash
cd /opt/pallet
docker compose exec -T postgres psql -U pallet_owner -d pallet \
  -c "DELETE FROM login_throttles WHERE username = lower('<username>');"
```

Then check the History page (filter action = LOGIN_FAILURE / LOCKOUT) to see whether the failures were the user mistyping or an attack from another IP. If an attack: reset that user's password (docs/runbooks/manage-users.md).
