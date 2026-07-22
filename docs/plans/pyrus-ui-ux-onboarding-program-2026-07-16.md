# PYRUS UI/UX and Onboarding Program

Status: **FOUNDATION + CONNECT ACCOUNT PILOT APPROVED; broader program remains DRAFT**

Date: 2026-07-16

Owner: active Codex design session

Doctrine: [`DESIGN.md`](../../DESIGN.md) is authoritative when code, tests, or this plan conflict.

## Objective

Improve every PYRUS user-facing surface as one continuing program while preserving the product's expert-first information density, operational trust, and live-trading safeguards. Add a separate onboarding layer for new users with required safety/setup essentials and resumable, dismissible, replayable, goal-based walkthroughs and wizards.

This is not a one-shot visual rewrite. It is a sequence of route-owned vertical slices, each leaving a verified improvement and preserving the existing execution boundaries.

## Success Criteria

The program is complete only when all of the following are current-state facts:

- The permanent workspace remains dense, fast, and expert-first; onboarding does not dilute the production UI.
- New-user safety/setup essentials and four goal tracks are implemented, accessible, resumable, replayable, and versioned per user.
- Tutorial order practice is a local simulation that owns no network client and cannot create live or Shadow orders. Its host may persist only bounded onboarding progress through the existing authenticated preferences route.
- Every visible route plus signed-out authentication has been audited at 390×844, 768×1024, and 1440×900 in light and dark themes.
- Every migrated surface specifies and verifies loading, empty, error, success, partial, and stale behavior where applicable.
- Keyboard navigation, focus behavior, screen-reader semantics, reduced motion, contrast, and phone touch targets conform to `DESIGN.md`.
- Cross-screen user journeys continue to work: Signals → Trade, Flow → Trade, Research → Trade, Account → Trade, Algo candidate/position → Trade, Backtest → Algo, and Shadow Algo → separately confirmed live controls.
- Focused tests, relevant browser checks, PYRUS typecheck/build, sanctioned runtime reload, live health, and same-supervisor verification pass for each implementation tranche.
- The durable session handoff and this plan remain current as evidence changes.

## Confirmed Product Intent

- Permanent UI: expert-first, dense, calm, fast, and high-trust.
- Onboarding: a separate layer, not beginner copy embedded across permanent screens.
- Walkthrough shape: task-based goals, not a linear page tour.
- Goal tracks: connect a broker/account, read a signal, practice placing/reviewing a trade safely, and manage risk.
- Progress: closable/pausable at any time; optional goals unlock after required essentials, and every goal is resumable and replayable.
- Safety: guidance may explain, highlight, prefill synthetic fields, or simulate; it never bypasses review/confirmation and never submits a live order automatically.
- Questionnaire boundary: the initial product questionnaire is shown once during initial setup/deployment. Later onboarding and runtime status derive from current server-owned account, connection, deployment, and preference facts; they never ask the user to rerun that questionnaire or treat its old answers as live readiness.
- Explicit non-goals: decorative spaciousness that slows operation, generic dashboard card grids, a long forced tour, or beginner-ifying the trading workstation.

## Decision Register

D1 and D8 were confirmed on 2026-07-16. D2 and D7 were confirmed by the
user on 2026-07-18 for the foundation and Connect Account pilot. D3 and D5
are source-derived safety/scope invariants. D4 and the pilot portion of D6
are bounded engineering ceilings for this staged implementation; broader
cross-device merge and future-version notification policy remain outside the
pilot approval.

| ID | Decision | Recommended draft | Why it matters | Status |
| --- | --- | --- | --- | --- |
| D1 | What does “required” block? | `essentialsComplete = safety boundary acknowledged + readiness inspected`. That gate controls optional learning tracks, never the workspace. A verified account connection is not required, and Connect Account becomes startable for an authenticated user after essentials even while disconnected/unknown. Existing execution gates remain the only live-trading authority. | Avoids a circular setup gate and prevents onboarding progress from becoming a security control. | Confirmed 2026-07-16 |
| D2 | Existing-user rollout and opening cadence | Auto-open Getting Started once per authenticated user and catalog version, only after the exact identity, workspace, and server-confirmed preferences settle. Defer while any blocking dialog is present. Persist `autoOpenShownVersion` and retain Command Palette / phone More as permanent replay paths. This is a versioned all-user opening contract, not an inference that the user is “new.” | Provides the requested automatic first entry without opening on unresolved identity/preferences or over another modal surface. | Confirmed 2026-07-18 |
| D3 | Broker starting path | The wizard hands off to the existing provider-choice controls; it does not own a second provider state machine or hard-code a default broker. | The current panel owns multiple provider-specific readiness, OAuth/connect/sync/disconnect mutations, and one shared card lifecycle. Duplicating or auto-driving it would violate the confirmed execution boundary. | Source-derived safety invariant 2026-07-16 |
| D4 | Progress sync, identity, and v1 conflicts | Canonical progress uses the per-user server preference record after both database and configured fallback paths are proven user-keyed. Unsynced bounded tutorial progress is stored only under `pyrus:onboarding:v1:${user.id}`, never shared `pyrus:state:v1`; it is removed after confirmed sync and is inaccessible until the same immutable user authenticates again. Remote state is explicitly idle/loading/confirmed/failed. Cross-tab/device conflicts use truthful last-confirmed-write-wins behavior in v1; no unsupported merge/CAS guarantee. | Identity/fallback isolation is a security invariant. The pilot deliberately stops at truthful last-confirmed-write-wins; a future merge/CAS contract would be a separate expansion. | Pilot v1 engineering ceiling 2026-07-18 |
| D5 | Operator-only setup | Keep Flex/schema/history and infrastructure health in advanced/operator setup, outside the required end-user path. | LoginGate explicitly calls first-run bootstrap an operator account, while Settings owns runtime/diagnostic/storage controls. Treating either as user onboarding would conflate account administration with product learning. | Source-derived scope invariant 2026-07-16 |
| D6 | Pause, switching, and version bumps | Pilot: one active track; starting another pauses the current track; Close/Escape pauses; fresh runtime drift reopens only the affected runtime step; explicit replay resets the current pass while retaining bounded history and prior completion time. A later required-copy/version-notification policy is not part of this pilot approval. | Makes pause, drift, and replay truthful without deleting prior completion evidence or turning onboarding into an access gate. | Pilot v1 engineering ceiling 2026-07-18; future update notices pending |
| D7 | What proves the Connect Account goal is complete? | Complete when a current-user provider connection is authenticated/connected and that provider exposes at least one current account through an existing server-owned read surface. Call this `account.connection-verified`; do not claim execution readiness. Existing order-specific execution gates remain separate and authoritative. | The generated cross-provider account response has no `executionReady` field. SnapTrade/Robinhood/Schwab sync mutations do, but tutorial state must not trust a mutation result or unkeyed browser cache. Connection-plus-account truth matches the goal without expanding it into permission to trade. | Confirmed 2026-07-18 |
| D8 | Who receives the Connect Account track? | Every authenticated user role receives the Connect Account track and can manage self-scoped connections. Connection management is not admin-only. The production surface follows the existing signed-in `broker_connect` entitlement authority plus provider-specific compliance gates; role alone never makes the track inapplicable. | The server already separates user-scoped connection lifecycle from admin-only order submission. The stale frontend `role === "admin"` guard was corrected to mirror the existing entitlement authority. | Confirmed 2026-07-16 |

No implementation may convert an unresolved broader-program recommendation into
product behavior without approval. The staged foundation and Connect Account
pilot may implement the confirmed/ceiling contracts recorded above.

## Evidence Baseline

### Observed

- The authenticated product has 11 visible screens: Market, Signals, Flow, GEX, Trade, Account, Research, Algo, Backtest, Diagnostics, and Settings.
- `market-demo` is a hidden alias that renders the promoted production Market implementation.
- The normal local web URL is `http://127.0.0.1:18747/`; API health is `http://127.0.0.1:8080/api/healthz`.
- The live pid2-owned `runDevApp.mjs` supervisor was PID 130 at audit time; no reload was performed.
- The signed-out route rendered at phone, tablet, and desktop sizes with no console errors in an isolated browser daemon.
- `pnpm --filter @workspace/pyrus audit:design` passes.
- A broader 73-test design/a11y/motion source-guard run has 71 passes and two stale regex failures. The failures do not prove rendered defects.
- The current `initialPlatformScreen.test.mjs` is concurrent incomplete WIP: it imports URL-history helpers not exported by `initialPlatformScreen.ts`.
- Shared route and UI integration files are heavily modified by other work. Ownership must be rechecked immediately before every edit.
- There is no current application onboarding, walkthrough, coachmark, wizard, or Getting Started implementation.
- Radix Dialog-based BottomSheet, Drawer, ConfirmDialog, Toast, Tooltip, and overlay patterns already exist and cover most accessibility mechanics needed by onboarding.
- `pyrusQa=safe` does not block protected execution routes. The real order ticket owns live and Shadow mutation handlers and receives no safety prop that makes it a tutorial sandbox.
- Client preference caching is not currently per-user: `pyrus:state:v1`, module-global preference state, and module-global remote-load flags survive account changes. Onboarding cannot use that shared optimistic cache.
- The current generic Settings `Synced Preferences → Reset` path PATCHes the entire default preference object. If onboarding is added naively, that unrelated action would erase goal history and notice versions and could resurface invitations; generic preference reset must preserve the onboarding subtree.
- The application-wide React Query client also survives identity changes, while generated user-scoped broker/readiness query keys do not include `user.id`. Logout refreshes auth and marks all queries stale, but it does not cancel/remove cached query data or clear mutation results; there is no identity cache boundary. A new user must not render prior-user cached rows before refetch.
- Server fallback preference storage is normally user-keyed, but a nonempty `PYRUS_USER_PREFERENCES_FILE` currently replaces it with one unkeyed shared path. That override must be made user-keyed before onboarding can claim fallback isolation.
- The auth session exposes immutable user ID, email, display name, role, and entitlements, but no account-created/new-user/onboarding-eligibility fact. Missing progress cannot identify a new user.
- The notification store keeps toast entries in one module-global ring buffer and persists one device-global `pyrus.notifications.lastReadAt.v1`; neither resets by authenticated identity. Existing toast rows/read state must be isolated before a versioned onboarding invitation can safely use that drawer.
- `SnapTradeConnectPanel` owns provider discovery plus provider-specific readiness and connect/sync/disconnect actions for SnapTrade brokerages, Robinhood, Schwab, and IBKR Client Portal. Onboarding can observe and hand off to those controls but cannot safely duplicate or auto-drive them.
- The generated cross-provider `BrokerAccount`/`AccountsResponse` contract has no `executionReady` field. Provider-specific sync mutation responses expose it, and SnapTrade mirrors a selected execution account into an unkeyed browser store, but neither is safe tutorial completion authority. Existing current-user `BrokerAccountInclusionResponse` plus provider-readiness surfaces can instead prove connected/authenticated provider state and account presence without claiming permission to trade.
- Broker connection/read lifecycle routes are authenticated, self-scoped, and gated by the existing `broker_connect` entitlement; provider-specific gates such as IBKR compliance remain separate. `SnapTradeConnectPanel` now mirrors that authority through `authSession.hasEntitlement("broker_connect")`, so member and admin roles are not split by a frontend role guard.
- LoginGate explicitly describes first-time bootstrap as creation of the operator account, while Settings owns runtime, diagnostic, storage, and infrastructure controls. Those are not end-user safety essentials.
- `DESIGN.md` excludes backend/API changes from the original visual-rollout scope. Persisting onboarding inside the existing per-user preferences JSON contract is therefore a bounded, explicit exception required by this newly approved product feature: it adds no table, route, or generated/OpenAPI contract, but it does extend the authenticated settings-preference request/response JSON payload. Backwards-compatible normalization is required.

### Inferred, requiring rendered confirmation

- Research is the largest cross-page visual outlier because its route host and Photonics implementation duplicate header/test-ID responsibilities and hand-author many surfaces and motions.
- The 768px Research branch is a credible layout risk because route and screen breakpoint systems disagree.
- Market's local KPI/regime treatments may benefit from shared primitives, but migration should follow a fresh render rather than source-only aesthetic judgment.
- The Account phone source-selector implementation/test may conflict with the doctrine's 64px single-row requirement; current evidence is a test assertion, not a fresh render.

### Unknown

- Authenticated normal-route visual quality across all screens in the current shared worktree.
- Whether a later release needs merge/CAS semantics beyond the pilot’s truthful last-confirmed-write-wins ceiling.
- How a future required-safety copy/version update should notify users; this is not part of the approved pilot.

## What Already Exists and Must Be Reused

- Design tokens and doctrine: `artifacts/pyrus/src/index.css`, `lib/uiTokens.jsx`, `lib/typography.ts`, `lib/responsive.ts`, and root `DESIGN.md`.
- Shared UI primitives: `components/platform/primitives.jsx`, `BottomSheet.jsx`, `DockedSheet.jsx`, `components/ui/ConfirmDialog.jsx`, `Button.jsx`, Tooltip, Popover, Drawer, Toast, and focus styles.
- Navigation authority: `PlatformShell` → `useVisibleScreenNavigation` → `handleSetScreen`; do not introduce another screen store or event bus.
- Route readiness: `platform-screen-stack`, hidden boot overlay, active `screen-host-${id}`, absent route error, hidden loader/suspense fallback, then a route-owned anchor.
- Preferences: versioned per-user JSON persisted through authenticated, CSRF-protected settings routes with a local cache. The default server fallback is per-user; the configured fallback override is not safe to reuse until T1.2b makes it per-user.
- Connection setup: `SettingsScreen` → Data & Broker → `SnapTradeConnectPanel`; use its existing explicit user actions and readiness models.
- Runtime readiness: authoritative broker/account/session facts; persisted onboarding progress never substitutes for them.
- Reduced motion and touch behavior: existing `.ra-*` motion/touch classes and system/app preference channels.

## Information Architecture

```text
Authenticated workspace
├── Expert workstation (permanent expert layer, improved through route-owned slices)
│   ├── Header / desktop navigation / command palette
│   ├── Phone primary navigation + More
│   └── Active screen host
└── Onboarding layer
    ├── Required safety essentials
    │   ├── Know Live vs Shadow
    │   ├── Know that review/confirmation is mandatory
    │   └── Inspect data + account connection status from authoritative runtime facts
    ├── Getting Started goal picker
    │   ├── Connect and verify an account
    │   ├── Read a signal
    │   ├── Practice an order review safely
    │   └── Manage position risk
    └── Active guide
        ├── Goal + progress
        ├── One current task
        ├── Target outline or honest missing-target fallback
        └── Back / Next / Pause
```

### Visual hierarchy

For the goal picker, users see: (1) readiness/safety status, (2) recommended next goal, (3) other replayable goals. For an active walkthrough, users see: (1) the highlighted production fact or synthetic practice field, (2) one concise explanation, (3) one primary next action. The guide never competes with the workspace by adding a full-page dimming mask during nonmodal steps.

### Presentation contract

- Goal picker and required explanations: accessible Radix Dialog at widths 768px and above; existing BottomSheet below 768px.
- Active walkthrough: compact nonmodal guide card plus a simple outline on a stable `data-onboarding-anchor` inside the active `screen-host-*`.
- No custom spotlight geometry, dark full-screen mask, floating decoration, or third-party tour dependency in v1.
- A missing/non-ready required anchor times out to Retry / Pause and never completes; a missing optional anchor offers Continue without highlight / Pause. Neither traps the workspace.
- Command palette and phone More provide permanent “Open Getting Started” re-entry.

### Visual anatomy and mockup brief

Literal typography values remain role-based until T2.1 reconciles the current CSS/JS scale mismatch. All surfaces use IBM Plex Sans for interface language and values, with tabular numerals preserving data alignment, flat neutral surfaces, hairline separation, semantic status color, and existing `CSS_COLOR`, `RADII`, `ELEVATION`, `textSize`, `dim`, and `sp` tokens.

#### Goal picker — instrument checklist, not cards

