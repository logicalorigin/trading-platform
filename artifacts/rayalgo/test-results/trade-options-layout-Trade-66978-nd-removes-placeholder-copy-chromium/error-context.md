# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: trade-options-layout.spec.ts >> Trade swaps contract chart above options chain and removes placeholder copy
- Location: e2e/trade-options-layout.spec.ts:170:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('trade-contract-chart-panel').getByText('CONTRACT')
Expected: visible
Error: strict mode violation: getByTestId('trade-contract-chart-panel').getByText('CONTRACT') resolved to 3 elements:
    1) <span data-component-name="span" data-replit-metadata="artifacts/rayalgo/src/RayAlgoPlatform.jsx:16670:8">CONTRACT</span> aka getByText('CONTRACT', { exact: true })
    2) <span data-component-name="span" data-replit-metadata="artifacts/rayalgo/src/RayAlgoPlatform.jsx:16696:8">ibkr contract bars</span> aka getByText('ibkr contract bars')
    3) <span>Option contract</span> aka getByText('Option contract')

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('trade-contract-chart-panel').getByText('CONTRACT')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - button "◉Market" [ref=e7] [cursor=pointer]
        - button "◈Flow" [ref=e8] [cursor=pointer]
        - button "◧Trade" [ref=e9] [cursor=pointer]
        - button "▣Account" [ref=e10] [cursor=pointer]
        - button "◎Research" [ref=e11] [cursor=pointer]
        - button "⬡Algo" [ref=e12] [cursor=pointer]
        - button "⏣Backtest" [ref=e13] [cursor=pointer]
      - generic [ref=e14]:
        - generic "Interactive Brokers is not configured in this workspace." [ref=e15]:
          - generic [ref=e16]:
            - generic [ref=e17]: IBKR RELAY
            - generic [ref=e18]: OFFLINE
          - generic [ref=e19]:
            - 'generic "CP: offline | role account | target -- | ping -- | heartbeat --" [ref=e20]':
              - img [ref=e21]
              - generic [ref=e25]:
                - text: CP
                - generic [ref=e26]: OFFLINE
            - 'generic "TWS: offline | role market data | target -- | ping -- | heartbeat --" [ref=e32]':
              - img [ref=e33]
              - generic [ref=e37]:
                - text: TWS
                - generic [ref=e38]: OFFLINE
          - generic [ref=e44]: PAPER | ----
        - generic "Fri Apr 24 · After hours" [ref=e45]:
          - generic [ref=e46]: MARKET CLOCK
          - generic [ref=e47]: 19:54:34 ET
          - generic [ref=e48]: AFTER HOURS · OPENS 2d 13:35:26
        - button "☼" [ref=e49] [cursor=pointer]
    - generic [ref=e50]:
      - generic [ref=e52]:
        - button "Volatility VIXY 500.00 +0.40%" [ref=e53] [cursor=pointer]:
          - generic [ref=e54]:
            - generic [ref=e55]:
              - generic [ref=e56]: Volatility
              - generic [ref=e57]: VIXY
            - generic [ref=e58]:
              - generic [ref=e59]: "500.00"
              - generic [ref=e60]: +0.40%
        - button "Treasuries IEF 500.00 +0.40%" [ref=e61] [cursor=pointer]:
          - generic [ref=e62]:
            - generic [ref=e63]:
              - generic [ref=e64]: Treasuries
              - generic [ref=e65]: IEF
            - generic [ref=e66]:
              - generic [ref=e67]: "500.00"
              - generic [ref=e68]: +0.40%
        - button "Dollar UUP 500.00 +0.40%" [ref=e69] [cursor=pointer]:
          - generic [ref=e70]:
            - generic [ref=e71]:
              - generic [ref=e72]: Dollar
              - generic [ref=e73]: UUP
            - generic [ref=e74]:
              - generic [ref=e75]: "500.00"
              - generic [ref=e76]: +0.40%
        - button "Gold GLD 500.00 +0.40%" [ref=e77] [cursor=pointer]:
          - generic [ref=e78]:
            - generic [ref=e79]:
              - generic [ref=e80]: Gold
              - generic [ref=e81]: GLD
            - generic [ref=e82]:
              - generic [ref=e83]: "500.00"
              - generic [ref=e84]: +0.40%
        - button "Crude USO 500.00 +0.40%" [ref=e85] [cursor=pointer]:
          - generic [ref=e86]:
            - generic [ref=e87]:
              - generic [ref=e88]: Crude
              - generic [ref=e89]: USO
            - generic [ref=e90]:
              - generic [ref=e91]: "500.00"
              - generic [ref=e92]: +0.40%
      - generic [ref=e93]:
        - generic "Active broker account for trading, orders, and portfolio views" [ref=e94]:
          - generic [ref=e95]: ACCOUNT
          - generic [ref=e96]: "----"
        - generic "Net Liq" [ref=e97]:
          - generic [ref=e98]: Net Liq
          - generic [ref=e99]: "----"
        - generic "Buying Power" [ref=e100]:
          - generic [ref=e101]: Buying Power
          - generic [ref=e102]: "----"
        - generic "Cash" [ref=e103]:
          - generic [ref=e104]: Cash
          - generic [ref=e105]: "----"
  - generic [ref=e106]:
    - button "☰" [ref=e109] [cursor=pointer]
    - generic [ref=e112]:
      - generic [ref=e113]:
        - generic [ref=e114] [cursor=pointer]:
          - generic [ref=e115]: SPY
          - generic [ref=e116]: +0.40%
          - button "×" [ref=e117]
        - generic [ref=e118] [cursor=pointer]:
          - generic [ref=e119]: QQQ
          - generic [ref=e120]: +0.40%
          - button "×" [ref=e121]
        - generic [ref=e122] [cursor=pointer]:
          - generic [ref=e123]: NVDA
          - generic [ref=e124]: +0.40%
          - button "×" [ref=e125]
        - button "+" [ref=e126] [cursor=pointer]
      - generic [ref=e127]:
        - generic [ref=e128]:
          - generic [ref=e129]:
            - generic [ref=e130]: SPY
            - generic [ref=e131]: S&P 500
          - generic [ref=e132]:
            - generic [ref=e133]: "500.00"
            - generic [ref=e134]: ▲ +2.00
            - generic [ref=e135]: (+0.40%)
          - generic [ref=e136]:
            - generic [ref=e137]: VOL 50.0M
            - generic [ref=e138]: IV ----
            - generic [ref=e139]: IMP ±$13.60 (2.72%)
            - generic [ref=e140]: ATM 500
            - generic [ref=e141]: CHAIN live
        - generic [ref=e142]:
          - generic [ref=e145]:
            - generic [ref=e146]:
              - generic:
                - generic [ref=e147]:
                  - button "SPY" [ref=e148] [cursor=pointer]:
                    - img [ref=e149]
                    - generic [ref=e152]: SPY
                    - img [ref=e153]
                  - button "1m" [ref=e156] [cursor=pointer]
                  - button "5m" [ref=e157] [cursor=pointer]
                  - button "15m" [ref=e158] [cursor=pointer]
                  - button "1h" [ref=e159] [cursor=pointer]
                  - button "1D" [ref=e160] [cursor=pointer]
                  - button "5m" [ref=e161] [cursor=pointer]:
                    - generic [ref=e162]: 5m
                    - img [ref=e163]
                  - button "Candles" [ref=e165] [cursor=pointer]:
                    - img [ref=e166]
                    - generic [ref=e170]: Candles
                    - img [ref=e171]
                  - button "Indicators 3" [ref=e173] [cursor=pointer]:
                    - img [ref=e174]
                    - generic [ref=e175]: Indicators 3
                    - img [ref=e176]
                  - button "Undo" [disabled] [ref=e178]:
                    - img [ref=e179]
                  - button "Redo" [disabled] [ref=e182]:
                    - img [ref=e183]
                  - button "Screenshot" [ref=e187] [cursor=pointer]:
                    - img [ref=e188]
                  - button "Settings" [ref=e191] [cursor=pointer]:
                    - img [ref=e192]
                  - button "Enter fullscreen" [ref=e195] [cursor=pointer]:
                    - img [ref=e196]
                  - button "RayReplica" [ref=e201] [cursor=pointer]
                - generic:
                  - generic:
                    - generic:
                      - generic: SPY
                      - generic: Equity chart
                      - generic: 5m
                      - generic: IBKR 5m
                    - generic:
                      - generic: "503.77"
                      - generic: "-0.07%"
                    - generic:
                      - generic: Bar 5m
                      - text: O
                      - generic: "503.48"
                      - text: H
                      - generic: "504.77"
                      - text: L
                      - generic: "502.48"
                      - text: C
                      - generic: "503.77"
                      - text: V
                      - generic: 358.00K
                    - generic: Apr 24, 19:50 REST ROLL
                  - generic:
                    - generic: RayReplica
                    - generic: EMA21
                    - generic: EMA55
            - generic [ref=e203]:
              - button "Crosshair / pan" [pressed] [ref=e205] [cursor=pointer]:
                - img [ref=e206]
              - generic [ref=e208]:
                - button "Horizontal line" [ref=e210] [cursor=pointer]:
                  - img [ref=e211]
                - button "Vertical line" [ref=e212] [cursor=pointer]:
                  - img [ref=e213]
                - button "Rectangle" [ref=e216] [cursor=pointer]:
                  - img [ref=e217]
              - generic [ref=e219]:
                - button "Magnet crosshair" [ref=e221] [cursor=pointer]:
                  - img [ref=e222]
                - button "Fit content" [ref=e226] [cursor=pointer]:
                  - img [ref=e227]
              - button "No drawings to remove" [disabled] [ref=e233]:
                - img [ref=e234]
            - table [ref=e239]:
              - row [ref=e240]:
                - cell
                - cell [ref=e241]
                - cell [ref=e245]
              - row [ref=e249]:
                - cell
                - cell [ref=e250]
                - cell [ref=e254]
            - generic:
              - generic:
                - generic: CHOCH
              - generic:
                - generic: Trend Reversal
              - generic:
                - generic: BULL OB +++ 310K
              - generic:
                - generic: O 499.2
              - generic:
                - generic: SL
              - generic:
                - generic: TP 1
              - generic:
                - generic: LL
              - generic:
                - generic: LH
              - generic:
                - generic: HL
              - generic:
                - generic: BUY
              - generic:
                - generic: HH
              - generic:
                - generic: RAYALGO DASHBOARD
                - generic:
                  - generic: 5m TREND
                  - generic: BULLISH
                  - generic:
                    - generic: STRENGTH
                    - generic: Strong
                  - generic:
                    - generic: TREND AGE
                    - generic: NEW (11)
                  - generic:
                    - generic: VOLATILITY
                    - generic: 0/10
                  - generic:
                    - generic: SESSION
                    - generic: Sydney
                - generic:
                  - generic:
                    - generic: H1
                    - generic: BULL
                  - generic:
                    - generic: H4
                    - generic: BULL
                  - generic:
                    - generic: D1
                    - generic: BULL
            - generic [ref=e257]:
              - generic:
                - generic [ref=e258]:
                  - generic [ref=e259]: RayReplica · EMA21 · EMA55
                  - generic [ref=e260]: "Zoom: scroll"
                  - generic [ref=e261]: Ln / L / % / 100 = price mode · A = auto-scale
                  - generic [ref=e262]: IBKR 5m C 0 P 0 UOA amber
                - generic [ref=e263]:
                  - button "Lin" [ref=e264] [cursor=pointer]
                  - button "L" [ref=e265] [cursor=pointer]
                  - button "%" [ref=e266] [cursor=pointer]
                  - button "100" [ref=e267] [cursor=pointer]
                  - button "A" [ref=e269] [cursor=pointer]
                  - button "Invert scale" [ref=e270] [cursor=pointer]:
                    - img [ref=e271]
          - generic [ref=e274]:
            - generic [ref=e275]:
              - generic [ref=e276]: CONTRACT
              - generic [ref=e277]: 500C
              - generic [ref=e278]: 05/01
              - generic [ref=e279]: ibkr contract bars
              - generic [ref=e280]: $8.00
            - generic [ref=e284]:
              - generic [ref=e285]:
                - generic:
                  - generic [ref=e286]:
                    - button "SPY 500C 05/01" [ref=e287] [cursor=pointer]:
                      - img [ref=e288]
                      - generic [ref=e291]: SPY 500C 05/01
                      - img [ref=e292]
                    - button "1m" [ref=e295] [cursor=pointer]
                    - button "5m" [ref=e296] [cursor=pointer]
                    - button "15m" [ref=e297] [cursor=pointer]
                    - button "1h" [ref=e298] [cursor=pointer]
                    - button "1D" [ref=e299] [cursor=pointer]
                    - button "5m" [ref=e300] [cursor=pointer]:
                      - generic [ref=e301]: 5m
                      - img [ref=e302]
                    - button "Candles" [ref=e304] [cursor=pointer]:
                      - img [ref=e305]
                      - generic [ref=e309]: Candles
                      - img [ref=e310]
                    - button "Indicators 1" [ref=e312] [cursor=pointer]:
                      - img [ref=e313]
                      - generic [ref=e314]: Indicators 1
                      - img [ref=e315]
                    - button "Screenshot" [ref=e318] [cursor=pointer]:
                      - img [ref=e319]
                    - button "Settings" [ref=e322] [cursor=pointer]:
                      - img [ref=e323]
                    - button "Enter fullscreen" [ref=e326] [cursor=pointer]:
                      - img [ref=e327]
                    - button "RayReplica" [ref=e333] [cursor=pointer]
                  - generic:
                    - generic:
                      - generic:
                        - generic: SPY 500C 05/01
                        - generic: Option contract
                        - generic: 5m
                        - generic: REST ROLL
                      - generic:
                        - generic: "503.77"
                        - generic: "-0.07%"
                      - generic:
                        - generic: Bar 5m
                        - text: O
                        - generic: "503.48"
                        - text: H
                        - generic: "504.77"
                        - text: L
                        - generic: "502.48"
                        - text: C
                        - generic: "503.77"
                        - text: V
                        - generic: 358.00K
                      - generic: Apr 24, 19:50 REST ROLL
                    - generic:
                      - generic: RayReplica
              - table [ref=e336]:
                - row [ref=e337]:
                  - cell
                  - cell [ref=e338]
                  - cell [ref=e342]
                - row [ref=e346]:
                  - cell
                  - cell [ref=e347]
                  - cell [ref=e351]
              - generic:
                - generic:
                  - generic: CHOCH
                - generic:
                  - generic: Trend Reversal
                - generic:
                  - generic: BULL OB +++ 310K
                - generic:
                  - generic: O 499.2
                - generic:
                  - generic: SL
                - generic:
                  - generic: TP 1
                - generic:
                  - generic: LL
                - generic:
                  - generic: LH
                - generic:
                  - generic: HL
                - generic:
                  - generic: BUY
                - generic:
                  - generic: HH
                - generic:
                  - generic: RAYALGO DASHBOARD
                  - generic:
                    - generic: 5m TREND
                    - generic: BULLISH
                    - generic:
                      - generic: STRENGTH
                      - generic: Strong
                    - generic:
                      - generic: TREND AGE
                      - generic: NEW (11)
                    - generic:
                      - generic: VOLATILITY
                      - generic: 0/10
                    - generic:
                      - generic: SESSION
                      - generic: Sydney
                  - generic:
                    - generic:
                      - generic: H1
                      - generic: BULL
                    - generic:
                      - generic: H4
                      - generic: BULL
                    - generic:
                      - generic: D1
                      - generic: BULL
              - generic [ref=e354]:
                - generic:
                  - generic [ref=e355]:
                    - generic [ref=e356]: RayReplica
                    - generic [ref=e357]: "Zoom: scroll"
                    - generic [ref=e358]: Ln / L / % / 100 = price mode · A = auto-scale
                    - generic [ref=e359]: REST ROLL
                  - generic [ref=e360]:
                    - button "Lin" [ref=e361] [cursor=pointer]
                    - button "L" [ref=e362] [cursor=pointer]
                    - button "%" [ref=e363] [cursor=pointer]
                    - button "100" [ref=e364] [cursor=pointer]
                    - button "A" [ref=e366] [cursor=pointer]
                    - button "Invert scale" [ref=e367] [cursor=pointer]:
                      - img [ref=e368]
        - generic [ref=e371]:
          - generic [ref=e372]:
            - generic [ref=e373]:
              - generic [ref=e374]: OPTIONS CHAIN
              - combobox [ref=e375] [cursor=pointer]:
                - option "05/01 / 7d" [selected]
                - option "05/08 / 14d"
                - option "05/15 / 21d"
              - generic [ref=e376] [cursor=pointer]:
                - checkbox "Heatmap" [ref=e377]
                - text: Heatmap
              - generic [ref=e378]: IMP +/-$13.60 (2.72%)
              - generic [ref=e379]: ATM 500
              - generic [ref=e380]: live
            - generic [ref=e382]:
              - generic [ref=e384]:
                - generic [ref=e385]:
                  - generic "Call Bid" [ref=e386]
                  - generic "Call Ask" [ref=e387]
                  - generic "Call Last" [ref=e388]
                  - generic "Call Volume" [ref=e389]
                  - generic "Call Open Interest" [ref=e390]
                  - generic "Call IV" [ref=e391]
                  - generic "Call Delta" [ref=e392]
                  - generic "Call Gamma" [ref=e393]
                  - generic "Call Theta" [ref=e394]
                  - generic "Call Vega" [ref=e395]
                - generic [ref=e396] [cursor=pointer]:
                  - generic [ref=e397]: "3.95"
                  - generic [ref=e398]: "4.05"
                  - generic [ref=e399]: "4.00"
                  - generic [ref=e400]: "590"
                  - generic [ref=e401]: 1.5K
                  - generic [ref=e402]: 22.0%
                  - generic [ref=e403]: "0.48"
                  - generic [ref=e404]: "0.020"
                  - generic [ref=e405]: "-0.030"
                  - generic [ref=e406]: "0.110"
                - generic [ref=e407] [cursor=pointer]:
                  - generic [ref=e408]: "5.95"
                  - generic [ref=e409]: "6.05"
                  - generic [ref=e410]: "6.00"
                  - generic [ref=e411]: "595"
                  - generic [ref=e412]: 1.5K
                  - generic [ref=e413]: 22.0%
                  - generic [ref=e414]: "0.48"
                  - generic [ref=e415]: "0.020"
                  - generic [ref=e416]: "-0.030"
                  - generic [ref=e417]: "0.110"
                - generic [ref=e418] [cursor=pointer]:
                  - generic [ref=e419]: "7.95"
                  - generic [ref=e420]: "8.05"
                  - generic [ref=e421]: "8.00"
                  - generic [ref=e422]: "600"
                  - generic [ref=e423]: 1.5K
                  - generic [ref=e424]: 22.0%
                  - generic [ref=e425]: "0.48"
                  - generic [ref=e426]: "0.020"
                  - generic [ref=e427]: "-0.030"
                  - generic [ref=e428]: "0.110"
                - generic [ref=e429] [cursor=pointer]:
                  - generic [ref=e430]: "5.95"
                  - generic [ref=e431]: "6.05"
                  - generic [ref=e432]: "6.00"
                  - generic [ref=e433]: "605"
                  - generic [ref=e434]: 1.5K
                  - generic [ref=e435]: 22.0%
                  - generic [ref=e436]: "0.48"
                  - generic [ref=e437]: "0.020"
                  - generic [ref=e438]: "-0.030"
                  - generic [ref=e439]: "0.110"
                - generic [ref=e440] [cursor=pointer]:
                  - generic [ref=e441]: "3.95"
                  - generic [ref=e442]: "4.05"
                  - generic [ref=e443]: "4.00"
                  - generic [ref=e444]: "610"
                  - generic [ref=e445]: 1.5K
                  - generic [ref=e446]: 22.0%
                  - generic [ref=e447]: "0.48"
                  - generic [ref=e448]: "0.020"
                  - generic [ref=e449]: "-0.030"
                  - generic [ref=e450]: "0.110"
              - generic [ref=e451]:
                - generic [ref=e452]: Strike
                - generic [ref=e453]: "490"
                - generic [ref=e454]: "495"
                - generic [ref=e455]: "500"
                - generic [ref=e456]: "505"
                - generic [ref=e457]: "510"
              - generic [ref=e459]:
                - generic [ref=e460]:
                  - generic "Put Bid" [ref=e461]
                  - generic "Put Ask" [ref=e462]
                  - generic "Put Last" [ref=e463]
                  - generic "Put Volume" [ref=e464]
                  - generic "Put Open Interest" [ref=e465]
                  - generic "Put IV" [ref=e466]
                  - generic "Put Delta" [ref=e467]
                  - generic "Put Gamma" [ref=e468]
                  - generic "Put Theta" [ref=e469]
                  - generic "Put Vega" [ref=e470]
                - generic [ref=e471] [cursor=pointer]:
                  - generic [ref=e472]: "3.95"
                  - generic [ref=e473]: "4.05"
                  - generic [ref=e474]: "4.00"
                  - generic [ref=e475]: "590"
                  - generic [ref=e476]: 1.5K
                  - generic [ref=e477]: 22.0%
                  - generic [ref=e478]: "-0.48"
                  - generic [ref=e479]: "0.020"
                  - generic [ref=e480]: "-0.030"
                  - generic [ref=e481]: "0.110"
                - generic [ref=e482] [cursor=pointer]:
                  - generic [ref=e483]: "5.95"
                  - generic [ref=e484]: "6.05"
                  - generic [ref=e485]: "6.00"
                  - generic [ref=e486]: "595"
                  - generic [ref=e487]: 1.5K
                  - generic [ref=e488]: 22.0%
                  - generic [ref=e489]: "-0.48"
                  - generic [ref=e490]: "0.020"
                  - generic [ref=e491]: "-0.030"
                  - generic [ref=e492]: "0.110"
                - generic [ref=e493] [cursor=pointer]:
                  - generic [ref=e494]: "7.95"
                  - generic [ref=e495]: "8.05"
                  - generic [ref=e496]: "8.00"
                  - generic [ref=e497]: "600"
                  - generic [ref=e498]: 1.5K
                  - generic [ref=e499]: 22.0%
                  - generic [ref=e500]: "-0.48"
                  - generic [ref=e501]: "0.020"
                  - generic [ref=e502]: "-0.030"
                  - generic [ref=e503]: "0.110"
                - generic [ref=e504] [cursor=pointer]:
                  - generic [ref=e505]: "5.95"
                  - generic [ref=e506]: "6.05"
                  - generic [ref=e507]: "6.00"
                  - generic [ref=e508]: "605"
                  - generic [ref=e509]: 1.5K
                  - generic [ref=e510]: 22.0%
                  - generic [ref=e511]: "-0.48"
                  - generic [ref=e512]: "0.020"
                  - generic [ref=e513]: "-0.030"
                  - generic [ref=e514]: "0.110"
                - generic [ref=e515] [cursor=pointer]:
                  - generic [ref=e516]: "3.95"
                  - generic [ref=e517]: "4.05"
                  - generic [ref=e518]: "4.00"
                  - generic [ref=e519]: "610"
                  - generic [ref=e520]: 1.5K
                  - generic [ref=e521]: 22.0%
                  - generic [ref=e522]: "-0.48"
                  - generic [ref=e523]: "0.020"
                  - generic [ref=e524]: "-0.030"
                  - generic [ref=e525]: "0.110"
          - generic [ref=e526]:
            - generic [ref=e527]:
              - generic [ref=e528]: SPOT FLOW
              - generic [ref=e529]: SPY · no live data
            - generic [ref=e531]:
              - generic [ref=e532]: No live spot flow
              - generic [ref=e533]: This panel only renders API-backed buy and sell flow for SPY.
          - generic [ref=e534]:
            - generic [ref=e535]:
              - generic [ref=e536]: OPTIONS ORDER FLOW
              - generic [ref=e537]: SPY · no live data
            - generic [ref=e539]:
              - generic [ref=e540]: No live options flow
              - generic [ref=e541]: Strike heatmaps and DTE buckets are hidden until live options prints are returned for SPY.
        - generic [ref=e542]:
          - generic [ref=e543]:
            - generic [ref=e544]: ORDER TICKET
            - generic [ref=e545]:
              - generic [ref=e546]: IBKR REQUIRED
              - generic [ref=e547]: "----"
            - generic [ref=e548]:
              - generic [ref=e549]: SPY
              - generic [ref=e550]: 500C
              - generic [ref=e551]: 05/01 · 0d
            - generic [ref=e552]:
              - generic [ref=e553]:
                - generic [ref=e554]: BID
                - generic [ref=e555]: $7.95
              - generic [ref=e556]:
                - generic [ref=e557]: MID
                - generic [ref=e558]: $8.00
                - generic [ref=e559]: 0.10 (1.3%)
              - generic [ref=e560]:
                - generic [ref=e561]: ASK
                - generic [ref=e562]: $8.05
            - generic [ref=e563]:
              - generic [ref=e564]:
                - button "BUY" [ref=e565] [cursor=pointer]
                - button "SELL" [ref=e566] [cursor=pointer]
              - generic [ref=e567]:
                - button "LMT" [ref=e568] [cursor=pointer]
                - button "MKT" [ref=e569] [cursor=pointer]
                - button "STP" [ref=e570] [cursor=pointer]
            - generic [ref=e571]:
              - generic [ref=e572]:
                - button "1" [ref=e573] [cursor=pointer]
                - button "3" [ref=e574] [cursor=pointer]
                - button "5" [ref=e575] [cursor=pointer]
                - button "10" [ref=e576] [cursor=pointer]
              - generic [ref=e577]:
                - generic [ref=e578]: QTY
                - spinbutton [ref=e579]: "3"
              - generic [ref=e580]:
                - generic [ref=e581]: LIMIT
                - spinbutton [ref=e582]: "8"
            - generic [ref=e583]:
              - generic [ref=e584]:
                - generic [ref=e585]:
                  - generic [ref=e586]: STOP LOSS
                  - generic [ref=e587]: "-35%"
                - spinbutton [ref=e588]: "5.2"
              - generic [ref=e589]:
                - generic [ref=e590]:
                  - generic [ref=e591]: TAKE PROFIT
                  - generic [ref=e592]: +75%
                - spinbutton [ref=e593]: "14"
            - generic [ref=e594]:
              - button "DAY" [ref=e595] [cursor=pointer]
              - button "GTC" [ref=e596] [cursor=pointer]
              - button "IOC" [ref=e597] [cursor=pointer]
              - button "FOK" [ref=e598] [cursor=pointer]
            - generic [ref=e599]:
              - generic [ref=e600]:
                - generic [ref=e601]: P&L AT EXPIRATION
                - generic [ref=e602]:
                  - generic [ref=e603]: ━ now $500.00
                  - generic [ref=e604]: ┃ strike $500
              - img [ref=e605]:
                - generic [ref=e608]: BE $508.00
                - generic [ref=e611]: Max +∞
                - generic [ref=e612]: Max $-2400
                - generic [ref=e613]: $375
                - generic [ref=e614]: $625
            - generic [ref=e615]:
              - generic [ref=e616]:
                - text: BE
                - generic [ref=e617]: $508.00
                - text: (+1.6%)
              - generic [ref=e618]:
                - text: Risk
                - generic [ref=e619]: $2400
              - generic [ref=e620]: POP 73%
            - generic [ref=e621]:
              - button "SIM PREVIEW" [ref=e622] [cursor=pointer]
              - button "BUY 3 × $8.00 · −$2400" [ref=e623] [cursor=pointer]
          - generic [ref=e624]:
            - generic [ref=e625]:
              - generic [ref=e626]: STRATEGY
              - generic [ref=e627]:
                - button "Call ATM Bullish, ~50Δ" [ref=e628] [cursor=pointer]:
                  - generic [ref=e629]: Call ATM
                  - generic [ref=e630]: Bullish, ~50Δ
                - button "Put ATM Bearish, ~50Δ" [ref=e631] [cursor=pointer]:
                  - generic [ref=e632]: Put ATM
                  - generic [ref=e633]: Bearish, ~50Δ
                - button "Call OTM Aggressive, 30Δ" [ref=e634] [cursor=pointer]:
                  - generic [ref=e635]: Call OTM
                  - generic [ref=e636]: Aggressive, 30Δ
                - button "0DTE Lotto High R/R · Δ20" [ref=e637] [cursor=pointer]:
                  - generic [ref=e638]: 0DTE Lotto
                  - generic [ref=e639]: High R/R · Δ20
                - button "ITM Call Conservative, 70Δ" [ref=e640] [cursor=pointer]:
                  - generic [ref=e641]: ITM Call
                  - generic [ref=e642]: Conservative, 70Δ
                - button "Put OTM Hedge, 25Δ" [ref=e643] [cursor=pointer]:
                  - generic [ref=e644]: Put OTM
                  - generic [ref=e645]: Hedge, 25Δ
            - generic [ref=e646]:
              - generic [ref=e647]:
                - generic [ref=e648]: GREEKS
                - generic [ref=e649]: PER CONTRACT
              - generic [ref=e650]:
                - generic [ref=e651]: Δ
                - generic [ref=e655]: "0.480"
                - generic [ref=e656]: Moderate
              - generic [ref=e657]:
                - generic [ref=e658]: Γ
                - generic [ref=e662]: "0.020"
                - generic [ref=e663]: Moderate γ
              - generic [ref=e664]:
                - generic [ref=e665]: Θ
                - generic [ref=e669]: "-0.030"
                - generic [ref=e670]: $3/day
              - generic [ref=e671]:
                - generic [ref=e672]: V
                - generic [ref=e676]: "0.110"
                - generic [ref=e677]: $11/1% IV
            - generic [ref=e678]:
              - generic [ref=e679]: POSITION × 3
              - generic [ref=e680]:
                - generic [ref=e681]: Δ 1.44
                - generic [ref=e682]: Γ 0.06
                - generic [ref=e683]: Θ -0.09
                - generic [ref=e684]: V 0.33
          - generic [ref=e685]:
            - generic [ref=e686]:
              - generic [ref=e687]:
                - button "BOOK" [ref=e688] [cursor=pointer]
                - button "FLOW" [ref=e689] [cursor=pointer]
                - button "TAPE" [ref=e690] [cursor=pointer]
              - generic [ref=e691]:
                - generic [ref=e692]: broker off
                - generic [ref=e693]: 500C
                - generic [ref=e694]: $0.10 sprd
            - generic [ref=e696]:
              - generic [ref=e697]: IBKR book unavailable
              - generic [ref=e698]: Depth-of-book is only available when the broker bridge is configured.
          - generic [ref=e699]:
            - generic [ref=e700]:
              - generic [ref=e701]:
                - button "OPEN 0" [ref=e702] [cursor=pointer]
                - button "HIST 0" [ref=e703] [cursor=pointer]
                - button "ORDERS 0" [ref=e704] [cursor=pointer]
              - generic [ref=e705]: "----"
            - generic [ref=e707]: No open positions
            - generic [ref=e708]:
              - button "Close All" [ref=e709] [cursor=pointer]
              - button "Set Stops" [ref=e710] [cursor=pointer]
              - button "Roll" [ref=e711] [cursor=pointer]
  - generic [ref=e712]:
    - generic [ref=e715]: PAPER
    - generic [ref=e716]: WL DEFAULT
    - generic [ref=e717]: SYM SPY
    - generic [ref=e718]: DELAYED ----
    - generic [ref=e719]: HIST ----
    - generic [ref=e720]: RSCH ----
    - generic [ref=e721]: CP OFFLINE --
    - generic [ref=e722]: TWS OFFLINE --
    - generic [ref=e723]: v0.1.0
  - button "STANDBY Bloomberg" [ref=e725] [cursor=pointer]:
    - img [ref=e726]
    - generic [ref=e729]: STANDBY
    - generic [ref=e730]: Bloomberg
