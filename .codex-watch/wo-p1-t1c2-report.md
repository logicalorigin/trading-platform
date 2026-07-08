# WO-P1-T1c2 Report

Observed finding: `TradeOrderTicket.shadowBrokerGate.test.mjs` asserted the live-submit guard with source-text branch checks, so it did not execute the blocked live-submit path.

Change made:
- Added `resolveIbkrLiveSubmitBlock` and `submitIbkrLiveOrderAfterGate` in `TradeOrderTicket.jsx`.
- Routed the IBKR live submit path through `submitIbkrLiveOrderAfterGate` before tax preflight or live broker submission.
- Replaced the guard source-order assertion with executable unit coverage that imports the guard helper and verifies a blocked IBKR live submit does not invoke the live-submit continuation.

Verification:

```text
$ pnpm --filter @workspace/pyrus exec tsx --test src/features/trade/TradeOrderTicket.shadowBrokerGate.test.mjs
✔ shadow ticket readiness does not warn on missing gateway (1.104349ms)
✔ live ticket readiness still warns on missing gateway (0.338764ms)
✔ SnapTrade equity readiness does not require IBKR gateway (0.110197ms)
✔ SnapTrade equity readiness blocks when no execution-ready account is selected (0.624164ms)
✔ shadow preview and fill branches are not gated by broker connection (0.515719ms)
✔ blocked IBKR live submit never invokes live submit continuation (6.487069ms)
✔ ready IBKR live submit invokes live submit continuation once (0.301291ms)
✔ SnapTrade equity submit branch is before IBKR broker guards (3.513189ms)
✔ SnapTrade equity submit reconciles recent order status after success (0.155605ms)
✔ SnapTrade equity preview resolves account symbol and checks impact (0.25885ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2140.751994
```