```text
┌ Getting Started                         Synced  × ┐
│ Safety reviewed · Data configured · Account setup needed │
├ Choose a goal                                      ┤
│ ◇ Read a signal        Recommended · 0/2         › │
│   Read side, freshness, gates, and thesis           │
├─────────────────────────────────────────────────────┤
│ ◇ Connect an account   Setup needed · 0/3        › │
│   Choose a provider and verify readiness             │
├─────────────────────────────────────────────────────┤
│ ◇ Practice order review        Available · 0/3    › │
├─────────────────────────────────────────────────────┤
│ ◇ Manage position risk         Available · 0/3    › │
└─────────────────────────────────────────────────────┘
```

- One owning modal/sheet, one flat readiness band, and an ordered list of four full-width native-button rows. Do not use `Card`, `SurfacePanel`, `StatTile`, or a nested Start button per goal.
- Reuse Radix Dialog anatomy from `ConfirmDialog` without its confirmation semantics; reuse `BottomSheet` below 768px, `SectionHeader size="sm"`, `Badge`, `StatusPill`, `Button`, `Skeleton`, and `DataUnavailableState`.
- Each row is `16px icon / minmax text / status+progress / 16px chevron` at tablet/desktop and `16px / text / chevron` on phone, where status moves below the description. Icons and chevrons are functional scanning cues, not decorative circles.
- Recommended/current uses `accentHoverBg` plus a text label. Completed uses a green ghost status pill, never a green row fill. Setup needed/Updated uses amber plus words. Unavailable includes the concrete reason and never relies on opacity alone.
- Safety incomplete keeps every goal visible, shows one `Review essentials` primary action, and announces optional rows unavailable. `essentialsComplete` requires both boundary acknowledgement and one honest readiness inspection; Connect Account then becomes startable for an authenticated user even when runtime account connection state is disconnected/unknown.
- Loading preserves one readiness skeleton and four fixed-height row skeletons. Save/load failure preserves the list with one compact Retry warning. All-complete says `4 of 4 goals complete`, without celebration art or motion.
- Desktop 1440×900: centered 620px dialog, max `min(680px, calc(100dvh - 64px))`; 56px header/readiness bands; 60px minimum rows; 14–16px outer padding.
- Tablet 768×1024: centered 560px dialog, max `calc(100dvh - 32px)`; 64px rows and 44px controls. This is a dialog, not an ambiguous tablet sheet.
- Phone 390×844: existing BottomSheet at `84dvh`; stacked readiness band; 72px minimum rows; descriptions may wrap twice; only the body scrolls; no sticky CTA over the phone nav.
- Semantics: `Dialog.Title`/`Description`, `<ol aria-label="Getting Started goals">`, `aria-current="step"` on the active goal, row description/status via `aria-describedby`, and initial focus on Review essentials, Resume, or the recommended goal in that order.

#### Required safety essentials

- Three concise ordered steps inside the same picker container: environment, review boundary, readiness inspection. One step is visible at a time; copy stays utility-first and avoids legalistic walls of text.
- Environment is a two-row comparison, not two cards: `LIVE — can route real orders` and `SHADOW — simulated execution`. Words and stable position carry meaning alongside color.
- Review boundary states `Onboarding never submits. Real execution still requires PYRUS review and confirmation.` The acknowledgement action says `I understand the boundary`, never `Enable trading`.
- Readiness is a read-only ledger of Data, Provider, and Account with loading/ready/setup-needed/stale/error words from the runtime-facts adapter. `Not ready` is allowed and does not fail the essentials.
- The footer offers Back and the one current acknowledgement action. Close/Escape pauses; the workstation remains accessible; optional tracks retain an honest `Review essentials first` state.

#### Active walkthrough guide

- Named nonmodal region with a compact header (`Goal · Step N of M`, sync/status, Pause), one concrete step title, at most two short explanatory sentences, an explicit target label, and Back / primary action. Do not use Tooltip for interactive content.
- Target highlighting is one static rectangular portal layer measured from the stable anchor, expanded by 4px and clamped to the active host/visual viewport. It is `aria-hidden`, `pointer-events: none`, unfocusable, nonanimated, and uses a 2px tokenized accent border plus short corner brackets and a visual `Current step` tab. The guide separately announces the target’s accessible name. There is no spotlight mask, cutout, pulse, or page scrim.
- Desktop/tablet: 344px wide and at most 320px tall, placed inside the measured `platform-screen-stack`, not the viewport. Candidate order is lower-right, lower-left, upper-right, upper-left; choose the first candidate fully inside the stack, clear of the target expanded by 8px and other floating obstacles. Use 16px inset on desktop and 12px on tablet, above the context footer and below modal priority.
- Phone: fixed nonmodal card portaled to `document.body`, 8px left/right, with its bottom edge 8px above the measured `mobile-bottom-nav` top. If it intersects the target, move below the measured header. If both positions collide, scroll the target once with `behavior: "auto"` into the larger free region and remeasure; if still impossible, use the honest missing-target state. This preserves the primary workspace instead of permanently removing 220–320px from shell flow.
- Navigation actions say `Open Signals`, `Open Settings`, or `Open Account`; after canonical navigation, the guide waits for the active host and unique visible anchor. Required-target failure offers Retry / Pause; optional-target failure offers Continue without highlight.
- Modal drawers/sheets/dialogs, command palette, notification drawer, and destructive confirmation suspend both guide and outline. Toasts/nonmodal video remain visible obstacles and cause candidate relocation. Escape closes only the topmost layer. If the opener unmounts, focus restoration falls back to the active route heading.

#### Practice Lab — visually and technically separate from execution

- Title the standalone surface `Practice Lab`, never `Order Ticket`. Repeat `PRACTICE · SYNTHETIC DATA` and `SYNTHETIC DATA · NOTHING WILL BE SENT`; use neutral/accent or cyan identity, not Live/Shadow environment treatments, broker marks, account numbers, readiness/compliance strips, or production submit language.
- Input order: fixed Practice Account (`SIM-001`), fixed synthetic asset (`SPY · Synthetic equity`), fixed simulated quote, intentionally unselected BUY/SELL, whole-share quantity, MARKET/LIMIT, conditional limit price, then `Estimate · synthetic` and `Review practice order`.
- Keep TIF out of the input lesson; show `DAY · practice default` only in review. No broker, buying-power, tax, compliance, margin, fee, fill, or account-readiness validation.
- Desktop: distinct 800–880px onboarding dialog, full-width practice banner, flexible form column plus 280–320px inline review column. Tablet: 640–720px one-column dialog. Phone: one-column BottomSheet/full-width onboarding surface with 16px padding and reserved action space; do not mimic Trade’s docked ticket placement.
- Review order is Account, Asset, Side, Quantity, Type, Price/reference, Estimated value, then `No order will be created or sent.` Actions are `Back to edit` and `Finish practice`—never Place, Submit, Fill, Broker preview, or an order ID.
- Pristine fields show helper text only. On blur/review: associated inline error and `aria-invalid`; Review focuses the first invalid field; estimate remains `—` until valid; editing invalidates prior acknowledgement. Completion says `Practice complete. No order was created.`
- Reuse the visual grammar of `SegmentedControl`, `TextField`, canonical `Button`, and the label/value review grid from `ConfirmDialog`; never import `TradeOrderTicket`, `BrokerActionConfirmDialog`, request builders, API hooks, auth/broker stores, mutation paths, or any preview/submit handler.

#### Rejection checklist for generated mockups

Reject per-goal cards, icon circles, progress rings, centered welcome copy, illustrations, gradients, colored decorative rails, confetti, glass decoration, oversized headings, fake market data, broker branding, or a practice CTA that resembles live execution. The comparison board is not approved until the user selects a variant; this anatomy is the generator brief, not a visual approval.

### Content contract (verbatim v1)

Safety-essential and Practice Lab language below is the broader-program
baseline. For the staged foundation and Connect Account pilot, D2/D7 are
confirmed and the D4/D6 pilot ceilings apply. Future required-safety update
notices and the remaining goal tracks still require their own implementation
review.

#### Goal picker

| Element | Copy |
| --- | --- |
| Title | `Getting Started` |
| Description | `Choose one goal. Pause or close at any time.` |
| Section heading | `Choose a goal` |
| Essentials pending | `Confirm the environment, execution boundary, and current readiness.` |
| Essentials action | `Review essentials` |
| Readiness example | `Safety reviewed · Data configured · Provider connected · Account setup needed` |
| All complete | `4 of 4 goals complete. Replay any goal when you need it.` |

When essentials are incomplete, every optional row says `Review essentials first` and has no row action. `Review essentials` appears once as the container action, never inside every row.

Canonical goal rows:

| Goal | Description | Steps | Action noun |
| --- | --- | ---: | --- |
| `Read a signal` | `Read side, freshness, timeframe agreement, gates, and thesis.` | 2 | `signal review` |
| `Connect an account` | `Open Data & Broker, choose a provider, and verify readiness.` | 3 | `account setup` |
| `Practice order review` | `Build and review a fixed synthetic order. Nothing will be sent.` | 3 | `practice order review` |
| `Manage position risk` | `Inspect exposure, position risk, and the Trade review handoff.` | 3 | `position risk review` |

`Recommended` is a ranking badge, not an operational state. It never replaces `Setup needed`, `Paused`, `Updated`, or `Unavailable`. The badge is deterministic: prefer the active track; otherwise the first paused/updated startable track with progress; otherwise the first startable incomplete track in canonical Read → Connect → Practice → Risk order. Never recommend a prerequisite-blocked, temporarily unavailable, or completed track unless all four goals are complete, in which case no row is recommended.

| State | Visible status | Whole-row accessible action |
| --- | --- | --- |
| Available | `Available · {c}/{N}` | `Start {action noun}` |
| Recommended | Badge `Recommended`; retain the truthful state below it | Same action as the underlying state |
| Active | `Current · {c}/{N}` | `Resume {action noun}` |
| Paused | `Paused · {c}/{N}` | `Resume {action noun}` |
| Complete | `Complete · {N}/{N}` | `Replay {action noun}` |
| Updated | `Updated · {c}/{N}` plus `Prior completion retained.` | `Review updates to {action noun}` |
| Setup needed | `Setup needed · {c}/{N}` | `Start account setup` |
| Unavailable | `Unavailable · {closed reason}` | No Start/Resume/Replay action; a temporary target failure may expose `Retry {action noun}` without advancing |
| Essentials incomplete | `Review essentials first` | No row action |

`Setup needed` applies to every authenticated Connect Account user after essentials. A disconnected or unknown account connection state never disables that row, and role alone never produces an unavailable state. A temporary required-target empty/error result can derive Unavailable from session-local host evidence; it is never persisted, never marks completion, and Retry only revalidates the same step. A production entitlement/provider denial is shown as its current runtime setup error and never converted into a persisted onboarding applicability reason. All-complete copy is always `4 of 4 goals complete`.

#### Active guide

The header is `{Goal} · Step {n} of {N}` with `Pause`. Its compact save label derives from the persistence contract below; it does not maintain an independent optimistic `Synced` flag.

| Goal / step | Title | Body | Target label | Primary action |
| --- | --- | --- | --- | --- |
| Connect 1/3 | `Open Data & Broker` | `Provider and account setup lives in Settings. Open Data & Broker to continue.` | `Data & Broker` | `Open Settings`; after navigation, the existing tab is the target action |
| Connect 2/3 | `Choose a provider` | `Use the existing provider controls. Onboarding will not select or connect a provider for you.` | `Provider controls` | Existing provider control; no duplicate guide action |
| Connect 3/3 | `Verify the connection` | `Read the current broker and account status. Follow the next setup action shown in Settings.` | `Broker readiness` | `Check current status`; under confirmed D7, show `Finish goal` only when `account.connection-verified` is true |
| Signal 1/2 | `Select a signal` | `Open Signals and select a visible row. The evidence drilldown opens from that selection.` | `Signal list` | `Open Signals`; after navigation, a row inside the list is the action |
| Signal 2/2 | `Read the evidence` | `Confirm side, freshness, and timeframe agreement. Then read the gates and thesis.` | `Signal evidence` | `I reviewed the evidence` |
| Practice 1/3 | `Build a synthetic order` | `Use SIM-001 and the fixed synthetic quote. Choose side, whole-share quantity, and MARKET or LIMIT.` | `Practice Lab fields` | `Review practice order` |
| Practice 2/3 | `Resolve local validation` | `Correct each marked field, then compare the synthetic estimate. Nothing is sent while you edit or review.` | First invalid Practice Lab field | `Review practice order` |
| Practice 3/3 | `Confirm the boundary` | `Confirm the synthetic account, inputs, and estimated value. No order will be created or sent.` | `Practice review ledger` | `Finish practice` |
| Risk 1/3 | `Find the active source` | `Open Account and identify the source behind the current portfolio view.` | `Active account source` | `Open Account`; once visible: `I found the active source` |
| Risk 2/3 | `Read the risk context` | `Read concentration and exposure, then inspect one position’s risk context. Missing data is not zero.` | `Account risk context` | `I reviewed the risk context`, enabled only while the unique required target is visibly valid |
| Risk 3/3 | `Confirm the handoff` | `Position actions enter the normal Trade review path. Onboarding does not submit or execute them.` | `Position review handoff` optional | `I understand the handoff` |

Completion announcements:

| Track | Copy |
| --- | --- |
| Safety essentials | `Essentials reviewed. Optional goals are now available. Account readiness remains a separate runtime state.` |
| Read a signal | `Signal review complete. You reviewed side, freshness, timeframe agreement, gates, and thesis.` |
| Connect an account | `Broker account connection verified in Settings. Existing execution gates remain authoritative.` |
| Practice order review | `Practice complete. No order was created.` |
| Manage position risk | `Risk workflow reviewed. Position actions still require normal Trade review and confirmation.` |

The completion action is `Choose another goal`.

Required missing target:

- Title: `Target unavailable`
- Body: `“{Target label}” is not available in the active {screen} view. Retry after the screen finishes loading, or pause this goal.`
- Actions: `Retry` / `Pause`

Optional missing target:

- Title: `Highlight unavailable`
- Body: `“{Target label}” is not available in the active {screen} view. You can continue without the highlight.`
- Actions: `Continue` / `Pause`

Never offer `Continue` for a missing required target or record its completion. Runtime-owned steps do not complete from `Continue`, `Next`, or acknowledgement before their closed runtime fact is true.

Production-control dispatch is bounded and observational. `OnboardingHost` may perform only the catalog’s canonical screen navigation. It never calls a provider, row-selection, connect, sync, or order handler. For a step whose existing production control is the action, the host observes a trusted click or keyboard activation bubbling within the one unique current anchor after the production handler, then waits for the declared next anchor/postcondition on the next render. It advances only when both the activation and postcondition are valid. If the postcondition already exists at step entry, show a manual `Continue with current selection` acknowledgement instead of fabricating a production click. Synthetic events, activations outside the current anchor, disappearing/duplicate targets, or a missing postcondition record no progress. No route-wide event bus or persisted UI-action claim is added.

#### Safety essentials

Container copy:

| Element | Copy |
| --- | --- |
| Eyebrow | `GETTING STARTED` |
| Title | `Safety essentials` |
| Intro | `Review three operating boundaries before starting an optional walkthrough. The workspace remains available.` |
| Progress | `Step 1 of 3` / `Step 2 of 3` / `Step 3 of 3` |

Step 1:

| Element | Copy |
| --- | --- |
| Title | `Live and Shadow` |
| Body | `Verify the execution environment before every order review.` |
| Live label | `LIVE / REAL` |
| Live description | `Can route real orders through the selected broker account.` |
| Shadow label | `SHADOW` |
| Shadow description | `Simulated execution in PYRUS’s internal ledger. No live broker order is created.` |
| Primary action | `Continue` |

Step 2:

| Element | Copy |
| --- | --- |
| Title | `Onboarding has no execution access` |
| Body | `Onboarding never submits. Live execution remains in Trade and still requires PYRUS review and confirmation.` |
| Supporting line | `No walkthrough changes an order or bypasses an execution gate.` |
| Secondary action | `Back` |
| Primary action | `I understand the boundary` |

Step 3:

| Element | Copy |
| --- | --- |
| Title | `Inspect current readiness` |
| Body | `Readiness comes from current system state, not walkthrough progress. Setup-needed, stale, or unavailable states do not block the workspace.` |
| Ledger labels | `Data` / `Provider` / `Account` |
| Status labels | `Checking` / `Live` / `Configured` / `Connected` / `Connection verified` / `Setup needed` / `May be out of date` / `Status unavailable` |
| Footer note | `Not ready does not fail this review.` |
| Loading action | `Checking readiness…` |
| Retry action | `Retry` |
| Secondary action | `Back` |
| Primary action | `Finish essentials` |

