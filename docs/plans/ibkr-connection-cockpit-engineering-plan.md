# IBKR Connection Cockpit Engineering Plan

Generated: 2026-06-04
Branch: main
Scope: improve the IBKR launch/connect/deactivate experience after the v7 helper reliability work, with better speed visibility, stuck-state guidance, and UI communication. This plan is documentation-only.

## Skill Adaptation

This plan applies `$plan-eng-review` and `$planning-and-task-breakdown`. The original review skill expects interactive `AskUserQuestion` gates, but this Codex session is in Default mode and the user explicitly asked to proceed. I therefore captured the engineering decisions, tradeoffs, and task breakdown directly in this plan artifact instead of mutating app behavior.

## Step 0 Scope Challenge

The minimum useful outcome is not another connection system. The existing runtime already records most of the signal we need; the plan should expose and render that signal cleanly.

What can be reused:
- Existing activation diagnostics in [ibkr-bridge-runtime.ts](/home/runner/workspace/artifacts/api-server/src/services/ibkr-bridge-runtime.ts:2234) already return activation count, latest activation, progress events, and timing fields.
- Existing progress model in [ibkrConnectionOperationStepperModel.js](/home/runner/workspace/artifacts/pyrus/src/features/platform/ibkrConnectionOperationStepperModel.js:32) already maps helper progress events into launch phases.
- Existing header popover component in [HeaderStatusCluster.jsx](/home/runner/workspace/artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx:1830) already has compact stepper styling and token usage.
- Existing `/session`, `/ibkr/desktops`, and `/ibkr/activation/diagnostics` routes already supply most read-only state.

Scope reduction:
- Do not create a new event bus or durable activation table for this pass.
- Do not require another helper update unless API contract changes prove unavoidable.
- Do not redesign the full header. Build one compact operational "connection cockpit" inside the existing IBKR popover.

Complexity check:
- The complete version likely touches 6 to 8 files. That is acceptable because the changes cross API contract, generated client types, pure frontend model, UI, and tests.
- More than 8 files is a smell. If implementation starts expanding into Replit startup, account trading, or market-data line management, stop and split the work.

Search check:
- No new concurrency or infrastructure pattern is introduced. The plan reuses current REST polling/session refresh and the v7 long-poll helper claim path.
- Existing SSE infrastructure can remain untouched unless QA proves the current polling cadence cannot render progress promptly.

Completeness check:
- The complete path is backend-derived phase insight plus frontend rendering and tests. A shortcut that only adds UI copy would be cheaper for a human but would leave the same diagnosis gaps.

## What Already Exists

| Sub-problem | Existing source | Reuse decision |
|-------------|-----------------|----------------|
| Activation progress events | `recentProgress` from `getIbkrBridgeActivationDiagnostics()` | Reuse as raw event source |
| First-seen timestamps per helper step | `progressStepTimings` | Reuse for duration computation |
| Login handoff timing | `latestActivation.timings` | Reuse for credential delivery insight |
| Helper version compatibility | `runtime.ibkr.desktopAgentCompatibility` and helper constants | Reuse for badge and stuck thresholds |
| Launch/deactivate stepper | `buildIbkrLaunchOperationStepper()` and `buildIbkrDeactivateOperationStepper()` | Keep as top-level progress summary |
| Popover styling tokens | `CSS_COLOR`, `RADII`, `T`, `textSize`, `sp`, `dim` | Reuse; no new palette |

## Architecture Review

Finding A1: side-effecting launcher metadata.

`GET /ibkr/bridge/launcher` is documented as "Create an IBKR bridge one-click launcher payload" in [openapi.yaml](/home/runner/workspace/lib/api-spec/openapi.yaml:478), and the route calls `getIbkrBridgeLauncher()` in [platform.ts](/home/runner/workspace/artifacts/api-server/src/routes/platform.ts:1107). Read-oriented UI diagnostics should not call a route that can create activation state. Confidence: 9/10.

Recommendation: add a separate read-only helper metadata endpoint before adding more connection UI. The existing launcher route can remain for compatibility, but diagnostics and popover UI should stop depending on it for status.

