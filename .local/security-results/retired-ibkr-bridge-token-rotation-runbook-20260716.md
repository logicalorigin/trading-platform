# Retired IBKR bridge token retirement runbook — 2026-07-16

## Purpose

Close the only unresolved credential finding without copying, revealing, or reusing the credential.

## Finding identity

- Historical commit: `ce7173dfe39cd50bf54b413437b3ec3a37046356`
- Deleted path: `artifacts/api-server/data/ibkr-bridge-runtime-override.json.dead-tunnel.disabled-20260610T120616`
- Sensitive field: line 4, `apiToken`
- Non-secret historical service origin:
  `https://somehow-hills-savings-plants.trycloudflare.com`
- Current-tree status: the file is deleted. On 2026-07-20 the remaining
  persisted runtime-override reader/writer, deprecated URL/file inputs, and
  browser credential-handoff launcher were removed in the current WIP.
- Reachability rechecked 2026-07-20: five refs contain the historical commit:
  `refs/heads/replit-agent`, `refs/remotes/gitsafe-backup/HEAD`,
  `refs/remotes/gitsafe-backup/main`, `refs/replit/agent-ledger`, and
  `refs/tags/replit-fiasco-20260610`.
- Validity status: the workspace owner states that the accepting service is
  decommissioned. A post-event service-side use-log review is still not
  recorded.

Never paste the token value into this file, chat, tickets, logs, screenshots, shell history, or a replacement configuration.

## Owner action

Use the branch that matches the retired bridge service:

1. If the bridge service or its authentication allowlist still exists, remove the historical token from the service-side accepted-token set first. Issue a new unrelated token only if that retired bridge must remain available.
2. If the bridge service has been decommissioned, record evidence that the service, deployment, and accepted-token store no longer exist or cannot authenticate requests.
3. Review service-side authentication/audit logs for use of the retired credential after the commit date. Record only timestamps, result, and a non-secret credential identifier or owner statement.
4. Do not set or delete Replit environment variables as part of this runbook. Any replacement runtime attachment belongs to a separately approved control-plane/change window.
5. Do not rewrite Git history yet. Rotation/revocation must be complete first; history rewriting is a separate destructive, coordinated repository operation.

## Acceptable closure evidence

Record one of the following without a secret value:

- service-side revocation event ID and UTC timestamp;
- deployment/secret-store audit event showing the accepted token was removed;
- decommission record proving the accepting service and token store were destroyed;
- signed owner/security statement naming the service, action, UTC timestamp, and reviewer.

## Verification record

- Owner: workspace owner (identity represented by this Codex conversation)
- Service or deployment: retired IBKR desktop bridge / historical Cloudflare
  Quick Tunnel named above
- Action (`revoked`, `rotated`, or `service decommissioned`): service
  decommissioned (owner attestation)
- Completed at (UTC): unknown — decommission time was not supplied
- Non-secret evidence reference: owner statement recorded in Codex session
  `019f7f81-99a1-77a3-b6de-fbd56b7a088c` at
  `2026-07-20T16:08:57Z`
- Post-event unauthorized-use review result: unavailable — the owner stated
  on `2026-07-20T18:11:54Z` that they do not have access to the retired
  service logs. No review was performed, so unauthorized post-event use
  remains unknown.
- Reviewer: pending
- Reviewed at (UTC): pending

## Release gate

This blocker remains open because the log review is unavailable. Continuing
source hardening does not convert missing evidence into a pass. Closure
requires either acceptable evidence above or a separately explicit,
documented release-risk exception reviewed by the release owner. A digest
mismatch, deletion from the current tree, or lack of observed current use is
not sufficient by itself.