Step 3 errors are exactly:

- `Current readiness is unavailable. Retry, or finish with the state shown.`
- `Account setup needed. Connect Account remains available after essentials are complete.`

Completion and pause:

| Element | Copy |
| --- | --- |
| Completion title | `Essentials complete` |
| Completion body | `Optional walkthroughs are available. Workspace access and execution gates are unchanged.` |
| Primary action | `Choose a goal` |
| Secondary action | `Close` |
| Gated goal status | `Review essentials first` |
| Gated goal action | `Review essentials` |
| Pause action | `Pause Getting Started` |
| Close accessible name | `Close and pause Getting Started` |
| Pause notice | `Getting Started paused. Resume from the Command Palette or More.` |

#### Practice Lab

Build state:

| Element | Copy |
| --- | --- |
| Eyebrow | `PRACTICE · SYNTHETIC DATA` |
| Title | `Practice Lab` |
| Intro | `Build and review a synthetic order using fixed practice values. Nothing here reaches Live, Shadow, or a broker.` |
| Persistent banner | `SYNTHETIC DATA · NOTHING WILL BE SENT` |
| Section title | `Build a practice order` |
| Account | `Practice account` / `Fixed synthetic account` |
| Asset | `Asset` / `Synthetic equity` |
| Quote | `Simulated quote` / `Fixed practice snapshot` |
| Side | `Side` / `BUY` / `SELL` |
| Quantity | `Quantity` / `Whole shares only.` |
| Order type | `Order type` / `MARKET` / `LIMIT` |
| Market helper | `Uses the fixed simulated quote.` |
| Limit price | `Limit price` / `Required for LIMIT.` |
| Estimate | `Estimate · synthetic` / `Quantity × practice price` |
| Primary action | `Review practice order` |
| Secondary action | `Pause practice` |

Validation copy is exactly:

- `Choose BUY or SELL.`
- `Enter a quantity.`
- `Enter a whole number greater than 0.`
- `Enter a limit price.`
- `Enter a price greater than 0.`
- Review-attempt summary: `Check the highlighted field.`
- After a reviewed value changes: `Practice values changed. Review them again.`

Review state:

| Element | Copy |
| --- | --- |
| Eyebrow | `PRACTICE REVIEW` |
| Title | `Review synthetic values` |
| Rows | `Account`, `Asset`, `Side`, `Quantity`, `Order type`, `Price` or `Reference price`, `Time in force`, `Estimated value` |
| Time in force | `DAY · practice default` |
| Boundary note | `No order will be created or sent.` |
| Secondary action | `Back to edit` |
| Primary action | `Finish practice` |

Completion and pause:

| Element | Copy |
| --- | --- |
| Eyebrow | `PRACTICE COMPLETE` |
| Title | `Practice complete` |
| Body | `No order was created. Live and Shadow are unchanged.` |
| Primary action | `Choose another goal` |
| Secondary action | `Replay practice` |
| Pause action | `Pause practice` |
| Close accessible name | `Close and pause practice` |
| Pause notice | `Practice paused. Inputs reset. No order was created.` |
| Resume action | `Resume practice` |

Practice Lab must never use `Order Ticket`, `Preview`, `Place`, `Submit`, `Fill`, `Confirm order`, `Cancel order`, broker names, order IDs, or placed/submitted/accepted statuses. These are production-execution terms, not tutorial language.

`Reset practice` appears only during an active incomplete pass and resets the local fields plus current pass through `restart-active-track` with the Practice track ID. A completed pass uses `Replay practice`; it never exposes both Reset and Replay for the same state.

Practice inputs and local review evidence are deliberately volatile and never enter preferences/pending storage. On mounting an incomplete Practice track, the component dispatches `restart-active-track` with the expected Practice track ID before rendering, which also repairs a crash/reload that left Step 1 or 2 persisted. The first review attempt may then complete Build; a valid attempt completes Resolve and opens the local review. `Back to edit`, any edit after review, and `Reset practice` dispatch the track-scoped restart. Pause/Close dispatch the atomic `pause-and-restart-track` so no intermediate write/race can retain volatile review evidence. A stale Practice unmount after the user switches goals is a no-op against the new active track. The current local field values may remain while the component stays mounted after Back, but the user must create a fresh valid review before Finish. Finish is accepted only while the current local reducer owns fresh review evidence and then completes the boundary step. History/prior completion remains bounded and retained, but stale current-pass simulation IDs never resume a review after remount.

#### Persistence and identity (pilot v1 ceiling)

| Proven state | Label | Supporting copy | Action |
| --- | --- | --- | --- |
| Active user known; remote load unresolved; no usable progress | `Checking progress` | `Loading Getting Started progress for this account.` | — |
| Same-user local pending record restored while remote load runs | `Local changes` | `Showing progress saved on this device while PYRUS checks the server.` | — |
| Save request in flight after local pending write | `Saving` | `Your latest progress is saved on this device until the server confirms it.` | — |
| Active-user response confirmed; no newer local pending record | `Synced` | `Server confirmed {relative time}.` | — |
| Confirmed response reports server fallback storage | `Synced` | `Server confirmed {relative time} using fallback storage.` | — |
| Confirmed progress has no completed steps | `Synced` | `No Getting Started steps completed yet.` | — |
| Save failed; same-user pending record exists | `Saved on this device` | `The server has not confirmed these changes.` | `Retry save` |
| Load failed; verified same-user pending storage is writable | `Progress unavailable` | `PYRUS couldn’t load saved Getting Started progress for this account. You can start locally; changes will stay on this device until the server confirms them.` | `Retry` / `Start locally` |
| Local pending storage read/write/remove fails or quota is unavailable | `Not saved` | `Changes are only in this open session and may be lost when it closes. The server has not confirmed them.` | `Retry save` |
| Refresh failed after a confirmed snapshot is visible | `Last confirmed` | `Showing the progress last confirmed by the server {relative time}.` | `Retry` |
| Local changes overlay an older confirmed snapshot | `Local changes` | `These changes are saved on this device. Last server confirmation: {relative time}.` | `Retry save` |
| Local completion is pending save | `Complete · save pending` | `This goal is complete on this device. The server has not confirmed it yet.` | `Retry save` |

Save success announces `Progress saved.` New confirmed state replacing an older visible snapshot announces `Loaded the latest server-confirmed progress.` Do not expose `updatedAt` when it is an epoch/default sentinel; use `No Getting Started steps completed yet.`

`Synced` is truthful only when the response belongs to the current immutable `user.id`, the request succeeded, and no newer local pending record exists. It never means “up to date everywhere.” The confirmed source may be database or server fallback storage; v1 does not claim merge/CAS or universal device freshness.

Auth/identity behavior and copy:

- While auth is unresolved, render no onboarding UI and announce nothing from onboarding.
- Signed out, do not mount the onboarding host.
- On an account switch, detach the prior identity immediately and expose none of its copy, counts, progress, or runtime facts while the next user loads.
- On session expiry, pause without completion and close the onboarding surface. Say `Getting Started paused` and `Sign in again to load or save progress for this account.`
- When the same immutable user returns with pending local state, say `Local progress restored`, `These changes were saved on this device and have not been confirmed by the server.`, and offer `Retry save`.
- For a different user, begin at `Checking progress`; never claim prior progress was discarded, transferred, or restored.

#### Initial opening, future updates, and switching

The approved pilot has no initial invitation row. It auto-opens Getting
Started once per immutable authenticated user and catalog version only after:

- the exact user identity is attached;
- the workspace is ready;
- that user’s preferences have a server-confirmed response; and
- no open dialog or `role="dialog"` surface is present.

Opening records `autoOpenShownVersion` for the active catalog version. A
blocking dialog defers rather than consumes the opening. Failed/unresolved
preferences never trigger it. Command Palette and phone More remain permanent
manual re-entry paths. Copy never calls the user “new” or “eligible,” because
this is an all-user versioned opening contract rather than an inferred
new-user fact.

Required-safety major-version update:

- Title: `Getting Started updated`
- Body: `Safety guidance has changed. Review the updated essentials when convenient. Your workspace remains available.`
- Primary action: `Review updates`
- Dismiss accessible name: `Dismiss updated Getting Started guidance`

Eligibility is exact: render this update row only when `requiredAcknowledgedVersion > 0`, `requiredAcknowledgedVersion < currentSafetyVersion`, and `requiredNoticeResolvedVersion < currentSafetyVersion`. A fresh/default user at version 0 has no prior guidance to call “updated” and receives only the D2 entry behavior/permanent re-entry; a user already acknowledged at the current version receives no row.

Opening the drawer records only `requiredNoticeSeenVersion`. Selecting `Review updates` or dismissing the row records `requiredNoticeResolvedVersion`; only finishing the revised essentials advances `requiredAcknowledgedVersion` and `readinessInspectedVersion`. A dismissed notice therefore stays suppressed for that safety-copy version without falsely recording acknowledgement or changing workspace/execution access.

Optional-track update uses badge `Updated`, body `This goal has new steps. Your previous completion is kept.`, and action `Review updates`.

Under the pilot D6 ceiling, switching/replay preserves history and therefore does not add a confirmation dialog. Use:

- Destination-row description: `Starting {next goal} pauses {current goal} at Step {n} of {N}.` The existing save-status band separately says Synced, Saved on this device, Pending, or Not saved; switching copy never promises durability.
- New-goal announcement: `{Current goal} paused at Step {n} of {N}. {Next goal} started.`
- Resumed-goal announcement: `{Current goal} paused at Step {n} of {N}. {Next goal} resumed at Step {m} of {M}.`
- Pause after confirmed sync: `{Goal} paused at Step {n} of {N}. Progress synced.`
- Pause with a same-user pending record: `{Goal} paused at Step {n} of {N}. Progress is saved on this device; sync is pending.`
- Replay: `Replaying {goal} from Step 1. Prior completion is retained.`
- Updated: `Reviewing updates to {goal}. Prior completion is retained.`
- Generic pause notice when no finer state is presented: `Walkthrough paused` / `Resume from Getting Started anytime.`

#### Runtime readiness language

| Runtime state | Label | Copy |
| --- | --- | --- |
| Loading | `Checking…` | `Checking the current {data/provider/account} status.` |
| Data live proof | `Live` | `The selected data source currently reports live delivery.` |
| Data configuration only | `Configured` | `The selected data source is configured. Live delivery remains governed by the workspace freshness indicators.` |
| Data setup needed | `Setup needed` | `The selected data source needs configuration or reconnection. For IBKR, append the current source-owned bridge reason.` |
| Provider connected | `Connected` | `A current-user provider connection is connected or authenticated.` |
| Provider configuration only | `Configured` | `A broker provider is configured. PYRUS has not confirmed a connected current-user provider.` |
| Provider setup needed | `Setup needed` | `PYRUS has not confirmed a configured provider or a connected current-user provider.` |
| Account connection verified | `Connection verified` | `A connected current-user provider exposes at least one current account. This is not execution permission.` |
| Account setup needed | `Setup needed` | `No broker account connection is verified right now. You can finish the safety essentials and review account setup next.` |
| Runtime request failed | `Status unavailable` | `PYRUS couldn’t confirm the current {data/provider/account} status. Retry or open Data & Broker.` |
| Unknown | `Unknown` | `The current status could not be determined.` |
| Stale with timestamp | `May be out of date` | `Last checked {relative time}. Recheck before relying on this status.` |
| Essentials inspected while setup is incomplete | `Readiness reviewed` | `You reviewed the current setup state. A verified connection is not required to finish the safety essentials.` |

Persisted tutorial progress never proves current readiness. Never render `Synced across devices`, `Up to date everywhere`, `Cloud saved`, `Changes merged`, `Your progress is safe`, `You’re a new user`, `Eligible for onboarding`, `Onboarding unlocked trading`, `Account ready` from persisted progress, `Offline` without a proven connectivity fact, `Saved` immediately after an optimistic write, or `Onboarding complete` as an authorization/execution claim. Also reject `Ready to trade`, `Enable trading`, `Place order`, `Submit`, `Fill`, `Connect now`, `Risk managed`, `Signal approved`, `Reset progress`, celebratory completion copy, and nested visible Start/Resume/Replay buttons inside goal rows.

### Track blueprints

Only one track is active. Starting another pauses the current track at its last valid step. Catalog copy is concise utility language; entries contain no callbacks, endpoints, requests, or mutation handlers.

| Track | Step | Utility copy / user task | Completion owner | Target policy |
| --- | --- | --- | --- | --- |
| Safety essentials | Environment | “Live can route real orders. Shadow is simulated. Verify the environment shown before every review.” | Manual acknowledgement | No target |
| Safety essentials | Confirmation | “Onboarding never submits. Real execution still uses PYRUS review and confirmation.” | Manual acknowledgement | No target |
| Safety essentials | Readiness inspection | “Check the current account and data status. Not ready is a setup state, not a tutorial failure.” | Manual inspection of read-only runtime facts | No production target |
| Connect account | Open setup | Navigate to Settings and identify Data & Broker. | Navigation/visible target | Required target |
| Connect account | Choose provider | Use the existing provider controls; onboarding does not pick or launch one automatically. | Manual existing UI action | Required target |
| Connect account | Verify connection | Read current broker/account state and the next explicit user action. | Closed runtime fact | Required target |
| Read a signal | Open Signals | Navigate to the Signals workspace and choose a visible row. | Navigation/manual selection inside unique list anchor | Required target |
| Read a signal | Read evidence | Identify side, freshness, timeframe agreement, gates, and thesis. | Manual acknowledgement after visible drilldown | Required target |
| Practice order review | Build synthetic order | Use labeled synthetic account, asset, side, quantity, type, and price fields. | Local simulation reducer | No production target |
| Practice order review | Validate | Resolve local field errors and compare estimated value. | Local simulation reducer | No production target |
| Practice order review | Review boundary | Reach and acknowledge the synthetic confirmation boundary; no order is created. | Local simulation reducer | No production target |
| Manage risk | Open Account | Navigate to Account and identify the active source. | Navigation/visible target | Required target |
| Manage risk | Read exposure | Inspect concentration, exposure, and a position’s risk context. | Manual acknowledgement after visible facts | Required target |
| Manage risk | Understand handoff | Explain that position actions enter the normal Trade review path and do not execute from onboarding. | Manual acknowledgement | Optional target |

Recommended proposed anchor IDs are `settings-root`, `settings-data-broker-tab`, `broker-provider-controls`, `broker-readiness`, `signals-root`, `signal-list`, `signal-evidence`, `account-root`, `account-active-source`, `account-risk-context`, and `account-position-handoff`. `signal-list` is one unique table-region anchor around the virtualized rows; individual rows never repeat an anchor ID. The parent `signal-evidence` and `account-risk-context` anchors prevent one guide step from trying to outline two disjoint elements; `account-active-source` prevents outlining the entire Account route. Each becomes a stable `data-onboarding-anchor` only when its owning screen slice lands. A required data-bearing anchor also exposes exactly one route-owned `data-onboarding-state="loading|ready|empty|error|stale"`; only `ready` can accept a production activation or manual completion. A retained empty wrapper therefore stays geometrically measurable but derives a concrete temporary Unavailable reason rather than pretending usable content exists. This attribute is presentation evidence, never persisted readiness or execution authority. Missing optional targets may continue without a highlight; missing/non-ready required targets offer Retry / Pause and record no completion.

## User Journey Storyboard

| Step | User does | Intended feeling | Product response |
| --- | --- | --- | --- |
| 1 | Opens Getting Started automatically once for the active user/catalog version, or uses permanent manual re-entry | Oriented, not blocked | Brief safety essentials state what Live/Shadow mean and where confirmations occur. |
| 2 | Sees current readiness | Trusts the system's honesty | Account/data state comes from current runtime facts, never a saved tutorial claim. |
| 3 | Chooses a goal | In control | Recommended next goal is prominent; all tracks can be paused or replayed. |
| 4 | Follows a production-screen guide | Focused | One target and one instruction at a time; navigation uses the existing screen authority. |
| 5 | Practices order review | Safe | Fixed synthetic data and a local reducer demonstrate review without any component-owned request; the host may save bounded tutorial progress. |
| 6 | Completes or pauses | Confident | Progress saves per user; pending remote sync is stated honestly. |
| 7 | Returns weeks later | Respected as an expert | Workspace stays dense; Getting Started is available on demand, not persistently intrusive. |

