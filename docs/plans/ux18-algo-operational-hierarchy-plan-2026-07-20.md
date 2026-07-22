# UX-18 Implementation Plan — Algo Operational Hierarchy and Tables

**Status:** Complete; validated 2026-07-22  
**Date:** 2026-07-20  
**Lane:** Mobile / design / UI / UX only

## Outcome

Finish the existing Algo cockpit without redesigning its runtime model. A trader
must be able to identify the active deployment and its shadow/live state, see
the first blocker, scan signals/candidates and positions, open a candidate or
position in Trade for review, and reach configuration without mistaking a
navigation action for an order submission.

UX-18 is complete only when the active-data screen passes the six doctrine
presentations at 390, 768, and 1440 pixels in dark and light themes, with a
mutation firewall proving that confirmation inspection and Trade handoff remain
nonmutating.

## Observed Baseline

- The current screen already has the intended large-scale hierarchy:
  sticky operations header, deployment tabs, readiness/attention overview,
  Signals to Actions, account-scoped positions, and a 380px desktop
  configuration/diagnostics rail.
- Narrow layouts already move the rail into a closed, explicit settings drawer.
- `PlatformShell.jsx` suppresses the global Algo Monitor while the primary Algo
  screen is active, so the primary screen no longer competes with a duplicate
  operational sidebar.
- Server source already force-pauses a deployment when its mode changes to
  live. UX-18 must preserve that contract and must not change backend behavior.
- The focused Algo design/safety baseline is green: 79/79 tests across
  `AlgoScreen`, `AlgoLivePage`, operations primitives, right-rail doctrine,
  typography, positions, risk units, and position-management readiness.
- The empty-state doctrine matrix is green at all six presentations: 6/6.
- The active risk-unit browser fixture reached and exercised the UI at
  390/768/1440, then all three cases failed at the final fixture audit because
  the route map does not yet model the source-confirmed read-only endpoint
  `/api/broker-execution/ibkr-portal/readiness`. No protected mutation was
  observed.
- The separate runtime workstream owns data/runtime semantics in
  `algoHelpers.js`, `algoHelpers.test.mjs`, and backend services. UX-18 should
  consume those outputs, not edit their meaning.

## Fresh-Eyes Findings

1. A ready candidate action is labeled **Submit**, but its implementation only
   navigates to a pre-filled Trade ticket. That copy overstates the action and
   violates the required review-only handoff.
2. Candidate handoff is duplicated: a tiny Trade button sits in the signal hero
   while a second ready-only action occupies the Act column. The targets are
   14px and 28×24px, below the 44px touch target expected on narrow layouts.
3. The shadow/live mode button is nested inside a focusable `role="tab"`. One
   visual item therefore contains two independent keyboard actions, making
   selection and destructive mode intent harder to distinguish.
4. The empty deployment state duplicates the existing creation modal and uses
   placeholder-only deployment-name and symbol inputs. The existing
   `CreateDeploymentModal` already supplies visible field labels and is the
   canonical flow.
5. Active candidate, blocker, position, rail, confirmation, and Trade-handoff
   relationships have no deterministic six-presentation browser proof.
6. `AlgoScreen.jsx` retains eight unused responsive grid-template constants and
   an unused `wasEnabled` confirmation field from the pre-cockpit layout. They
   should disappear only while the surrounding code is already being touched.

## Design Completeness

| Dimension | Current | What makes it 10/10 |
|---|---:|---|
| Information hierarchy | 8/10 | Active deployment, mode, run state, and first blocker are the first scan; configuration remains tertiary. |
| State coverage | 8/10 | Loading, empty, unavailable, active, blocked, stale, and recovery states are fixture-backed without layout jumps. |
| Safety language | 7/10 | No Algo action says Submit; live mode and live enablement are separate, explicit states. |
| Responsive allocation | 7/10 | Active tables, rail/drawer, and controls are proven at 390/768/1440 in both themes. |
| Accessibility | 6/10 | Deployment selection and mode intent are separate controls; visible labels and 44px touch targets are enforced. |
| Design-system alignment | 8/10 | Flat bands, hairlines, IBM Plex roles, semantic color, and the canonical creation modal remain authoritative. |
| Verification | 6/10 | The active-data suite has zero unknown reads, zero protected mutations, and six green presentations. |

Target after UX-18: at least 9/10 in every dimension. The remaining point is
reserved for live visual review against real production-shaped data after the
deterministic fixture is green.

## Information Hierarchy

