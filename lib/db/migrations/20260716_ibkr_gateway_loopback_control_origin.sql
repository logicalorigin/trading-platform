-- Co-located session hosts are reachable only through an exact loopback HTTP
-- origin. Remote host origins remain HTTPS-only.

BEGIN;

ALTER TABLE ibkr_gateway_hosts
  DROP CONSTRAINT ibkr_gateway_hosts_control_origin_chk,
  ADD CONSTRAINT ibkr_gateway_hosts_control_origin_chk
  CHECK (
    (control_origin ~ '^https://[^/?#]+/?$' AND control_origin !~ '@')
    OR control_origin ~ '^http://127[.]0[.]0[.]1(:[0-9]{1,5})?$'
    OR control_origin ~ '^http://[[]::1[]](:[0-9]{1,5})?$'
  );

COMMIT;