Time horizons:

- First 5 seconds: distinguish required safety from optional learning and show current readiness.
- First 5 minutes: complete one useful goal without reading a page tour.
- Long-term: replay a specific workflow after product changes without resetting unrelated progress.

## Onboarding State and Safety Contract

### Model

```ts
type OnboardingStepKind = "explain" | "observe" | "simulate";
type OnboardingTrackStatus = "active" | "paused" | "completed";
type OnboardingTargetPolicy = "required" | "optional" | "none";
type OnboardingCompletionOwner = "manual" | "runtime" | "simulation";
type OnboardingCompletionKey =
  | "account.connection-verified"
  | "simulation.review-reached";
type OnboardingRequiredMilestone =
  | "boundary-acknowledged"
  | "readiness-inspected";

const ONBOARDING_LIMITS = {
  maxTracks: 8,
  maxStepsPerTrack: 16,
  maxCompletionHistoryPerTrack: 32,
  maxIdLength: 64,
  maxTimestampLength: 32,
  maxSerializedBytes: 64 * 1024,
} as const;

type OnboardingStep = {
  id: string;
  kind: OnboardingStepKind;
  screenId?: string;
  anchorId?: string;
  targetPolicy: OnboardingTargetPolicy;
  completionOwner: OnboardingCompletionOwner;
  completionKey?: OnboardingCompletionKey;
};

type OnboardingCatalogStep = OnboardingStep & {
  completionMilestone?: OnboardingRequiredMilestone;
  copy: {
    title: string;
    body: string;
    targetLabel?: string;
  };
};

type OnboardingTrack = {
  id: string;
  version: number;
  required?: boolean;
  label: string;
  description: string;
  actionNoun: string;
  completionAnnouncement: string;
  steps: readonly OnboardingCatalogStep[];
};

type OnboardingCatalog = {
  version: number;
  tracks: readonly OnboardingTrack[];
};

type OnboardingStepCompletion = {
  stepId: string;
  completedAt: string;
};

type OnboardingTrackProgress = {
  catalogVersion: number;
  status: OnboardingTrackStatus;
  lastStepId: string | null;
  completedStepIds: string[];
  completionHistory: OnboardingStepCompletion[];
  completedAt: string | null;
};

type OnboardingProgress = {
  schemaVersion: 1;
  autoOpenShownVersion: number;
  requiredNoticeSeenVersion: number;
  requiredNoticeResolvedVersion: number;
  requiredAcknowledgedVersion: number;
  readinessInspectedVersion: number;
  activeTrackId: string | null;
  tracks: Record<string, OnboardingTrackProgress>;
};

type OnboardingProgressAction =
  | { type: "activate-track"; trackId: string }
  | { type: "pause-active-track"; trackId: string }
  | {
      type: "complete-current-step";
      trackId: string;
      stepId: string;
      owner: OnboardingCompletionOwner;
      evidenceKey?: OnboardingCompletionKey;
      completedAt: string;
    }
  | { type: "restart-active-track"; trackId: string }
  | { type: "pause-and-restart-track"; trackId: string }
  | {
      type: "review-runtime-step";
      trackId: string;
      evidenceKey: OnboardingCompletionKey;
    }
  | { type: "replay-track"; trackId: string }
  | { type: "review-track-update"; trackId: string }
  | { type: "mark-auto-open-shown" }
  | { type: "mark-required-notice-seen" }
  | { type: "resolve-required-notice" };
```

`screenId` remains a data string. Catalog tests first prove the pure `PLATFORM_SCREEN_IDS` authority and rendered `SCREENS` registry still agree, then validate every catalog screen against that set without importing React into production catalog code. The plan does not invent a new platform ID type or edit the concurrent URL-history file. Under confirmed D7, `account.connection-verified` resolves through the read-only runtime-facts adapter; `simulation.review-reached` resolves only through the local Practice reducer. Persist only schema/catalog versions, track/step identifiers, status, and timestamps. Catalog copy/milestones are definitions, never duplicated in progress.

The onboarding model creates no role-based applicability policy. The pure progress normalizer never accepts a role, entitlement, or provider gate and persists no authorization reason. While identity/authorization facts are unresolved, onboarding stays closed. Once they settle, every authenticated role sees the same four goals; production controls and backend guards remain the only authority for connection actions. A current entitlement/provider denial is rendered as runtime setup state and never rewrites or completes onboarding progress.

Default progress contains the five catalog track records as `paused` with `lastStepId: null`, no completions/history, and no active pointer. That sentinel is the nonpersisted UI state Available; no fourth stored status is added. `activeTrackId` is the active-pointer authority, and normalization makes at most that known noncompleted record `active` while pausing every inconsistent extra active record.

Normalization rebuilds from known catalog tracks/steps rather than enumerating arbitrary input. IDs must match `^[a-z][a-z0-9.-]{0,63}$`. Version fields are integers from zero through the applicable current version; negative, fractional, future, string-coerced, and nonfinite values become zero so corrupt state cannot suppress guidance. `autoOpenShownVersion` is independent from the future required-notice seen/resolved pair; `resolved > seen` promotes the matching required-notice seen version. Completed-step input inspects at most 16 entries, filters/deduplicates, and emits catalog order. History inspects only the last 32 raw entries, validates IDs/timestamps, canonicalizes timestamps, and retains repeated steps across replay passes. Invalid timestamps/completedAt are discarded. Oversized/cyclic/unknown input normalizes without throwing and serialized output stays within 64 KiB.

Catalog migration rules:

- Step IDs never rename in v1. Removed IDs are dropped; new IDs are new steps; stable IDs survive and resume at the first valid incomplete step. Add an alias table only when a real future migration has an explicit old/new mapping.
- Replaying a completed track clears current-pass `completedStepIds`, starts at Step 1, and retains bounded completion history plus the prior `completedAt`.
- Optional-track version changes preserve completion and show Updated.
- Normalization preserves a valid older `catalogVersion`; overwriting it with the current version would erase Updated detection. Reviewing an update advances the stored version and resumes at the first newly incomplete step; a copy-only update restarts at Step 1 while retaining prior completion evidence.
- A required safety major-version change requests re-acknowledgement under D6 and never blocks the workspace.
- The initial `autoOpenShownVersion` is independent from required-safety update-notice seen/resolved versions. Consuming the initial opening never suppresses a later safety update, and dismissing a safety-update notice never records acknowledgement.
- Required-update eligibility additionally requires a positive prior `requiredAcknowledgedVersion` below the current safety version; default zero never impersonates a returning user with changed guidance.
- Persisted completion never satisfies a runtime-owned completion key; the adapter recomputes it from current read-only facts.

Back is intentionally a transient review affordance, not a second progress authority. The mounted Safety/guide/Practice view may keep a bounded `viewStepId` in component state and move Back only among known current/previous catalog steps. It never changes `lastStepId`, completed IDs, milestones, or history. Pause/close/remount discards that view pointer and resumes the first incomplete persisted step. Practice is the one stricter case described below because its editable fields and review evidence are deliberately volatile.

Runtime drift never rewrites history in the background. For a persisted completed Connect track, the effective picker state is Complete only while the fresh D7 fact is true. Loading/stale/error derive Checking/Stale/Unavailable without erasing history; a fresh disconnected result derives `Setup needed · Prior completion retained.` with action `Review account setup`. Selecting that action dispatches `review-runtime-step` for the catalog’s exact runtime-owned connection step: retain Steps 1–2/history/prior `completedAt`, remove that step and downstream current-pass completions, activate at Verify connection, and require a fresh exact fact to complete again. If the fact recovers before review is selected, the row returns to Complete without a write.

Reducer invariants:

- Activating another valid track pauses the current track first. Invalid or D1-gated activation is a total no-op and does not disturb the current track.
- Optional activation requires both required milestone versions at the current safety-track version; account connection state is never consulted for this gate.
- A completion action carries the expected `trackId` and `stepId` from its originating interaction/observer and is a total no-op unless both still match the active current step. Only then may a canonical ISO timestamp, matching completion owner, and the exact required evidence key advance it. Missing/extra/wrong evidence is rejected, and a late asynchronous observer can never advance a newly selected track even when both steps use the same owner.
- Pause/restart actions carry the expected `trackId` and are total no-ops unless it still equals `activeTrackId`; a stale component can never pause/reset a newly selected destination. `restart-active-track` clears current-pass completed IDs, returns to Step 1, and retains bounded history plus prior `completedAt`. `pause-and-restart-track` performs that reset and pause atomically for volatile Practice. `replay-track` remains the corresponding action for a completed track.
- `review-runtime-step` is accepted only for a completed known track and the exact catalog runtime-owned key; it retains prior nonruntime completions/history, removes the runtime step and downstream current-pass completions, and activates that step. Current-fact absence is derived by the host and is not persisted as authority.
- Completing the first two Safety steps records only their bounded current-pass step completion. `requiredAcknowledgedVersion` and `readinessInspectedVersion` advance together, atomically, only when `Finish essentials` successfully completes the final current step for the expected Safety track/step. Resolving a notice also marks it seen but never changes either safety version.
- Final-step completion clears `activeTrackId`. Replay/update behavior follows the migration rules above and never deletes prior completion evidence.

Never persist broker/account IDs, order fields, entitlement/readiness claims, live permission, or any value that can unlock an execution path.

### Hard safety invariants

1. Onboarding progress is educational state, never authorization state.
2. Required readiness is recomputed from authenticated runtime facts.
3. The practice-order component imports no real ticket, generated mutation hook, API request helper, broker handler, or order route.
4. The simulator component produces zero fetch/XHR/beacon/form/navigation effects and creates neither live nor Shadow orders. The host may issue only the authenticated `/api/settings/preferences` PATCH whose validated payload changes bounded onboarding progress; that persistence is outside the simulator reducer/request boundary.
5. The real Trade and Algo confirmation gates remain unchanged.
6. An optional handoff to the real Trade screen ends tutorial simulation; it never pre-submits or silently carries a live ticket across the boundary.
7. Browser onboarding tests abort and fail on any execution, order, broker-connect, sync, import, or provider mutation request.
8. Shared `pyrus:state:v1` never stores onboarding progress. Pending local progress uses only the authenticated user’s `pyrus:onboarding:v1:${user.id}` key, confirmed pending data is removed, and late responses from a prior identity are ignored.
9. Auth stays on an outer query client; application queries/mutations use a fresh inner client per identity/authorization generation. Fixed generated query keys therefore never make A’s or a prior role’s broker/account facts visible to the next generation, even when old asynchronous work settles late.
10. Practice fields/review evidence are never persisted. Any incomplete remount or pause atomically restarts the Practice pass, and stale component actions are track-scoped no-ops after a switch.
11. The initial product questionnaire is a one-time setup/deployment input. No later onboarding adapter, recommender, or readiness observer asks for it again or treats its persisted answers as a current account, connection, or deployment fact.

## Interaction State Coverage

| Feature | Loading | Empty | Error | Success | Partial / stale |
| --- | --- | --- | --- | --- | --- |
| Initial versioned opening | Keep onboarding closed until exact identity, workspace readiness, and remote preferences settle. | After a confirmed response with `autoOpenShownVersion` below the current catalog version, auto-open Getting Started once and record the version. | Do not auto-open while preference truth is unresolved/failed; permanent Command Palette/More re-entry remains. | The active immutable user sees the picker once for that catalog version. | An open dialog defers rather than consumes the opening; this all-user contract never labels the user “new.” |
| Goal picker | Show compact progress skeleton only if remote state is unresolved. | Show all four goals and explain why the recommended one comes first. | Show retry plus Start locally only when pending storage is verified writable; otherwise label session-only state Not saved. | Show completed/active/available status per goal. | Pending-sync badge and retry action. |
| Active anchor | Guide waits briefly after canonical navigation/readiness. | Missing optional target offers Continue. | Missing required target offers Retry / Pause and records no completion. | Outline target and announce current step. | If target disappears, remove outline and fall back honestly. |
| Runtime prerequisite | Show checking state without claiming readiness. | Explain the missing account/data requirement and link to setup. | Show actionable current failure, not generic copy. | Mark only from authoritative runtime fact. | Show stale/unknown separately from ready. |
| Progress save | Preserve local reducer state while saving. | First save creates bounded onboarding record. | Keep local progress, label pending, offer retry. | Confirm synced timestamp/source. | Never call a local optimistic write “synced.” |
| Order practice | Fixed synthetic quote/order loads synchronously. | Not applicable; defaults are always synthetic and explicit. | Local validation explains invalid field without network fallback. | Synthetic review is acknowledged. | No market freshness claims; fixture time is labeled simulated. |
| Track completion | Keep last step visible while persisting. | No-op if catalog has no valid steps. | Remain paused at last valid step. | Show next recommended goal and replay action. | Catalog upgrades reconcile stable IDs without erasing history. |
| Logout / account switch | Pause and detach the prior user before loading another identity. | Signed-out state mounts no onboarding host. | New user receives defaults if remote load fails; never prior-user progress. | Confirmed remote state belongs to the active immutable user ID. | Ignore late responses and writes from the previous identity. |
| Multi-tab / device conflict | Keep the current visible step while a request is in flight. | Use the first valid catalog step when the confirmed record is empty. | Preserve the current user’s keyed pending state and offer retry. | The last server-confirmed write wins in v1; a later reload normalizes that snapshot by stable catalog IDs. | No automatic cross-device merge or conflict claim; label only locally known pending versus confirmed state. |
| Auth expiry | Pause without completion and close protected setup actions. | Signed-out gate owns the surface. | Explain that sign-in is required to sync/resume. | Resume after the active user is re-established. | Never retain another identity’s runtime facts. |
| Navigate away | Keep the guide compact and pause if the step’s screen is no longer active. | Goal picker remains available from re-entry. | Missing required target records no completion. | Canonical navigation restores the active step. | Underlying dialogs keep topmost Escape priority. |
| Track switch / reset | Pause the current track before another starts. | Reset offers the first valid step without deleting history. | Invalid catalog state normalizes to paused/default. | One active track is announced. | V1 has no role-based `Not applicable` state; setup-needed and temporary runtime-unavailable facts remain distinct. |
| Catalog version bump | Load the existing valid history first. | New steps appear as Updated. | Malformed migration falls back to the first valid step. | Optional completion is retained; required re-ack follows D6. | No version bump blocks workspace access. |

## Responsive and Accessibility Contract

| Width | Goal picker | Active guide | Target behavior |
| --- | --- | --- | --- |
| 390×844 | BottomSheet at `84dvh`, one-column goals, 44px controls | Nonmodal card 8px above the measured phone nav | Scroll target into view without smooth motion; never cover its primary control. |
| 768×1024 | Centered 560px Dialog, 64px goal rows | 344px guide card with 12px stack margins | Outline only within active host; retained hidden hosts ignored. |
| 1440×900 | Centered 620px Dialog, dense goal rows | 344px nonmodal card with 16px stack margins | Preserve primary workspace and sidebars; target remains readable. |

Accessibility requirements:

- Modal picker traps and restores focus; nonmodal steps never steal target focus.
- Escape and Close pause, never falsely complete.
- Escape closes only the topmost onboarding/underlying overlay; it never dismisses two layers in one keypress.
- Progress is an ordered list with `aria-current="step"`.
- Status changes use `aria-live="polite"`; validation failures use `role="alert"`.
- Every icon-only control has an accessible name; all phone/tablet controls meet 44px touch targets.
- Keyboard-only completion is possible; highlight is not color-only.
- Reduced-motion mode disables smooth scrolling and all onboarding transitions.
- Contrast meets the doctrine's body/text/control requirements in both themes.
- The visual highlight is `aria-hidden`, `pointer-events: none`, and never focusable.
- A target must be unique, connected, visible, non-inert, and inside the active screen host before it can be highlighted or completed.
- The guide is a named region; announcements include the target’s accessible label when available.
- Focus restoration falls back to the active route heading when the opener unmounts during navigation.
- Phone placement accounts for the bottom-nav height and safe-area inset; guide/target collision resolves by moving the guide, never covering the target action.
- Interactive walkthrough content never uses Tooltip. Synthetic fields have programmatic labels, descriptions, and associated errors.