```text
DESKTOP
┌ Operations header: deployment identity · mode · run state · first blocker ┐
├ Deployment selector tabs (selection only)                                 ┤
├ Readiness / risk / activity summary                                       ┤
├ Signals to Actions: current rows → candidate state → Review in Trade       ┤
├ Account selector + positions → Review in Trade                            ┤
└──────────────────────────────────────────────┬──────────────────────────────┘
                                               │ Settings / diagnostics rail
                                               │ Dirty-state save bar

TABLET / PHONE
Operations header → deployment tabs → overview → signals → positions
Settings remain closed until the explicit Settings control opens the drawer.
```

The first three items a user must see are:

1. Which deployment is selected.
2. Whether it is SHADOW or LIVE, and whether it is running or paused.
3. What currently blocks or needs attention.

## Responsive Contract

| Presentation | Required allocation |
|---|---|
| 390×844 | One-column operational read; horizontally scrollable deployment selector; compact signal records; positions remain contained; settings opens as a closed-by-default bottom drawer; all candidate/mode controls expose 44px targets. |
| 768×1024 | One-column primary workspace with shell rails collapsed; compact table treatment may follow measured width, but labels and blocker context remain present; settings uses the explicit drawer, not an automatically opened sheet. |
| 1440×900 | Main workspace plus 380px internal settings/diagnostics rail; global Algo Monitor absent on the Algo route; signal and position tables retain stable headers/rails and independent containment. |

All three widths must pass dark and light themes. Both reduced-motion channels
must suppress nonessential motion without changing hierarchy.

## State Contract

| Feature | Loading | Empty | Error | Success | Partial / stale |
|---|---|---|---|---|---|
| Deployment inventory | Keep stable Algo chrome; no stale deployment substitution. | Explain whether drafts exist and offer the canonical Create deployment action. | State inventory unavailable without guessing the cause; allow automatic retry. | Selected deployment and mode are explicit. | Preserve last successful list during a failed background refresh and label the refresh failure. |
| Operations overview | Neutral placeholders preserve the band. | Zero values stay truthful. | First operational blocker appears before diagnostics detail. | Readiness, risk, activity, and pipeline scan in that order. | Amber freshness/source text; no layout insertion. |
| Signals/candidates | Stable table shell or compact loading state. | Explain search/filter/matrix-specific reason and recovery. | Row or table-level failure text, not a blank table. | Candidate state and one Review in Trade action are clear. | Stale quote/signal cues remain row-local. |
| Positions | Preserve Account table shell. | Explain that positions appear after a fill. | Inherited Account error state. | Source/account and management readiness remain explicit. | Stale or unavailable values retain Account semantics. |
| Live switch | Not applicable. | Not applicable. | Failed mode change leaves the original mode selected. | Destructive confirmation opens, cancel restores focus, confirm changes mode only. | A newly live deployment is visibly paused until separately enabled. |
| Settings rail/drawer | Baseline controls stay gated until loaded. | No focused deployment means no editable controls. | Save failure remains visible at the save bar. | Desktop rail or explicit narrow drawer. | Dirty fields and stale baselines remain distinguishable. |

## Implementation Tasks

### Task 1 — Restore the active Algo fixture baseline

**Description:** Promote the existing untracked risk-unit fixture into the
shared UX-18 active-data fixture instead of creating a second copy. Model the
new IBKR readiness read with the canonical response shape, preserve the current
risk-unit test, and establish a green mutation-firewalled baseline.

**Acceptance criteria:**

- [ ] `/api/broker-execution/ibkr-portal/readiness` returns an explicit
      user-scoped, non-trading-ready fixture response.
- [ ] The existing 390/768/1440 risk-unit assertions pass unchanged.
- [ ] Unknown reads and protected mutations are both empty.

**Verification:**

- [ ] `pnpm exec playwright test e2e/algo-operational-hierarchy.browser-validation.spec.ts --grep "risk amount units" --reporter=list`

**Dependencies:** None.  
**Files likely touched:**

- `artifacts/pyrus/e2e/algo-risk-unit-responsive.browser-validation.spec.ts`
- `artifacts/pyrus/e2e/algo-operational-hierarchy.browser-validation.spec.ts`

**Estimated scope:** Small.

### Task 2 — Make deployment tabs selection-only

**Description:** Keep a read-only SHADOW/LIVE badge on every deployment, but
remove mode mutation from the tab itself. A tab selects one deployment and does
nothing else, eliminating nested keyboard actions and accidental mode intent.

**Acceptance criteria:**

- [ ] No interactive control is nested inside the focusable deployment tab.
- [ ] Every deployment retains a word-labeled SHADOW or LIVE badge that does
      not rely on color.
- [ ] Pointer and keyboard activation select the deployment exactly once.

**Verification:**

- [ ] Component tests cover selection, badge copy, keyboard activation, and the
      absence of a nested mode button.

