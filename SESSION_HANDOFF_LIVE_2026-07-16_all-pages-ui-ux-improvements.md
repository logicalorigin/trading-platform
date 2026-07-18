# Live Session Handoff — All-Pages UI/UX Improvements

- Status: superseded by `SESSION_HANDOFF_2026-07-16_019f6b21-3956-7d02-bf1d-0628ec47e090.md`; retained as the detailed pre-persistence recovery note.
- Session ID: `019f6b21-3956-7d02-bf1d-0628ec47e090`
- Updated At (MT): `2026-07-16 10:15:41 MDT`
- Updated At (UTC): `2026-07-16T16:15:41Z`
- CWD: `/home/runner/workspace`
- Branch: `main`
- HEAD: `d744a4ad8002fab0dcc79eae1227811ed50c8ce3`
- Runtime: live pid2-owned supervisor observed as PID `130`; no reload performed
- User request: resume the existing design work and continue iteratively across all pages, features, and elements to improve UI and UX; use `interview-me` for decisions that materially affect intent.

## Restored Context

- Relevant prior design handoff: `SESSION_HANDOFF_2026-07-15_019f6733-f245-7d91-a919-1fc3a19b3711.md`.
- That lane had restored and validated the Account/mobile work, then moved to a rendered Market Demo audit at phone, tablet, mid, and desktop widths.
- Prior validation recorded 31/31 focused Account/design/loader tests, PYRUS typecheck, live health HTTP 200, and same supervisor PID.
- Current tree is heavily shared and dirty: `git diff --shortstat` currently reports 302 tracked files changed, 33,097 insertions, and 8,310 deletions; `git status --porcelain=v1` reports 229 untracked entries from many concurrent lanes.

## Current Step

- Context restoration and the `interview-me` intent gate are complete. No product code, Replit startup config, runtime process, staging area, or commit has been changed.
- Confirmed intent: keep the permanent UI dense and expert-first; improve scanning, confidence, consistency, responsiveness, and accessibility; build a separate reusable onboarding layer with required safety/setup essentials plus dismissible, resumable, replayable goal-based walkthroughs and wizards.
- Confirmed safety boundary: onboarding may teach, highlight, or simulate but must never bypass normal review/confirmation or submit live orders automatically.
- The read-only route, design-system, onboarding-state, runtime, and ownership audits are complete. The dependency-aware implementation plan is now written at `docs/plans/pyrus-ui-ux-onboarding-program-2026-07-16.md`, has been adversarially re-reviewed through multiple fresh-context passes, and remains draft pending D2/D4/D6/D7/D8, interactive visual/mockup review, and human approval.
- D1 is confirmed: safety acknowledgement plus honest readiness inspection gates only the optional guided tracks; it never blocks the workspace, never requires an already-connected account, and never supersedes execution gates.
- No product code, Replit startup config, runtime process, staging area, or commit has been changed in this planning tranche. Only the plan and this live handoff were edited.
- The plan now includes an implementation-grounded visual anatomy/mockup brief for the dense goal picker, required safety steps, compact active guide, target outline, and visually distinct synthetic Practice Lab. The design skill remains paused at its mandatory Step-0 user response; no mockups have been generated or approved yet.
- D3 is now a source-derived safety invariant: the walkthrough hands off to existing provider controls and never owns a second provider state/default/automatic action. D5 is a source-derived scope invariant: operator/infrastructure setup remains outside required end-user learning.
- The plan now includes the exact v1 copy/state contract for the picker, guide, safety essentials, synthetic Practice Lab, persistence/auth identity, invitation/version updates, readiness, missing targets, switching, and prohibited claims. Safety/practice copy is baseline; D2/D4/D6/D7/D8-dependent copy remains explicitly recommended, not approved behavior.
- New source checks disproved the prior cross-provider execution-ready assumption: generated `BrokerAccount` has no `executionReady`, and provider sync mutation results/unkeyed browser state are not valid tutorial authority. Recommended D7 therefore completes Connect Account only from a current-user connected/authenticated provider plus current account, explicitly without claiming execution permission.
- New source checks also proved broker-management UI is admin-only. Recommended D8 keeps Signal/Practice/Risk education available to every authenticated role while rendering Connect Account non-actionable with the closed role reason for ineligible users; this is pending user approval.

## Worker Result Ledger

