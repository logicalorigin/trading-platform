-- 20260626_option_contract_broker_contract_id.sql
--
-- Split option market-data identity from broker execution identity.
-- provider_contract_id remains the public market-data identifier and should
-- converge on Massive/OPRA tickers. broker_contract_id preserves legacy broker
-- contract ids needed only for order/account reconciliation.

alter table public.option_contracts
  add column if not exists broker_contract_id varchar(128);

update public.option_contracts
set broker_contract_id = provider_contract_id
where broker_contract_id is null
  and provider_contract_id is not null
  and trim(provider_contract_id) <> ''
  and upper(trim(provider_contract_id)) not like 'O:%';

-- Keep this migration outside an explicit transaction. CREATE INDEX CONCURRENTLY
-- is required here because option_contracts is large enough that a transaction
-- wrapping the backfill holds the ALTER TABLE lock for too long under live load.
create unique index concurrently if not exists option_contracts_broker_contract_id_idx
  on public.option_contracts (broker_contract_id);
