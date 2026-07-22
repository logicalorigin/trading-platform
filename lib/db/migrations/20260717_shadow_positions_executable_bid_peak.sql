-- Durable, lifecycle-local high-water mark used by Signal Options stop
-- enforcement. This column is written only from executable-bid-provenance
-- quote payloads; valuation mids must never populate it.
ALTER TABLE "shadow_positions"
  ADD COLUMN IF NOT EXISTS "executable_bid_peak" numeric(18, 6),
  ADD COLUMN IF NOT EXISTS "executable_bid_peak_as_of" timestamptz;
