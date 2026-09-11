# Runbook — recover when the last admin is locked out

Use when no active admin can log in (forgotten password, admin deactivated through the database, departed staff).

1. SSH to the VPS; `cd /opt/pallet`.
2. Generate an Argon2id hash for a temporary password with the API image (same parameters as the app):
   ```bash
   docker compose run --rm --no-deps -e TEMP_PASSWORD='<temporary-password-min-10>' api \
     node -e "require('argon2').hash(process.env.TEMP_PASSWORD,{type:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log)"
   ```
3. Apply it as the owner role (the audit row documents the manual intervention):
   ```bash
   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U pallet_owner -d pallet <<'SQL'
   BEGIN;
   UPDATE users SET password_hash = '<hash-from-step-2>', is_active = true, role = 'ADMIN',
          must_change_password = true, token_version = token_version + 1, version = version + 1
    WHERE username = '<admin-username>';
   UPDATE session_families SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET'
    WHERE user_id = (SELECT id FROM users WHERE username = '<admin-username>') AND revoked_at IS NULL;
   DELETE FROM login_throttles WHERE username = '<admin-username>';
   INSERT INTO audit_logs (action, entity_type, entity_id, summary_key, summary_params)
   SELECT 'PASSWORD_RESET', 'USER', id::text, 'audit.summary.USER.PASSWORD_RESET',
          jsonb_build_object('username', username, 'via', 'db-runbook')
     FROM users WHERE username = '<admin-username>';
   COMMIT;
   SQL
   ```
4. Log in with the temporary password; you are forced to set a new one.
5. If no admin row exists at all: set `ADMIN_*` in `.env` only works on an empty users table — instead, run step 3 against an existing employee username (it promotes them to ADMIN).