Finding A2: phase insight should be backend-derived, not browser-inferred from raw events.

The backend has authoritative activation timings in [ibkr-bridge-runtime.ts](/home/runner/workspace/artifacts/api-server/src/services/ibkr-bridge-runtime.ts:2234). If the browser infers stuck reasons directly from raw progress strings, future helper wording changes will break the UI silently. Confidence: 8/10.

Recommendation: extend the backend diagnostics response with a stable `insight` object that contains current phase, owner, elapsed times, stale thresholds, and recommended user action.

Finding A3: no helper update should be required for cockpit phase one.

The v7 helper already sends progress events, long-polls job claim, claims login envelopes, and posts completion. A helper update would only be justified if a specific missing timestamp or cancellation acknowledgement is impossible to derive server-side. Confidence: 8/10.

Recommendation: treat helper changes as a later optimization, not the default path.

Architecture data flow:

```text
User clicks Launch/Connect
  -> Pyrus queues remote launch via API
  -> Windows helper claims desktop job
  -> Helper reports progress events
  -> API stores activation timings and recent progress
  -> /api/session + /api/ibkr/activation/diagnostics expose status
  -> Frontend model derives cockpit rows
  -> Header popover shows:
       current phase
       owner
       elapsed/normal time
       next expected transition
       user action when stuck
```

Target backend contract:

```ts
type IbkrActivationInsight = {
  currentPhase: "request" | "update" | "credentials" | "gateway" | "twoFactor" | "bridge" | "tunnel" | "complete" | "canceled" | "error" | "idle";
  currentOwner: "pyrus" | "desktopHelper" | "ibGateway" | "ibkrMobile" | "cloudflareTunnel" | "user" | "none";
  currentPhaseStartedAt: string | null;
  currentPhaseElapsedMs: number | null;
  severity: "idle" | "progress" | "attention" | "error" | "success";
  normalAfterMs: number | null;
  staleAfterMs: number | null;
  stale: boolean;
  title: string;
  detail: string;
  recommendedAction: string | null;
  timeline: Array<{
    id: string;
    label: string;
    owner: IbkrActivationInsight["currentOwner"];
    status: "pending" | "active" | "complete" | "attention" | "error" | "canceled";
    startedAt: string | null;
    completedAt: string | null;
    elapsedMs: number | null;
  }>;
};
```

## Code Quality Review

Finding Q1: avoid growing `HeaderStatusCluster.jsx` into the only owner of IBKR connection logic.

The file already owns many popover interactions and the current stepper render. Adding timing math, owner labels, thresholds, and stuck copy directly in the component would make it harder to test and easier to regress. Confidence: 8/10.

Recommendation: put derivation in pure model functions:
- Backend: one helper that builds `IbkrActivationInsight`.
- Frontend: one small model adapter that formats the backend insight for compact UI.
- UI: render only the model.

Finding Q2: keep status names stable and helper progress strings private.

Existing helper progress strings are useful for diagnostics but are too operational to be a UI contract. Confidence: 8/10.

Recommendation: expose stable phase ids and owner ids from the backend. The UI should render those ids, not parse helper log messages.

Finding Q3: preserve app styling language.

The connection popover is an operational header surface, not a marketing page. Confidence: 9/10.

Recommendation:
- Use existing `CSS_COLOR`, `RADII.sm`, typography helpers, and lucide icons already present in the header file.
- Keep the cockpit dense: no nested cards, no new brand palette, no large hero-style text.
- Use icon buttons for retry/cancel/details where possible, with existing tooltip behavior.
- Use a single subtle active animation, and respect reduced motion.

## Test Review

Detected framework: Node built-in test runner with `node JS validation runner`, plus TypeScript typecheck commands.

Coverage diagram for planned paths:

```text
CODE PATHS                                             USER FLOWS
[+] API read-only helper metadata                      [+] Open popover while idle
  |-- [GAP] returns version/desktop status only           |-- [GAP] no activation created by reading status
  |-- [GAP] never enqueues launch activation              |-- [GAP] helper badge is visible and calm
  `-- [GAP] handles no desktop registered