## Route Readiness and Audit Matrix

Every normal-route browser audit uses this source-derived sequence:

1. `platform-screen-stack` is visible.
2. `pyrus-boot-progress-overlay` is hidden.
3. `screen-host-${id}` is visible with `aria-hidden="false"`.
4. `screen-load-error-${id}` is absent.
5. `screen-loading-${id}` and `screen-suspense-fallback` are hidden.
6. The route-owned anchor below is visible.

| Route | Final route-owned anchor |
| --- | --- |
| Market / Market Demo | `market-demo-screen`, then `market-chart-grid` |
| Signals | `signals-screen` |
| Flow | `flow-main-layout` |
| GEX | `gex-screen` |
| Trade | `trade-top-zone` |
| Account | `account-screen` |
| Research | `.photonics-research-root` or `research-search-input`; never the duplicated `research-screen` ID |
| Algo | `algo-screen`, then `algo-live-grid` |
| Backtest | `backtest-screen`, then `backtest-workspace` |
| Diagnostics | `diagnostics-screen` |
| Settings | `settings-screen` |

The doctrine matrix uses a fresh `?screen=<id>` browser context for each phone route so it does not depend on hidden More-sheet interactions. Phone navigation itself is a separate shell test: Market, Signals, Trade, and Account are primary; Flow, GEX, Research, Algo, Backtest, Diagnostics, and Settings are reached through More. Normal mode is the default. Safe QA appears only in a separately named safe-QA contract test and is never treated as an execution guard.

## Coverage Ledger

This ledger is the route/surface completeness authority. A row is complete only when its task evidence covers the normal route at all doctrine widths and both themes, plus applicable loading, empty, error, success, partial, and stale states.

| Surface or journey | Owning tasks | Required evidence |
| --- | --- | --- |
| Signed-out authentication / bootstrap | T4.20 | Auth pending/error/success, keyboard flow, 390/768/1440, light/dark, no onboarding/bootstrap conflation |
| Shared typography, motion, responsive authority | T2.1–T2.4 | Token/source parity, computed reduced motion, exact breakpoint boundaries, representative data voice |
| Header, desktop navigation, command palette | T2.6, T3.4 | Active route, long labels, keyboard/focus, status wrapping, Getting Started replay |
| Shell, phone navigation, More | T2.5, T3.5 | Four primary destinations plus More, width changes, drawers closed, safe-area placement, no overflow |
| Watchlist rail / drawer | T2.7 | Active/passive modes, search, loading/empty/error/stale, focus restore, touch geometry |
| Algo monitor / footer context | T2.8 | Desktop/tablet allocation, collapse/launch, Algo deduplication, secondary hierarchy |
| Dialogs, drawers, sheets, tooltips, toasts | T2.9, T2.11, T2.12 | Topmost Escape, focus trap/restore, inertness, z-order, identity isolation, announcements, long/error content |
| Boot, loading, global error recovery | T2.10 | Stable geometry, polite announcements, actionable recovery, theme/width parity |
| Onboarding model, identity, persistence | T1.1–T1.5 including T1.2b/T1.3c | Bounded schema, migrations, shared-query/client/server/fallback per-user isolation, runtime facts, and exact per-user/catalog-version auto-open |
| Onboarding host, goal picker, invitation, safety, practice | T3.1–T3.9 | Re-entry, dense goal selection, discoverable nonblocking invitation, focus, target validity, D1 gate, simulator integration/deny layer, zero execution/broker side effects, onboarding-only preference persistence |
| Market / hidden Market Demo alias | T4.2 | Activity semantics, Regime → Scanner → Chart → Context, route alias parity |
| Signals / Signals → Trade | T4.3–T4.5 | Scan/drilldown states, anchored pilot, handoff, human guide review |
| Flow / Flow → Trade | T4.11 | Filters/tape/contract/context hierarchy, handoff, state fixtures |
| GEX | T4.12 | Expiration/metric/chart allocation, data truth, keyboard/touch |
| Trade | T4.13–T4.16 | Chart/chain, positions/flow, strategy/Greeks/L2, ticket hierarchy, all execution gates unchanged |
| Account / Account → Trade / Manage Risk | T4.9–T4.10 | Source density, exposure/positions/orders, review-only handoff, risk track |
| Research / Research → Trade | T4.1, T4.21 | Single route ownership, Photonics hierarchy, tablet behavior, handoff |
| Algo / Algo → Trade / Shadow → live | T4.18 | Operational scan, deployment confirmation, review-only handoff, destructive live boundary |
| Backtest / Backtest → Algo | T4.17 | Inputs/results/warnings/trades/logs/history, explicit draft promotion |
| Diagnostics | T4.19 | Failure/impact/evidence/recovery hierarchy across all diagnostic fixtures |
| Settings / Connect Account | T4.6–T4.8 | Setup/recovery states, Data & Broker hierarchy, provider/readiness anchors, zero automatic mutations |

## Dependency Graph

```text
Confirmed D1/D2/D7/D8 + pilot ceilings D4/D6 + source-derived invariants D3/D5
  → ownership snapshot + truthful QA baseline
    ├── onboarding data lane
    │   └── pure model/catalog → shared-query identity boundary → runtime-facts adapter → bounded preference schema → server fallback isolation + client preference identity-safe confirmed saves
    ├── shared design lane
    │   └── typography authority → reduced motion → breakpoint authority → shell/overlay audit
    └── route design lane (may proceed independently when ownership is clear)
        ├── Research host, Market, Flow, GEX, Trade, Backtest, Algo, Diagnostics, Login
        ├── Signals stabilization ──────────────┐
        ├── Settings stabilization ────────────┼── paired anchored tracks
        └── Account stabilization ─────────────┘

onboarding data + shared design prerequisites
  → accessible host + re-entry + safety essentials + local order practice
    → Read a Signal anchored pilot
      → human pilot review
        → Connect Account and Manage Risk anchored tracks

all lanes
  → full validation, sanctioned reload when needed, and continuing visual audit loop
```

No route-wide design work depends on onboarding completion, but all shared-shell changes depend on a clean ownership handoff. Anchored walkthroughs do depend on their target screen slice being stable.

## Ownership Protocol

Before every task:

1. Run `git status --short -- <exact task files>` and record blobs/hashes for modified files.
2. Check current task-board/chat ownership when a file is modified or untracked.
3. Claim no more than the task's listed files.
4. Do not stage, commit, stash, reset, or overwrite unrelated changes.
5. If a required shared file is actively owned, continue with a disjoint task or pause that slice.
6. Re-read the final diff immediately before tests because the shared worktree can change during execution.

Known hot files from the broader audit include `AppContent.tsx`, `PlatformApp.jsx`, `PlatformScreenRouter.jsx`, `PlatformShell.jsx`, `AppHeader.jsx`, `SettingsScreen.jsx`, `useUserPreferences.ts`, major Trade files, and several screen implementations. The new `features/onboarding/` directory is currently absent.

Scoped ownership snapshot observed 2026-07-16T15:03:35Z:

- Modified in the current shared worktree: root `DESIGN.md`, `PYRUS/package.json`, `PYRUS_SRC/index.css`, `PYRUS_SRC/lib/uiTokens.jsx`, `PYRUS_SRC/features/platform/AppHeader.jsx`, `PYRUS_SRC/features/platform/PlatformShell.jsx`, and `PYRUS_SRC/features/preferences/useUserPreferences.ts`.
- Clean in the scoped status check (clean does not prove unowned): `lib/typography.ts`, `lib/responsive.ts`, `DockedSheet.jsx`, `BottomSheet.jsx`, `platformOverlays.test.mjs`, `CommandPalette.jsx`, `MobileMoreSheet.jsx`, `NotificationsDrawer.jsx`, `BloombergLiveDock.jsx`, the client preference model/test, the server preference model, `routes/settings.test.ts`, and `services/route-admission.test.ts`.
- Planned onboarding model/catalog/runtime-facts files and all new onboarding tests/specs do not yet exist. After plan approval, T1.1 is the lowest-conflict pure first slice; T1.3c is the required shared-query identity boundary before T1.5’s pure adapter plus React Query hook. T0.3 is also mostly file-disjoint but touches Playwright config and its authenticated matrix still requires user-approved ephemeral storage/artifact paths.
- Re-run the exact status check immediately before every slice; this snapshot is evidence, not a claim of exclusive ownership.

Path bases used below are exact:

- `PYRUS` = `artifacts/pyrus`
- `PYRUS_SRC` = `artifacts/pyrus/src`
- `API_SRC` = `artifacts/api-server/src`

Every product/test path below includes its declared base. A repository-root path is labeled explicitly. A proposed new test path is still an exact intended filename, not a placeholder.

## Implementation Tasks

Each task is a vertical or enabling slice with five or fewer intended files. File status must be rechecked at execution time.

### Phase 0 — Truthful baseline and ownership

- [ ] **T0.1 (P1)** — Record exact owners/status for the next slice and preserve the concurrent URL-history WIP.
  - Files: no product edits; update this plan and the active handoff only.
  - Accept: no claimed file overlaps an active lane; `initialPlatformScreen.test.mjs` remains outside scope.
  - Verify: status/blob snapshot attached to the handoff.

- [ ] **T0.2 (P1, ownership-gated)** — Restore a truthful explicit design-source test command.
  - Files: `PYRUS/package.json`, `PYRUS_SRC/features/backtesting/mobileDataLayouts.designConformance.test.mjs`, `PYRUS_SRC/features/research/PhotonicsObservatory.designConformance.test.mjs`.
  - Accept: the two stale selectors match the current intentional CSS exclusions; the exact `test:design-source` package script runs the complete design/a11y/motion source inventory.
  - Verify: `pnpm --filter @workspace/pyrus run audit:design` and `pnpm --filter @workspace/pyrus run test:design-source` pass.

- [ ] **T0.3 (P1)** — Add a read-only route doctrine browser harness and an isolated safe-QA contract check.
  - Files: new `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`, new `PYRUS/e2e/safe-qa-contract.browser-validation.spec.ts`, `PYRUS/playwright.config.ts`.
  - Accept: the doctrine matrix uses a user-approved non-sensitive fixture account or verified balance/account masking, strict mutation aborts, the exact readiness/anchor matrix above, fresh `?screen=` contexts, separate phone More navigation, 390/768/1440, dark/light, keyboard/reduced-motion modes, route screenshots, and overflow/occlusion measurements. Dark/light and app reduced-motion variants come from a per-context intercepted preferences GET (cloning only `appearance.theme` / `appearance.reducedMotion`) or separately preconfigured synthetic users; the harness never clicks a production preference control under a nonmutating credential. OS reduced motion is tested separately. For any run with `PYRUS_STORAGE_STATE`, Playwright config canonicalizes and rejects a repository-local state path, requires mode 0600, requires canonical outside-repo `PYRUS_QA_ARTIFACT_DIR` mode 0700, and sets `outputDir` beneath it so every screenshot, trace, video, and attachment stays there under umask 077; it fails closed rather than use repository-local `test-results`. Anonymous existing tests preserve their current behavior when protected QA variables are absent. Raw authenticated captures are never attached by default, identifiers are redacted before handoff, and all artifacts expire/delete after the approved QA window. The second spec intentionally tests only the safe-QA mode contract and proves it is not an execution guard.
  - Verify: run the doctrine spec first with one route filter and then the full nonmutating matrix; run the safe-QA contract spec separately by its exact filename.

### Phase 1 — Identity-safe onboarding data

- [ ] **T1.1 (P1)** — Implement the bounded pure progress model and catalog.
  - Files: new `PYRUS_SRC/features/onboarding/onboardingModel.ts`, new `PYRUS_SRC/features/onboarding/onboardingCatalog.ts`, new `PYRUS_SRC/features/onboarding/onboardingModel.test.mjs`, new `PYRUS_SRC/features/onboarding/onboardingCatalog.test.mjs`.
  - Accept: the full schema above; exact five-track catalog order/copy/IDs/owners/keys/milestones/targets; stable IDs; all four optional goals available to every authenticated role after D1 gating; one active track; catalog reconciliation; pause/resume/replay/version and independent notice behavior; malformed/cyclic/future/oversized normalization; bounded history/serialization; registry-valid screen IDs; and a data-only catalog with no functions, React, browser, storage, API, request, mutation, ticket, broker-handler, or navigation-store imports.
  - Verify: defaults/Available sentinel; two-milestone D1 committed only by successful final Safety completion; gated activation; switch/pause; wrong expected track/step, owner/key/time rejection; a stale Signal observer after Signal→Risk manual-owner switching is a no-op; active restart versus completed replay retention; runtime-drift review retaining prior evidence; independent initial auto-open and required-notice version fields including zero-never-updated eligibility; malformed/cyclic/future state; all limits; inconsistent active normalization; removed/stable IDs; add-step/copy-only updates; required bump pausing optional work without history loss; exact catalog metadata/target invariants and pure/rendered screen-registry parity. Run `pnpm --filter @workspace/pyrus exec tsx --test src/features/onboarding/onboardingModel.test.mjs src/features/onboarding/onboardingCatalog.test.mjs`.

- [ ] **T1.2 (P1)** — Extend client and server preference models with bounded onboarding progress.
  - Files: `PYRUS_SRC/features/preferences/userPreferenceModel.ts`, `PYRUS_SRC/features/preferences/userPreferenceModel.test.mjs`, `API_SRC/services/user-preferences-model.ts`, new `API_SRC/services/user-preferences-model.test.ts`.
  - Accept: client and server normalizers agree only on the onboarding subtree, its defaults, bounds, and canonical valid output; this task does not reconcile their pre-existing differences in unrelated appearance/preference fields. Onboarding is omitted from shared `pyrus:state:v1`; strict server input rejects malformed/oversized state; unknown onboarding fields are stripped; missing onboarding remains backwards-compatible and defaults do not imply new-user eligibility.
  - Verify: focused client/server model tests and both typechecks.

- [ ] **T1.2b (P1, security prerequisite)** — Make the server fallback preference path truly per-user.
  - Files: `API_SRC/services/user-preferences.ts`, new `API_SRC/services/user-preferences-fallback.test.ts`, `API_SRC/routes/settings.test.ts`, repository-root `.env.example`.
  - Accept: validate the context user ID as the UUID shape guaranteed by `usersTable.id`; reject invalid/traversal-shaped input before resolving a path. The default path remains `tmp/pyrus/user-preferences-${userId}.json`. A configured file such as `/path/preferences.json` resolves deterministically to sibling `/path/preferences.<sha256(userId)>.json` using Node’s standard-library hash, so identity bytes never enter that configured filename. Every written file remains mode 0600. A legacy unkeyed `/path/preferences.json` is never silently served to an arbitrary authenticated user; warn once with the exact ignored path and start from normalized defaults unless the user-keyed sibling exists. Database and fallback reads/writes remain isolated for A/B users; unauthenticated and invalid-CSRF settings requests still fail. No environment value or Replit control-plane state is changed by this task.
  - Verify: default-path and configured-override A/B isolation, invalid/traversal-shaped user-ID rejection, 0600 permissions, database-failure fallback, ambiguous-legacy refusal/warning, settings auth/CSRF route tests, API typecheck/build, and `pnpm run audit:replit-startup` only if startup-sensitive config beyond `.env.example` is later brought into scope.

