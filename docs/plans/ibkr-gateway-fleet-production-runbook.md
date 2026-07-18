# IBKR gateway fleet production runbook

Last reviewed: 2026-07-18

Status: **HOLD**. This runbook is executable only after every hard gate below
has evidence. It does not authorize a Replit publish, secret change, host
approval, broker login, or order.

## Scope and topology

The approved first-production topology is one Replit Reserved VM with one
externally exposed fullstack API port and one loopback-only IBKR session host:

```text
internet -> API/web :18747
                  |
                  +-> signed loopback control -> session host 127.0.0.1:18748
                                                   |
                                                   +-> local Docker socket
                                                       -> isolated paper capsule(s)
```

The API owns the fleet root secret. The production supervisor derives a
host-ID-bound key and passes only that derivative to the host child. The host
never receives the root key, database URL, or unrelated broker/API secrets.
Fleet routing is disabled until the host has registered, remained healthy, and
been explicitly approved.

### Accepted topology limits

The API and session-host processes share one VM and Unix trust zone. Passing a
minimal child environment prevents accidental secret propagation, but it is
not process-level isolation and does not prove that a compromised same-UID
process cannot inspect sibling process state. The host also controls the local
Docker socket, which is host-equivalent authority over daemon-managed
workloads. Capsules and public traffic must never receive that socket.

This co-located shape is the approved first-production topology. A requirement
for a stronger API-to-host isolation boundary changes the architecture: move
the session host to a separately administered Docker-capable VM and review its
network authentication, transport, and failure modes before use.

## Facts, inferences, and unknowns

| Kind | Statement |
|---|---|
| Observed | The repository builds the web app, API, session host, and local operator CLI. The production supervisor owns both children and treats either exit as fatal. |
| Observed | Host registration is HMAC-authenticated, quarantined by default, attestation-bound, and heartbeat-gated. Approval requires exact immutable values and a fresh heartbeat. |
| Observed | The host refuses readiness unless the pinned seccomp file, Docker daemon capabilities, and exact immutable capsule image all pass its runtime checks. |
| Observed | Fresh placement requires capsule lease protocol version 1. The migration records existing hosts as version 0, and the host capability is immutable for a host ID. |
| Observed | The authenticated session host—not the API—mints every capsule grant from its own Linux boot ID and `CLOCK_BOOTTIME`, returns that grant only in the signed receipt, and applies it locally before acknowledging control. Its 20-second grant window plus the capsule's fixed 120-second TTL remains inside the database's 155-second replacement fence. |
| Observed | A disposable development-image preflight on this workspace host rejected an invalid HMAC lease frame, accepted a real host-local renewal through the private TCP bridge, remained ready with zero logins/restarts/OOM kills, and cleaned up without touching the live API or unrelated slot 1. This is local transport evidence, not Reserved VM release evidence. |
| Observed | The development workspace parent cgroup is capped at 1,024 tasks and has reached that exact peak. A 60-second no-login probe of the current image reached a sampled maximum of 107 capsule PIDs. In the final staged five-new-capsule attempt, slots 2–5 reached ready with zero logins, slot 6 began at 1,014 tasks and failed its Docker operation, and the parent limit-event counter rose from 469 to 545. Scoped cleanup was exact. This is a development-host capacity failure, not a capsule OOM or per-container PID-limit event. |
| Observed | This release is not wire-compatible with a mixed-version rolling registration: the prior API rejects the new capability field, while the new API rejects registrations that omit it. |
| Observed | The runtime-attestation digest is configured identity data, not a digest dynamically measured by the host. Runtime readiness is evidenced separately by fresh lifecycle traffic. |
| Observed | The repository now has a clean-tree, registry-neutral BuildKit publish path that emits provenance, an SBOM, exact image/config evidence, and a release manifest. |
| Observed | On an enabled deployment, the API starts normally while the host wrapper preloads and validates only the configured immutable digest. Session-host code is imported only after that succeeds; capsule creation retains `--pull never`. |
| Observed | The guarded paper-density runner binds the host control port, refuses active or pre-existing capsule state, executes the fixed `1 → 2 → 5 → 10 → 15 → 20` lease-v1 ramp, records API/container/host samples, cleans up, and never changes admission capacity. |
| Observed | Replit documents Reserved VM as an always-on deployment selected in the Publishing tool, with published-app secrets, monitoring, and configurable port mapping. |
| Inferred | The explicit host-child environment allowlist reduces direct authority but does not isolate two same-UID processes on the same VM. |
| Unknown | Replit's public documentation does not establish that the selected published Reserved VM exposes a usable Docker daemon/socket with the required capabilities. |
| Unknown | No registry has been owner-approved and no exact release image/manifest has been published from the eventual clean release commit. |
| Unknown | The exact published image has not been preloaded and inspected on the selected Reserved VM. |
| Unknown | The selected Reserved VM's parent-cgroup task ceiling, idle baseline, and per-capsule peak have not been measured. A 1,024-task ceiling is insufficient for the 20-session target even before adding host-process headroom at the locally observed 107 PIDs per no-login capsule. |
| Unknown | A trusted shell with the published app environment and production database has not been proven. Without one, the non-network approval CLI cannot be used against production. |
| Inferred | A fresh signed heartbeat proves the host's runtime readiness check passed at that time, because lifecycle traffic is withheld while runtime readiness is degraded. |

