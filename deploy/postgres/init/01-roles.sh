#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════
# Pallet System — PostgreSQL first-run initialisation.
# Mounted into /docker-entrypoint-initdb.d of the official postgres image; it runs ONCE,
# only when the pgdata volume is empty. It creates:
#   pallet_owner  LOGIN CREATEDB  — owns database `pallet` and schema public; runs migrations
#   pallet_app    LOGIN           — runtime role used by the API (table grants: prisma/sql/grants.sql)
# Required environment: POSTGRES_USER (superuser, set by the image), DB_OWNER_PASSWORD, DB_APP_PASSWORD.
# ═══════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD must be set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "${POSTGRES_DB:-$POSTGRES_USER}" \
  -v owner_pw="$DB_OWNER_PASSWORD" \
  -v app_pw="$DB_APP_PASSWORD" <<'SQL'
CREATE ROLE pallet_owner LOGIN CREATEDB PASSWORD :'owner_pw';
CREATE ROLE pallet_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE pallet OWNER pallet_owner ENCODING 'UTF8' TEMPLATE template0;
SQL

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname pallet <<'SQL'
REVOKE ALL ON DATABASE pallet FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pallet TO pallet_owner;
GRANT CONNECT ON DATABASE pallet TO pallet_app;

ALTER SCHEMA public OWNER TO pallet_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pallet_app;

-- Runtime safety nets for the application role.
ALTER ROLE pallet_app IN DATABASE pallet SET statement_timeout = '30s';
ALTER ROLE pallet_app IN DATABASE pallet SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pallet_app IN DATABASE pallet SET timezone = 'UTC';
ALTER ROLE pallet_owner IN DATABASE pallet SET timezone = 'UTC';
SQL

echo "pallet init: roles pallet_owner, pallet_app and database pallet created"

# Development / CI only (docker-compose.dev.yml, ci.yml): a separate, identically configured
# database `pallet_test` for the integration suite. Never set in production.
if [[ "${PALLET_CREATE_TEST_DB:-false}" == "true" ]]; then
  psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "${POSTGRES_DB:-$POSTGRES_USER}" <<'SQL'
CREATE DATABASE pallet_test OWNER pallet_owner ENCODING 'UTF8' TEMPLATE template0;
SQL

  psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname pallet_test <<'SQL'
REVOKE ALL ON DATABASE pallet_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pallet_test TO pallet_owner;
GRANT CONNECT ON DATABASE pallet_test TO pallet_app;

ALTER SCHEMA public OWNER TO pallet_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pallet_app;

ALTER ROLE pallet_app IN DATABASE pallet_test SET statement_timeout = '30s';
ALTER ROLE pallet_app IN DATABASE pallet_test SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pallet_app IN DATABASE pallet_test SET timezone = 'UTC';
ALTER ROLE pallet_owner IN DATABASE pallet_test SET timezone = 'UTC';
SQL

  echo "pallet init: database pallet_test created (PALLET_CREATE_TEST_DB=true)"
fi