- [ ] **T1.3 (P1, ownership-gated)** — Make preference identity and onboarding save status truthful.
  - Files: `PYRUS_SRC/features/preferences/useUserPreferences.ts`, new `PYRUS_SRC/features/preferences/useUserPreferences.identity.test.mjs`, new `PYRUS_SRC/features/onboarding/onboardingPendingStorage.ts`, new `PYRUS_SRC/features/onboarding/onboardingPendingStorage.test.mjs`.
  - Accept: state and requests are scoped to `authSession.user.id`; account change resets load flags and pending state; prior requests are aborted/ignored; remote status is idle/loading/confirmed/failed; pending storage uses only `pyrus:onboarding:v1:${user.id}` and is deleted after confirmed sync; a failed B load never shows or sends A progress; local pending storage failures expose `Not saved` and never promise device durability. The existing generic Settings preference Reset preserves the current user’s normalized onboarding subtree byte-for-byte at the semantic object level; it resets no goal/history/invitation/update field. Shared `pyrus:state:v1` and its events are non-onboarding cache only: filter `storage` events to the exact `USER_PREFERENCES_STORAGE_KEY`, ignore them while identity is unresolved/detached, merge only normalized non-onboarding sections into the current snapshot, and preserve the active user’s confirmed/pending onboarding subtree. A local/cache event never triggers a remote save. Only explicit onboarding Replay/restart actions change onboarding progress. V1 makes no cross-device merge guarantee.
  - Verify: A progress → refresh/offline resume → logout → B login → failed B GET → B defaults, zero A state, late A response ignored; same-user re-auth resumes only that user’s pending record; confirmed sync cleans it up; generic preference Reset preserves every onboarding field under confirmed and pending states; matching/unrelated/null-key storage events and custom cache events update only non-onboarding sections; cross-tab theme/workspace changes cannot default or later save onboarding; forced localStorage get/set/remove/quota failures; plus rejection, retry, and stale-response tests.

- [ ] **T1.3c (P1, security prerequisite)** — Add an authenticated identity/authorization boundary for application React Query state.
  - Files: `PYRUS_SRC/app/AppProviders.tsx`, new `PYRUS_SRC/features/auth/queryIdentityBoundary.ts`, new `PYRUS_SRC/features/auth/queryIdentityBoundary.test.mjs`.
  - Accept: keep `AUTH_SESSION_QUERY_KEY` on a small outer QueryClient owned by `AuthProvider`. While auth is loading, render only the boundary’s neutral loading state. After auth settles, mount application descendants beneath a fresh inner QueryClient keyed by an authorization fingerprint of immutable `user.id`, current role, and sorted entitlements, or explicit isolated `signed-out` / `auth-error` generations so LoginGate can render without prior-user cache. The current generation remains stable across same-fingerprint refreshes; logout, A→B, role/entitlement change, and session-expiry detach synchronously select a new client before descendants render. Old-generation queries/mutations may settle only into their unreachable old client; cleanup cancels/clears them best-effort, but correctness never depends on cancellation. Reuse the existing default query options in both clients from one factory. Clearing even non-user market cache on a rare generation change is the deliberate safe ceiling.
  - Verify: anonymous→A, A→signed-out, A→B, A→B→A, A→signed-out→A, same-A refresh retains cache, same-ID role/entitlement change creates a fresh generation, backend error, late A query/mutation callbacks can mutate only the unreachable A client, outer auth-query preservation, descendant mount ordering, and every later A/B application generation refetches through a newly constructed inner client rather than reviving a client cached by fingerprint.

- [x] **T1.4 (P2, D2 pilot contract)** — Define the exact versioned auto-open authority without adding a speculative “new user” fact.
  - Files: `PYRUS_SRC/features/onboarding/onboardingModel.ts`, `PYRUS_SRC/features/onboarding/OnboardingHost.tsx`, and focused host/model tests.
  - Accept: this is an approved all-authenticated-user, once-per-catalog-version contract. It waits for the exact identity, workspace readiness, and server-confirmed preferences; persists `autoOpenShownVersion`; and defers while a blocking dialog is present. Missing progress is not described as eligibility or new-user status.
  - Verify: identity switch, unresolved/failed/confirmed preferences, already-shown/current version, future catalog version, blocking-overlay deferral, and one-open maximum.

- [ ] **T1.5 (P1)** — Implement the closed, read-only onboarding runtime-facts adapter.
  - Files: new `PYRUS_SRC/features/onboarding/onboardingRuntimeFacts.ts`, new `PYRUS_SRC/features/onboarding/onboardingRuntimeFacts.test.mjs`, new `PYRUS_SRC/features/onboarding/useOnboardingRuntimeFacts.ts`, new `PYRUS_SRC/features/onboarding/useOnboardingRuntimeFacts.test.mjs`.
  - Accept: depends on T1.3c. The pure adapter maps explicit raw inputs to the exact Data/Provider/Account labels above and, under confirmed D7, the runtime-owned closed key `account.connection-verified`. The hook receives the attached immutable `user.id` plus the current authorization generation and, only while Getting Started is visible or a fact-dependent track is active, subscribes to the existing generated `useGetSession`, `useGetSnapTradeReadiness`, `useGetRobinhoodReadiness`, `useGetSchwabReadiness`, `useGetIbkrPortalReadiness`, `useListBrokerConnections`, and `useGetBrokerExecutionIncludedAccounts` read-only queries with their canonical React Query keys so current-generation cache entries dedupe. It may fetch missing current facts; it never imports a mutation hook/helper, starts provider setup, reads readiness from the DOM, trusts the unkeyed SnapTrade execution-account browser store, trusts persisted completion, or rereads the one-time initial questionnaire as runtime state.
  - Accept: Data uses the existing session contract, not account inference. Its observer uses `retry: false`, `staleTime: 20_000`, and no second polling interval (the platform’s existing session observer owns polling). No data before settle is Checking; no data plus terminal error is Unavailable; stale cached data is Stale. For fresh `marketDataProvider === "massive"`, `configured.massive === true` is Configured—not Live—and false is Setup needed. For fresh IBKR, the hook reuses exported `hasGatewayLiveDataProof(session.ibkrBridge)`: true is Live. Otherwise Configured requires `configured.ibkr === true`, bridge `connected === true`, `authenticated === true`, `healthFresh === true`, and either `bridgeReachable === true` or `socketConnected === true`; every other configured/unconfigured condition is Setup needed with the source-owned bridge reason. The adapter does not duplicate the live-proof algorithm or infer transport health from timestamps.
  - Accept: connection verification is cross-provider but exact. SnapTrade requires a current-user live connected SnapTrade connection plus a current-user SnapTrade account. Robinhood and Schwab require their current-user readiness `user.connected === true` plus a matching current-user account; Schwab also requires `reauthRequired.required !== true`. IBKR Client Portal requires `status === "connected"`, `authenticated === true`, and a selected execution target/account. Provider configuration, a stale account row alone, an `executionDecision.outcome`, or an order-specific execution capability is never enough and is never represented as permission to trade. Every authenticated role uses this same fact path; existing entitlements and provider-specific compliance gates remain authoritative for production actions.
  - Accept: Provider/Account aggregation precedence is deterministic. A fresh verified provider/account pair makes Account `Connection verified` even if another provider is loading or errored, with partial detail text for the secondary condition. Without a verified pair, any fresh current-user connection makes Provider `Connected`; otherwise any settled configured provider makes Provider `Configured`; otherwise successfully settled broker sources with no connection or configuration make Provider `Setup needed`. Account remains `Setup needed`. `Checking` appears only before any source settles; `Status unavailable` appears only when no usable source settled and every attempted source failed or was denied. Every broker observer passes `retry: false` and the current production-owner policies exactly: `staleTime: 15_000` for the four provider-readiness queries and `staleTime: 30_000` for broker connections/included accounts. React Query `isStale` under those policies is the only staleness authority; do not add manual timestamp timers. A stale source cannot newly satisfy the closed completion key until its visible refetch settles. If the two values must be locally named before shared provider ownership is available, include a `ponytail:` comment stating the ceiling and the T4.8 extraction path. Signal evidence and Account risk remain manual steps enabled by host target validation; `simulation.review-reached` remains owned solely by the local reducer, so neither needs a cross-route fact store.
  - Verify: the runtime-owned key; session/data plus SnapTrade/Robinhood/Schwab/IBKR and included-account loading/empty/error/stale/ready combinations; aggregation precedence and partial detail; hidden host makes zero requests; entitled member/admin fact parity; current entitlement/provider denial remains honest runtime state; existing-cache dedupe; identity or authorization-generation change clears prior facts and ignores late results; persisted-completion, stale-browser-store, and stale-questionnaire adversaries; no signal/risk DOM or event-store dependency in this adapter; and forbidden mutation/DOM/import source guards.

### Phase 2 — Shared design authority and global frame

- [ ] **T2.1 (P1, ownership-gated)** — Reconcile typography-role authority before sizing onboarding UI.
  - Files: `PYRUS_SRC/lib/typography.ts`, `PYRUS_SRC/lib/uiTokens.jsx`, `PYRUS_SRC/index.css`, new `PYRUS_SRC/lib/typographyParity.test.mjs`.
  - Accept: each semantic DOM role has one documented value; any canvas exception is explicit; no accidental 7/8/8px versus 10px split.
  - Verify: design audit, parity test, and rendered light/dark samples.

- [ ] **T2.2 (P1, ownership-gated)** — Close the shared reduced-motion gap.
  - Files: `PYRUS_SRC/components/platform/DockedSheet.jsx`, new `PYRUS_SRC/components/platform/DockedSheet.motion.test.mjs`, `PYRUS_SRC/index.css` only if the component cannot reuse an existing motion class.
  - Accept: the inner transition stops under both OS and app reduced-motion channels.
  - Verify: source guard and browser computed-style assertion.

- [ ] **T2.3 (P1, ownership-gated)** — Document and test responsive authority before positioning the guide.
  - Files: repository-root `DESIGN.md`, `PYRUS_SRC/lib/responsive.ts`, new `PYRUS_SRC/lib/responsiveContract.test.mjs`.
  - Accept: 768/1024 authority and measured-container exceptions are explicit; route thresholds cannot silently redefine phone/tablet semantics.
  - Verify: contract test and exact-boundary doctrine matrix.

- [ ] **T2.4 (P2)** — Correct the shared Stat data voice.
  - Files: `PYRUS_SRC/components/ui/Stat.jsx`, new `PYRUS_SRC/components/ui/Stat.visualPolicy.test.mjs`.
  - Accept: canonical data values use `T.data` / IBM Plex Sans with tabular numerals without changing labels.
  - Verify: focused test and representative Market/Account render comparison.

- [ ] **T2.5 (P1, ownership-gated)** — Audit shell allocation and phone navigation.
  - Files: `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/features/platform/PlatformShell.mobileNavigation.test.mjs`, new `PYRUS/e2e/platform-shell-allocation.browser-validation.spec.ts`.
  - Accept: desktop/tablet/phone allocation, four primary destinations plus More, closed drawers after width changes, no horizontal overflow, primary workspace dominant.
  - Verify: source test and 390/768/1440 browser spec.

- [ ] **T2.6 (P1, ownership-gated)** — Audit header and desktop navigation.
  - Files: `PYRUS_SRC/features/platform/AppHeader.jsx`, `PYRUS_SRC/features/platform/AppHeader.navigationLayout.test.mjs`, new `PYRUS/e2e/app-header-navigation.browser-validation.spec.ts`.
  - Accept: active route, keyboard navigation, long labels, status wrapping, focus visibility, and no collision at existing header thresholds.
  - Verify: focused test and mid/desktop browser widths.

- [ ] **T2.7 (P1, ownership-gated)** — Audit watchlist rail and phone drawer.
  - Files: `PYRUS_SRC/features/platform/PlatformWatchlist.jsx`, `PYRUS_SRC/features/platform/MobileWatchlistDrawer.jsx`, `PYRUS_SRC/features/platform/PlatformWatchlist.test.mjs`, `PYRUS_SRC/features/platform/PlatformWatchlist.searchSource.test.mjs`.
  - Accept: active/passive route modes, loading/empty/error/stale states, focus restore, and 44px phone controls.
  - Verify: focused tests and shell browser spec.

- [ ] **T2.8 (P1, ownership-gated)** — Audit Algo monitor and footer context.
  - Files: `PYRUS_SRC/features/platform/PlatformAlgoMonitorSidebar.jsx`, `PYRUS_SRC/features/platform/PlatformAlgoMonitorSidebar.test.mjs`, `PYRUS_SRC/features/platform/PlatformAlgoMonitorSidebar.designConformance.test.mjs`, `PYRUS_SRC/features/platform/FooterMemoryPressureIndicator.jsx`, `PYRUS_SRC/features/platform/FooterMemoryPressureIndicator.test.mjs`.
  - Accept: collapsible monitor, tablet launcher, no duplication on Algo, footer/context never outranks the workspace.
  - Verify: focused tests and shell browser spec.

- [ ] **T2.9 (P1)** — Verify overlay interoperability before adding onboarding.
  - Files: `PYRUS_SRC/components/platform/platformOverlays.test.mjs`, `PYRUS_SRC/features/platform/CommandPalette.jsx`, new `PYRUS/e2e/overlay-interoperability.browser-validation.spec.ts`.
  - Accept: topmost-only Escape, focus trap/restore, inert background, correct z-order, 44px close controls, reduced motion, and no Drawer/BottomSheet/dialog/command-palette/tooltip/toast collision. Command Palette prevents one Escape from reaching an underlying guide/modal and restores focus. Any additional primitive defect becomes a separate bounded task.
  - Verify: source test and browser spec.

- [ ] **T2.10 (P1, ownership-gated)** — Audit boot, loading, and error recovery.
  - Files: `PYRUS_SRC/components/neural/NeuralLoader.tsx`, `PYRUS_SRC/components/platform/ContainerLoadingStatus.jsx`, `PYRUS_SRC/components/platform/ContainerLoadingStatus.test.mjs`, `PYRUS_SRC/components/platform/PlatformErrorBoundary.tsx`, new `PYRUS/e2e/loading-error-recovery.browser-validation.spec.ts`.
  - Accept: stable dimensions, theme parity, polite loading announcements, actionable failure, keyboard recovery, and doctrine widths.
  - Verify: focused tests and browser fault fixtures.

- [ ] **T2.11 (P1, ownership-gated)** — Audit global status, notification, and toast surfaces.
  - Files: `PYRUS_SRC/features/platform/HeaderStatusCluster.jsx`, `PYRUS_SRC/features/platform/HeaderStatusCluster.test.mjs`, `PYRUS_SRC/features/platform/ToastStack.jsx`, new `PYRUS/e2e/global-status-overlays.browser-validation.spec.ts`.
  - Accept: current trust/status reads first, toasts announce correctly, long/error states do not obscure primary actions, and nonmodal status/toast priority is deterministic.
  - Verify: focused tests and browser fixtures.

- [ ] **T2.12 (P1, ownership-gated privacy and overlay prerequisite)** — Isolate notification history by authenticated identity and fix drawer ownership.
  - Files: `PYRUS_SRC/features/platform/notificationStore.js`, new `PYRUS_SRC/features/platform/notificationStore.identity.test.mjs`, `PYRUS_SRC/features/platform/NotificationsDrawer.jsx`, `PYRUS_SRC/features/platform/PlatformApp.jsx`, new `PYRUS/e2e/notifications-identity.browser-validation.spec.ts`.
  - Accept: `PlatformApp` establishes the current immutable `user.id`, stamps it into each `captureToast`, clears both its visible toast state and the notification ring buffer on identity change, and clears the store identity on unmount. The next identity loads only `pyrus.notifications.lastReadAt.v1:${user.id}`. Signed-out/unknown identity exposes no prior rows. Captures stamped for a detached identity are ignored. `NotificationsDrawer` uses Radix Drawer/equivalent focus/inertness and topmost Escape semantics rather than the current document-level listener, so one keypress cannot also pause onboarding underneath. Repair clickable drawer rows at the same ownership seam: use a noninteractive row container with sibling, distinctly named native actions (or one single native row action), never `role=button` with nested buttons. The future onboarding invitation remains preference-backed and is not inserted into this ring buffer.
  - Verify: A toasts/read state → logout → B login shows zero A rows/counts; B read state does not suppress A after A returns; storage failure is honest/nonfatal; late A capture ignored; valid non-nested row semantics, names, keyboard order/actions; focus trap/restore; backdrop/Close/Escape; and overlay sequence with Command Palette/onboarding guide.

### Phase 3 — Onboarding shell, safety, and isolated practice

