# Backend Data Machine Handoff

- Last Updated (MT): `2026-06-12 18:15:27 MDT`
- Last Updated (UTC): `2026-06-13T00:15:27Z`
- Native Codex Session ID: `pending-backend-data-machine`
- Scope: backend data-map machine-state documentation plus realtime Diagnostics machine diagram.

## Status

Implemented: latest Codex pickup completed the Diagnostics right-side
observability rail visual refinement.

Current Codex pickup:

- `MachineStateDiagram.jsx` now removes `client` from positioned card layout.
  Client remains in the model but renders as a compact rail signal list split
  into API Boundary and Browser Signals.
- Diagnostics moved out of the bottom lane into a right-side
  `OBSERVABILITY & CLIENTS` rail.
- The main diagram now has four numbered stages:
  sources/distribution, process lanes, signals/algo, account/trading.
- Normal master edges to/from Diagnostics/Client are hidden from the main
  pipeline. View-only alert overlays are derived from current master status and
  draw only for main source groups in `checking`, `degraded`, or `down`.
- `MACHINE_STATE_WIRING.md` now documents the distinction between the 27-edge
  truth graph and the rendered alert-only rail edges.
- `artifacts/pyrus/src/index.css` now carries the scoped edge animation,
  reduced-motion opt-out, and phone-only scroll workspace for the diagram.
- Contract tests now pin that Client is model telemetry but not a rendered card,
  the rail labels/rules exist, and the invalid SVG `height="auto"` attribute is
  gone.

Current validation:

- Passing: `node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagram.contract.test.mjs`
- Passing: `node --test artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- Passing: `pnpm --filter @workspace/pyrus run typecheck`
- Passing: `pnpm --filter @workspace/pyrus run build`
- Browser after screenshots captured:
  - `/tmp/pyrus-machine-visual-review/after-desktop-panel.png`
  - `/tmp/pyrus-machine-visual-review/after-mobile-panel.png`
  - `/tmp/pyrus-machine-visual-review/after-report.json`
- Preserved before screenshots:
  - `/tmp/pyrus-machine-visual-review/before-desktop-panel.png`
  - `/tmp/pyrus-machine-visual-review/before-mobile-panel.png`
  - `/tmp/pyrus-machine-visual-review/before-report.json`
- Browser report: no console messages; mobile uses horizontal diagram workspace
  instead of shrinking the SVG.

Latest refinement:

- Follow-up contract fix: `/api/diagnostics/runtime` OpenAPI now exposes the runtime backend fields used by the machine/diagnostics wiring instead of leaving them as undocumented extras:
  - `RuntimeIbkrDiagnostics.governor`
  - `RuntimeIbkrDiagnostics.streams`
  - `RuntimeDiagnosticsResponse.marketDataWorkPlan`
  - `RuntimeDiagnosticsResponse.signalMonitor`
- Regenerated API clients so React and zod generated shapes include those fields. Codegen also surfaced existing generated drift from prior spec changes, including Quote Snapshot extended-baseline generated types and the already-removed Signal Monitor matrix POST client.
- Audited the diagram against source ownership and corrected the old `Source Layer`/Massive-only simplification.
- Broker and Massive are now separate top-row data sources; shared hubs are centered: `Market Data Hub`, `Position Quotes`, and `Account View`.
- Added explicit `Signals`, `Algo Engine`, and `Trade Mgmt` stages so the visible path reaches signal generation, orchestration, trade decisions, orders/fills, exits, and maintenance.
- Added visible edge labels for transport/handoff type: Broker REST/SSE, IBKR WS/REST, Massive WS/REST, REST/SSE contracts, EventSource, worker state, pressure/backoff, line budgets, and runtime diagnostics samples.
- Removed the inner bordered SVG container so the machine aligns with surrounding Diagnostics `SurfacePanel` sections.
- Documentation now includes a concrete top-down runtime data movement topology before the abstract state machine.

## Files Changed

- `docs/backend-data-map.md`
  - Added/updated `Backend Data Line Machine` with concrete runtime topology, Mermaid state diagram, plain-text fallback, source references, transport labels, operational pressure/latency/backoff/timeout surfacing, and evidence rules.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
  - Added pure Diagnostics data-machine model builder.
  - Maps diagnostics snapshots, route-admission action/pressure, IBKR/market-data health, account/order freshness, line governor pressure, flow scanner, memory/workload, and incidents into stable machine nodes and edges.
  - Latest refinement models Broker/Massive as separate sources; market/account/quote shared hubs; signals/algo/trade-management subprocesses; diagnostics collector/SSE path; and pressure/backoff/timeout side inputs.
- `artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs`
  - Covers healthy live flow, reconnecting transport, degraded API, down IBKR, stale account/order streams, capacity-limited line pressure, shed admission, cache-only admission, and missing snapshots.
  - Latest refinement asserts Broker/Massive labels, centered shared flow, signal/algo/trade-management health, route admission direction, and source/hub/trade animated edges.
- `artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx`
  - Added operator-style animated SVG machine diagram for Diagnostics Overview.
  - Latest refinement moves Broker/Massive to the top row, centers shared hubs, adds signal/algo/trading stages, renders transport edge labels, and keeps animation edge-only.
- `artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
  - Wires the new model/component above the Overview metrics strip.
  - Preserves the pre-existing `contentReady: diagnosticsVisible` readiness change.
