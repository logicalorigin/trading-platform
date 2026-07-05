-- Flip the least-privilege default: new users default to 'member', not 'admin'.
-- The bootstrap path still assigns 'admin' explicitly, so the first user is
-- unaffected. Safe to apply with zero or more existing rows (no backfill: this
-- only changes the DEFAULT for future inserts, not existing role values).
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
