# IBKR Historical Credential — Remote Action Dossier

Recorded: 2026-07-21 09:53:18 MDT / 2026-07-21T15:53:18Z

Status: local-only discovery complete. No remote query, fetch, push, deletion,
provider action, credential access, or live ref mutation was performed.

## What local configuration proves

Three remote names are configured:

- gitsafe-backup
- origin
- subrepl-iqi08uk6

Each has one fetch refspec mapping all server heads into its corresponding
refs/remotes namespace. None has a configured push refspec. remote.pushDefault
and push.default are unset.

The affected local branch refs/heads/replit-agent has no upstream. The affected
tag refs/tags/replit-fiasco-20260610 has no remote ownership metadata.
refs/replit/agent-ledger is a custom local namespace not covered by any
configured remote fetch refspec.

Observed local remote-tracking state:

| Local ref | Observed state | What it proves |
| --- | --- | --- |
| refs/remotes/gitsafe-backup/main | Historical commit | Last locally recorded gitsafe-backup main state is affected |
| refs/remotes/gitsafe-backup/HEAD | Symbolic to gitsafe-backup/main | Local alias only |
| refs/remotes/origin/main | Does not contain historical commit | Local cached origin/main is clear |
| refs/remotes/origin/HEAD | Symbolic to origin/main | Local alias only |
| subrepl-iqi08uk6 tracking refs | None present | No current local cache, not proof of server absence |

## What local configuration does not prove

- Whether any configured remote is reachable or authenticated.
- Whether its URL currently names the same server used when the local tracking
  refs were created.
- Whether server heads or tags have moved, appeared, or disappeared since the
  last fetch.
- Which remote, if any, owns replit-agent or
  replit-fiasco-20260610.
- Whether refs/replit/agent-ledger has a Replit-managed provider copy.
- Whether a server ref descends from the historical commit even when its tip is
  not equal to the historical OID.

Therefore no push or deletion command is safe to finalize from local state
alone.

## Candidate mapping to verify later

These are hypotheses, not instructions to execute:

| Local rewritten source | Possible server destination | Required proof |
| --- | --- | --- |
| refs/heads/replit-agent | refs/heads/replit-agent on any configured remote where it exists | ls-remote lease plus fetched containment check |
| rewritten gitsafe-backup main history | refs/heads/main on gitsafe-backup | exact current server lease and ownership |
| rewritten tag | refs/tags/replit-fiasco-20260610 on every remote where it exists | exact tag object/peeled OIDs |
| refs/replit/agent-ledger | Replit internal/provider state, if any | Replit documentation or support confirmation |

Never push a refs/remotes path. It is local tracking state, not a server
namespace.

## Separately authorized discovery phase

After all sessions are idle and the user authorizes read-only network
discovery:

1. Record git remote get-url only into a protected temporary file if identity
   comparison is needed; do not print credential-bearing URLs.
2. Capture git ls-remote --symref --heads --tags for each configured remote.
3. Record exact server OIDs as leases.
4. Fetch candidate refs into a new disposable mirror and test containment of
   ce7173dfe39cd50bf54b413437b3ec3a37046356. ls-remote tip equality alone
   cannot disprove ancestry.
5. Compare the fetched histories to the locally rehearsed rewrite.
6. Present the exact server refs, old leases, new tips, and rollback mapping to
   the user before any write.

## Separately authorized write phase

Only after discovery, local purge verification, and explicit per-ref approval:

- Use an exact lease guard for every force update.
- Update or delete/recreate only the approved server heads and tags.
- Do not push all refs, mirror-push, or infer a remote destination from a local
  tracking namespace.
- Preserve the independent pre-rewrite backup until a fresh-clone verification
  and provider-retention plan are complete.
- Stop and reconstruct the plan if any lease moved.

No exact force-update command is included now because its remote, server ref,
and lease are unverified.

Machine-readable evidence:
.local/security-results/ibkr-historical-credential-remote-action-dossier-20260721.json
