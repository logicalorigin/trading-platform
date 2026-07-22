ALTER TABLE signal_monitor_profiles
  ADD COLUMN IF NOT EXISTS signal_settings_revision integer NOT NULL DEFAULT 1;

ALTER TABLE signal_monitor_symbol_states
  ADD COLUMN IF NOT EXISTS signal_settings_revision integer;

UPDATE signal_monitor_symbol_states AS state
SET active = false,
    updated_at = now()
FROM signal_monitor_profiles AS profile
WHERE state.profile_id = profile.id
  AND profile.environment = 'live'
  AND state.active = true;

UPDATE signal_monitor_profiles
SET enabled = false,
    updated_at = now()
WHERE environment = 'live'
  AND enabled = true;
