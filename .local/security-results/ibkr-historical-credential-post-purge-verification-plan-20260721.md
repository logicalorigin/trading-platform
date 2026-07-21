# IBKR Historical Credential — Post-Purge Verification Plan

Prepared: 2026-07-21 10:01:09 MDT / 2026-07-21T16:01:09Z

Status: ready, not executed. The live repository still contains the target
objects and refs. This document authorizes no ref change, reflog expiry,
garbage collection, network request, remote write, support submission,
runtime restart, publication, or backup deletion.

## Target identity

- Historical commit: `ce7173dfe39cd50bf54b413437b3ec3a37046356`
- Historical blob: `0a8d666023a1e01905897606a4cd444e675c5443`
- Historical path:
  `artifacts/api-server/data/ibkr-bridge-runtime-override.json.dead-tunnel.disabled-20260610T120616`
- Expected rewritten A tip: `e8dcd9b2ba20d8be01279edff7dd25202523a290`
- Expected rewritten B tip: `deb68a86e465eff8ebcd71a133ddb3338fcc7463`

The mutation procedure and rollback source of truth remain
`.local/security-results/ibkr-historical-credential-purge-runbook-20260721.md`.
This plan begins after its guarded four-ref transaction.

## Evidence rules

- Record the frozen commit, tree, ref snapshot, worktree status digest, command,
  start/end UTC timestamps, exit code, tool version, and output-artifact
  SHA-256 for every gate.
- Keep scanner reports mode `0600`; never print candidate values.
- Treat a missing command, skipped lane, changed ref lease, changed candidate
  tree, or unexplained scanner delta as a failure, not as a pass.
- Keep the independent pre-rewrite mirror read-only and protected until local,
  remote, provider-retention, and frozen-candidate verification are accepted.
  That mirror intentionally retains the sensitive history.
- Delete the backup only through a separately reviewed destructive action.

## Gate 0 — authority and quiescence

All boxes must be independently evidenced immediately before the live change:

- [ ] Every other workspace session is demonstrably idle or stopped.
- [ ] The shared worktree is frozen and attributed; no writer can move refs or
      files during the window.
- [ ] The read-only preflight exits zero against `/home/runner/workspace` and
      prints `authorizes_live_change=false`.
- [ ] `MemAvailable` is at least 6 GiB and cgroup `memory.current` is no more
      than 10 GiB before each clone, scan, typecheck, or build.
- [ ] The independent `--mirror --no-local` backup passes strict fsck and has
      its path, ownership, mode, ref digest, shallow metadata, and object proof
      recorded.
- [ ] The exact four-ref transaction, expected old/new OIDs, rollback mapping,
      and backup location have explicit user approval.

The preflight invocation is:

```bash
.local/security-tools/ibkr-historical-credential-purge-preflight.sh --repo /home/runner/workspace
```

A passing preflight does not establish idleness, freeze the tree, or grant
destructive authorization.

## Gate 1 — immediate local proof

Run Phase 5 of the purge runbook, then require all of the following:

| Assertion | Required result |
| --- | --- |
| Four direct target refs | Exact expected A/B rewritten tips |
| `refs/remotes/gitsafe-backup/HEAD` | Still symbolic to `refs/remotes/gitsafe-backup/main` and resolves to expected B |
| `git for-each-ref --contains <bad-commit>` | No output |
| `git rev-list --all -- <historical-path>` | Zero commits |
| `git cat-file -e <bad-commit>^{commit}` | Fails |
| `git cat-file -e <bad-blob>^{blob}` | Fails |
| `refs/purge-stage/**` and `refs/purge-rollback/**` | Absent |
| Non-target ref snapshot | Byte-identical to the preflight snapshot |
| Main, locally cached origin/main, and stash | Exact preflight OIDs |
| Worktree status snapshot | Byte-identical to the preflight snapshot |
| `git fsck --full --strict --no-dangling` | Exit 0 |

Also recheck every pseudoref, reflog file, registered worktree, alternate,
replace/graft namespace, nested Git object store, and workspace bundle covered
by the local-retention audit. A ref-only pass is insufficient because the
rehearsal proved that the objects survive in packs until reflog expiry and
garbage collection.

## Gate 2 — clean transferability proof

After Gate 1, make a protected disposable local mirror from the cleaned live
repository using `git clone --mirror --no-local`. In that mirror require:

- all refs and the shallow boundary match the cleaned source;
- strict fsck passes;
- the bad commit and blob are absent;
- no ref contains the bad commit;
- the historical path has zero reachable commits.

This proves that a normal local transfer does not reintroduce the objects. It
does not prove anything about remote hidden refs or provider backups. Record
the mirror digest, then remove the disposable clean mirror through a validated
same-filesystem cleanup after its evidence is preserved.

## Gate 3 — secret scan of all cleaned local refs

Observed scanner identity:

- Gitleaks `8.30.1`
- binary:
  `.local/security-tools/gitleaks-8.30.1/gitleaks`
