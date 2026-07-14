-- Manual apply after the S&P priority creator and readers are removed.
-- Preserve membership rows for audit while making the retired source inert.
-- Rollback requires restoring the reader/creator code and running a fresh,
-- authoritative source sync; do not blindly reactivate stale memberships.
UPDATE universe_source_memberships
SET active = false,
    last_missing_at = now(),
    updated_at = now()
WHERE source_id = 'sp500'
  AND active = true;
