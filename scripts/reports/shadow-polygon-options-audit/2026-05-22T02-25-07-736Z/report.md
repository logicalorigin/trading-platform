# Shadow Polygon Options Audit

- Generated: 2026-05-22T02:25:07.736Z
- Account: shadow
- Provider: massive (https://api.massive.com)
- Report directory: /home/runner/workspace/scripts/reports/shadow-polygon-options-audit/2026-05-22T02-25-07-736Z

## Ledger Summary

- Option fills: 823
- Option orders: 823
- Distinct fill order IDs: 823
- Orders without fills: 0
- Buy fills: 414
- Sell fills: 409
- Symbols: 65
- Option tickers: 379
- Fill window: 2026-04-01T13:30:00.000Z to 2026-04-30T15:05:00.000Z
- Realized P&L: 92871.05
- Fees: 1878.00
- Cash delta: 85689.00

## External Accuracy Summary

- Audited fills: 823
- Exact matches: 732
- Unresolved strict mismatches: 80
- Provider errors: 0

### By Source

| Bucket | Total | Matched | Nearby close only | Unresolved | Provider errors |
| --- | ---: | ---: | ---: | ---: | ---: |
polygon-option-aggregates | 220 | 129 | 11 | 80 | 0
polygon-option-trade | 603 | 603 | 0 | 0 | 0

### By Side And Source

| Bucket | Total | Matched | Nearby close only | Unresolved | Provider errors |
| --- | ---: | ---: | ---: | ---: | ---: |
buy:polygon-option-aggregates | 129 | 129 | 0 | 0 | 0
buy:polygon-option-trade | 285 | 285 | 0 | 0 | 0
sell:polygon-option-aggregates | 91 | 0 | 11 | 80 | 0
sell:polygon-option-trade | 318 | 318 | 0 | 0 | 0

## Position Summary

| Status | Positions | Net quantity | Realized P&L | Fees |
| --- | ---: | ---: | ---: | ---: |
closed | 374 | 0 | 92843.76 | 1858.48
open | 5 | 15 | 27.29 | 19.52

## Balance Snapshots

| Source | Snapshots | Min NAV | Max NAV | First | Last |
| --- | ---: | ---: | ---: | --- | --- |
automation | 823 | 24989.23 | 118142.00 | 2026-04-01T13:30:00.000Z | 2026-04-30T15:05:00.000Z
automation_mark | 13441 | 24680.51 | 118199.35 | 2026-04-01T13:31:00.000Z | 2026-04-30T15:05:00.000Z

## Unresolved Strict Samples

| Status | Symbol | Ticker | Side | Fill At | Fill Price | Reason |
| --- | --- | --- | --- | --- | ---: | --- |
no_provider_bars_near_fill | CLSK | O:CLSK260402C00008000 | sell | 2026-04-01T16:10:00.000Z | 0.84 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | TLT | O:TLT260406C00083000 | sell | 2026-04-01T17:25:00.000Z | 3.45 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | GLD | O:GLD260406C00434000 | sell | 2026-04-01T17:55:00.000Z | 9.35 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_exact_bar | MSFT | O:MSFT260406C00370000 | sell | 2026-04-01T17:55:00.000Z | 5.01 | provider returned nearby bars but no bar at the fill minute
no_provider_bars_near_fill | DELL | O:DELL260410C00175000 | sell | 2026-04-06T17:05:00.000Z | 3.45 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | DIA | O:DIA260410C00463000 | sell | 2026-04-06T17:05:00.000Z | 6.6 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | HUT | O:HUT260410C00049000 | sell | 2026-04-06T17:05:00.000Z | 2.48 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_exact_bar | META | O:META260410C00575000 | sell | 2026-04-06T18:00:00.000Z | 10.3 | provider returned nearby bars but no bar at the fill minute
no_provider_bars_near_fill | SQQQ | O:SQQQ260410C00075000 | sell | 2026-04-06T18:15:00.000Z | 3.3 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | TLT | O:TLT260410C00088000 | sell | 2026-04-06T19:55:00.000Z | 0.09 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | TSM | O:TSM260410C00335000 | sell | 2026-04-07T13:55:00.000Z | 9.4 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | SMCI | O:SMCI260410C00021000 | sell | 2026-04-07T15:00:00.000Z | 1.38 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | DIA | O:DIA260410C00460000 | sell | 2026-04-08T14:25:00.000Z | 19.35 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | CRWV | O:CRWV260410C00088000 | sell | 2026-04-08T18:10:00.000Z | 3.67 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | IONQ | O:IONQ260410C00029000 | sell | 2026-04-08T18:15:00.000Z | 1.16 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | APLD | O:APLD260410C00026000 | sell | 2026-04-08T18:35:00.000Z | 2.99 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | VRT | O:VRT260410C00270000 | sell | 2026-04-08T18:50:00.000Z | 12.4 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | ARM | O:ARM260410C00148000 | sell | 2026-04-09T14:20:00.000Z | 2.08 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | ACHR | O:ACHR260410C00004000 | sell | 2026-04-09T17:30:00.000Z | 1.53 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_exact_bar | TLT | O:TLT260413C00083000 | sell | 2026-04-09T17:45:00.000Z | 3.6 | provider returned nearby bars but no bar at the fill minute
no_provider_bars_near_fill | GOOGL | O:GOOGL260413C00315000 | sell | 2026-04-09T18:20:00.000Z | 5.4 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | TLT | O:TLT260413C00087000 | sell | 2026-04-10T15:40:00.000Z | 0.08 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | RTX | O:RTX260417C00205000 | sell | 2026-04-10T18:00:00.000Z | 2.04 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_provider_bars_near_fill | SQQQ | O:SQQQ260417C00066000 | sell | 2026-04-10T19:05:00.000Z | 3.02 | provider returned no 1-minute aggregate bars within +/-2 minutes
no_exact_bar | AVGO | O:AVGO260413C00365000 | sell | 2026-04-10T19:35:00.000Z | 11 | provider returned nearby bars but no bar at the fill minute

Full row-level details are in `results.csv` and `results.json`.
