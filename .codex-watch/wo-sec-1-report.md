# WO-SEC-1 Report

## Evidence

- `artifacts/api-server/src/routes/platform.ts:174` already imports `requireEntitlementCsrf`; no import was added.
- Sibling pattern confirmed:
  - `POST /orders` at `platform.ts:2118` calls `await requireEntitlementCsrf("broker_connect")(req);` at `platform.ts:2119`.
  - `POST /orders/submit` at `platform.ts:2130` calls `await requireEntitlementCsrf("broker_connect")(req);` at `platform.ts:2131`.
- Fixed routes:
  - `POST /accounts/:accountId/orders/:orderId/cancel` at `platform.ts:1919` now calls the guard first at `platform.ts:1920` before `cancelAccountOrder(...)` at `platform.ts:1927`.
  - `POST /orders/:orderId/replace` at `platform.ts:2165` now calls the guard first at `platform.ts:2166` before `replaceOrder(...)` at `platform.ts:2168`.
  - `POST /orders/:orderId/cancel` at `platform.ts:2177` now calls the guard first at `platform.ts:2178` before `cancelOrder(...)` at `platform.ts:2180`.

## Route Inventory

Grep basis:

```text
rg -n "requireEntitlementCsrf|router\.(post|put|patch|delete).*orders|replaceOrder\(|cancelOrder\(|cancelAccountOrder\(|placeOrder\(|submitRawOrders\(|previewOrder\(|placeShadowOrder\(|previewShadowOrder\(" artifacts/api-server/src/routes/platform.ts
```

| Route | Service call reached | Broker-mutating? | Guard present? | Notes |
| --- | --- | --- | --- | --- |
| `POST /accounts/:accountId/orders/:orderId/cancel` | `cancelAccountOrder(...)` | Yes, live-capable account cancel | Yes | Guard first statement at `platform.ts:1920`. |
| `POST /shadow/orders/preview` | `previewShadowOrder(...)` | No | No | Shadow preview only; no live broker mutation. |
| `POST /shadow/orders` | `placeShadowOrder(...)` | No | No | Shadow/paper order placement only; no live broker mutation. |
| `POST /orders` | `placeOrder(...)` | Yes, live-capable order create | Yes | Existing sibling guard at `platform.ts:2119`. |
| `POST /orders/preview` | `previewOrder(...)` | No | No | Read-only normalized order preview; intentionally unguarded by broker entitlement/CSRF. |
| `POST /orders/submit` | `submitRawOrders(...)` or `placeOrder(...)` | Yes, live-capable submit | Yes | Existing sibling guard at `platform.ts:2131`. |
| `POST /orders/:orderId/replace` | `replaceOrder(...)` | Yes, live-capable replace | Yes | Guard first statement at `platform.ts:2166`. |
| `POST /orders/:orderId/cancel` | `cancelOrder(...)` | Yes, live-capable cancel | Yes | Guard first statement at `platform.ts:2178`. |

No literal `submitOrder(...)` call exists in `platform.ts`; `submitRawOrders(...)` and the `/orders/submit` fallback `placeOrder(...)` path are inventoried above.

## Validation

- `pnpm --filter @workspace/api-server run typecheck` -> exit 0.
- `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/routes/account-positions-route.test.ts` -> blocked before tests because the existing file uses `mock.module`, which requires Node's `--experimental-test-module-mocks` flag under Node 24.
- `pnpm --filter @workspace/api-server exec node --experimental-test-module-mocks --import tsx --test --test-force-exit src/routes/account-positions-route.test.ts` -> 8 tests, 8 pass, 0 fail.