**Dependencies:** Task 1.  
**Files likely touched:**

- `artifacts/pyrus/src/screens/algo/AlgoDeploymentTabs.jsx`
- `artifacts/pyrus/src/screens/algo/AlgoDeploymentTabs.test.mjs`

**Estimated scope:** Small.

### Task 3 — Make active mode and run state explicit

**Description:** Put the active deployment’s mode intent in the sticky
operations header and make mode plus run state read as two separate facts.
Preserve the existing destructive confirmation and server-owned force-pause
behavior.

**Acceptance criteria:**

- [ ] Active mode is word-labeled at every width; live reads **LIVE MONEY** and
      does not rely on red alone.
- [ ] Paused/running language is mode-aware: start/pause shadow deployment or
      enable/pause live trading, never generic Resume.
- [ ] Opening and canceling the live confirmation performs no request and
      restores focus to the initiating mode control.

**Verification:**

- [ ] Source/component tests cover independent mode intent, destructive dialog
      copy, pending state, Escape/cancel, and focus return.
- [ ] Existing deployment inventory and background-refresh tests remain green.

**Dependencies:** Task 2.  
**Files likely touched:**

- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `artifacts/pyrus/src/screens/AlgoScreen.test.mjs`

**Estimated scope:** Medium.

### Task 4 — Make candidate and position handoff explicitly review-only

**Description:** Replace the candidate row’s duplicate Trade controls with one
canonical **Review in Trade** action. Remove the internal `submit` vocabulary,
use the neutral action accent rather than financial-outcome green, and size the
control for the active input mode. Preserve the already-correct position handoff.

**Acceptance criteria:**

- [ ] Candidate rows contain one Trade handoff control, not a hero shortcut plus
      a second Act-column button.
- [ ] The action id/copy is `openTrade` / **Review in Trade**; Algo contains no
      Submit label for this navigation path.
- [ ] The accessible name includes symbol/contract context; the target is at
      least 44px on narrow/touch layouts and 24px on desktop.
- [ ] Clicking candidate or position handoff only selects Trade review state;
      it never sends an order or other protected mutation.

**Verification:**

- [ ] Focused row/table tests cover copy, one-action rendering, target sizing,
      keyboard activation, and callback payload.
- [ ] `OperationsPositionsTable.test.mjs` remains green.

**Dependencies:** Task 3.  
**Files likely touched:**

- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.mjs`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs`

**Estimated scope:** Medium.

### Task 5 — Reuse the canonical deployment creation flow

**Description:** Remove the duplicate inline form from the empty Algo state.
Keep contextual empty/error copy and route the primary action to the existing
`CreateDeploymentModal`, whose fields already have visible labels and shared
touch behavior.

**Acceptance criteria:**

- [ ] Empty states show context plus one **Create deployment** action when
      creation is available.
- [ ] Deployment name, strategy draft, and symbols are edited only in the
      canonical labeled modal.
- [ ] Unavailable inventory remains nonmutating and does not offer a misleading
      create action.
- [ ] Obsolete empty-form props, the unused `wasEnabled` field, and dead
      pre-cockpit grid constants are removed only if no current reader remains.

**Verification:**

- [ ] `AlgoLivePage.test.mjs` covers draft/no-draft/unavailable copy and modal
      launch intent.
- [ ] `AlgoScreen.test.mjs` proves the existing modal remains the sole creator.

**Dependencies:** Task 4.  
**Files likely touched:**

- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `artifacts/pyrus/src/screens/AlgoScreen.test.mjs`

**Estimated scope:** Small.

### Task 6 — Prove the full active operational hierarchy

**Description:** Extend the promoted fixture with one paused shadow deployment,
one paused live deployment, ready and blocked candidates, a populated signal
matrix, one shadow position, one broker position, attention/transitions, and
right-rail diagnostics. Run the actual normal app URL with all mutations
aborted.

**Acceptance criteria:**

- [ ] At all six presentations, the first scan is deployment → mode/run state →
      blocker → signals/candidates → positions; configuration remains tertiary.
- [ ] Desktop shows the internal Algo rail and no global Algo Monitor; tablet
      and phone keep settings closed until explicitly opened.
- [ ] Signal and position content remain contained with no document overflow,
      clipped controls, or inaccessible offscreen actions.
- [ ] Candidate and position handoffs open the expected Trade review state with
      selected symbol/contract identity preserved.
- [ ] Opening and canceling the live switch confirmation records zero protected
      mutations; the test never presses Confirm or enables live trading.
- [ ] Runtime errors, unknown reads, and protected mutations are all empty.

**Verification:**