[+] API activation insight model                       [+] Click Launch/Connect
  |-- [GAP] idle/no activation                            |-- [GAP] stepper appears immediately
  |-- [GAP] request waiting on desktop helper             |-- [GAP] current owner says Desktop helper
  |-- [GAP] credentials waiting on Pyrus                  |-- [GAP] credentials phase shows elapsed time
  |-- [GAP] gateway login active                          |-- [GAP] Gateway/2FA phase gives correct user action
  |-- [GAP] two-factor wait                               `-- [GAP] connected state resolves to success
  |-- [GAP] tunnel/attach wait
  |-- [GAP] canceled activation                         [+] Deactivate/reconnect
  `-- [GAP] stale phase threshold                          |-- [GAP] cancel button disables while in flight
                                                            |-- [GAP] deactivate state explains what is being stopped
                                                            `-- [GAP] reconnect recovers from stale activation

[+] Frontend cockpit model                             [+] Error and slow paths
  |-- [GAP] formats duration buckets                      |-- [GAP] old helper or slow poll shows update guidance
  |-- [GAP] maps owners to labels/icons                   |-- [GAP] missing credentials shows recoverable copy
  |-- [GAP] does not overflow compact header              `-- [GAP] tunnel/DNS delay shows retry guidance
  `-- [GAP] hides noise when connected
```

Coverage target:
- Backend model tests: all phase/status branches, edge timestamps, and stale thresholds.
- Route tests: read-only metadata endpoint creates no activation.
- Frontend model tests: owner labels, elapsed formatting, severity, stale guidance, and connected idle behavior.
- UI/source tests: stepper remains immediate, cockpit placement is below the stepper, cancel/deactivate affordances remain present.
- Browser QA: open `?pyrusQa=safe`, verify popover layout and no text overflow; live full-app IBKR navigation only with explicit approval.

Priority regression tests:
- Reading helper metadata must not change activation count.
- A launch request must render progress UI immediately, before the Windows helper posts the first progress event.
- Cancel/deactivate buttons must remain usable and communicate in-flight state.

## Performance Review

Finding P1: cockpit should not add another high-frequency polling loop.

The header already refreshes session/runtime state. Adding a separate 1-second browser poll for diagnostics would increase API chatter and can produce contradictory state races. Confidence: 7/10.

Recommendation: use the existing session refresh cadence where possible. If diagnostics need a faster cadence only while launch is active, scope it to the popover/active operation and stop it immediately when the operation completes.

Finding P2: duration math must be O(number of phases), not O(number of all progress events) per render.

Activation progress history is bounded today, but UI render logic should not scan or sort raw events repeatedly. Confidence: 7/10.

Recommendation: compute normalized timeline server-side once per diagnostics request; keep frontend formatting cheap.

Operational timing targets:
- UI launch state visible: under 300 ms after click.
- v7 desktop helper job claim when online: normally under 2 seconds, attention after 8 seconds.
- Credential handoff ready after launch job claim: attention after 12 seconds.
- Gateway login window wait: attention after 25 seconds.
- 2FA wait: informational at 15 seconds, user action at 30 seconds.
- Tunnel attach: attention after 45 seconds.

## User Experience Requirements

The cockpit should answer four questions:
- Where exactly are we?
- Who are we waiting on?
- How long has this taken versus normal?
- What should the user do now, if anything?

Recommended layout inside the existing connection popover:

```text
[existing launch/deactivate stepper]

Current stage
  Owner chip        elapsed        status tone
  Detail sentence with next expected transition
  Action row when needed: Cancel / Retry / Details

Timeline disclosure
  Request       complete     Pyrus
  Desktop       active       Desktop helper     1.7s
  Credentials   pending      Pyrus
  Gateway       pending      IB Gateway
  Tunnel        pending      Cloudflare tunnel

[existing connection summary]
[existing market-data line usage]
[existing advanced details]
```

