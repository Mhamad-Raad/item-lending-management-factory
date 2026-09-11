# Runbook — deploy a new version

Normal path (automatic):

1. Merge to `main`; wait for CI to be green.
2. Tag: `git tag v1.4.0 && git push origin v1.4.0`.
3. GitHub Actions `Deploy` runs CI, pushes `ghcr.io/mhamad-raad/pallet-api:<sha>` and `pallet-caddy:<sha>`, then SSHes to the VPS and runs `/opt/pallet/deploy/deploy.sh <sha>`.
4. `deploy.sh` checks out `<sha>` in `/opt/pallet`, sets `APP_VERSION`, pulls images, runs the `migrate` one-shot (migrations + grants + first-run seed), `docker compose up -d`, waits ≤ 60 s for the API health check, and rolls back automatically to the previous SHA on failure.
5. Verify: open `https://<APP_DOMAIN>`, log in, open the dashboard; check `https://<APP_DOMAIN>/api/health` returns `{"status":"ok","db":"ok","version":"<sha>"}`.

Manual path (Actions unavailable):

1. Build and push images from a workstation: `docker build -f apps/api/Dockerfile -t ghcr.io/mhamad-raad/pallet-api:<sha> . && docker push …` (same for `deploy/caddy/Dockerfile`).
2. `ssh <user>@<vps>` then `sudo /opt/pallet/deploy/deploy.sh <sha>`.

Rules:

- Migrations must be expand-only for one release (add columns/tables; drop only in the release after the code stops using them). This keeps rollback safe.
- A short restart is acceptable (zero downtime is not required). Deploy outside factory working hours when possible.

One-time VPS prerequisites: `/opt/pallet` is a git clone of the repository; `/opt/pallet/.env` exists (from `.env.example`); `docker login ghcr.io` done with a GitHub token that has `read:packages` (or both GHCR packages set to public); GitHub repository secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_HOST_FINGERPRINT` and environment `production` exist.
