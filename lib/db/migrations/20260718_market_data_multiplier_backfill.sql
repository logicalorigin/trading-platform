-- Massive OCC contracts represent standard 100-share premium units. Repair
-- legacy rows written before ingest separated premium multiplier from the
-- provider's deliverable metadata.
update option_contracts
set
  multiplier = 100
where massive_ticker is not null
  and multiplier is distinct from 100;