Styling constraints:
- Reuse the existing stepper visual language in `HeaderIbkrOperationStepper`.
- Use `bg1`, `borderLight`, `RADII.sm`, restrained typography, and existing semantic colors.
- Keep rows compact, with stable dimensions so labels and timers do not shift layout.
- Use lucide icons already imported or nearby, not custom SVG.
- No nested cards. The cockpit is one bordered operational block under the stepper.
- No new color theme, no gradients, no decorative imagery.

## Implementation Plan

### Phase 1: Backend Foundation

#### Task 1: Add Read-Only Helper Metadata

Description: Add a route that returns helper/runtime metadata without creating or queuing an activation. The route should be used by diagnostics and future UI status checks instead of abusing the launcher route.

Acceptance criteria:
- [ ] `GET /api/ibkr/bridge/helper-metadata` or equivalent returns expected helper version, desktop compatibility, paired desktop summary, and runtime override status.
- [ ] Calling the route does not create a launcher, activation, desktop job, login handoff, or progress event.
- [ ] Existing `/api/ibkr/bridge/launcher` remains backward compatible.

Verification:
- [ ] Backend unit/route test asserts activation count is unchanged before and after metadata read.
- [ ] `pnpm --filter @workspace/api-server run typecheck`

Dependencies: None.

Files likely touched:
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.validation.ts`
- `lib/api-spec/openapi.yaml`
- generated API client files if codegen is required

Estimated scope: Medium, 3-5 files before generated outputs.

#### Task 2: Build Backend Activation Insight Model

Description: Convert existing activation timings and progress events into stable phase, owner, severity, elapsed, stale, and recommended-action fields.

Acceptance criteria:
- [ ] Diagnostics response includes a stable `insight` object with phase id, owner id, elapsed timing, stale threshold, summary copy, and timeline rows.
- [ ] Helper progress strings remain diagnostic data, not frontend control flow.
- [ ] Insight handles idle, active, complete, canceled, stale, and error states.

Verification:
- [ ] Backend model tests cover every phase and stale threshold.
- [ ] Existing `ibkr-bridge-runtime.validation.ts` still passes.
- [ ] `pnpm --filter @workspace/api-server run typecheck`

Dependencies: Task 1 can be parallel if contract names are coordinated, but Task 2 should land before frontend work.

Files likely touched:
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.validation.ts`
- `lib/api-spec/openapi.yaml`
- generated API client files if codegen is required

Estimated scope: Medium.

### Checkpoint: Backend

- [ ] Helper metadata is read-only.
- [ ] Activation insight is fully unit-tested.
- [ ] API server typecheck passes.
- [ ] OpenAPI/client generation is current if public contract changed.

### Phase 2: Frontend Cockpit Model And UI

#### Task 3: Add Frontend Cockpit Model

Description: Add a pure frontend model adapter that consumes session/runtime diagnostics and backend activation insight, formats compact labels, chooses icons, and decides whether the cockpit is visible.

Acceptance criteria:
- [ ] Model shows immediately after launch/connect is clicked, even before the helper posts first progress.
- [ ] Model maps owners to concise app-styled labels: Pyrus, Desktop helper, IB Gateway, IBKR Mobile, Tunnel, User.
- [ ] Model hides or compresses itself when connected and no action is needed.

Verification:
- [ ] Node tests cover idle, launch start, helper wait, credential wait, Gateway login, 2FA wait, tunnel wait, complete, canceled, and error states.
- [ ] Existing `ibkrConnectionOperationStepperModel.validation.js` still passes.

Dependencies: Task 2.

Files likely touched:
- `artifacts/pyrus/src/features/platform/ibkrConnectionCockpitModel.js`
- `artifacts/pyrus/src/features/platform/ibkrConnectionCockpitModel.validation.js`
- possibly `artifacts/pyrus/src/features/platform/bridgeRuntimeModel.js`

Estimated scope: Small to Medium.

#### Task 4: Render Cockpit Under The Existing Stepper

Description: Add the compact cockpit block inside the connection popover below `HeaderIbkrOperationStepper` and above the existing summary/advanced details.