- `artifacts/pyrus/src/index.css`
  - Added scoped SVG edge-flow animation and reduced-motion opt-outs.
- `lib/api-spec/openapi.yaml`
  - Runtime diagnostics contract now includes the JSON backend wiring fields consumed by Diagnostics/runtime control.
- `lib/api-client-react/src/generated/api.schemas.ts`, `lib/api-zod/src/generated/api.ts`, and `lib/api-zod/src/generated/types/*`
  - Regenerated from the OpenAPI contract.

## Validation

Passed:

- `pnpm --filter @workspace/pyrus exec node --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check -- docs/backend-data-map.md artifacts/pyrus/src/screens/DiagnosticsScreen.jsx artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs artifacts/pyrus/src/index.css`
- `pnpm --filter @workspace/pyrus run doctor:runtime`
- `curl -fsS 'http://127.0.0.1:18747/?pyrusQa=safe'`
- `curl -fsS 'http://127.0.0.1:8080/api/healthz'`
- `pnpm --filter @workspace/pyrus run build`

Latest refinement validation passed:

- `pnpm --filter @workspace/pyrus exec node --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check -- artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs artifacts/pyrus/src/index.css docs/backend-data-map.md artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
- `pnpm --filter @workspace/pyrus run build`

Top-down refinement validation passed:

- `pnpm --filter @workspace/pyrus exec node --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check -- artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.test.mjs artifacts/pyrus/src/index.css docs/backend-data-map.md artifacts/pyrus/src/screens/DiagnosticsScreen.jsx`
- `pnpm --filter @workspace/pyrus run build`

Source-ownership refinement validation passed:

- `node --check artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js`
- `pnpm --filter @workspace/pyrus exec node --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- `pnpm --filter @workspace/pyrus run typecheck`
- `pnpm --filter @workspace/pyrus run build`
- `pnpm exec tsx --eval ...` server-render sanity probe in `artifacts/pyrus` confirmed SVG output includes Broker/Massive/Market/Account/Signals/Algo/Trade labels, no stale `source-layer`, and no inner border string.

Contract follow-up validation passed:

- `pnpm --filter @workspace/pyrus exec node --test src/screens/diagnostics/machineStateDiagramModel.test.mjs`
- `pnpm --filter @workspace/api-client-react run typecheck`
- `pnpm --filter @workspace/api-zod exec tsc -p tsconfig.json --noEmit`
- `git diff --check -- lib/api-spec/openapi.yaml lib/api-client-react/src/generated/api.schemas.ts lib/api-zod/src/generated/api.ts lib/api-zod/src/generated/types/runtimeDiagnosticsResponse.ts lib/api-zod/src/generated/types/runtimeIbkrDiagnostics.ts artifacts/pyrus/src/screens/diagnostics/machineStateDiagramModel.js artifacts/pyrus/src/screens/diagnostics/MachineStateDiagram.jsx artifacts/pyrus/src/screens/DiagnosticsScreen.jsx docs/backend-data-map.md`
- `pnpm --filter @workspace/pyrus run typecheck`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/pyrus run build`

Known validation limitation:

- `pnpm --filter @workspace/api-spec run codegen` regenerated clients, then exited nonzero because its built-in root `typecheck:libs` was blocked by the hot PYRUS/Replit runtime guard. Targeted package typechecks above passed instead; root `audit:api-codegen` was not run for the same hot-runtime reason.
- `pnpm run audit:markdown-paths` failed on pre-existing missing references in `REPO_CLEANUP_INVENTORY.md` and `scripts/README.md`; none were from the new backend-data-map references.
- Browser visual QA was not run because Playwright is not installed and Chrome DevTools MCP is not exposed in this session.

## Runtime Notes

- Existing Pyrus dev server was already running at `http://127.0.0.1:18747/`.
- Existing API server was healthy at `/api/healthz`.
- `doctor:runtime` warned that the API process predates the latest built API bundle; this work is frontend/doc-only and did not require API restart.
- Full workspace remains heavily dirty from unrelated work. Scoped status for this slice is limited to the files above.