| Worker | Assignment | Scope | Expected | State | Leader Action |
| --- | --- | --- | --- | --- | --- |
| `/root/route_inventory` | A1 + plan re-review | Read-only route/page inventory and exact plan-path/command verification | Route map, dependencies, validation corrections | complete | Verified 11 visible screens + hidden Market alias, readiness matrix, exact T2.9–T2.11 paths, browser-auth mechanism gap, and executable reload requirements |
| `/root/onboarding_audit` | A2 + plan re-review | Read-only onboarding architecture and adversarial state/security review | Reuse map, identity/persistence/safety blockers | complete | Verified simulator boundary, identity bleed risk, and final plan corrections for exact per-user pending storage, truthful v1 conflict behavior, and a named runtime-facts adapter |
| `/root/design_system_audit` | A3 + plan re-review + exact picker/guide copy | Read-only design-system audit and design-plan scoring | Cross-page consistency map, plan quality score, exact content deck | complete | Re-scored the plan, supplied canonical goal/guide/missing-target copy, and exposed three pre-code anchor/model gaps; the plan now uses parent `signal-evidence` / `account-risk-context` anchors, a dedicated `account-active-source`, and emits no unsupported `Not applicable` state |
| `/root/pure_model_spec` | Exact T1.1 model/catalog specification | Read-only source-grounded reducer, migration, and test contract | Minimal exports, exact catalog/test matrix, contradiction review | complete | Incorporated bounded defaults/history/serialization, one active pointer, independent notice pairs, stable-ID/replay/update rules, pure catalog authority, and the 13-case reducer matrix |
| `/root/plan_final_audit` | Adversarial final plan audit | Read-only source and internal-consistency pass | Concrete blockers only | complete | Exposed and prompted fixes for cross-provider readiness, admin-only applicability, empty/stale anchors, BottomSheet labels/focus, production-action progression, practice transitions, notification identity/update ownership, QA artifact privacy, performance coverage, and stale asynchronous step completion |
| `/root/plan_consistency_reaudit` | Fresh-context current-plan audit | Read-only Ponytail-full consistency/source pass | Remaining blockers or `DONE` | complete — `DONE` | Prompted the unified Safety-version commit point, canonical readiness vocabulary, A→B→A cache-generation proof, exact browser allowlist precedence, and complete Data/Provider/Account runtime-state copy; the final current-file scan found no remaining blocker |
| `/root/handoff_truth_audit` | Durable handoff truth audit | Read-only plan/repo/runtime comparison | Stale or missing handoff facts | interrupted after factual delta | Confirmed stale line/task/tree counts and the goal-picker slice wording; the leader refreshed those facts and independently re-ran counts, whitespace, runtime, HEAD, and tree checks |

## Audit Decisions and Findings

