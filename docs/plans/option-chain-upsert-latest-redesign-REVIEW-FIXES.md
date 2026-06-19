# option-chain upsert-latest — BLOCKING REVIEW FIXES

**For the session implementing `option-chain-upsert-latest-redesign.md`.**
**Reviewer:** independent adversarial review (Claude session `44004638`, workflow `wf_298bb91d-f14`, 5 verifiers + synthesis) + direct source verification, 2026-06-17.
**Status of the reviewed work as of this review:** the Rust + Node dual-writes were LIVE in the working tree (`ingest.rs +120`, `option-metadata-store.ts +31`) but NOT yet deployed (api-server ran the old `dist`). This is a historical blocking-review note; later source revisions should be checked directly before treating any item below as still open.

---

## TL;DR
- ✅ **Migration** (`lib/db/migrations/20260617_option_chain_latest.sql`) is **safe to apply now** — additive, no FKs, indexes on an empty table, reversible.
- ✅ **History-drop is safe** (the make-or-break claim): both readers (`gex.rs:34` distinct-on, `option-metadata-store.ts:855` keep-first-by-`as_of`) collapse to latest-per-contract. No history consumer.
- ✅ **Upsert key `(option_contract_id, source)`** verified necessary + sufficient; monotonicity guard correct. **Rust dual-write (`ingest.rs`) is correct** (ticker-dedup + single tx).
- ⛔ **The Node dual-write (`option-metadata-store.ts:541-575`) has TWO data-loss-class bugs. Do NOT deploy Phase 1 until both are fixed.**

---

## BLOCKING BUG 1 — intra-batch `ON CONFLICT` → throws → write suppressed
`snapshotRows` is built from `input.contracts` (516-539) with **no dedup by `optionContractId`**; one call writes a single `source` and a single `asOf`. The new upsert on `(optionContractId, source)` (552-556) throws Postgres **`ON CONFLICT DO UPDATE command cannot affect row a second time`** whenever any 500-row chunk contains two rows for the same `option_contract_id`. The Rust path avoids this via `unique_option_chain_snapshots` ticker-dedup (`ingest.rs:206`); the Node path has no equivalent.

## BLOCKING BUG 2 — non-atomic dual-write → divergence + silent suppression
The two writes are **separate statements, not one transaction**: `db.insert(optionChainSnapshotsTable)` (544) then a distinct `db.insert(optionChainLatestTable)...onConflictDoUpdate` (549). If the upsert throws (e.g. Bug 1), the legacy insert has **already committed**, the loop aborts, remaining chunks skip, and the `catch` (579-585) swallows the error and arms `markDurableOptionMetadataFailure` backoff → **future writes for that scope are silently suppressed** and `option_chain_latest` is left permanently behind. Rust does both writes in one `tx` (`ingest.rs:176` begin / `191` commit).

---

## FIX (paste-ready) — replace the chunk loop in `persistOptionChain` (`option-metadata-store.ts`, the `for (let index = 0; ...)` block ~541-575)

```ts
    for (let index = 0; index < snapshotRows.length; index += 500) {
      const values = snapshotRows.slice(index, index + 500);
      if (!values.length) {
        continue;
      }
      // BUG 1 fix: this call writes one `source` + one `asOf`, so two input
      // contracts resolving to the same option_contract_id would make the single
      // ON CONFLICT statement affect one row twice ("cannot affect row a second
      // time"). Dedup the UPSERT batch by optionContractId (keep last). The
      // legacy append keeps every row — its readers already take latest-per-contract.
      const upsertValues = [
        ...new Map(values.map((row) => [row.optionContractId, row])).values(),
      ];
      // BUG 2 fix: both writes in ONE transaction. If the upsert fails the legacy
      // insert rolls back too, so the two tables can never diverge and a failure
      // can't silently leave option_chain_latest behind (the catch arms backoff).
      await db.transaction(async (tx) => {
        await tx.insert(optionChainSnapshotsTable).values(values);
        await tx
          .insert(optionChainLatestTable)
          .values(upsertValues)
          .onConflictDoUpdate({
            target: [
              optionChainLatestTable.optionContractId,
              optionChainLatestTable.source,
            ],
            set: {
              bid: sql`excluded.bid`,
              ask: sql`excluded.ask`,
              last: sql`excluded.last`,
              mark: sql`excluded.mark`,
              impliedVolatility: sql`excluded.implied_volatility`,
              delta: sql`excluded.delta`,
              gamma: sql`excluded.gamma`,
              theta: sql`excluded.theta`,
              vega: sql`excluded.vega`,
              openInterest: sql`excluded.open_interest`,
              volume: sql`excluded.volume`,
              asOf: sql`excluded.as_of`,
              updatedAt: sql`now()`,
            },
            setWhere: sql`excluded.as_of >= ${optionChainLatestTable.asOf}`,
          });
      });
    }
```

(Optionally apply the same dedup to the legacy `values` too — harmless, since the append readers collapse to latest-per-contract — but keeping the legacy insert un-deduped preserves its exact pre-redesign behavior.)

---

## NON-BLOCKING (handle before later phases, not before Phase 1)
- **Prune repoint:** `pruneOldSnapshots` (`option-metadata-store.ts:478`) deletes ONLY from `option_chain_snapshots`; it never touches `option_chain_latest`. After Phase-4 decommission, the latest table's non-`massive` rows — especially unbounded-cardinality `signal-options:decision:<deploymentId>` — are never pruned → unbounded growth re-emerges. Repoint the prune at the latest table **before** decommission.
- **Prune time-gate vs live latest row:** the 24h `lt(asOf, cutoff)` prune would delete the SINGLE live latest row for a `signal-options:decision:<id>` deployment that's been quiet >24h. `massive` is structurally safe (not in `OPTION_METADATA_PRUNABLE_SOURCES`, not matched by `signal-options:%`), so GEX can't be starved — but the decision-source rows need a last-row-guarded / non-time-based prune on the latest table.
- **Doc nits:** the migration file is `20260617_option_chain_latest.sql`, not `20260618_` as the redesign doc says (hand-apply hazard); the source-family list omits the bare default `'ibkr'` (`option-metadata-store.ts:536` `input.source ?? "ibkr"`).

## Confirmed GOOD (no change needed)
History-drop safety · migration lock-safety (no FKs, empty-table indexes) · upsert key necessity+sufficiency · per-source monotonicity guard · Rust dual-write correctness.
