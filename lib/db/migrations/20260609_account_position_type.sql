-- Add a durable account-reporting position type separate from trading
-- asset_class. The stored value is nullable so existing rows can still fall
-- back to read-time classification when source evidence is incomplete.

alter table if exists flex_trades
  add column if not exists position_type varchar(32);

alter table if exists flex_open_positions
  add column if not exists position_type varchar(32);

alter table if exists shadow_orders
  add column if not exists position_type varchar(32);

alter table if exists shadow_fills
  add column if not exists position_type varchar(32);

alter table if exists shadow_positions
  add column if not exists position_type varchar(32);

create index if not exists flex_trades_position_type_idx
  on flex_trades (position_type);

create index if not exists flex_open_positions_position_type_idx
  on flex_open_positions (position_type);

create index if not exists shadow_orders_position_type_idx
  on shadow_orders (position_type);

create index if not exists shadow_fills_position_type_idx
  on shadow_fills (position_type);

create index if not exists shadow_positions_position_type_idx
  on shadow_positions (position_type);

with static_etfs(symbol) as (
  values
    ('SPY'), ('QQQ'), ('IWM'), ('DIA'), ('TLT'), ('IEF'),
    ('GLD'), ('USO'), ('SOXX'), ('VXX'), ('VIXY')
)
update flex_trades t
   set position_type = case
     when lower(coalesce(
       t.raw->>'positionType',
       t.raw->>'securityType',
       t.raw->>'secType',
       t.raw->>'assetCategory',
       t.raw->>'assetClass',
       t.asset_class
     )) in ('opt', 'option', 'options')
       or lower(coalesce(t.raw->>'assetCategory', t.asset_class)) like '%option%'
     then 'option'
     when lower(coalesce(
       t.raw->>'positionType',
       t.raw->>'securityType',
       t.raw->>'secType',
       t.raw->>'assetCategory',
       t.raw->>'assetClass',
       t.asset_class
     )) = 'etf'
       or exists (
         select 1
           from ticker_reference_cache r
          where upper(r.symbol) = upper(t.symbol)
            and (
              lower(coalesce(r.asset_class, '')) = 'etf'
              or lower(coalesce(r.raw->>'market', '')) = 'etf'
              or lower(coalesce(r.raw->>'type', '')) = 'etf'
            )
       )
       or exists (select 1 from static_etfs e where e.symbol = upper(t.symbol))
     then 'etf'
     else 'stock'
   end
 where t.position_type is null;

with static_etfs(symbol) as (
  values
    ('SPY'), ('QQQ'), ('IWM'), ('DIA'), ('TLT'), ('IEF'),
    ('GLD'), ('USO'), ('SOXX'), ('VXX'), ('VIXY')
)
update flex_open_positions p
   set position_type = case
     when lower(coalesce(
       p.raw->>'positionType',
       p.raw->>'securityType',
       p.raw->>'secType',
       p.raw->>'assetCategory',
       p.raw->>'assetClass',
       p.asset_class
     )) in ('opt', 'option', 'options')
       or lower(coalesce(p.raw->>'assetCategory', p.asset_class)) like '%option%'
     then 'option'
     when lower(coalesce(
       p.raw->>'positionType',
       p.raw->>'securityType',
       p.raw->>'secType',
       p.raw->>'assetCategory',
       p.raw->>'assetClass',
       p.asset_class
     )) = 'etf'
       or exists (
         select 1
           from ticker_reference_cache r
          where upper(r.symbol) = upper(p.symbol)
            and (
              lower(coalesce(r.asset_class, '')) = 'etf'
              or lower(coalesce(r.raw->>'market', '')) = 'etf'
              or lower(coalesce(r.raw->>'type', '')) = 'etf'
            )
       )
       or exists (select 1 from static_etfs e where e.symbol = upper(p.symbol))
     then 'etf'
     else 'stock'
   end
 where p.position_type is null;

with static_etfs(symbol) as (
  values
    ('SPY'), ('QQQ'), ('IWM'), ('DIA'), ('TLT'), ('IEF'),
    ('GLD'), ('USO'), ('SOXX'), ('VXX'), ('VIXY')
)
update shadow_orders o
   set position_type = case
     when lower(o.asset_class) in ('opt', 'option', 'options') then 'option'
     when lower(o.asset_class) = 'etf'
       or exists (select 1 from static_etfs e where e.symbol = upper(o.symbol))
     then 'etf'
     else 'stock'
   end
 where o.position_type is null;

with static_etfs(symbol) as (
  values
    ('SPY'), ('QQQ'), ('IWM'), ('DIA'), ('TLT'), ('IEF'),
    ('GLD'), ('USO'), ('SOXX'), ('VXX'), ('VIXY')
)
update shadow_fills f
   set position_type = case
     when lower(f.asset_class) in ('opt', 'option', 'options') then 'option'
     when lower(f.asset_class) = 'etf'
       or exists (select 1 from static_etfs e where e.symbol = upper(f.symbol))
     then 'etf'
     else 'stock'
   end
 where f.position_type is null;

with static_etfs(symbol) as (
  values
    ('SPY'), ('QQQ'), ('IWM'), ('DIA'), ('TLT'), ('IEF'),
    ('GLD'), ('USO'), ('SOXX'), ('VXX'), ('VIXY')
)
update shadow_positions p
   set position_type = case
     when lower(p.asset_class) in ('opt', 'option', 'options') then 'option'
     when lower(p.asset_class) = 'etf'
       or exists (select 1 from static_etfs e where e.symbol = upper(p.symbol))
     then 'etf'
     else 'stock'
   end
 where p.position_type is null;
