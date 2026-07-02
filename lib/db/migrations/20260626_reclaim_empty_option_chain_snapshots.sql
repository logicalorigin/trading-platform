-- 20260626_reclaim_empty_option_chain_snapshots.sql
--
-- Phase 1 DB maintenance: reclaim the legacy option_chain_snapshots table after
-- live readers/writers moved to option_chain_latest.
--
-- Backup gate:
--   /tmp/db-maintenance-backups/phase1-targets-20260625T2355Z.dump
--   sha256 795ddfcd93e1ccffbc7cd75e8469974d24cdc8e921627696a6c4840fd6cb5794
--
-- Safety:
--   This script refuses to truncate if the table contains any rows. It leaves a
--   temporary empty shell in place for a low-risk soak; later dead-table cleanup
--   can quarantine/drop the shell after deployed code has stopped referencing it.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  snapshot_count bigint;
begin
  if to_regclass('public.option_chain_snapshots') is null then
    raise notice 'public.option_chain_snapshots is already absent; nothing to reclaim';
    return;
  end if;

  select count(*) into snapshot_count from public.option_chain_snapshots;
  if snapshot_count <> 0 then
    raise exception
      'refusing to truncate public.option_chain_snapshots: expected 0 rows, found %',
      snapshot_count;
  end if;

  execute 'truncate table public.option_chain_snapshots';
  execute 'analyze public.option_chain_snapshots';
end $$;

commit;