- Route inventory: 11 visible authenticated screens (`market`, `signals`, `flow`, `gex`, `trade`, `account`, `research`, `algo`, `backtest`, `diagnostics`, `settings`) plus hidden `market-demo`, which now renders the same promoted production Market implementation.
- Navigation/readiness: preserve the existing `handleSetScreen` / visible-screen-store path, at most two retained inactive screens, and the canonical readiness sequence (`platform-screen-stack`, boot overlay hidden, active `screen-host-*`, route-owned anchor).
- Onboarding architecture: create one dependency-free authenticated `OnboardingHost` at the shell overlay boundary; use versioned per-user preference progress; reuse Radix Dialog/BottomSheet/Drawer and current focus semantics; use stable onboarding anchors only in the active screen host.
- Onboarding practice: a local reducer/view with fixed synthetic order data, zero fetches, no `TradeOrderTicket`, no generated mutation hooks, no `platformJsonRequest`, and no live or Shadow submit/review handler. Safe QA is explicitly not the protection boundary.
- Design-system findings: typography roles have conflicting CSS/JS values; responsive authority is fragmented; Research duplicates host/header/test-ID responsibilities; `DockedSheet` reduced-motion coverage has a deterministic gap; Market calendar activity uses an incorrect positive tone; shared `Stat` uses the wrong data font.
- Validation gap: existing source guards are broad but rendered all-route coverage is sparse. The program needs a truthful 390x844 / 768x1024 / 1440x900, dark/light, keyboard/reduced-motion route matrix built incrementally.
- Ownership: shared integration files are currently modified (`AppContent`, `PlatformApp`, `PlatformScreenRouter`, `PlatformShell`, `AppHeader`, `SettingsScreen`, `useUserPreferences`, Trade files, and others). New `features/onboarding/` files are unowned, but shell/preferences/navigation integration requires a fresh owner check before editing.
- The revised plan now has an explicit coverage ledger for signed-out auth, shared shell/overlays/states, onboarding, all 11 routes, the hidden Market alias, and each cross-screen handoff.
- The revised plan uses normal-mode authenticated QA by default. `?pyrusQa=safe` is reserved solely for a separately named contract test of safe-QA behavior itself.
- Exact plan contracts now include immutable-user-keyed pending onboarding storage, last-confirmed-write-wins v1 cross-device behavior, a closed read-only runtime-facts adapter, stable route readiness anchors, five-or-fewer-file slices, and executable SIGUSR2 health/PID verification.
- Goal-picker design is one instrument checklist surface with a flat readiness band and four hairline-separated button rows, not per-goal cards. Tablet uses a 560px dialog; phone uses the existing BottomSheet.
- The active guide is a 344px nonmodal region placed within the measured active screen stack. Phone floats 8px above the measured bottom nav and moves above the target when needed; it does not consume the shell’s primary workspace. A static noninteractive rectangular outline provides the target cue without a spotlight mask or page scrim.
- The Practice Lab uses fixed synthetic account/asset/quote data, local BUY/SELL + quantity + MARKET/LIMIT validation, an inline review ledger, and repeated no-send language. It explicitly avoids Trade’s docked placement and all Place/Submit/Fill/broker-preview language.
- Copy truth is now testable: `Synced` requires a successful active-user response and no newer local pending state; the plan prohibits cross-device/cloud/merge/readiness claims the API cannot prove. Auth switching immediately detaches prior-user progress and runtime facts.
- Goal rows use one whole-row action with operational state separate from a deterministic `Recommended` ranking badge. The authenticated role now supplies one closed D8 applicability authority: `provider-setup-unavailable-for-role`; no other applicability reason may be invented.
- The final content audit found that `signal-freshness` + `signal-gates` and `account-exposure` + `account-position-risk` would violate the one-anchor step model. The plan now specifies encompassing parent anchors and a dedicated active-source anchor instead.
- D6's current recommendation now avoids a confirmation dialog for reversible goal switches: the current track pauses, history is retained, pre-action copy explains the result, and a truth-specific announcement reports it. This remains pending user confirmation.
- A missing implementation owner was corrected: `OnboardingGoalPicker.tsx`, its test, and the narrow `BottomSheet.jsx` accessibility extension now form a separate three-file slice; the host slice owns only guide placement/outline/shell integration. Overlay prerequisites explicitly cover Command Palette and Notifications Escape coordination before onboarding mounts.
- Final visual-plan verification corrected four additional specifics: BottomSheet gets an optional accessible description in the goal-picker slice; `essentialsComplete` explicitly requires both boundary acknowledgement and readiness inspection; rendered guide geometry/obstacle/Escape proof is its own five-file slice; and the Practice Lab browser deny-layer test replaces a redundant source-only security test without exceeding the file cap.
- The current plan adds per-user notification ring/read-state isolation before any invitation, a D6-required safety-update row independent of D2, and a separate conditional host integration if trusted auto-open is ever approved.
- The current plan also isolates all application React Query state behind a fresh inner client for every immutable identity/role/entitlement generation while auth remains on a small outer client. A→B→A and A→signed-out→A must construct new application clients, so fixed generated broker query keys cannot revive prior-user facts.
- Generic preference Reset and cross-tab cache events preserve the active user’s normalized onboarding subtree. Only explicit onboarding actions change that subtree; shared `pyrus:state:v1` remains non-onboarding state, and v1 makes no cross-device merge claim.
- Runtime copy and precedence are now closed separately for Data, Provider, and Account. Connect completion uses `account.connection-verified`; configured/connected states never claim execution readiness, and stale/error/loading facts never silently satisfy completion.
- Every asynchronous completion action carries its originating track and step and is a no-op after a switch. The two Safety version fields advance together only after successful `Finish essentials`, not when an earlier acknowledgement step is clicked.
- The Practice browser deny layer uses an exact method-plus-normalized-path GET allowlist, including canonical read-only readiness/account paths that happen to live under a `broker-execution` namespace. Every unlisted GET, mutation outside the bounded preferences PATCH, order-lifecycle/connect/sync/import action, form, beacon, OAuth callback, or external navigation fails the test.
- Required data anchors now publish a closed `loading|ready|empty|error|stale` presentation state. Only ready required anchors can advance; retained empty wrappers derive an honest temporary Unavailable/Retry state and never imply zero risk or usable signal data.
- Production actions have a deterministic rule: onboarding may navigate canonically, then only observe a trusted activation within the current unique anchor and the declared next ready postcondition. It never invokes provider/selection/order handlers or creates a global event bus.
- The QA plan now requires an outside-repo mode-0600 storage state and mode-0700 artifact directory under umask 077, non-sensitive/masked authenticated fixtures, preferences-GET overrides for nonmutating theme/app-motion variants, redaction/expiry, strict mutation aborts, plus existing bundle and all-screen waterfall audits.

