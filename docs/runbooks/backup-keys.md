# Runbook — append-only backup keys and Object Lock (one-time, by hand)

Why (ARCHITECTURE.md §13.6, Q70): the VPS runs the nightly backup. If the VPS is taken over, its bucket key must not be able to destroy the backups. So the VPS gets an **append-only** key (it can add snapshots, never delete), the bucket keeps every object for at least **30 days** with **Object Lock**, and retention (`restic forget --prune`) runs from the maintainer's own machine with a **second key** that may delete.

**Nothing in the repository can do this part: it happens in the Backblaze B2 account, by hand.** Until it is done, the VPS key can still delete the backups.

You need: the B2 account login (password manager), the B2 command-line tool on your own machine (`pip install b2` or `brew install b2-tools`; the web console cannot create a key without `deleteFiles`), and `restic`.

## 1. Bucket: Object Lock and lifecycle

In the B2 web console → **Buckets** → `pallet-backups`:

1. **Object Lock** → enable it (B2 can enable it on an existing bucket; if the console refuses, create a new bucket with "Object Lock: Enable", `restic init` it, and point both env files at it).
2. **Default retention**: mode **Compliance**, **30 days** (or more). Compliance cannot be shortened or removed by anyone, including the account owner, until each object's 30 days are over — that is the protection. (Governance mode can be lifted by a key with `bypassGovernance`; use it only if you accept that.)
3. **Lifecycle settings** → "Keep prior versions for this number of days": **30**. A pruned (or maliciously deleted) file is only _hidden_ at first; it stays recoverable for 30 days, then B2 removes it.

Cost: every byte uploaded stays billed for at least 30 days, even after a prune.

## 2. The VPS key — append-only

On your machine, signed in to the B2 CLI with the account's master key (`b2 account authorize`):

```bash
b2 key create --bucket pallet-backups pallet-vps-append listBuckets,listFiles,readFiles,writeFiles
# older CLI versions: b2 create-key --bucket pallet-backups pallet-vps-append listBuckets,listFiles,readFiles,writeFiles
```

No `deleteFiles`, no `bypassGovernance`, no `writeFileRetentions`. Put the printed `keyID` / `applicationKey` into `/etc/pallet/backup.env` on the VPS (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) and into the password manager.

Check it on the VPS: `sudo /opt/pallet/deploy/backup/backup.sh` must end with `backup OK`; `b2 key list` (on your machine) must show the key without `deleteFiles`. Then delete the old read-and-write key in the console (**Application Keys**).

## 3. The prune key — only on the maintainer's machine

```bash
b2 key create --bucket pallet-backups pallet-prune listBuckets,listFiles,readFiles,writeFiles,deleteFiles
```

Where it lives: `~/.config/pallet/prune.env` on the maintainer's machine (`chmod 600`, from `deploy/backup/prune.env.example`) and the password manager entry "Pallet System production". **Never** on the VPS, in GitHub secrets or in the repository.

## 4. Prune monthly, from your machine

```bash
git clone https://github.com/Mhamad-Raad/item-lending-management-factory.git   # once
cd item-lending-management-factory && deploy/backup/prune.sh
```

It keeps 30 daily snapshots (`restic forget --keep-daily 30 --prune`) and runs `restic check`. It refuses to run on a host that has `/etc/pallet/backup.env` (the VPS). Put a monthly reminder in your calendar, or set `HEALTHCHECKS_PRUNE_URL` (a healthchecks.io check with a 31-day period) so a forgotten prune alerts you. A missed month costs only storage.

## If the VPS was compromised

1. Rotate the VPS key (step 2, new name) — the attacker has the old one; delete the old key.
2. From your machine: `restic snapshots --tag pallet` with `prune.env`. If snapshots or data files are missing, the attacker hid them: within the 30-day window they still exist as prior versions. Restore them with the prune key before anything else (B2 CLI: list with `b2 ls --versions b2://pallet-backups/`, then `b2 file unhide b2://pallet-backups/<path>` for each hidden file; or copy the bucket as of a date before the attack with `rclone copy --b2-version-at <time>` into a new bucket).
3. Then follow `restore-from-backup.md`.
