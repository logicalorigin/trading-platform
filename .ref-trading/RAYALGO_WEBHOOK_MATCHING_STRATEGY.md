# RayAlgo Webhook Matching Strategy

## Goal
Mirror invite-only RayAlgo alerts into our platform and measure parity against local RayAlgo generation with consistent, explainable metrics.

## Webhook Endpoint
- URL: `/api/tradingview/alerts`
- Method: `POST`
- Auth (optional): `TRADINGVIEW_WEBHOOK_SECRET` via payload `secret`, query `?secret=...`, or header `x-tv-secret`.

## Canonical Signal Payload (for parity)
Use this for parity-driving events.

```json
{
  "secret": "YOUR_SECRET",
  "scriptName": "RayAlgo Invite Only",
  "strategy": "rayalgo",
  "eventType": "signal",
  "signalId": "{{ticker}}-{{interval}}-{{time}}-{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "timeframe": "{{interval}}",
  "ts": "{{time}}",
  "action": "{{strategy.order.action}}",
  "price": "{{close}}",
  "conviction": "{{plot_0}}",
  "regime": "{{plot_1}}",
  "components": {
    "emaCross": "{{plot_2}}",
    "bosRecent": "{{plot_3}}",
    "chochRecent": "{{plot_4}}",
    "obDir": "{{plot_5}}",
    "sweepDir": "{{plot_6}}"
  },
  "message": "{{strategy.order.comment}}"
}
```

## Event Taxonomy
- `signal`: buy/sell intent for parity and shadow execution matching.
- `entry`: optional broker/position open event (logged, typically not used for signal parity).
- `exit`: optional broker/position close event (logged, skipped from pine signal parity).
- `heartbeat`/`status`/`debug`: operational telemetry (logged, skipped from parity).

## Matching Logic (implemented)
Primary matching:
- Match `pine` vs `local` by `symbol`, `timeframe`, `direction` and nearest timestamp within `windowSec`.

Core metrics:
- `precision`, `recall`, `f1`
- `medianTimingSec`

Quality metrics (matched pairs only):
- `convictionMae` and `convictionMedianAbsError`
- `regimeMatchRate`
- `componentMatchRate`
- `componentMatchByKey` (`emaCross`, `bosRecent`, `chochRecent`, `obDir`, `sweepDir`)

## Recommended Operating Profile
1. Keep parity alerts strict: only `eventType: signal` for directional decisions.
2. Send `exit` alerts separately for lifecycle audit, not parity scoring.
3. Run local signal generation on same symbol/timeframe and compare with:
   - `GET /api/rayalgo/parity?symbol=AMEX:SPY&timeframe=5&windowSec=300`
4. Start with `windowSec=300` for 5m bars, then tighten to `120` if stable.

## Debug Loop
1. Verify webhook ingestion: `GET /api/tradingview/alerts?limit=20`
2. Verify pine shadow signals: `GET /api/rayalgo/signals?source=pine&limit=50`
3. Verify local signals: `GET /api/rayalgo/signals?source=local&limit=50`
4. Compare parity report and inspect `unmatchedExamples`.