## Product Decisions Pending

1. D2: invitation-only v1 unless a trusted server new-user fact is approved; recommended discoverability is one nonblocking versioned notification that never auto-opens, plus permanent Command Palette / phone More replay.
2. D4: canonical server preference state plus exact per-user pending key; choose truthful last-confirmed-write-wins v1 or authorize a new merge/CAS contract.
3. D6: one active track; recommended reversible switching pauses without a confirmation dialog and preserves history; Close/Escape pauses; versioned required-copy changes use a nonblocking notification and never block the workspace.
4. D7: recommended Connect completion is a current-user connected/authenticated provider plus current account, explicitly not execution readiness.
5. D8: recommended audience is all authenticated roles, with Connect Account unavailable/non-actionable for roles that cannot manage broker connections; applicable completion counts adjust honestly.

D1 is confirmed. D3 and D5 are source-derived invariants, not pending choices.

## Next Step

1. Resolve D8, D7, D2, D4, and D6 one at a time with `interview-me`; D8 is next because it determines whether the goal catalog is universal or operator-scoped.
2. Run the interactive visual plan review and onboarding mockup comparison, then obtain human plan approval.
3. After approval and a fresh ownership snapshot, implement only bounded vertical slices in dependency order: pure onboarding model/catalog/runtime facts, identity-safe persistence, shared design authority, then the read-only Signals pilot before the other anchored tracks.

## Validation Status

- Observed: `http://127.0.0.1:8080/api/healthz` returned HTTP 200; the pid2-owned `runDevApp.mjs` supervisor remains PID `130`; no reload was performed.
- Observed: an isolated gstack browser daemon loaded the normal signed-out route at `http://127.0.0.1:18747/`; the sign-in form became visible with no console errors. Readiness timing was TTFB 80 ms, DOM ready 649 ms, total 735 ms. Responsive screenshots were captured at 375x812, 768x1024, and 1280x720 under `/tmp/pyrus-design-audit/`.
- Observed: `pnpm --filter @workspace/pyrus audit:design` passes. A broader 73-test design/a11y/motion source-guard run reported 71 passing and two regex mismatches in Backtesting and Photonics mobile layout guards; rendered regressions are not established.
- Observed: `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/initialPlatformScreen.test.mjs` fails before tests run because the modified test imports `readPlatformScreenFromSearch` and `writePlatformScreenHistory`, but `initialPlatformScreen.ts` does not export them. This is concurrent unvalidated WIP and is outside the first editable tranche unless ownership is resolved.
- Observed from route-admission and Trade integration source: `pyrusQa=safe` is not a tutorial safety sandbox and does not block protected execution routes. The planned simulator must remain entirely disconnected from real ticket/API/broker mutation owners and be tested with a browser deny layer.
- Observed at 2026-07-16T14:30Z: API health HTTP 200, normal web HTTP 200, and the live pid2-owned supervisor remains PID 130; no reload was performed.
- Observed: plan path references were checked; every currently absent file in a Files list is either explicitly marked new or is created by an earlier dependency task. `git diff --no-index --check` reports no whitespace errors for the plan.
- Observed at 2026-07-16T16:15:41Z: API health HTTP 200, normal web HTTP 200, and the live pid2-owned supervisor remained PID 130 before and after the probes; no reload was performed.
- Observed at 2026-07-16T16:12:31Z: the latest plan has 1,305 lines and 60 numbered/checkpoint task entries. It has 53 ordinary `Files` rows plus one conditional `Files if approved` row; all 54 enumerated slices contain at most five files. The latest plan and handoff whitespace checks remain clean.
- Observed ownership snapshot: among near-term planned shared paths, `DESIGN.md`, `artifacts/pyrus/package.json`, `index.css`, `lib/uiTokens.jsx`, `AppHeader.jsx`, `PlatformShell.jsx`, and `useUserPreferences.ts` are modified. The checked typography/responsive, overlay, command/More/notification, preference-model/server, and onboarding-new-file paths remain clean or absent; clean does not establish ownership.
- Not yet run: authenticated normal-route interaction QA, current full PYRUS typecheck/build, or sanctioned reload.
- Blocker before product-code editing: D8/D7/D2/D4/D6, interactive design-plan focus/mockup review, human plan approval, and exact file ownership remain unresolved. Planning/handoff edits only; no product code has been authorized in this lane.