- SHA-256:
  `88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509`

Run the pinned scanner against all cleaned refs with full redaction and a
mode-`0600` JSON report:

```bash
umask 077
REPORT=.local/security-results/gitleaks-ibkr-post-purge-all-refs-20260721.json
.local/security-tools/gitleaks-8.30.1/gitleaks git --redact --no-banner --report-format json --report-path "$REPORT" --log-opts=--all /home/runner/workspace
```

Gitleaks can exit 1 for already reviewed synthetic fixtures, so exit status
alone is not the acceptance test. Without printing the report, require:

- no finding whose `File` equals the historical path;
- no finding whose `Commit` equals the historical commit;
- no new unreviewed rule/file/line signature relative to the frozen-candidate
  baseline;
- manual disposition for every delta;
- report mode, SHA-256, scanner version, and candidate count recorded.

No repository `.gitleaks.toml` exists as of preparation. This lane therefore
uses the pinned default rules. Adding a repository policy remains a separate
reviewed hardening change and must not be silently folded into the purge.

The live repository is shallow with one boundary. An all-ref local scan covers
only objects present locally; it cannot certify older server history beyond
that boundary. Gate 4 remains mandatory, and each remote verification record
must state whether the server supplied complete history or another shallow or
filtered graph.

## Gate 4 — remote namespace proof

This gate requires separate read-only discovery and per-ref write authority.
Use
`.local/security-results/ibkr-historical-credential-remote-action-dossier-20260721.md`
as the source of truth.

For every configured remote:

1. Inventory actual server heads, tags, and symbolic refs without printing
   credential-bearing URLs.
2. Fetch candidate server refs into a new disposable mirror and test ancestry;
   tip inequality alone does not prove the historical commit is absent.
3. Compare exact server OIDs with recorded leases.
4. Present each server ref, old lease, rewritten tip, and rollback mapping for
   approval.
5. Apply only approved lease-guarded updates.
6. Fetch again into a second fresh mirror and require the same object, path,
   ref-containment, and strict-fsck checks as Gates 1 and 2. Record any server
   shallow boundary, object filter, or inaccessible hidden namespace.

Do not push a `refs/remotes/**` path. Exact remote commands remain deliberately
unwritten until server namespaces and leases are observed.

## Gate 5 — provider-managed retention proof

The Git checks cannot prove deletion from Replit checkpoints, Agent context,
File History, database recovery images, disaster-recovery copies, or internal
provider refs. With explicit submission authorization:

- send the secret-free request at
  `.local/security-results/replit-historical-copy-deletion-request-20260720.md`;
- record the response only in the blank evidence template;
- obtain the copy classes, retention-start event, terminal expiry/deletion
  date, excluded systems, rehydration behavior, and written attestation;
- never send the credential value or raw XML.

This gate remains open until written provider evidence or a reviewed, explicit
risk exception identifies every unresolved copy class.

## Gate 6 — frozen-candidate release verification

History cleanup does not validate product behavior. On one immutable clean
candidate, serialize the repository gates and recheck memory before every
heavy command:

```bash
pnpm run audit:guards
pnpm run typecheck
pnpm run build:pyrus-app
```

The commands are source-confirmed in the root `package.json` as of preparation.
`build:pyrus-app` itself runs `audit:guards` before the Pyrus, API, and IBKR
session-host builds; keep the standalone guard result only because the current
frozen-release checklist explicitly requires it.

Also require:

- the focused security suites attached to F2–F13, resolved again from the
  frozen tree rather than copied from old handoffs;
- OSV-Scanner version `2.3.3` running
  `osv-scanner scan source --recursive` against the frozen source, with JSON
  evidence and every result triaged;
- new CycloneDX SBOMs for the release artifacts, component/dependency
  validation, tool identity, and hashes;
- current-tree, candidate-diff, all-ref, and built-artifact Gitleaks scans;
- `git diff --check`, candidate commit/tree hashes, and a clean status;
- normal-URL runtime and browser acceptance through the Replit-owned
  lifecycle, using explicit readiness selectors and no unapproved broker or
  provider action.

The repository exposes no SBOM generation script. Prior evidence used OWASP
`cdxgen 12.7.1`; the exact frozen-candidate invocation must be reconstructed
and reviewed before execution rather than guessed or installed during this
waiting period.

## Terminal acceptance

Publication may be reconsidered only when all of these are true:

- local objects, path, refs, reflogs, and transfer copies pass;
- every authorized remote fresh-mirror check passes;
- provider copy classes are deleted/expired or covered by an explicit reviewed
  risk exception;
- credential decommission/revocation evidence is accepted, or the missing
  post-event-use evidence has an explicit reviewed release-risk exception;
- the 12 historically resolved findings pass again on the frozen candidate;
- build, dependency, secret, runtime, browser, and release-owner gates pass;
- an independent reviewer signs the final evidence.

Until then, the decision is `HOLD`. A successful Git purge alone cannot close
the incident or authorize publication.