Acceptance criteria:
- [ ] The progress sequence icons and animation appear immediately on launch/connect.
- [ ] Cockpit current stage, owner chip, elapsed timer, and details render without text overflow.
- [ ] Timeline disclosure is available but compact by default.
- [ ] Styling matches the app's existing header/popover tokens.

Verification:
- [ ] Source tests assert cockpit placement and test ids.
- [ ] Frontend typecheck passes.
- [ ] Browser QA with `?pyrusQa=safe` verifies no white screen, no console crash, and stable popover layout.

Dependencies: Task 3.

Files likely touched:
- `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`
- `artifacts/pyrus/src/features/platform/ibkrConnectionCockpitModel.js`
- `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.validation.js` or related header source tests

Estimated scope: Medium.

#### Task 5: Audit Connection Actions

Description: Verify cancel, clear, deactivate, reconnect, and retry affordances against the new operation state so users can recover from slow or stuck phases.

Acceptance criteria:
- [ ] Cancel button cancels the current activation and shows in-flight state.
- [ ] Deactivate does not appear complete until backend state confirms detach/shutdown.
- [ ] Retry does not enqueue duplicate activation while one is active unless explicitly intended.
- [ ] Error states tell the user whether to wait, approve 2FA, clear Gateway prompt, retry tunnel, or relaunch helper.

Verification:
- [ ] Unit tests cover cancel/deactivate/retry state transitions.
- [ ] Safe browser QA checks buttons are visible, disabled/enabled correctly, and have no layout jumps.

Dependencies: Tasks 3 and 4.

Files likely touched:
- `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`
- `artifacts/pyrus/src/features/platform/ibkrConnectionOperationStepperModel.js`
- `artifacts/pyrus/src/features/platform/ibkrConnectionOperationStepperModel.validation.js`

Estimated scope: Medium.

### Checkpoint: UI

- [ ] Frontend model and source tests pass.
- [ ] Header popover remains visually consistent.
- [ ] Connection progress communicates current owner and user action.
- [ ] No full live IBKR navigation is performed without explicit approval.

### Phase 3: Operational Refinement

#### Task 6: Add Lightweight Timing Diagnostics

Description: Persist or expose phase duration summaries in diagnostics so repeated slow points can be distinguished from one-off IBKR/Gateway delay.

Acceptance criteria:
- [ ] Latest activation includes phase durations for request, credentials, Gateway login, 2FA, bridge attach, and tunnel attach where timestamps exist.
- [ ] Diagnostics distinguish "waiting normally" from "stale" without marking expected 2FA delay as an error.
- [ ] Slow points are visible in advanced details for support/debugging.

Verification:
- [ ] Backend tests cover missing timestamps and partial timelines.
- [ ] Frontend tests cover duration rendering with null/partial data.

Dependencies: Task 2.

