# Runtime Inhibitor Modal Plan

Date: 2026-07-16
Status: plan approved as `open once`; transport foundation repaired, inhibitor product stages not implemented

## Outcome

Make active conditions that prevent an advertised system from functioning impossible to miss. The application should auto-open one global modal once for each stable root-cause key, keep an exact active badge until the condition resolves, retain a useful local history, and produce a safe Markdown report that can be pasted directly to an engineering agent.

This is an inhibitor surface, not a second general-purpose diagnostics screen and not a frontend guess at severity.

## Observed Starting Point

- The server already assigns the stable root-cause identity `incidentKey = subsystem:category:code`.
- The missing Signal Options deployment is already emitted as `automation:deployment:signal_options_deployment_missing`, and its domain owner knows that default shadow automation cannot run.
- The diagnostics event contract currently distinguishes only `info` and `warning`; it cannot state that an incident blocks a product capability.
- The current latest payload slices generic events, and generic in-memory and one-day database retention can still age out history. A semantic list of active inhibitors must not inherit display/history limits.
- The browser now has one administrator-gated, ref-counted diagnostics transport. Opening Diagnostics does not create a second EventSource; `ready` carries metadata and the subscription owns one initial authoritative snapshot.
- Diagnostics screen history is still mostly component memory. Pressure-selected read/export caps and pressure-skipped event persistence have been removed, but retention is not an authoritative active-state contract.
- Existing failure-point normalization and crash-report redaction can be reused, but raw diagnostics payloads are not safe material for the copy action.
- `PlatformShell` is the existing global overlay boundary. The header needs an inhibitor entry point on both desktop and mobile.
- The Algo live/shadow inventory bug demonstrates why the modal must report domain-owned root state. A global pressure label or frontend inference would have blamed the wrong subsystem.

## Product Decisions

### Impact is domain-owned

Add an explicit impact enum:

```text
observational | degraded | inhibitor
```

Existing warnings default to `degraded`. Only the backend code that owns a capability may mark it `inhibitor`; the frontend must not infer this from words, severity, pressure level, or time elapsed. The Signal Options missing-deployment incident is the first inhibitor.

### “Open once” means once per root-cause key

- Persist `autoOpenedAt` before opening the dialog.
- The same `incidentKey` never steals focus again, including after a reload or after resolving and recurring.
- A recurrence still reactivates the badge and updates history.
- If product later wants once per occurrence, the backend must add a durable occurrence ID. Timestamps and event counts are not reliable occurrence identities.

### Acknowledgment does not hide impact

Closing or acknowledging the modal suppresses focus stealing only. It never clears an active badge. Only an authoritative server snapshot that omits or resolves the inhibitor clears it from the active count.

### No arbitrary history ceiling

The normalized local store has one record per stable incident key. It does not use a `50`, `64`, or similar record cap. If storage becomes unavailable or quota-limited, the feature continues in memory and visibly reports that history persistence is unavailable.

## Architecture

```text
domain diagnostics builders
          |
          v
explicit impact + stable incidentKey
          |
          v
complete activeInhibitors in authoritative snapshot
          |
          v
one admin-gated diagnostics stream store
          |
          +--> memory-pressure consumer
          +--> Diagnostics screen
          +--> runtime inhibitor controller
                         |
                         +--> exact active badge
                         +--> persisted redacted history
                         +--> one-time modal
                         +--> agent-ready report
```

The shared stream owns one EventSource and one observable HTTP fallback. The SSE `ready` event carries connection metadata only; the subscriber replay supplies the single authoritative initial snapshot.

## Implementation Stages

### 1. Repair and consolidate the transport — complete foundation

- Completed: removed the duplicated full payload from `ready`.
- Completed: one ref-counted diagnostics stream store serves the memory-pressure hook and Diagnostics screen.
- Completed: client and server are administrator-gated consistently.
- Completed: one visible HTTP fallback remains without an independent polling owner.
- Completed: focused tests prove consumers share one transport and one initial snapshot.
- Completed: the server writer coalesces snapshots/heartbeats under socket backpressure and disconnects with distinct overflow, drain-timeout, or socket-write-error reasons instead of retaining an unbounded promise chain or mislabeling every failure as a timeout.

