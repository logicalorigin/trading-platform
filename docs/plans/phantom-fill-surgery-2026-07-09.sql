-- Phantom-fill ledger surgery, 2026-07-09 (Riley-approved: "make the changes. we are shadow trading")
-- Audit basis: docs/plans/phantom-fills-audit-2026-07-09.md
\set ON_ERROR_STOP on
BEGIN;

-- ---------- backups (drop after acceptance) ----------
CREATE TABLE IF NOT EXISTS _phantom_backup_fills_20260709 AS
  SELECT * FROM shadow_fills WHERE id IN (
    '17569796-3744-4710-9c6d-232513006a6b','3bce202d-e2ee-4daf-b1ef-9a954e05a64f',
    '6604b75e-7f2b-4a11-b9f3-0975dcce071e','df83cdb0-6744-47a2-a012-b78159b39e60',
    '8724cd31-bacf-454a-bc41-acf9a684b1a2','58af07bf-c32a-410d-9851-cbefd38bdbf3');
CREATE TABLE IF NOT EXISTS _phantom_backup_positions_20260709 AS
  SELECT * FROM shadow_positions WHERE id = '2d730583-a3e6-4c80-bd26-3adfb2c6cdcd'
     OR (symbol IN ('BRKR','ZETA','KTOS','MULL') AND status='closed'
         AND closed_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z');
CREATE TABLE IF NOT EXISTS _phantom_backup_orders_20260709 AS
  SELECT * FROM shadow_orders WHERE id IN (
    'b41bbe8c-2ad0-4fe4-8f63-899b8c456161','a0a0c679-a990-4948-bec8-34d945b653ca');
CREATE TABLE IF NOT EXISTS _phantom_backup_marks_20260709 AS
  SELECT * FROM shadow_position_marks WHERE position_id = '2d730583-a3e6-4c80-bd26-3adfb2c6cdcd';

-- ---------- A. re-price the 4 degenerate-spread sells to the fixed-rule mid ----------
-- BRKR 2.24 -> 3.92 (mid 3.925, captured quote; toFixed(2) of 3.925 float = 3.92): delta +672.00
UPDATE shadow_fills SET price=3.92, gross_amount=1568.00, realized_pnl=realized_pnl+672.00,
  cash_delta=cash_delta+672.00, updated_at=now()
  WHERE id='17569796-3744-4710-9c6d-232513006a6b';
-- ZETA 0.34 -> 0.95 (mark-reconstructed mid): delta +610.00
UPDATE shadow_fills SET price=0.95, gross_amount=950.00, realized_pnl=realized_pnl+610.00,
  cash_delta=cash_delta+610.00, updated_at=now()
  WHERE id='3bce202d-e2ee-4daf-b1ef-9a954e05a64f';
-- KTOS 0.54 -> 1.00: delta +414.00
UPDATE shadow_fills SET price=1.00, gross_amount=900.00, realized_pnl=realized_pnl+414.00,
  cash_delta=cash_delta+414.00, updated_at=now()
  WHERE id='6604b75e-7f2b-4a11-b9f3-0975dcce071e';
-- MULL 0.83 -> 2.05: delta +366.00
UPDATE shadow_fills SET price=2.05, gross_amount=615.00, realized_pnl=realized_pnl+366.00,
  cash_delta=cash_delta+366.00, updated_at=now()
  WHERE id='df83cdb0-6744-47a2-a012-b78159b39e60';

-- closed-position realized mirrors
UPDATE shadow_positions SET realized_pnl=realized_pnl+672.00, updated_at=now()
  WHERE account_id='shadow' AND symbol='BRKR' AND status='closed' AND closed_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE shadow_positions SET realized_pnl=realized_pnl+610.00, updated_at=now()
  WHERE account_id='shadow' AND symbol='ZETA' AND status='closed' AND closed_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE shadow_positions SET realized_pnl=realized_pnl+414.00, updated_at=now()
  WHERE account_id='shadow' AND symbol='KTOS' AND status='closed' AND closed_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE shadow_positions SET realized_pnl=realized_pnl+366.00, updated_at=now()
  WHERE account_id='shadow' AND symbol='MULL' AND status='closed' AND closed_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';

-- ---------- B. void ASTN (invalid entry: bid-0, 62-min-stale quote; gates now fail closed) ----------
DELETE FROM shadow_position_marks WHERE position_id='2d730583-a3e6-4c80-bd26-3adfb2c6cdcd';
DELETE FROM shadow_fills WHERE id IN ('8724cd31-bacf-454a-bc41-acf9a684b1a2','58af07bf-c32a-410d-9851-cbefd38bdbf3');
DELETE FROM shadow_positions WHERE id='2d730583-a3e6-4c80-bd26-3adfb2c6cdcd';
DELETE FROM shadow_orders WHERE id IN ('b41bbe8c-2ad0-4fe4-8f63-899b8c456161','a0a0c679-a990-4948-bec8-34d945b653ca');

-- ---------- C. account running balances ----------
-- cash: +2062.00 (re-prices) + 1266.72 (ASTN cash_delta reversal: +1288.36 - 21.64) = +3328.72
-- realized: +2062.00 + 1263.36 = +3325.36 ; fees: -6.72 (ASTN legs)
UPDATE shadow_accounts SET cash=cash+3328.72, realized_pnl=realized_pnl+3325.36,
  fees=fees-6.72, updated_at=now() WHERE id='shadow';

-- ---------- D. balance-snapshot history (arithmetically reversible; deltas recorded in audit doc) ----------
-- re-priced sells at their fill times
UPDATE shadow_balance_snapshots SET cash=cash+672.00, buying_power=buying_power+672.00,
  net_liquidation=net_liquidation+672.00, realized_pnl=realized_pnl+672.00
  WHERE account_id='shadow' AND as_of >= '2026-07-09T13:33:23.09+00';
UPDATE shadow_balance_snapshots SET cash=cash+610.00, buying_power=buying_power+610.00,
  net_liquidation=net_liquidation+610.00, realized_pnl=realized_pnl+610.00
  WHERE account_id='shadow' AND as_of >= '2026-07-09T13:33:23.09+00';
UPDATE shadow_balance_snapshots SET cash=cash+414.00, buying_power=buying_power+414.00,
  net_liquidation=net_liquidation+414.00, realized_pnl=realized_pnl+414.00
  WHERE account_id='shadow' AND as_of >= '2026-07-09T13:55:47.679+00';
UPDATE shadow_balance_snapshots SET cash=cash+366.00, buying_power=buying_power+366.00,
  net_liquidation=net_liquidation+366.00, realized_pnl=realized_pnl+366.00
  WHERE account_id='shadow' AND as_of >= '2026-07-09T13:43:57.731+00';
-- ASTN buy reversal (cash out restored) then sell reversal (cash in removed, realized restored)
UPDATE shadow_balance_snapshots SET cash=cash+1288.36, buying_power=buying_power+1288.36,
  net_liquidation=net_liquidation+1288.36, fees=fees-3.36
  WHERE account_id='shadow' AND as_of >= '2026-07-09T14:32:03.567+00';
UPDATE shadow_balance_snapshots SET cash=cash-21.64, buying_power=buying_power-21.64,
  net_liquidation=net_liquidation-21.64, realized_pnl=realized_pnl+1263.36, fees=fees-3.36
  WHERE account_id='shadow' AND as_of >= '2026-07-09T14:32:21.519+00';

COMMIT;

-- acceptance readback
SELECT round(sum(realized_pnl)::numeric,2) AS jul9_realized, count(*) AS fills
FROM shadow_fills
WHERE (occurred_at AT TIME ZONE 'America/New_York')::date = '2026-07-09';
SELECT round(net_liquidation::numeric,0) AS latest_nlv, as_of FROM shadow_balance_snapshots ORDER BY as_of DESC LIMIT 1;
SELECT round(cash::numeric,2) AS account_cash, round(realized_pnl::numeric,2) AS account_realized FROM shadow_accounts WHERE id='shadow';

-- ============ V2 APPENDIX (post-verification additions; run as its own transaction) ============
-- Verification findings (wf_61de3b9f): (1) mirror-repair rescans the last 10k
-- entry/exit events every ~60s and RE-CREATES ledger records for any event without
-- a shadow_orders.source_event_id mirror — the deleted ASTN trade would resurrect
-- within a minute unless its events are flagged out of repair scope (the designed
-- exemption: payload.backfill.source). (2) The daily-loss halt sums EXIT-EVENT
-- payload pnl, so re-priced fills need their event payloads patched to match.
\set ON_ERROR_STOP on
BEGIN;

-- ASTN: exempt both events from mirror-repair + annotate the void + zero the halt input
UPDATE execution_events SET payload = jsonb_set(jsonb_set(
    payload,
    '{backfill}', '{"source":"signal_options_backfill"}'::jsonb),
    '{voided}', '{"reason":"invalid_entry_degenerate_quote_gates_failed_open","audit":"docs/plans/phantom-fills-audit-2026-07-09.md"}'::jsonb)
  WHERE id = 'f334df29-2953-4905-acee-627efbdab8cd';
UPDATE execution_events SET payload = jsonb_set(jsonb_set(jsonb_set(
    payload,
    '{backfill}', '{"source":"signal_options_backfill"}'::jsonb),
    '{voided}', '{"reason":"invalid_entry_degenerate_quote_gates_failed_open","audit":"docs/plans/phantom-fills-audit-2026-07-09.md"}'::jsonb),
    '{pnl}', '0'::jsonb)
  WHERE id = '4a935ebc-9b42-4782-9ec4-95eeba023270';

-- Re-priced exits: align event payload pnl/exitPrice with the corrected fills
-- (KTOS and MULL each emitted duplicate exit events; patch all in the window).
UPDATE execution_events SET payload = jsonb_set(jsonb_set(payload,'{pnl}','105.31'::jsonb),'{exitPrice}','3.92'::jsonb)
  WHERE event_type='signal_options_shadow_exit' AND payload->'position'->>'symbol'='BRKR'
    AND occurred_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE execution_events SET payload = jsonb_set(jsonb_set(payload,'{pnl}','-96.73'::jsonb),'{exitPrice}','0.95'::jsonb)
  WHERE event_type='signal_options_shadow_exit' AND payload->'position'->>'symbol'='ZETA'
    AND occurred_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE execution_events SET payload = jsonb_set(jsonb_set(payload,'{pnl}','-582.06'::jsonb),'{exitPrice}','1.00'::jsonb)
  WHERE event_type='signal_options_shadow_exit' AND payload->'position'->>'symbol'='KTOS'
    AND occurred_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';
UPDATE execution_events SET payload = jsonb_set(jsonb_set(payload,'{pnl}','-713.02'::jsonb),'{exitPrice}','2.05'::jsonb)
  WHERE event_type='signal_options_shadow_exit' AND payload->'position'->>'symbol'='MULL'
    AND occurred_at BETWEEN '2026-07-09T13:00:00Z' AND '2026-07-09T15:00:00Z';

COMMIT;

-- v2 readback: ASTN events exempt from repair + no unmirrored live events remain
SELECT count(*) AS astn_events_flagged FROM execution_events
  WHERE id IN ('f334df29-2953-4905-acee-627efbdab8cd','4a935ebc-9b42-4782-9ec4-95eeba023270')
    AND payload->'backfill'->>'source'='signal_options_backfill';