- [ ] **T3.1 (P1, ownership-gated)** — Mount the accessible onboarding host on existing navigation.
  - Files: new `PYRUS_SRC/features/onboarding/OnboardingHost.tsx`, new `PYRUS_SRC/features/onboarding/OnboardingGuide.tsx`, new `PYRUS_SRC/features/onboarding/OnboardingHost.test.mjs`, `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/index.css`.
  - Accept: uses `handleSetScreen` and the visible-screen store; consumes T1.5’s current-generation `useOnboardingRuntimeFacts` result with attached identity/current role rather than a second shell session/account snapshot; DOM readiness waits for the active host plus stable anchor and does not require `PlatformApp.screenReadiness`; target uniqueness/visibility/inert checks plus closed `data-onboarding-state` validation on required data anchors; modal/nonmodal focus rules; missing/non-ready-target fallback; no second navigation store. Identity/role facts must settle before the host opens; an unavailable track exposes no activation, and a formerly active track that becomes unavailable is paused before any guide renders. The host can perform only declared canonical navigation. For an existing-control step it observes a trusted activation inside a `ready` unique current anchor after the production handler and advances only after the declared next `ready` anchor/postcondition renders; a pre-existing postcondition requires a manual `Continue with current selection`. It never invokes the production action or creates a route-wide event bus. V1 uses only a static noninteractive rectangular outline—no spotlight/mask geometry. Phone placement measures header/nav and tries bottom/top positions; tablet/desktop placement measures the screen stack and tries four corners. Modal layers suspend guide and outline; one automatic non-smooth scroll is allowed before honest fallback.
  - Verify: host unit/source tests; T3.2 owns rendered geometry and overlay proof.

- [ ] **T3.2 (P1, ownership-gated)** — Prove guide geometry, target validity, obstacle handling, and overlay suspension.
  - Files: `PYRUS_SRC/features/onboarding/OnboardingGuide.tsx`, `PYRUS_SRC/features/onboarding/OnboardingHost.test.mjs`, `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/features/platform/BloombergLiveDock.jsx`, new `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: stable obstacle markers for toast stack, Bloomberg launcher/collapsed/expanded dock, modal surfaces, header, nav, footer, and active screen stack. Browser proof covers 390px bottom/top collision placement, measured safe area, one `behavior: "auto"` scroll then fallback; 768/1440 four-corner order inside the active stack; no sidebar/footer overlap; and no target-action occlusion.
  - Verify: duplicate/disconnected/zero-size/hidden/`aria-hidden`/inert/retained/disappearing anchors; 4px outline expansion/clamp; 2px border plus shape/text cue; aria-hidden/nonfocusable/pointer-none/no-animation highlight; required versus optional failure; modal suspension; toast/video relocation; opener/route-heading focus; long copy; both reduced-motion channels; and Escape sequence where the first key closes Command Palette/Notifications while the guide remains, then the next key pauses the guide.

- [ ] **T3.3 (P1)** — Ship the dense goal picker as a distinct onboarding surface.
  - Files: new `PYRUS_SRC/features/onboarding/OnboardingGoalPicker.tsx`, new `PYRUS_SRC/features/onboarding/OnboardingGoalPicker.test.mjs`, `PYRUS_SRC/components/platform/BottomSheet.jsx`.
  - Accept: Radix Dialog at desktop/tablet and existing BottomSheet on phone; narrowly extend BottomSheet with optional description/description-ID, `closeLabel`, and initial-focus ref/callback support instead of suppressing `aria-describedby` or focusing the header Close first. The picker supplies `Close and pause Getting Started`; Practice supplies `Close and pause practice`. Readiness/safety band comes first, then one deterministically recommended goal row and the remaining goals as hairline-separated rows—never a card grid. Rows expose available/active/paused/completed/updated/setup-needed/unavailable state, progress, and prerequisite truth; the full row is the single Start/Resume/Replay/Retry action with no nested action button. D1 keeps optional starts unavailable until `essentialsComplete` (boundary acknowledged plus readiness inspected); every authenticated role can then start Connect Account, and disconnected/unknown readiness remains Setup needed rather than disabled. Under D7, a historically complete Connect row derives Complete only from a fresh verified fact; drift uses the exact prior-completion-retained states/actions above without background history loss.
  - Verify: ordered-list semantics, deterministic recommendation ranking, keyboard/touch selection, focus trap/restore, exact close labels, initial focus priority Review essentials → Resume → recommended goal at 390px, long copy, all goal states/reasons, Connect complete→disconnect/stale/error→reconnect/review transitions, 390/768/1440, light/dark, and no nested cards.

- [ ] **T3.4 (P1, ownership-gated)** — Add desktop command-palette re-entry.
  - Files: `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/features/platform/AppHeader.jsx`, `PYRUS_SRC/features/platform/CommandPalette.jsx`, `PYRUS_SRC/features/platform/AppHeader.navigationLayout.test.mjs`, new `PYRUS_SRC/features/onboarding/onboardingDesktopReentry.test.mjs`.
  - Accept: “Open Getting Started” opens/resumes by keyboard and command palette without permanent chrome.
  - Verify: command ranking, keyboard, focus return, and active-track resume tests.

- [ ] **T3.5 (P1, ownership-gated)** — Add phone More re-entry.
  - Files: `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/features/platform/MobileMoreSheet.jsx`, `PYRUS_SRC/features/platform/PlatformShell.mobileNavigation.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: a 44px Getting Started action opens/resumes; More focus restores; guide respects nav/safe-area height.
  - Verify: source test and 390px browser flow.

- [x] **T3.6 (P1, D2 pilot disposition)** — Omit the superseded initial invitation lane.
  - Accept: the approved pilot uses the exact versioned auto-open contract in T1.4/T3.6c plus permanent Command Palette / phone More re-entry. It adds no initial invitation row to the notification ring buffer or drawer.
  - Verify: no invitation mutation/state path is required for initial pilot entry.

- [ ] **T3.6b (P1, ownership-gated, conditional on D6; independent of D2)** — Add the versioned required-safety update notice.
  - Files: new `PYRUS_SRC/features/onboarding/onboardingRequiredNotice.ts`, new `PYRUS_SRC/features/onboarding/onboardingRequiredNotice.test.mjs`, `PYRUS_SRC/features/platform/PlatformShell.jsx`, `PYRUS_SRC/features/platform/AppHeader.jsx`, `PYRUS_SRC/features/platform/NotificationsDrawer.jsx`.
  - Accept: after auth/preferences settle, a required-safety version bump creates one preference-backed nonblocking drawer row only for a positive previously acknowledged safety version below current, even when the initial invitation is omitted. Default/never-acknowledged version 0 and already-current acknowledgement never render “updated.” Opening the drawer records only `requiredNoticeSeenVersion`; opening Safety essentials or dismissing the row records `requiredNoticeResolvedVersion`; neither action changes `requiredAcknowledgedVersion` or `readinessInspectedVersion`. Only completing the revised essentials records acknowledgement/inspection. The row never auto-opens, blocks the workspace, or appears above a destructive confirmation; permanent replay remains.
  - Verify: 0/current, prior/current, current/current, dismissed current, and next-version eligibility; unseen required notice contributes its own accessible header badge even with D2 invitation absent; unseen/seen/resolved/acknowledged are independent; dismiss without acknowledgement; open then pause; later acknowledge; identity isolation; and overlay/focus behavior.

- [x] **T3.6c (P1, ownership-gated, D2 approved auto-open)** — Consume the per-user versioned opening fact in the host.
  - Files: `PYRUS_SRC/features/onboarding/OnboardingHost.tsx`, new `PYRUS_SRC/features/onboarding/onboardingAutoOpen.test.mjs`, `PYRUS_SRC/features/platform/PlatformShell.jsx`.
  - Accept: auto-open occurs only after exact auth identity, workspace, and preferences settle, for the immutable user’s first unshown catalog version, and never over a destructive/modal overlay. Missing progress is not called eligibility; `autoOpenShownVersion` is the closed persisted authority.
  - Verify: unshown/shown version, identity switch, delayed/stale response, destructive-overlay deferral, one-open maximum, and permanent manual re-entry.

- [ ] **T3.7 (P1)** — Ship required safety essentials.
  - Files: new `PYRUS_SRC/features/onboarding/SafetyEssentials.tsx`, new `PYRUS_SRC/features/onboarding/SafetyEssentials.test.mjs`, `PYRUS_SRC/features/onboarding/onboardingCatalog.ts`, `PYRUS_SRC/features/onboarding/onboardingModel.ts`, `PYRUS_SRC/features/onboarding/OnboardingGoalPicker.tsx`.
  - Accept: `essentialsComplete` requires boundary acknowledgement plus readiness inspection, not an already-verified account connection; Connect Account becomes available afterward for every authenticated role even with disconnected/unknown connection state; completion cannot unlock trading; workspace behavior follows D1/D6.
  - Verify: stored-completion adversarial test, focus/reduced-motion checks, and disconnected/unknown/ready facts.

- [ ] **T3.8 (P1)** — Build the isolated synthetic Practice Lab component and local model.
  - Files: new `PYRUS_SRC/features/onboarding/OrderReviewPractice.tsx`, new `PYRUS_SRC/features/onboarding/orderReviewPracticeModel.ts`, new `PYRUS_SRC/features/onboarding/OrderReviewPractice.test.mjs`.
  - Accept: a visually distinct standalone `Practice Lab` with persistent synthetic/no-send labels; fixed Practice Account, synthetic asset/quote, intentional BUY/SELL choice, whole quantity, MARKET/LIMIT, conditional price, local estimate, inline review ledger, and completion copy `Practice complete. No order was created.` The first review attempt completes Build. Invalid input enters/stays on Resolve validation and focuses the first error; a valid first attempt atomically completes Resolve and opens Review; a later valid retry does the same. Back/edit/reset/pause/close/remount follows the strict volatile restart contract above; Finish alone completes the third boundary step from fresh local evidence. It never uses Order Ticket, Place, Submit, Fill, broker preview, Live/Shadow styling, real account/provider marks, or production confirmation placement. Local validation only; zero component-owned requests and forbidden imports/endpoints rejected.
  - Verify: reducer/validation/accessibility; valid-first and invalid-first paths; Back→edit; Reset; pause/close/remount/reload stale-step repair; Practice→other-goal switch followed by stale unmount leaves the destination untouched; replay; edit invalidation; focus; exact pause/close copy; forbidden-import/source assertions; and zero component-owned fetch/XHR/beacon/form/navigation effects.

- [ ] **T3.9 (P1, ownership-gated)** — Integrate Practice Lab into the onboarding host and prove the network boundary.
  - Files: `PYRUS_SRC/features/onboarding/OnboardingHost.tsx`, `PYRUS_SRC/features/onboarding/OnboardingHost.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`, `API_SRC/services/route-admission.test.ts`.
  - Accept: the host mounts/unmounts Practice Lab from the catalog track, uses the atomic track-scoped pause-and-restart action, and persists only bounded progress. Safe QA is explicitly proven to allow protected execution so it cannot be the protection boundary. The browser instruments fetch, XHR, sendBeacon, form submission, and navigation while completing/resetting/replaying. Before implementation, derive a closed same-origin GET allowlist from the authenticated shell plus T1.5 query owners (auth/session, preferences, platform session, provider readiness, broker connections, included accounts, and only unavoidable baseline shell reads observed in the fixture). Evaluate permission by HTTP method plus exact normalized path: the enumerated read-only GETs remain allowed even when their canonical path lives under a `broker-execution` namespace; reject every unlisted GET. Permit the authenticated `/api/settings/preferences` PATCH only when the parsed body changes bounded onboarding state and leaves every unrelated preference semantically unchanged. After those exact exceptions, fail every mutation and every order-lifecycle, broker-connect, sync, or import route; never use a blanket path-fragment ban that catches an allowlisted readiness/account GET. Also fail every form/beacon and every external or OAuth navigation/callback.
  - Verify: integration mount/focus/pause/resume/replay; edit/pause/reload adversaries; preference save creates no order/broker record; safe-QA contract remains separate; and the complete browser deny layer at 390/768/1440.

### Phase 4 — Route-owned UI/UX slices

- [ ] **T4.1 (P1)** — Simplify Research route ownership before touching Photonics internals.
  - Files: `PYRUS_SRC/screens/ResearchScreen.jsx`, new `PYRUS_SRC/screens/ResearchScreen.routeHost.test.mjs`.
  - Accept: one visible page heading, one unique route root ID, no redundant outer card/header.
  - Verify: 390/768/1440, light/dark, focus, reduced motion, duplicate-ID assertion.

- [ ] **T4.2 (P2)** — Correct Market activity semantics, then render-audit the production Market flow.
  - Files: `PYRUS_SRC/features/market/MarketActivityPanel.jsx`, new `PYRUS_SRC/features/market/MarketActivityPanel.semanticTone.test.mjs`, `PYRUS/e2e/market-demo-responsive.browser-validation.spec.ts`.
  - Accept: calendar activity is amber/nonpositive; Regime → Scanner → Chart → Context hierarchy remains dense and disjoint.
  - Verify: focused model/design tests and 390/768/1440 browser checks.

- [ ] **T4.3 (P1)** — Stabilize Signals scan and drilldown hierarchy.
  - Files: `PYRUS_SRC/screens/SignalsScreen.jsx`, `PYRUS_SRC/screens/SignalsScreen.state-contract.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: primary bias/freshness/gate information scans first; drilldown states are explicit; Signals → Trade intent remains intact.
  - Verify: state-contract tests and handoff fixture at all doctrine widths.

- [ ] **T4.4 (P1)** — Ship “Read a signal” as the first anchored pilot.
  - Files: `PYRUS_SRC/features/onboarding/onboardingCatalog.ts`, `PYRUS_SRC/screens/SignalsScreen.jsx`, new `PYRUS_SRC/screens/SignalsScreen.onboardingAnchors.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: teaches side, freshness, timeframe, gates, and drilldown; avoids toggle/scan/apply/refresh controls; one `signal-list` anchor encloses the virtualized selectable rows and one encompassing `signal-evidence` target owns the selected drilldown. Individual rows never repeat the anchor. Both anchors publish their exact loading/ready/empty/error/stale presentation state. A trusted row activation is accepted only from a ready list and advances only after `signal-evidence` becomes uniquely ready; an already-selected ready signal uses `Continue with current selection`. The manual evidence acknowledgement is enabled only while `signal-evidence` passes the host’s connected/visible/non-inert/active-host/ready validation; no route-local event store is added; zero mutations.
  - Verify: keyboard-only completion, virtualized row churn/scroll, duplicate-anchor rejection, empty/error-derived temporary Unavailable + Retry, missing-target fallback, Signals → Trade preservation, and browser request deny-list.

- [ ] **T4.5 (P1 checkpoint)** — Review the rendered read-only pilot before cloning anchored patterns.
  - Files: update this plan and active handoff only.
  - Accept: user approves guide anatomy, copy density, target outline, phone placement, pause/resume, and no-workspace-occlusion evidence.
  - Verify: before/after screenshots and accessibility-tree notes at 390/768/1440.

- [ ] **T4.6 (P1, ownership-gated)** — Stabilize Settings setup/recovery hierarchy.
  - Files: `PYRUS_SRC/screens/SettingsScreen.jsx`, new `PYRUS_SRC/screens/SettingsScreen.designConformance.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: phone tabs, dirty/apply/restart states, and Data & Broker hierarchy are intentional; no automatic mutations.
  - Verify: loading/error/dirty/success fixtures and doctrine widths.

- [ ] **T4.7 (P1, ownership-gated)** — Add Connect Account route/tab anchors.
  - Files: `PYRUS_SRC/features/onboarding/onboardingCatalog.ts`, `PYRUS_SRC/screens/SettingsScreen.jsx`, new `PYRUS_SRC/screens/SettingsScreen.onboardingAnchors.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: canonical navigation reaches Settings; any authenticated role explicitly selects Data & Broker; a trusted tab activation advances only after the unique provider-controls postcondition appears; an already-open tab uses `Continue with current selection`; missing targets never complete. Production entitlement/provider gates remain visible runtime state and never become a role-based onboarding exclusion.
  - Verify: keyboard route/tab flow and mutation deny-list.