Primary Replit references:

- [Deployment types](https://docs.replit.com/features/publishing/deployment-types)
- [Published app monitoring](https://docs.replit.com/features/publishing/monitoring-a-deployment)
- [Publishing troubleshooting](https://docs.replit.com/build/troubleshooting)

## Non-negotiable invariants

1. Use a Reserved VM. Autoscale is not an approved stateful session-host
   topology.
2. Expose only the API/web port. The session host, capsule relays, CPG, noVNC,
   and Docker socket remain non-public.
3. Start in `paper` mode with host capacity and admission capacity both set to
   `1`.
4. Keep `IBKR_GATEWAY_FLEET_ENABLED=0` through build, publish, runtime preflight,
   registration, and approval.
5. Leave `IBKR_SESSION_HOST_CONTROL_TOKEN`,
   `IBKR_SESSION_HOST_CONTROL_KEY`, and
   `IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY` unset in co-located production. The
   supervisor derives and overrides host keys.
6. Never put a root key in a command argument, shell history, log, handoff,
   screenshot, issue, or runbook evidence.
7. Do not approve self-invented attestation values. The workload, runtime-spec,
   runtime-attestation, and image digests must match a separately reviewed
   release manifest and the registered host record exactly.
8. Do not raise admission capacity above `1` until the corresponding measured
   density/chaos evidence is attached to the release record.
9. No live order is part of this runbook. Any later live-order proof requires a
   separate, exact per-order user approval.
10. Do not attempt a mixed-version rolling registration. With fleet routing off
    and no active leases, apply the additive migration, publish the new API with
    the host disabled, and only then start the version-1 host under a fresh host
    UUID. Never reuse a migrated version-0 host ID for this release.
11. Do not mint capsule grants in the API process or compare absolute
    `CLOCK_BOOTTIME` values across machines. The API authenticates the control
    attempt; the selected session host mints and applies the local-kernel grant.

## Required published-app configuration

Configure production values in Replit's Publishing tool. Replit notes that
Project Editor secrets do not automatically establish published-app secrets,
so verify the published list explicitly.

| Setting | Initial value or rule | Secret |
|---|---|---|
| `IBKR_GATEWAY_FLEET_ENABLED` | `0` | No |
| `IBKR_SESSION_HOST_ENABLED` | `1` for the runtime preflight publish | No |
| `IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY` | Canonical 32-byte base64url value from the approved secret manager | Yes |
| `IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY` | Unset outside a bounded rotation window | Yes |
| `IBKR_SESSION_HOST_ID` | Fresh canonical UUID for this immutable version-1 host identity; do not reuse a migrated version-0 row | No |
| `IBKR_SESSION_HOST_CONTROL_TOKEN` | Unset | Yes |
| `IBKR_SESSION_HOST_CONTROL_KEY` | Unset; supervisor-derived | Yes |
| `IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY` | Unset; supervisor-derived | Yes |
| `IBKR_SESSION_CAPSULE_IMAGE` | Release-manifest `repository@sha256:...`; exact local image IDs are development/test only | No |
| `IBKR_SESSION_HOST_CAPACITY` | `1` initially | No |
| `IBKR_SESSION_HOST_MODE` | `paper` | No |
| `IBKR_SESSION_HOST_PORT` | `18748` | No |
| `IBKR_SESSION_HOST_FAILURE_DOMAIN` | Reviewed stable failure-domain label | No |
| `IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST` | Reviewed release-manifest value | No |
| `IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST` | Reviewed release-manifest value with `sha256:` prefix | No |
| `IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST` | Reviewed release-manifest value with `sha256:` prefix; configured, not dynamically measured | No |

Generate the root key only inside the approved secret manager. Do not use a
terminal command that prints it. The supervisor validates canonical encoding
and derives the host key internally.

## Gate 1 — repository release candidate

Record the exact release commit and require all commands to pass from a clean
worktree:

```bash
git status --short
pnpm run build:pyrus-app
node --test artifacts/pyrus/scripts/runProductionApp.test.mjs artifacts/pyrus/scripts/runIbkrSessionHost.test.mjs
node --test scripts/lib/ibkr-capsule-image.test.mjs scripts/ibkr-capsule-release.test.mjs scripts/ibkr-capsule-density.test.mjs
pnpm --filter @workspace/ibkr-contracts test
pnpm --filter @workspace/ibkr-session-host test
pnpm --filter @workspace/api-server exec tsx --test src/scripts/ibkr-gateway-host-admin-cli.test.ts
pnpm run replit:config:status
```

Expected evidence:

- clean status;
- all repository guards and three production bundles pass;
- production supervisor tests pass;
- operator CLI tests pass;
- `.replit`, `replit.nix`, and the PYRUS artifact TOML remain locked.

## Gate 2 — release manifest and immutable capsule distribution

The mechanism is implemented; the release-specific external evidence is not
yet present.

The manifest uses three distinct, deterministic identities:

1. `workloadIdentityDigest` is a domain-separated SHA-256 over the exact,
   path-and-length-framed files admitted by the capsule's deny-by-default
   `.dockerignore`.
2. `runtimeSpecDigest` is a separate domain-separated SHA-256 over the
   production host wrapper/supervisor, capsule runtime invocation, pinned
   seccomp profile, and immutable image preload verifier.
3. `runtimeAttestationDigest` binds the source commit, resulting image digest,
   Linux/amd64 platform, workload identity, and runtime spec in canonical JSON.
   It is configured release identity, not a claim of live runtime measurement.

After a registry is explicitly owner-approved and the operator has
authenticated Docker through its credential helper (never a token in command
arguments), publish from the clean Gate 1 commit:

```bash
pnpm run ibkr:capsule:release publish \
  --repository="$APPROVED_CAPSULE_REPOSITORY" \
  --manifest="$RELEASE_MANIFEST"
```

The command:

- refuses a dirty tree and resolves the full Git commit;
- builds only Linux/amd64 from
  `lib/ibkr-session-host/capsule/Dockerfile`;
- enables BuildKit `mode=max` provenance and an SBOM;
- pushes through the existing Docker credential helper;
- resolves the pushed result to `repository@sha256:...`;
- pulls that exact digest back and validates its repository digest, platform,
  UID/GID, entrypoint, absent healthcheck/volumes, source/runtime labels, and
  lease-protocol label;
- writes the manifest plus a separately hashed raw BuildKit metadata file.

The local runner's default Docker build network could not resolve Debian
repositories while its host network could. If the same failure is reproduced
for the clean release build, add `--build-network=host`; the selected network
is recorded in the manifest. Do not use that option preemptively.

On a trusted target shell, the independent preload evidence command is:

```bash
pnpm run ibkr:capsule:release preload \
  --manifest="$RELEASE_MANIFEST"
```

Production also performs this exact-digest pull and structural/label
inspection automatically in the host wrapper. The API starts concurrently,
but session-host code does not load until verification passes. Capsule
creation itself still uses `--pull never`, so there is no mutable-tag or
on-demand fallback.

This gate passes only when the manifest and raw metadata are reviewed, the
registry contains the exact digest, and target preload/inspection evidence
matches the same manifest. Selecting a registry, creating credentials,
executing `publish`, or changing Replit control-plane state requires explicit
owner approval.

## Gate 3 — disabled-fleet cutover and one-port publish

This is an explicit stop-the-fleet cutover, not a mixed-version rolling
deployment. Before changing binaries, prove fleet routing is already disabled,
drain or quarantine every prior host, and record `activeLeaseCount=0` for each.
Then:

1. Through the separately reviewed production migration runner, apply and
   verify these migrations in order, skipping a migration only after proving
   its exact schema is already present:
   `20260716_ibkr_gateway_fleet.sql`,
   `20260716_ibkr_gateway_loopback_control_origin.sql`,
   `20260716_ibkr_gateway_session_control_fencing.sql`, and
   `20260717_ibkr_gateway_capsule_lease_deadlines.sql`. Capture success and
   schema evidence for all four. If no reviewed migration path exists, keep the
   release on HOLD.
2. Select and verify **Reserved VM** as the deployment type.
3. Set both `IBKR_GATEWAY_FLEET_ENABLED=0` and
   `IBKR_SESSION_HOST_ENABLED=0`, then publish the new API release. Confirm the
   API health check is green before any version-1 host can register.
4. Confirm the build command remains `pnpm run build:pyrus-app` and the run
   command resolves to the artifact's production supervisor.
5. Expose only local port `18747` through the published web service.
6. Assign a fresh `IBKR_SESSION_HOST_ID` that has no database row, set
   `IBKR_SESSION_HOST_ENABLED=1`, and republish the same reviewed release while
   fleet routing remains off. Do not reuse the prior stable ID: its migrated
   capability is immutably version 0.
7. Verify `/api/healthz` is 200 through the published URL.
8. Verify the Publishing Overview reports `Reserved VM`, and capture the
   deployment ID, release commit, VM size, and timestamp.
9. Verify production secrets are present by name only. Never capture values.

Stop if the published deployment type is Autoscale, if more than one port is
external, if any old lease remains, if the migration is unproven, if the new
host ID already exists, or if the API health check does not remain green.

## Gate 4 — target Docker/runtime preflight

The host exposes `/readyz` only on loopback. A 200 response means all of these
source-enforced checks passed at that instant:

- Linux amd64/x86_64 Docker daemon;
- cgroup v2;
- builtin seccomp and cgroup namespaces;
- memory, swap, and PID limits;
- pinned local seccomp profile hash;
- exact immutable capsule image present;
- image is Linux/amd64, declares UID/GID `10001:10001`, uses exact entrypoint
  `/usr/local/bin/pyrus-capsule-supervisor.py`, and declares no healthcheck or
  volumes;
- pre-import image labels match the configured workload identity and runtime
  spec from the reviewed release manifest.

From a trusted shell inside the published VM, if such a shell is available:

```bash
curl --fail --silent --show-error http://127.0.0.1:18748/readyz
```

If no trusted published-VM shell exists, use the registered host heartbeat as
indirect evidence and require the published logs to show `lifecycle=registered`
without `runtime_unready`. Lack of either evidence keeps the release on HOLD.

## Gate 5 — inspect and approve at capacity one

The production build contains a non-network CLI:

```bash
node artifacts/api-server/dist/ibkr-gateway-host-admin.mjs --help
```

Run it only from a trusted operator environment whose `DATABASE_URL` is
independently confirmed to target the published production database. The CLI
uses the bounded script DB profile and closes all pools before exit.

Inspect the quarantined registration:

```bash
node artifacts/api-server/dist/ibkr-gateway-host-admin.mjs inspect \
  --host-id="$IBKR_SESSION_HOST_ID"
```

Require all of the following:

- `status` is `quarantined`;
- `heartbeatFresh` is `true` in two inspections at least 10 seconds apart;
- `activeLeaseCount` is `0`;
- `capsuleLeaseProtocolVersion` is exactly `1`;
- `controlOrigin` is exactly loopback HTTP;
- measured capacity is `1` for the initial release;
- workload, image, runtime-spec, runtime-attestation, and failure-domain values
  match the reviewed manifest byte-for-byte.

Approval deliberately repeats every security-relevant digest. Populate the
following operator-local, nonsecret variables from the independently reviewed
release manifest; they are not published app settings:

```bash
node artifacts/api-server/dist/ibkr-gateway-host-admin.mjs approve \
  --host-id="$IBKR_SESSION_HOST_ID" \
  --workload-identity-digest="$APPROVED_WORKLOAD_IDENTITY_DIGEST" \
  --image-digest="$APPROVED_IMAGE_DIGEST" \
  --runtime-spec-digest="$APPROVED_RUNTIME_SPEC_DIGEST" \
  --runtime-attestation-digest="$APPROVED_RUNTIME_ATTESTATION_DIGEST" \
  --capsule-lease-protocol-version=1 \
  --admission-slot-capacity=1 \
  --execute
```

`APPROVED_IMAGE_DIGEST` is the `sha256:...` digest portion of the immutable
image reference. The command returns no secret. It fails if the host heartbeat
is stale, any digest differs, or requested capacity exceeds the measured
capacity.

Re-run `inspect`; require `status=active`, `heartbeatFresh=true`,
`activeLeaseCount=0`, `capsuleLeaseProtocolVersion=1`, and
`admissionSlotCapacity=1`. Fleet routing remains off.

## Gate 6 — paper canary and fleet enablement

Only after Gates 1–5 pass:

1. Set `IBKR_GATEWAY_FLEET_ENABLED=1` through an explicitly approved published
   app configuration change.
2. Republish/restart through the normal Publishing workflow.
3. Confirm API health, host heartbeat freshness, and active status.
4. Admit exactly one synthetic paper connection.
5. Prove capsule readiness, browser login flow, read-only account access,
   generation fencing, release, and cleanup.
6. Re-inspect and require `activeLeaseCount=0` after release.

Any unexpected session, live-account mode, stale fence, cleanup uncertainty,
or heartbeat loss triggers immediate quarantine and fleet disablement.

## Emergency controls

Drain blocks new placements while allowing current valid leases to finish:

```bash
node artifacts/api-server/dist/ibkr-gateway-host-admin.mjs drain \
  --host-id="$IBKR_SESSION_HOST_ID" \
  --execute
```

Inspect until `activeLeaseCount=0`. Quarantine immediately removes the host
from valid placement/fence checks and is the fail-safe response to suspected
compromise, stale identity, cleanup uncertainty, or host loss:

```bash
node artifacts/api-server/dist/ibkr-gateway-host-admin.mjs quarantine \
  --host-id="$IBKR_SESSION_HOST_ID" \
  --execute
```

After quarantine, set `IBKR_GATEWAY_FLEET_ENABLED=0` through the approved
Publishing workflow. Preserve logs and database evidence; do not delete the
host row or capsules as an ad hoc cleanup step.

## Root-key rotation

The supervisor derives matching host keys from the configured roots, so no
derived host secret is generated, copied, or stored by the operator.

Use this three-publish sequence:

1. **Introduce overlap:** keep old root as primary; add the new root as
   `IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY`. Republish. Confirm two fresh
   heartbeats and a paper read-only control canary.
2. **Promote new root:** set the new root as primary and the old root as
   overlap. Republish. New API and host traffic now signs with the new primary;
   both sides still accept the old key. Confirm two fresh heartbeats and the
   same canary.
3. **Retire old root:** remove the overlap root. Republish. Confirm two fresh
   heartbeats and the canary again, then retire the old value in the secret
   manager.

Until restart/host-loss chaos is green, drain to `activeLeaseCount=0` before
each rotation publish. Never set primary and overlap to the same value. Never
remove the old root before the promoted-primary checks pass. On failure,
quarantine, disable fleet routing, and restore the last known-good
primary/overlap pair through the approved Publishing workflow.

## Capacity promotion

`measuredSlotCapacity` is a ceiling, not permission to admit that many
sessions. Promote only after a named density report proves the target on the
exact VM size, image, runtime spec, and release commit. Re-run `approve` with
the same attestation values and the proven admission capacity. Never exceed the
smaller of measured capacity, tested capacity, or the global fleet ceiling of
20.

The initial co-located release stays at capacity one. Replit's documented VM
sizes and each capsule's configured 2 GiB memory ceiling make higher density a
measurement question, not an assumption.

Run density only in a maintenance window with fleet routing and the production
session host disabled, the API healthy on loopback port `18747`, and no active
lease. Use the exact reviewed release manifest and a new report path:

```bash
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
cat /sys/fs/cgroup/pids.events
cat /sys/fs/cgroup/pids.peak

pnpm run ibkr:capsule:density \
  --manifest="$RELEASE_MANIFEST" \
  --report="$DENSITY_REPORT" \
  --deployment-id="$REPLIT_DEPLOYMENT_ID" \
  --vm-size="$REPLIT_RESERVED_VM_SIZE" \
  --execute
```

Record all four parent-cgroup values before and after the run. If cgroup-v2
task counters are unavailable, the task ceiling is lower than the host
baseline plus the target multiplied by the measured per-capsule peak, or the
counter in `pids.events` increases, the stage fails. Include reviewed task
headroom for host processes and transient capsule boot fan-out; do not size to
the arithmetic limit.

The wrapper validates the manifest, preloads its exact digest and labels, then
starts the built density runner. The runner owns `127.0.0.1:18748` throughout
the test, so it refuses a running host and prevents one from starting
concurrently. It also refuses any `pyrus-ibkr-slot-*` container before making a
change. It starts synthetic paper capsules at `1`, `2`, `5`, `10`, `15`, and
`20`; holds each intermediate level for two minutes and level 20 for ten
minutes; renews lease-v1 fencing sequentially to avoid synchronized Docker CLI
bursts; and samples every ten seconds. Each renewal revalidates the exact
container identity and running state. Every aggregate sample requires API
health 200, the exact expected running container set, zero Docker restarts, and
no OOM kill while recording container CPU/memory/PIDs and host
memory/swap/load. API health is also sampled every five seconds while each new
group boots. All successful synthetic placements are released in a finally
path and remaining capsule names are reported.

Require `verdict.mechanicalPass=true`, `cleanup.complete=true`, all six stages,
and sufficient reviewed memory/CPU headroom. A passing report is evidence, not
an automatic promotion: the runner always records `promotionApplied=false`.
On failure or incomplete cleanup, keep capacity at the last separately proven
level, quarantine before investigation if any capsule remains, and do not
rerun over that state.

## Release evidence record

Capture no secret values. Record:

- release commit and build transcript;
- migration transcript, prior-host zero-lease evidence, and the fresh
  version-1 host ID cutover record;
- Publishing deployment ID/type/VM size and one-port mapping;
- capsule image provenance and exact digest;
- API health and host readiness evidence;
- two pre-approval inspections and approval output;
- paper canary timestamps and opaque session/fence IDs;
- drain/quarantine exercise;
- rotation exercise;
- density, host-loss, API-restart, WebSocket, and lease/fencing reports;
- final owner and security reviewer sign-off.

The release decision remains **HOLD** if any item is absent, inferred rather
than observed, or tied to a different commit, image, VM size, or database.
