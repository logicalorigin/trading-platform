# IBKR Historical Credential — Local Retention Audit

Recorded: 2026-07-21 09:36:43 MDT / 2026-07-21T15:36:43Z

Corrected: 2026-07-21 10:14:12 MDT / 2026-07-21T16:14:12Z after a
descendant-ancestry reflog audit.

Status: read-only audit complete. No credential value was read, rendered, or
recorded. No Git ref, reflog, object, worktree, remote, runtime, or provider
state was changed.

## Claim tested

The five previously identified refs are the complete local retention surface.

## Result

The claim is only partly true:

- The five refs are the complete live ref-reachability set for commit
  ce7173dfe39cd50bf54b413437b3ec3a37046356.
- They are not the complete local retention set. The live shared object store
  and the refs/heads/replit-agent reflog also retain descendant commits. At
  audit time, three rollback-proof mirrors and the pre-rewrite bundle under the
  mode-0700 rehearsal directory retained the objects; those temporary copies
  were subsequently deleted as recorded below.

The distinction matters because changing refs does not itself remove packed
objects or independent backup copies.

## Observed live repository facts

- Repository: /home/runner/workspace
- Git version: 2.50.1
- Repository is shallow with one shallow-boundary commit. The historical
  commit is not that boundary.
- There are 78 refs. Exactly five contain the historical commit:
  - refs/heads/replit-agent
  - refs/remotes/gitsafe-backup/HEAD
  - refs/remotes/gitsafe-backup/main
  - refs/replit/agent-ledger
  - refs/tags/replit-fiasco-20260610
- gitsafe-backup/HEAD is symbolic to gitsafe-backup/main. Therefore the live
  mutation surface is four direct refs plus one effective symbolic ref.
- No tested pseudoref contains the historical commit: HEAD, ORIG_HEAD,
  MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, AUTO_MERGE, and
  FETCH_HEAD were checked when present.
- Zero reflog files mention the exact historical commit as either an old or new
  OID. A deeper ancestry check found 22 entries in the
  refs/heads/replit-agent reflog whose tips descend from the historical commit,
  representing 43 retaining nonzero old/new OID fields. No other reflog has a
  descendant-retaining entry. This is an expected target-branch retention
  mechanism, not an additional live ref, and all reflogs must still be expired
  before garbage collection.
- All 56 registered worktree HEADs exclude the historical commit.
- None of the 56 registered worktrees contains the exact historical file or
  any file matching ibkr-bridge-runtime-override.json*.
- No refs/original, refs/replace, refs/rewritten, refs/bisect, or refs/notes
  entry exists. The one stash ref does not contain the commit.
- There are no replace objects, legacy grafts, alternates, promisor remotes,
  promisor packs, partial-clone extension, multi-pack index, or cruft mtimes
  file.
- There is no submodule object store.
- The one nested workspace repository,
  /home/runner/workspace/.claude/skills/gstack/.git, contains neither object.
- No Git bundle exists inside the workspace outside .git.
- The historical commit and 327-byte blob are packed together in
  pack-b4da8d3d1a1879d4a5cf18c68deddad05bb9079e. Neither is loose.
- The historical path is reachable from one commit.

The 56 linked worktrees share the live repository object store. They do not
create 56 independent object copies, but they strengthen the requirement that
all worktree users be idle before live ref changes, reflog expiration, or
garbage collection.

## Observed rehearsal copies

The rehearsal root is
/tmp/pyrus-credential-purge-rehearsal.VcHQ8x. It is owned by runner, mode 0700,
and occupied 493,265,869 bytes at audit time.

Five valid bare repositories were present:

| Repository | Historical commit | Historical blob |
| --- | --- | --- |
| apply-test.git | absent | absent |
| backup.git | present | present |
| rehearsal.git | absent | absent |
| rollback-atomic-test.git | present | present |
| rollback-test.git | present | present |

The 80,972,978-byte pre-rewrite.bundle passes git bundle verify but failed the
standalone clone proof because the source repository is shallow. It was made
before rewriting from all refs and must be treated as retaining the historical
objects even though it is not a valid sole rollback source.

The three rollback mirrors and bundle were intentionally temporary. After the
preflight validator passed, the exact rehearsal root was revalidated for
owner, mode, contents, symlinks, and open handles, then deleted at
2026-07-21T15:50:23Z. The deletion removed 493,265,869 bytes and is not
recoverable. A post-cleanup /tmp scan found zero Git object stores containing
either historical object. The live target refs remained unchanged.

## Inference

No newly discovered local ref or worktree expands the planned four-direct-ref
atomic transaction. The descendant-retaining target-branch reflog makes the
existing order mandatory: after the transaction, expire all reflogs before
garbage collection, then prove both objects are physically absent.

## Explicit unknowns and limits

- Local remote-tracking refs do not prove server-side remote state. No network
  probe was performed.
- The repository is shallow. Local ancestry and scanner results cover the
  history present in this object store, not any older server history outside
  its shallow boundary.
- Replit snapshots, backups, caches, and retention systems remain external
  unknowns covered by the prepared support request.
- Codex logs and unrelated user-owned locations outside the workspace were not
  scanned for secret material. Searching them could expose unrelated secrets
  and is outside this bounded audit.
- Arbitrary archive formats were not content-scanned. The workspace was
  checked specifically for Git bundles, and registered worktrees were checked
  for the exact filename family.
- The /tmp object-store search was bounded to runner-owned Git object stores
  within five directory levels. It found only the five rehearsal repositories,
  three of which retain the objects.

Machine-readable evidence:
.local/security-results/ibkr-historical-credential-local-retention-audit-20260721.json
