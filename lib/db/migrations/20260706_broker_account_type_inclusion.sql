alter table if exists broker_accounts
  add column if not exists account_type varchar(32);

alter table if exists broker_accounts
  add column if not exists included_in_trading boolean not null default true;

update broker_accounts
   set account_type = case
     when display_name ~* '\mcrypto\M' then 'crypto'
     when display_name ~* '\mfutures\M' then 'futures'
     when display_name ~* '\mevents?\M' then 'prediction'
     else 'equity'
   end
 where account_type is null
    or account_type not in ('crypto', 'futures', 'prediction', 'equity');

update broker_accounts
   set included_in_trading = false
 where account_type in ('crypto', 'futures', 'prediction')
   and included_in_trading = true;
