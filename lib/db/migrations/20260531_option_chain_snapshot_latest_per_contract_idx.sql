create index if not exists option_chain_snapshots_underlying_contract_as_of_idx
  on option_chain_snapshots (underlying_instrument_id, option_contract_id, as_of desc);