- [ ] **T4.8 (P1, ownership-gated)** — Add broker panel readiness anchors without duplicating its state machine.
  - Files: `PYRUS_SRC/screens/settings/SnapTradeConnectPanel.jsx`, `PYRUS_SRC/screens/settings/SnapTradeConnectPanel.source.test.mjs`, `PYRUS_SRC/screens/settings/ibkrPortalConnectModel.js`, `PYRUS_SRC/screens/settings/ibkrPortalConnectModel.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: first repair the current nested-interactive broker cards: the card is a noninteractive group, provider selection is one native control with a distinct accessible name/state, and Connect/Sync/Disconnect/Reconnect actions are sibling controls in a separately named action group with deterministic focus order. `broker-provider-controls` and `broker-readiness` are then stable, unique, read-only guide targets; onboarding observes current provider/readiness and next explicit action and never launches OAuth/connect/sync/import. Only a trusted activation from the explicit provider-selection control can advance Choose provider, and only after the production panel renders its selected readiness state; action-group bubbling is excluded. An already-selected provider uses `Continue with current selection`. Under confirmed D7, completion means current-user connection plus account verified, never execution permission. Preserve the current user-level `broker_connect` authority and never reintroduce a role-only frontend guard; provider-specific compliance gates remain separate.
  - Verify: valid non-nested interactive semantics, screen-reader names/selected state, keyboard focus/selection, action-group activation never advances onboarding, entitled member/admin parity, entitlement/provider denial, disconnected/error/partial/connected-without-account/verified-connection fixtures, stale-data refetch, and zero mutation requests in the walkthrough fixture.

- [ ] **T4.9 (P1, ownership-gated)** — Stabilize Account source, risk, and Trade-review hierarchy.
  - Files: `PYRUS_SRC/screens/AccountScreen.jsx`, `PYRUS_SRC/screens/account/AccountScreen.designConformance.test.mjs`, `PYRUS/e2e/account-selector-density.browser-validation.spec.ts`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: 64px single-row phone source controls; positions/exposure/performance/orders scan correctly; Account → Trade remains review-only.
  - Verify: 390/768/1440 and focused intent tests.

- [ ] **T4.10 (P1, ownership-gated)** — Ship “Manage risk” on the stabilized Account surface.
  - Files: `PYRUS_SRC/features/onboarding/onboardingCatalog.ts`, `PYRUS_SRC/screens/AccountScreen.jsx`, new `PYRUS_SRC/screens/AccountScreen.onboardingAnchors.test.mjs`, `PYRUS/e2e/onboarding.browser-validation.spec.ts`.
  - Accept: teaches active source, exposure, concentration, position context, and review handoff using stable `account-active-source`, encompassing `account-risk-context`, and optional `account-position-handoff` targets without closing/cancelling/resizing/submitting. Required data anchors publish exact loading/ready/empty/error/stale presentation state. Manual source/risk acknowledgements are enabled only while their required anchors pass the host’s connected/visible/non-inert/active-host/ready validation; empty/error/stale states derive a concrete temporary Unavailable reason and Retry/Pause, never a completion or “zero risk” claim. No route-local event store is added.
  - Verify: keyboard completion, ready/loading/empty/error/stale anchor fixtures, temporary Unavailable + Retry, and zero mutations.

- [ ] **T4.11 (P1, ownership-gated)** — Improve Flow contract discovery and Trade handoff.
  - Files: `PYRUS_SRC/screens/FlowScreen.jsx`, `PYRUS_SRC/screens/FlowScreen.designConformance.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: filters/tape/selected contract/context preserve priority; empty/stale/error states remain actionable; contract-level handoff remains correct.
  - Verify: focused tests and Flow → Trade fixture.

- [ ] **T4.12 (P1, ownership-gated)** — Improve GEX expiration/metric/chart allocation.
  - Files: `PYRUS_SRC/screens/GexScreen.jsx`, `PYRUS_SRC/screens/GexScreen.truthfulReadiness.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: primary gamma and expiration read first; graph/table controls remain keyboard/touch accessible; missing data is truthful.
  - Verify: truth/readiness and projection tests plus doctrine widths.

- [ ] **T4.13 (P1, ownership-gated)** — Improve Trade chart/chain allocation.
  - Files: `PYRUS_SRC/screens/TradeScreen.jsx`, `PYRUS_SRC/screens/TradeScreen.phoneChartLayout.test.mjs`, `PYRUS_SRC/features/trade/TradeChainPanel.designConformance.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: chart and chain priority, phone Chart/Chain tabs, loading states, and no ticket occlusion.
  - Verify: focused tests and normal-route mutation-aborted browser fixtures.

- [ ] **T4.14 (P1, ownership-gated)** — Improve Trade positions and flow context.
  - Files: `PYRUS_SRC/screens/TradeScreen.jsx`, `PYRUS_SRC/features/trade/TradePositionsPanel.jsx`, `PYRUS_SRC/features/trade/TradePositionsPanel.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: open positions, flow context, empty/error/stale states, and review intents are explicit without submitting.
  - Verify: focused tests and mutation-aborted browser fixtures.

- [ ] **T4.15 (P1, ownership-gated)** — Improve Trade strategy, Greeks, and L2 context.
  - Files: `PYRUS_SRC/features/trade/TradeStrategyGreeksPanel.jsx`, `PYRUS_SRC/features/trade/PayoffDiagram.jsx`, `PYRUS_SRC/features/trade/TradeL2Panel.jsx`, `PYRUS_SRC/features/trade/TradeL2PanelDiagnostics.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: secondary analysis never outranks ticket/chart; unavailable/partial data is truthful; keyboard and phone allocation hold.
  - Verify: focused L2 fixture and doctrine widths.

- [ ] **T4.16 (P1, ownership-gated)** — Improve ticket clarity while preserving every execution gate.
  - Files: `PYRUS_SRC/features/trade/TradeOrderTicket.jsx`, `PYRUS_SRC/features/trade/TradeOrderTicket.brokerOptions.test.mjs`, `PYRUS_SRC/features/trade/TradeOrderTicket.ibkrLifecycle.test.mjs`, `PYRUS_SRC/features/trade/TradeOrderTicket.shadowBrokerGate.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: environment/account/asset/side/quantity/type/price/estimate/review read in order; submit/cancel/replace confirmation and broker-specific gates remain unchanged.
  - Verify: execution safety tests first; browser aborts all mutations and inspects only non-side-effectful states.

- [ ] **T4.17 (P1, ownership-gated)** — Improve Backtest completion and draft-promotion clarity.
  - Files: `PYRUS_SRC/features/backtesting/BacktestingPanels.tsx`, `PYRUS_SRC/features/backtesting/BacktestingPanels.designConformance.test.mjs`, `PYRUS_SRC/features/backtesting/mobileDataLayouts.designConformance.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: inputs → results → warnings → trades/logs/history hierarchy; empty/error/partial states; promoted draft remains explicit.
  - Verify: focused Backtest tests and Backtest → Algo draft fixture.

- [ ] **T4.18 (P1, ownership-gated)** — Improve Algo deployment safety and operational scan.
  - Files: `PYRUS_SRC/screens/AlgoScreen.jsx`, `PYRUS_SRC/screens/AlgoScreen.test.mjs`, `PYRUS_SRC/screens/algo/AlgoLivePage.jsx`, `PYRUS_SRC/screens/algo/AlgoLivePage.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: Shadow/live unmistakable; live switch remains destructively confirmed and separately paused; candidate/position → Trade remains review-only.
  - Verify: deployment tests, Algo → Trade fixture, and nonmutating confirmation browser state.

- [ ] **T4.19 (P2, ownership-gated)** — Improve Diagnostics recovery hierarchy.
  - Files: `PYRUS_SRC/screens/DiagnosticsScreen.jsx`, `PYRUS_SRC/screens/diagnostics/MachineStateDiagram.jsx`, new `PYRUS_SRC/screens/diagnostics/MachineStateDiagram.contract.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: current failure, impact, evidence, and next safe action scan in order; raw detail remains available without dominating.
  - Verify: overview/broker/data/API/browser/memory/storage/event fixtures.

- [ ] **T4.20 (P2, ownership-gated)** — Re-audit signed-out authentication and first-time operator setup.
  - Files: `PYRUS_SRC/features/auth/LoginGate.jsx`, `PYRUS_SRC/features/auth/LoginGate.visualPolicy.test.mjs`, `PYRUS/e2e/login-gate-responsive.browser-validation.spec.ts`.
  - Accept: readable typography, 44px controls, honest token/error/pending/success behavior, and no product-onboarding copy conflated with account bootstrap.
  - Verify: 390/768/1440 light/dark and keyboard/error tests.

- [ ] **T4.21 (P2, ownership-gated)** — Refine Photonics only after route-host ownership is fixed.
  - Files: `PYRUS_SRC/features/research/PhotonicsObservatory.jsx`, `PYRUS_SRC/features/research/PhotonicsObservatory.designConformance.test.mjs`, `PYRUS_SRC/features/research/PhotonicsObservatory.tableSemantics.test.mjs`, `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts`.
  - Accept: one hierarchy, intentional tablet allocation, reduced motion for all transitions, shared surfaces where appropriate, and Research → Trade preserved.
  - Verify: 390/768/1440, light/dark, keyboard, reduced motion, and Research → Trade fixture.

### Phase 5 — Closure and continuing loop

- [ ] **T5.1 (P1)** — Run the exact focused tests listed by the active slice and `PYRUS/e2e/design-doctrine-matrix.browser-validation.spec.ts` at checkpoints.
- [ ] **T5.2 (P1)** — Run PYRUS typecheck/build and, whenever server files change, API-server typecheck/build.
- [ ] **T5.3 (P1)** — Reload only with SIGUSR2 to the live pid2-owned supervisor when runtime verification is needed; poll health to 200 and verify the same PID survives.
- [ ] **T5.4 (P1)** — Run authenticated visual/design QA against the normal app URL. Use `?pyrusQa=safe` only in the separately named `PYRUS/e2e/safe-qa-contract.browser-validation.spec.ts` that intentionally tests safe-QA behavior itself—never for general fixture, route, or design QA and never as an execution guard.
- [ ] **T5.5 (P1)** — Update this document’s Coverage Ledger and `SESSION_HANDOFF_LIVE_2026-07-16_all-pages-ui-ux-improvements.md` after each meaningful tranche; select the next highest-impact unowned route slice.
- [ ] **T5.6 (P1)** — Preserve workstation speed with existing performance authorities: after each shared-shell/onboarding tranche run `bundle:audit`, and at checkpoints run the normal authenticated waterfall audit for all 11 visible screens. Record visible-ready timings and chunk-budget deltas; investigate regressions before cloning the slice.

## Validation Commands

Shared fast path for each frontend slice; run the active task’s exact listed tests before these commands:

```bash
pnpm --filter @workspace/pyrus run audit:design
pnpm --filter @workspace/pyrus run test:design-source
pnpm --filter @workspace/pyrus run typecheck
pnpm --filter @workspace/pyrus run build
pnpm --filter @workspace/pyrus run bundle:audit
```

Checkpoint performance path after the build, with the same approved nonmutating storage-state controls as the doctrine matrix:

```bash
PYRUS_WATERFALL_SCREENS=market,signals,flow,gex,trade,account,research,algo,backtest,diagnostics,settings \
  pnpm --filter @workspace/pyrus run browser:waterfall:normal
```

Onboarding/server safety path:

```bash
pnpm --filter @workspace/pyrus exec tsx --test \
  src/features/auth/queryIdentityBoundary.test.mjs \
  src/features/preferences/useUserPreferences.identity.test.mjs \
  src/features/onboarding/onboardingModel.test.mjs \
  src/features/onboarding/onboardingCatalog.test.mjs \
  src/features/onboarding/onboardingPendingStorage.test.mjs \
  src/features/onboarding/onboardingRuntimeFacts.test.mjs \
  src/features/onboarding/useOnboardingRuntimeFacts.test.mjs \
  src/features/onboarding/OnboardingHost.test.mjs \
  src/features/onboarding/OnboardingGoalPicker.test.mjs \
  src/features/onboarding/SafetyEssentials.test.mjs \
  src/features/onboarding/OrderReviewPractice.test.mjs
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
  src/routes/settings.test.ts \
  src/services/route-admission.test.ts \
  src/services/user-preferences-fallback.test.ts \
  src/services/user-preferences-model.test.ts
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build
```

Run only the conditional broader-program tests brought into scope. The pilot
auto-open behavior is covered by the normal onboarding model/host suites:

```bash
# D6 required-safety version notice
pnpm --filter @workspace/pyrus exec tsx --test \
  src/features/onboarding/onboardingRequiredNotice.test.mjs
# D2 approved versioned auto-open
pnpm --filter @workspace/pyrus exec tsx --test \
  src/features/onboarding/onboardingAutoOpen.test.mjs
```

Authenticated normal-route doctrine matrix, only with user-approved nonmutating credentials captured to an ephemeral file outside the repository:

```bash
set -euo pipefail
test -n "$PYRUS_STORAGE_STATE"
test -f "$PYRUS_STORAGE_STATE"
STATE_PATH="$(realpath -- "$PYRUS_STORAGE_STATE")"
test -f "$STATE_PATH"
case "$STATE_PATH" in "$PWD"|"$PWD"/*) exit 1 ;; esac
test "$(stat -c '%a' "$STATE_PATH")" = "600"
export PYRUS_STORAGE_STATE="$STATE_PATH"
test -n "$PYRUS_QA_ARTIFACT_DIR"
ARTIFACT_DIR="$(realpath -- "$PYRUS_QA_ARTIFACT_DIR")"
test -d "$ARTIFACT_DIR"
case "$ARTIFACT_DIR" in "$PWD"|"$PWD"/*) exit 1 ;; esac
test "$(stat -c '%a' "$ARTIFACT_DIR")" = "700"
export PYRUS_QA_ARTIFACT_DIR="$ARTIFACT_DIR"
umask 077
PYRUS_APP_URL=http://127.0.0.1:18747/ \
  pnpm --filter @workspace/pyrus exec playwright test \
  e2e/design-doctrine-matrix.browser-validation.spec.ts --reporter=list

# After T3.9, run the onboarding host/simulator deny-layer matrix separately.
PYRUS_APP_URL=http://127.0.0.1:18747/ \
  pnpm --filter @workspace/pyrus exec playwright test \
  e2e/onboarding.browser-validation.spec.ts --reporter=list
```

Never print or commit the storage-state file. Keep it and authenticated screenshots/traces outside the repository with mode 0600, then delete or explicitly expire them when the user-approved QA window closes. The safe-QA contract runs separately by its exact spec filename and does not substitute for this matrix.

For runtime verification, use Replit's managed workflow restart action and
poll `http://127.0.0.1:8080/api/healthz` for 200. Do not signal the launcher.

Do not launch a replacement dev process, use generated Configure Your App workflows, or change Replit control-plane/startup state during this program.

## Checkpoints

Human review is required at these boundaries:

1. Foundation + Connect Account pilot: D1/D2/D7/D8 are confirmed, D3/D5 are source-derived invariants, and the D4/D6 pilot ceilings are recorded. Any broader behavior beyond those ceilings requires a new approval boundary.
2. Approve onboarding information architecture before shell integration.
3. Review rendered onboarding at all doctrine widths before adding production-screen anchors.
4. Review the first full goal track before cloning the pattern to the remaining tracks.
5. Review each route slice's before/after evidence before moving to the next route.

## Not in Scope

- Replacing the app with a beginner-oriented interface.
- A third-party tour framework or generic global anchor/event system.
- Trusting safe QA, localStorage, or tutorial completion as an execution safeguard.
- Automatically initiating broker OAuth/connect/sync/import flows.
- Automatically placing, cancelling, replacing, or closing live or Shadow orders.
- A single horizontal rewrite of every screen.
- Replit startup/control-plane maintenance, database startup changes, or deployment.
- Route-history work while its current implementation/test ownership is unresolved.
- A broad Photonics refactor before the small Research route-host responsibility is fixed and rendered.
- Development-only unauthenticated lab/crash routes (`?lab=chart-parity`, `?lab=ticker-search`, and `?crash=render`) except when a separate tooling task explicitly brings one into scope.

## Current Plan Readiness

The plan is implementation-specific and covers hierarchy, states, journey,
safety, responsive behavior, accessibility, dependencies, ownership, coverage,
and verification. The foundation + Connect Account pilot is approved under
D1–D8 as recorded in the decision register. The remaining goal tracks,
full-route visual program, future required-safety update notices, and any
cross-device merge/CAS expansion remain draft and require their own review.