```

# Test source

```ts
  90  |         quotes: requested.map((symbol) => ({
  91  |           symbol,
  92  |           price: basePrice,
  93  |           prevClose: basePrice - 2,
  94  |           change: 2,
  95  |           changePercent: 0.4,
  96  |           open: basePrice - 1,
  97  |           high: basePrice + 3,
  98  |           low: basePrice - 4,
  99  |           volume: 50_000_000,
  100 |           delayed: false,
  101 |         })),
  102 |       };
  103 |     } else if (url.pathname === "/api/options/expirations") {
  104 |       body = {
  105 |         underlying: "SPY",
  106 |         expirations: expirations.map((expirationDate) => ({ expirationDate })),
  107 |       };
  108 |     } else if (url.pathname === "/api/options/chains") {
  109 |       if (delayChainMs > 0) {
  110 |         await page.waitForTimeout(delayChainMs);
  111 |       }
  112 |       const expirationDate = url.searchParams.get("expirationDate") || expirations[0];
  113 |       body = {
  114 |         underlying: "SPY",
  115 |         expirationDate,
  116 |         contracts: makeOptionContracts(expirationDate),
  117 |       };
  118 |     } else if (url.pathname === "/api/bars") {
  119 |       body = { bars: makeBars(url.searchParams.get("symbol") || "SPY") };
  120 |     } else if (url.pathname === "/api/flow/events") {
  121 |       body = { events: [] };
  122 |     } else if (url.pathname === "/api/news") {
  123 |       body = { articles: [] };
  124 |     } else if (url.pathname === "/api/research/earnings-calendar") {
  125 |       body = { entries: [] };
  126 |     } else if (url.pathname === "/api/signal-monitor/profile") {
  127 |       body = { profile: { enabled: false, timeframe: "15m", watchlistId: null } };
  128 |     } else if (url.pathname === "/api/signal-monitor/state") {
  129 |       body = { states: [] };
  130 |     } else if (url.pathname === "/api/signal-monitor/events") {
  131 |       body = { events: [] };
  132 |     } else if (url.pathname === "/api/charting/pine-scripts") {
  133 |       body = { scripts: [] };
  134 |     } else if (url.pathname.includes("/streams/")) {
  135 |       await route.fulfill({ status: 204, body: "" });
  136 |       return;
  137 |     }
  138 | 
  139 |     await route.fulfill({
  140 |       status: 200,
  141 |       contentType: "application/json",
  142 |       body: JSON.stringify(body),
  143 |     });
  144 |   });
  145 | }
  146 | 
  147 | async function openTrade(page: Page) {
  148 |   await page.addInitScript(() => {
  149 |     window.localStorage.clear();
  150 |     window.sessionStorage.clear();
  151 |     window.localStorage.setItem(
  152 |       "rayalgo:state:v1",
  153 |       JSON.stringify({
  154 |         screen: "trade",
  155 |         sym: "SPY",
  156 |         theme: "dark",
  157 |         sidebarCollapsed: true,
  158 |         tradeActiveTicker: "SPY",
  159 |         tradeContracts: {
  160 |           SPY: { strike: 500, cp: "C", exp: "" },
  161 |         },
  162 |       }),
  163 |     );
  164 |   });
  165 |   await page.goto("/", { waitUntil: "domcontentloaded" });
  166 |   await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });
  167 |   await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  168 | }
  169 | 
  170 | test("Trade swaps contract chart above options chain and removes placeholder copy", async ({ page }) => {
  171 |   await page.setViewportSize({ width: 1440, height: 1000 });
  172 |   await mockTradeApi(page);
  173 |   await openTrade(page);
  174 | 
  175 |   const topBox = await page.getByTestId("trade-top-zone").boundingBox();
  176 |   const middleBox = await page.getByTestId("trade-middle-zone").boundingBox();
  177 |   const contractBox = await page.getByTestId("trade-contract-chart-panel").boundingBox();
  178 |   const chainBox = await page.getByTestId("trade-options-chain-panel").boundingBox();
  179 | 
  180 |   expect(topBox).not.toBeNull();
  181 |   expect(middleBox).not.toBeNull();
  182 |   expect(contractBox).not.toBeNull();
  183 |   expect(chainBox).not.toBeNull();
  184 |   expect(contractBox!.y).toBeGreaterThanOrEqual(topBox!.y - 1);
  185 |   expect(contractBox!.y + contractBox!.height).toBeLessThanOrEqual(topBox!.y + topBox!.height + 1);
  186 |   expect(chainBox!.y).toBeGreaterThanOrEqual(middleBox!.y - 1);
  187 |   expect(chainBox!.y + chainBox!.height).toBeLessThanOrEqual(middleBox!.y + middleBox!.height + 1);
  188 | 
  189 |   await expect(page.getByTestId("trade-options-chain-panel").getByText("OPTIONS CHAIN")).toBeVisible();
> 190 |   await expect(page.getByTestId("trade-contract-chart-panel").getByText("CONTRACT")).toBeVisible();
      |                                                                                      ^ Error: expect(locator).toBeVisible() failed
  191 | 
  192 |   const bodyText = await page.locator("body").innerText();
  193 |   expect(bodyText).not.toMatch(/spaceholder|schema-pending|placeholder panel|under construction|Coming Soon/i);
  194 | });
  195 | 
  196 | test("Trade option chain loading state shows a spinner while chain request is pending", async ({
  197 |   page,
  198 | }) => {
  199 |   await page.setViewportSize({ width: 1440, height: 1000 });
  200 |   await mockTradeApi(page, { delayChainMs: 1500 });
  201 |   await openTrade(page);
  202 | 
  203 |   await expect(
  204 |     page.getByTestId("trade-options-chain-panel").getByTestId("loading-spinner"),
  205 |   ).toBeVisible({ timeout: 10_000 });
  206 | });
  207 | 
```