Files likely touched:
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.validation.ts`
- `artifacts/pyrus/src/features/platform/ibkrConnectionCockpitModel.js`

Estimated scope: Medium.

#### Task 7: Decide Whether A Helper Update Is Still Worth It

Description: After backend/UI improvements, evaluate whether a helper-side change would materially improve speed or clarity. Keep this as a decision checkpoint, not automatic scope.

Acceptance criteria:
- [ ] Evidence shows whether remaining delay is API-side, helper-side, Gateway window activation, 2FA, or tunnel attach.
- [ ] If helper change is needed, the plan names the exact missing event/timestamp and compatibility impact.
- [ ] If no helper change is needed, document that v7 remains current.

Verification:
- [ ] Live logs from a successful and slow activation are compared against insight timeline.
- [ ] No helper version bump is made without a targeted failing test or measured gap.

Dependencies: Tasks 1-6.

Files likely touched:
- `scripts/windows/pyrus-ibkr-helper.ps1` only if evidence justifies it.
- Backend helper compatibility tests if bumped.

Estimated scope: Small if no helper change, Medium if helper change is justified.

### Checkpoint: Complete

- [ ] Backend targeted tests pass.
- [ ] Frontend targeted tests pass.
- [ ] API and Pyrus typechecks pass.
- [ ] Safe browser QA passes.
- [ ] Live IBKR connection test, when approved by user, shows immediate UI feedback and clear phase ownership.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Read-only UI accidentally creates activation | Duplicate helper jobs or confusing stale state | Task 1 makes helper metadata side-effect-free and tests activation count |
| Browser parses helper log strings | Future helper copy breaks UI | Backend emits stable phase/owner ids |
| Cockpit adds noisy polling | More API churn and inconsistent status | Reuse existing session/diagnostics cadence; active-only faster refresh if required |
| UI grows too much in header file | Harder testability and regressions | Keep derivation in pure models; component renders model |
| 2FA delay treated as failure | User sees false errors during normal approval | Use informational and attention thresholds separately |
| Helper update becomes scope creep | More risk during market-hours workflow | Helper changes require measured missing signal |

## Failure Modes

| Codepath | Production failure | Test coverage required | User-visible behavior |
|----------|--------------------|------------------------|-----------------------|
| Helper metadata route | No desktop is registered | Route unit test | Shows "Desktop helper not paired" with relaunch/setup action |
| Helper metadata route | Metadata read mutates activation state | Regression test | No user-visible duplicate activation |
| Activation insight idle | No latest activation exists | Model unit test | Cockpit hidden or calm idle state |
| Activation insight helper wait | v6/old helper slow-polls | Model unit test | Shows helper/update wait, not generic Preparing |
| Activation insight credentials | Login envelope not delivered | Model unit test | Shows Pyrus credential handoff wait and retry/cancel |
| Activation insight Gateway wait | Gateway window not found | Model unit test | Shows IB Gateway owner and prompt guidance |
| Activation insight 2FA | Mobile approval pending | Model unit test | Shows IBKR Mobile/User action after threshold |
| Activation insight tunnel | Cloudflare URL/DNS slow | Model unit test | Shows Tunnel owner and retry guidance |
| Frontend cockpit | Long label overflows popover | Safe browser QA/source test | Text wraps cleanly, no overlap |
| Cancel/deactivate | User clicks cancel mid-handoff | UI model/action test | Button disables in-flight and terminal state is clear |

Priority silent gaps to block implementation:
- Metadata route mutates activation state.
- Launch click does not show immediate progress UI.
- Cancel/deactivate action fires but leaves UI with no terminal or recoverable state.

## Worktree Parallelization Strategy

Dependency table:

| Step | Modules touched | Depends on |
|------|-----------------|------------|
| Backend metadata | API routes, IBKR runtime service, OpenAPI | None |
| Backend insight model | IBKR runtime service, OpenAPI | Metadata contract naming only |
| Frontend cockpit model | Pyrus platform model files | Backend insight contract |
| Frontend cockpit UI | Pyrus platform header component | Frontend cockpit model |
| Action audit | Pyrus platform header and stepper model | Cockpit model/UI |
| Timing diagnostics | API runtime service and Pyrus model | Backend insight model |
| Helper decision | Windows helper and compatibility tests | Evidence from prior tasks |

Parallel lanes:
- Lane A: Task 1 -> Task 2 -> Task 6, sequential because they share the API runtime contract.
- Lane B: Task 3 -> Task 4 -> Task 5, starts after Task 2 contract is stable.
- Lane C: Task 7, starts after Lane A and Lane B produce measured evidence.

Execution order:
- Do not launch parallel worktrees until Task 2 defines the contract.
- After Task 2, frontend model/UI can proceed while backend duration polish continues, as long as generated client changes are coordinated.
- Keep helper changes sequential and last.

Conflict flags:
- Tasks 3-5 all touch `artifacts/pyrus/src/features/platform`, so they should be sequential unless split by clear file ownership.
- Tasks 1, 2, and 6 all touch `ibkr-bridge-runtime.ts`, so they should be sequential.

## NOT In Scope

- Replit startup or artifact configuration changes. Startup rules remain locked.
- Replacing Cloudflare tunnel transport.
- Storing IBKR credentials beyond the existing one-time encrypted handoff.
- Changing IBKR account selection, trading order submission, or live trading safety gates.
- Redesigning the whole header, settings page, or broker connection architecture.
- Replacing the v7 helper by default.
- Full SSE migration for connection progress unless polling proves insufficient.
- Market-data line management changes; that is covered by the separate IBKR data-line architecture plan.

## Completion Summary

- Step 0: Scope Challenge - scope reduced to reuse existing diagnostics and avoid mandatory helper work.
- Architecture Review: 3 issues found.
- Code Quality Review: 3 issues found.
- Test Review: diagram produced, 24 gaps identified.
- Performance Review: 2 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed; deferred work is captured in this plan.
- Failure modes: 3 priority silent gaps flagged.
- Outside voice: skipped because this Default-mode skill run avoided extra interactive gates.
- Parallelization: 3 lanes, 1 backend lane, 1 frontend lane, 1 later helper-decision lane.
- Lake Score: 5/5 complete recommendations chosen for this scope.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** - API runtime - Add read-only helper metadata
  - Surfaced by: Architecture Review A1 - launcher metadata route is read-shaped but activation-producing.
  - Files: `artifacts/api-server/src/routes/platform.ts`, `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`, `artifacts/api-server/src/services/ibkr-bridge-runtime.validation.ts`, `lib/api-spec/openapi.yaml`.
  - Verify: backend route/unit tests, API typecheck.
- [ ] **T2 (P1, human: ~4h / CC: ~45min)** - API diagnostics - Add activation insight model
  - Surfaced by: Architecture Review A2 and Test Review - browser needs stable phase/owner/timing fields.
  - Files: `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`, `artifacts/api-server/src/services/ibkr-bridge-runtime.validation.ts`, `lib/api-spec/openapi.yaml`.
  - Verify: all insight branch tests, generated clients if contract changes, API typecheck.
- [ ] **T3 (P1, human: ~2h / CC: ~25min)** - Pyrus model - Add cockpit model adapter
  - Surfaced by: Code Quality Review Q1 - keep timing/owner derivation out of `HeaderStatusCluster.jsx`.
  - Files: `artifacts/pyrus/src/features/platform/ibkrConnectionCockpitModel.js`, matching test file, optional `bridgeRuntimeModel.js`.
  - Verify: frontend model tests.
- [ ] **T4 (P1, human: ~3h / CC: ~40min)** - Pyrus UI - Render app-styled cockpit in connection popover
  - Surfaced by: User Experience Requirements and Code Quality Review Q3.
  - Files: `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`, cockpit model tests/source tests.
  - Verify: frontend tests, typecheck, safe browser QA.
- [ ] **T5 (P1, human: ~2h / CC: ~30min)** - Pyrus actions - Audit cancel/deactivate/retry states
  - Surfaced by: Failure Modes - action state cannot silently hang.
  - Files: `HeaderStatusCluster.jsx`, `ibkrConnectionOperationStepperModel.js`, existing platform tests.
  - Verify: action state tests and safe browser QA.
- [ ] **T6 (P2, human: ~2h / CC: ~25min)** - Diagnostics - Add phase duration summaries
  - Surfaced by: Performance Review P2 and operational timing targets.
  - Files: API runtime service/tests and cockpit model/tests.
  - Verify: partial timestamp tests and duration rendering tests.
- [ ] **T7 (P2, human: ~1h / CC: ~15min)** - Helper decision - Decide on helper update from evidence
  - Surfaced by: Architecture Review A3.
  - Files: no helper files unless evidence justifies it.
  - Verify: compare live activation logs to cockpit timeline.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | skipped | Not requested in this pass |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped | Not requested; Default-mode plan kept local |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | complete | 8 issues, 3 priority silent gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | skipped | Design constraints included in eng plan |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | skipped | Not requested in this pass |

- UNRESOLVED: 0 blocking decisions for planning; implementation still needs normal code review and QA.
- VERDICT: ENG CLEARED - ready to implement in phased tasks above.
