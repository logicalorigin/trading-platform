# IBKR Hookup (This Workspace)

This project now supports Interactive Brokers Client Portal API auth/session bootstrap, account auto-discovery, live market data, live positions, and live order submission.

## 1. Start IBKR Client Portal Gateway

Use your preferred gateway setup (local install or Docker) and make sure API is reachable from this app server.

Common URLs:
- `https://127.0.0.1:5000` (default CP Gateway)
- `http://127.0.0.1:5001` (reverse-proxied/no-TLS setup)

If IB Gateway is on `5000`, run this app on a different port (for example `5122`) to avoid conflicts.

## 2. Set runtime secrets/env

Minimum required:
- `IBKR_BASE_URL`

Recommended:
- `IBKR_ACCOUNT_ID` (optional now; auto-discovered after login/session)
- `IBKR_ALLOW_INSECURE_TLS=true` when using a self-signed local HTTPS gateway

Example:

```bash
export IBKR_BASE_URL="https://127.0.0.1:5000"
export IBKR_ALLOW_INSECURE_TLS="true"
# optional:
export IBKR_ACCOUNT_ID="U1234567"
```

## 3. Start this app server

```bash
HOST=127.0.0.1 PORT=5122 npm run dev
```

## 4. Connect IBKR account in API/UI

You can use the UI `Positions & Accounts -> IBKR Main -> Connect`, or API:

```bash
curl -sS -X POST "http://127.0.0.1:5122/api/accounts/ibkr-main/connect" \
  -H 'content-type: application/json' \
  -d '{
    "broker":"ibkr",
    "label":"IBKR Main",
    "mode":"live",
    "credentials":{
      "IBKR_BASE_URL":"https://127.0.0.1:5000",
      "IBKR_ALLOW_INSECURE_TLS":"true"
    }
  }'
```

## 5. Authenticate brokerage session

If auth state is `needs_login`, sign in through CP Gateway, then refresh auth:

```bash
curl -sS -X POST "http://127.0.0.1:5122/api/accounts/ibkr-main/auth/refresh"
```

Expected successful state:
- `auth.state = "authenticated"`

The adapter now also attempts session bootstrap with:
- `POST /v1/api/iserver/auth/status`
- `POST /v1/api/iserver/auth/ssodh/init` (when refreshing)
- `POST /v1/api/tickle`
- `GET /v1/api/iserver/accounts`
- `POST /v1/api/iserver/account`

## 6. Verify live data

Spot quote:

```bash
curl -sS "http://127.0.0.1:5122/api/market/spot?accountId=ibkr-main&symbol=SPY"
```

Positions:

```bash
curl -sS "http://127.0.0.1:5122/api/positions?accountId=ibkr-main"
```

Bars:

```bash
curl -sS "http://127.0.0.1:5122/api/market/bars?accountId=ibkr-main&symbol=SPY&resolution=5&countBack=50"
```

## 7. Submit a live IBKR order

Live mode order submission now uses:
- `POST /v1/api/iserver/account/{accountId}/orders`
- `POST /v1/api/iserver/reply/{id}` (auto-confirm loop when required)

Example (option market order):

```bash
curl -sS -X POST "http://127.0.0.1:5122/api/orders" \
  -H 'content-type: application/json' \
  -d '{
    "accountId":"ibkr-main",
    "symbol":"SPY",
    "assetType":"option",
    "side":"buy",
    "quantity":1,
    "orderType":"market",
    "expiry":"2026-03-20",
    "strike":600,
    "right":"call",
    "executionMode":"live",
    "timeInForce":"day"
  }'
```

## Notes

- Paper-mode orders still use synthetic fills in this app by design.
- Live IBKR orders require `executionMode: "live"` and account mode set to `live`.
- Option strike discovery now uses IBKR `MMMYY` month format for `secdef/strikes`.