### 2. Add explicit inhibitor semantics

- Add `DiagnosticImpact` to service inputs, stored events, the database schema, OpenAPI, generated Zod, and generated client types.
- Default current warnings to `degraded` so existing callers remain truthful.
- Mark only `signal_options_deployment_missing` as `inhibitor` initially.
- Add a complete `activeInhibitors` collection to the latest snapshot. It must be independent of generic event slices and generic event-map trimming.
- Keep active inhibitors in semantic state until their domain condition clears, even if generic event history is pressured or unavailable.

### 3. Add the transport-independent store

Normalize and persist only:

```text
key, status, subsystem, category, code, impact, message,
firstSeenAt, lastSeenAt, eventCount, failurePoint,
autoOpenedAt, acknowledgedAt, resolvedAt
```

- Key storage by authenticated user.
- Never persist raw payloads or unrestricted dimensions.
- Persist the auto-open decision before changing UI state.
- Synchronize state through the browser `storage` event.
- Only the existing workspace-leader tab may auto-open; all tabs show the badge.
- Surface corrupt/quota-limited persistence as a visible feature state rather than silently discarding history.

### 4. Add the modal and global badge

- Mount one Radix dialog at `PlatformShell`, reusing the existing focus, Escape, outside-click, and focus-restoration patterns.
- Show active inhibitors first, then resolved history.
- Reuse normalized failure-point details for the selected incident.
- Provide `Copy redacted report`, `Open Diagnostics`, and `Acknowledge / Close` actions.
- Add exact-count triggers to desktop and mobile header layouts.
- Defer auto-open while another modal or critical mutation owns focus; keep the badge active immediately and open when safe.

### 5. Build the agent-ready copy path

- Extract the recursive crash-diagnostics redactor into a shared module and keep existing crash reporting on it.
- Generate concise Markdown with schema version, root-cause key, status, subsystem/category/code, first/last observation, count, redacted evidence, likely next action, safe build identity, current screen, transport state, and whether persistence was limited.
- Exclude raw events, full URLs, proxy targets, ports, account identifiers, credentials, tokens, and cookies.
- Apply recursive redaction again after assembling the report.
- If Clipboard API access fails, expose a selectable report and an explicit error.

## Accessibility and Mobile Acceptance

- Labelled title and description, focus trap, Escape handling, and focus restoration.
- No repeated live-region announcement for periodic snapshots; copy success uses `aria-live="polite"`.
- Full-height-capable mobile layout with safe-area padding, internal scroll, sticky actions, and 44px touch targets.
- A dedicated mobile trigger; no hover-only path.
- Reduced-motion behavior follows the application preference.

## Verification Gates

1. The missing deployment is an `inhibitor`; an ordinary warning remains `degraded`.
2. Generic 50/500-style event limits cannot truncate `activeInhibitors`.
3. One connection receives one initial full snapshot.
4. All consumers together create exactly one diagnostics EventSource.
5. Duplicate snapshots and reloads cannot reopen the same root-cause modal.
6. Resolution clears the active badge but retains history; recurrence does not steal focus again.
7. Corrupt and quota-limited storage remain visible and do not disable live inhibitor state.
8. Cross-tab synchronization updates all badges, while only the leader may auto-open.
9. Copied reports exclude raw content and redact bearer tokens, JWTs, secrets, URLs, and broker/account identifiers.
10. Desktop and mobile triggers expose the exact accessible active count.
11. Existing memory-pressure monitoring and Diagnostics screen tests remain green.
12. An attached-runtime watch shows no additional diagnostics connection or event-loop pressure after rollout.

## Non-goals

- Do not turn every warning or high ELU sample into an inhibitor.
- Do not auto-remediate trading, broker, or deployment state from the modal.
- Do not add another SSE connection, polling loop, retry stack, or arbitrary record ceiling.
- Do not weaken administrator authorization or copy raw diagnostic exports.
