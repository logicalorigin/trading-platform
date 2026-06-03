# Market Rendering QA

The Market page has a deterministic render QA mode for layout and chart-shell checks.
Use it when validating Market panel changes, chart-grid sizing, or viewport regressions.

## Entry Points

- Safe shell: `/?pyrusQa=safe&pyrusMarketQa=render&pyrusMarketCharts=shell`
- Dense fixture label: add `&pyrusMarketFixture=dense&pyrusMarketDensity=stress`
- Live chart mode: omit `pyrusMarketCharts=shell` or set `pyrusMarketCharts=live`

Safe QA always forces the chart shell so browser checks do not start live chart
hydration or background streams.

## Diagnostics

Read diagnostics from `data-market-*` attributes on `market-workspace`:

- `data-market-qa-enabled`
- `data-market-qa-source`
- `data-market-fixture`
- `data-market-chart-mode`
- `data-market-viewport`
- `data-market-pulse-columns`
- `data-market-sector-flow-columns`
- `data-market-leadership-columns`

The Market E2E spec attaches `market-render-diagnostics.json` plus targeted
panel screenshots on failure. The Playwright trace is retained for Market
failures so the QA owner can inspect DOM state, viewport size, and screenshots
without rerunning first.

## Validation

Run the focused browser coverage through the Replit wrapper:

```bash
pnpm --filter @workspace/pyrus run test:e2e:replit e2e/market-responsive.spec.ts -g "Market safe render QA|Market render QA keeps"
```

Run the full Market responsive file when chart interaction coverage is needed:

```bash
pnpm --filter @workspace/pyrus run test:e2e:replit e2e/market-responsive.spec.ts
```

For source-level checks:

```bash
pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/market/marketRenderQa.test.js src/features/market/marketChartWiring.test.js
pnpm --filter @workspace/pyrus run typecheck
```