- [ ] `pnpm exec playwright test e2e/algo-operational-hierarchy.browser-validation.spec.ts --reporter=list`
- [ ] `pnpm exec playwright test e2e/design-doctrine-matrix.browser-validation.spec.ts --grep "algo ·" --reporter=list`

**Dependencies:** Tasks 1–5.  
**Files likely touched:**

- `artifacts/pyrus/e2e/algo-operational-hierarchy.browser-validation.spec.ts`
- Evidence-backed component files only if the fixture exposes a real layout gap.

**Estimated scope:** Medium.

## Checkpoints

### Checkpoint A — After Task 1

- [ ] Risk-unit browser cases are green at 390/768/1440.
- [ ] Fixture has no unknown reads and no protected mutations.

### Checkpoint B — After Tasks 2–5

- [ ] Focused source/component suite is green.
- [ ] Shadow/live and running/paused remain separate states.
- [ ] No Algo candidate action uses Submit vocabulary.
- [ ] The empty state has no duplicate placeholder-only form.

### Checkpoint C — After Task 6

- [ ] Active-data fixture is green in six presentations.
- [ ] Empty-state doctrine matrix remains 6/6.
- [ ] Dark/light hierarchy, keyboard access, touch targets, reduced motion, and
      table containment are verified.
- [ ] UX-18 may then be checked off on the completion board.

## Final Validation Commands

Run serially after checking the workspace memory gate:

```bash
cd artifacts/pyrus
node --import tsx --test \
  src/screens/AlgoScreen.test.mjs \
  src/screens/algo/*.test.mjs \
  src/screens/algoCockpitDiagnosticsModel.test.mjs
pnpm exec playwright test \
  e2e/algo-operational-hierarchy.browser-validation.spec.ts \
  --reporter=list
pnpm exec playwright test \
  e2e/design-doctrine-matrix.browser-validation.spec.ts \
  --grep "algo ·" \
  --reporter=list
pnpm run audit:design
```

Run the broader typecheck/build only after the focused UX-18 gates pass and the
shared memory budget permits it. Report unrelated dirty-tree failures
separately; do not broaden UX-18 to repair them.

## Not In Scope

- ELU, API latency, resource pressure, stream breadth, or chunk-loading bugs.
- Signal/candidate math, MTF eligibility, position-marking, or trading policy.
- Backend routes, schemas, persistence, or broker readiness semantics.
- Changing the server’s force-pause-on-live contract.
- Changing risk-unit calculations or save behavior beyond regression coverage.
- Backtest/UX-19 work.
- Refactoring the global Algo Monitor; current source already hides it on the
  primary Algo route, so UX-18 only adds a regression assertion.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Concurrent runtime work changes Algo data semantics | High | Do not edit `algoHelpers.js`, its tests, or backend files; re-read the runtime handoff before each implementation tranche. |
| A safety-looking browser test accidentally mutates | High | Use the normal URL with a route-level mutation firewall; inspect and cancel confirmation only. |
| Dense mobile controls regress table readability | Medium | Use the existing compact row layout and change only the action target/allocation; verify at 390 and measured tablet width. |
| Fixture drift hides a new legitimate read | Medium | Confirm every route from source/generated clients before adding it; keep unknown reads fatal. |
| UX-18 turns into a cockpit redesign | Medium | Preserve the existing hierarchy and components; make only the four named UX corrections plus evidence-backed layout fixes. |

## Plan Approval Gate

Implementation starts only after the user accepts this task order. No staging,
commit, push, backend change, or live control use is part of this plan.

## Completion Evidence — 2026-07-22

- The complete focused Algo source suite is green: 255/255.
- The operational fixture is green in one clean run: 9/9, covering the three
  risk-unit layouts plus the six active phone/tablet/desktop dark/light
  presentations.
- The independent Algo design-doctrine matrix is green: 6/6.
- The design-conformance guard passes.
- Browser QA reproduced and fixed one phone-only containment defect. The 473px
  operations-header monitor leaked into a 378px main column; the phone monitor
  now shrinks to the available width and scrolls locally while mode and run
  state remain fully visible on the initial scan.
- Every operational presentation asserts zero protected mutations, zero
  unknown reads, and zero runtime errors. The suite opens and cancels the live
  confirmation but never confirms it or enables live trading.
- No backend, account-targeting, risk-calculation, or trading-policy semantics
  changed in UX-18.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | Not run | Existing approved UX-18 scope was preserved. |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | Not run | No outside review requested. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | Not run | UX-only implementation changed no architecture or runtime semantics. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | Clean | Score remained 9/10; one phone containment defect was found and fixed. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | Not applicable to this UI workstream. |

- **UNRESOLVED:** 0 UX-18 design decisions.
- **VERDICT:** DESIGN CLEARED — implementation and six-presentation validation complete.
