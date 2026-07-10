---
name: Dev DB disk-quota incident & guard
description: How the managed dev Postgres wedged on disk quota, what the recovery looked like, and the guard rules that prevent recurrence.
---

# Dev DB disk-quota incident & guard

**Rule:** Never run `VACUUM FULL` (or any full-table-rewrite maintenance) on the managed dev Postgres. Shrink the regenerable `bar_cache` only with plain `TRUNCATE`/`DELETE`.
**Why:** A `VACUUM FULL` on the ~6 GB `bar_cache` hit the database disk quota mid-rewrite; the aborted rewrite's orphaned files pinned the quota and the DB crash-looped, locking out the app, the Database pane, and all agents. Recovery required platform/user action (point-in-time restore), not anything agent-side.
**How to apply:** If bar_cache or DB size grows large, use bounded DELETEs (retention scheduler path) or TRUNCATE; a disk-usage guard in the API warns/blocks bar_cache writes at configured MB thresholds (fail-open on stale/unknown probes).

**Diagnostic signature of the wedged/thawing state:** connections succeed and `select 1` returns instantly, but ANY catalog- or disk-touching query (`pg_is_in_recovery()`, `pg_stat_activity`, `pg_database_size`) hangs past 100s — the DB is I/O-frozen, not down. The platform `checkDatabase()` still reports "provisioned" in this state, so it cannot be trusted as a health signal. The freeze can thaw without an app-side change once platform recovery completes; re-probe before concluding.
