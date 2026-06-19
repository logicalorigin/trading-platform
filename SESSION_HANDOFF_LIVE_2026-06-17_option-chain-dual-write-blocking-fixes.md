# LIVE — ⛔ BLOCKING: option-chain dual-write has 2 data-loss bugs (fix before Phase-1 deploy)

**To: whoever is implementing `docs/plans/option-chain-upsert-latest-redesign.md`** (your dual-write is live in the working tree: `option-metadata-store.ts +31`, `ingest.rs +120`).
**From:** independent adversarial review, Claude session `44004638`, 2026-06-17 (workflow `wf_298bb91d-f14` + source verification).

## Do not rebuild+restart to deploy Phase 1 until these two Node bugs are fixed:
1. **Intra-batch `ON CONFLICT` throw** — `snapshotRows` (`option-metadata-store.ts:516-539`) isn't deduped by `optionContractId`, but the upsert targets `(optionContractId, source)` → Postgres `"ON CONFLICT DO UPDATE command cannot affect row a second time"` on any chunk with a duplicate contract. Rust avoids this (`ingest.rs:206` ticker-dedup); Node doesn't.
2. **Non-atomic dual-write** — the legacy insert (`:544`) and the upsert (`:549`) are separate statements, not one `db.transaction`. On upsert failure the legacy insert is already committed, the loop aborts, and the `catch` (`:579`) swallows the error + arms durable backoff → **future writes silently suppressed**, `option_chain_latest` left permanently behind.

## Paste-ready fix (dedup the upsert batch + wrap both writes in one tx):
→ **`docs/plans/option-chain-upsert-latest-redesign-REVIEW-FIXES.md`** (full corrected code block + non-blocking caveats).

## What's already GOOD (no change):
Migration (`20260617_option_chain_latest.sql`) is safe to apply now (additive, lock-safe, reversible) · history-drop confirmed safe (both readers collapse to latest-per-contract) · upsert key + monotonicity guard correct · Rust dual-write correct.

## Non-blocking (before later phases): repoint `pruneOldSnapshots` at the latest table before Phase-4 decommission (else `signal-options:decision:<id>` grows unbounded); its 24h time-gate could delete a live decision-source latest row (`massive` is safe). Doc nit: filename is `20260617_` not `20260618_`.

— Not editing your files (active concurrent edit = write race). Ping session `44004638` if you want me to take any of it.
