alter table if exists flex_open_positions
  add column if not exists contract_key text not null default '';

with raw_values as (
  select
    p.id,
    p.symbol,
    (
      select btrim(entry.value)
      from jsonb_each_text(coalesce(p.raw, '{}'::jsonb)) as entry(key, value)
      where lower(entry.key) = any (
        array[
          'providercontractid',
          'conid',
          'contractid',
          'ibcontractid',
          'ibkrcontractid'
        ]
      )
        and btrim(entry.value) <> ''
      order by array_position(
        array[
          'providercontractid',
          'conid',
          'contractid',
          'ibcontractid',
          'ibkrcontractid'
        ],
        lower(entry.key)
      )
      limit 1
    ) as contract_id,
    (
      select btrim(entry.value)
      from jsonb_each_text(coalesce(p.raw, '{}'::jsonb)) as entry(key, value)
      where lower(entry.key) = any (
        array[
          'underlyingsymbol',
          'underlying',
          'underlyingticker',
          'symbol'
        ]
      )
        and btrim(entry.value) <> ''
      order by array_position(
        array[
          'underlyingsymbol',
          'underlying',
          'underlyingticker',
          'symbol'
        ],
        lower(entry.key)
      )
      limit 1
    ) as underlying_raw,
    (
      select btrim(entry.value)
      from jsonb_each_text(coalesce(p.raw, '{}'::jsonb)) as entry(key, value)
      where lower(entry.key) = any (
        array[
          'expirationdate',
          'expiration',
          'expiry',
          'expdate',
          'maturity',
          'lasttradedateorcontractmonth'
        ]
      )
        and btrim(entry.value) <> ''
      order by array_position(
        array[
          'expirationdate',
          'expiration',
          'expiry',
          'expdate',
          'maturity',
          'lasttradedateorcontractmonth'
        ],
        lower(entry.key)
      )
      limit 1
    ) as expiration_raw,
    (
      select btrim(entry.value)
      from jsonb_each_text(coalesce(p.raw, '{}'::jsonb)) as entry(key, value)
      where lower(entry.key) = any (
        array[
          'strike',
          'strikeprice'
        ]
      )
        and btrim(entry.value) <> ''
      order by array_position(
        array[
          'strike',
          'strikeprice'
        ],
        lower(entry.key)
      )
      limit 1
    ) as strike_raw,
    (
      select btrim(entry.value)
      from jsonb_each_text(coalesce(p.raw, '{}'::jsonb)) as entry(key, value)
      where lower(entry.key) = any (
        array[
          'right',
          'putcall',
          'callput',
          'optiontype'
        ]
      )
        and btrim(entry.value) <> ''
      order by array_position(
        array[
          'right',
          'putcall',
          'callput',
          'optiontype'
        ],
        lower(entry.key)
      )
      limit 1
    ) as right_raw
  from flex_open_positions p
),
normalized as (
  select
    id,
    nullif(contract_id, '') as contract_id,
    upper(regexp_replace(coalesce(underlying_raw, symbol), '[^A-Za-z0-9]', '', 'g')) as underlying_key,
    case
      when expiration_raw ~ '^[0-9]{8}$' then expiration_raw
      when expiration_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then replace(substring(expiration_raw from 1 for 10), '-', '')
      else null
    end as expiration_key,
    case
      when lower(coalesce(right_raw, '')) in ('call', 'c') then 'C'
      when lower(coalesce(right_raw, '')) in ('put', 'p') then 'P'
      else null
    end as right_key,
    case
      when regexp_replace(coalesce(strike_raw, ''), '[[:space:],$%]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then round((regexp_replace(strike_raw, '[[:space:],$%]', '', 'g'))::numeric * 1000)::bigint
      else null
    end as strike_key
  from raw_values
),
contract_keys as (
  select
    id,
    case
      when contract_id is not null then 'id:' || contract_id
      when underlying_key <> ''
        and expiration_key is not null
        and right_key is not null
        and strike_key is not null
      then 'O:' || underlying_key || substring(expiration_key from 3 for 6) || right_key || lpad(strike_key::text, 8, '0')
      else ''
    end as contract_key
  from normalized
)
update flex_open_positions p
set contract_key = contract_keys.contract_key
from contract_keys
where p.id = contract_keys.id
  and p.contract_key is distinct from contract_keys.contract_key;

create unique index if not exists flex_open_positions_unique_account_symbol_as_of_contract_key_idx
  on flex_open_positions (provider_account_id, symbol, as_of, contract_key);

drop index if exists flex_open_positions_unique_account_symbol_as_of_idx;
