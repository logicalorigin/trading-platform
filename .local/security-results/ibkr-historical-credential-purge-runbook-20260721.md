# Historical IBKR Credential Purge — Rehearsed Maintenance Runbook

Status: rehearsal complete; live maintenance not authorized or performed.

This runbook removes one retired IBKR bridge runtime-override file from the
repository histories that still retain it. It never needs the credential value
and must not print or copy that value.

## Scope and known baseline

The live source repository is /home/runner/workspace. It is shallow.

| Item | Verified value |
| --- | --- |
| Historical commit | ce7173dfe39cd50bf54b413437b3ec3a37046356 |
| Historical blob | 0a8d666023a1e01905897606a4cd444e675c5443 |
| Historical path | artifacts/api-server/data/ibkr-bridge-runtime-override.json.dead-tunnel.disabled-20260610T120616 |
| Direct ref: branch | refs/heads/replit-agent at 1e927435497f59973fb34a77de78a029f94af933 |
| Direct ref: backup tracking branch | refs/remotes/gitsafe-backup/main at ce7173dfe39cd50bf54b413437b3ec3a37046356 |
| Direct ref: Replit ledger | refs/replit/agent-ledger at 1e927435497f59973fb34a77de78a029f94af933 |
| Direct ref: tag | refs/tags/replit-fiasco-20260610 at ce7173dfe39cd50bf54b413437b3ec3a37046356 |
| Effective fifth ref | refs/remotes/gitsafe-backup/HEAD, a symbolic ref to refs/remotes/gitsafe-backup/main |

The historical path is absent from the current tree. The affected commit is
not an ancestor of main or origin/main. Those facts do not remove the object
from the four direct refs above.

The exact historical commit OID does not appear in any reflog field. A deeper
ancestry audit found 22 entries in the refs/heads/replit-agent reflog whose
tips descend from it, representing 43 retaining nonzero old/new OID fields.
No unrelated reflog retains that ancestry. This is why Phase 5 must expire all
reflogs before garbage collection; changing the four refs alone is not enough.

## Hard authorization boundary

Stop before changing the live repository unless every condition below is true:

1. Every other Codex/Replit agent and workflow that can write Git state is idle.
2. The shared workspace is frozen against new Git writes for the maintenance
   window.
3. The operator has shown the user the exact four direct refs and the symbolic
   fifth ref above, and has received explicit destructive-action confirmation.
4. The independent backup mirror has passed the restoration checks below.
5. No package install, broad build, browser capture, or other memory-heavy
   operation is running.
6. MemAvailable is at least 6 GiB and cgroup memory.current is at most 10 GiB.

The rehearsal did not satisfy condition 1. At the final Codex-state snapshot,
eight workspace threads were unarchived, seven besides this one, and four
other threads had updated within the prior 60 seconds. Therefore all-idle was
not established and the live procedure was intentionally not run.

Local ref changes do not alter server-side Git refs, Replit snapshots, caches,
or backups. Network discovery, force updates, tag deletion/recreation, and the
prepared Replit support request are separately authorized actions.

## Read-only machine preflight

Run the incident-specific validator before constructing a new backup or rewrite
mirror:

~~~bash
bash .local/security-tools/ibkr-historical-credential-purge-preflight.sh \
  --repo /home/runner/workspace
~~~

It must exit zero and print machine_preflight=pass. It intentionally also
prints all_other_sessions_idle=unverified, workspace_frozen=unverified,
destructive_authorization=required, and authorizes_live_change=false. Those
human lifecycle and authorization gates cannot be delegated to a Git script.

The validator is read-only and fails closed on moved target refs, a materialized
or redirected symbolic ref, unexpected retaining refs, purge staging refs,
descendant retention in any reflog other than the already-targeted
refs/heads/replit-agent reflog, exact historical-OID reflog entries,
unexpected pseudoref/worktree retention, incompatible object-storage
configuration, and the workspace memory thresholds. Its focused test is:

~~~bash
bash .local/security-tools/ibkr-historical-credential-purge-preflight.test.sh
~~~

The test uses one validated disposable clone and removes it on exit. Do not
confuse a machine-preflight pass with approval to change history.

## Important shallow-repository correction

Do not use a Git bundle as the only backup for this repository. In rehearsal,
git bundle verify described the bundle as complete, but a clone from that
bundle failed because parent 1a4a9816901b086b44320d83ad7947a01ce738e1 is
outside the retained shallow boundary.

The required rollback source is an independent mirror made with clone
--mirror --no-local. Preserve that mirror until local and external cleanup is
fully verified.

## Phase 1 — freeze, record, and validate

Run the following in one dedicated Bash shell. Do not continue if any test
fails.

~~~bash
set -euo pipefail

SOURCE=/home/runner/workspace
TARGET_PATH=artifacts/api-server/data/ibkr-bridge-runtime-override.json.dead-tunnel.disabled-20260610T120616
BAD_COMMIT=ce7173dfe39cd50bf54b413437b3ec3a37046356
BAD_BLOB=0a8d666023a1e01905897606a4cd444e675c5443

R1=refs/heads/replit-agent
R2=refs/remotes/gitsafe-backup/main
R3=refs/replit/agent-ledger
R4=refs/tags/replit-fiasco-20260610
RHEAD=refs/remotes/gitsafe-backup/HEAD

OLD_A=1e927435497f59973fb34a77de78a029f94af933
OLD_B=ce7173dfe39cd50bf54b413437b3ec3a37046356
EXPECTED_NEW_A=e8dcd9b2ba20d8be01279edff7dd25202523a290
EXPECTED_NEW_B=deb68a86e465eff8ebcd71a133ddb3338fcc7463

PURGE_ROOT="$(mktemp -d /tmp/pyrus-credential-purge.XXXXXX)"
chmod 700 "$PURGE_ROOT"
BACKUP="$PURGE_ROOT/backup.git"
REWRITE="$PURGE_ROOT/rewrite.git"

case "$PURGE_ROOT" in
  /tmp/pyrus-credential-purge.*) ;;
  *) exit 91 ;;
esac
test -d "$PURGE_ROOT"
test ! -L "$PURGE_ROOT"
test "$(stat -c '%a' "$PURGE_ROOT")" = 700
test "$(stat -c '%U' "$PURGE_ROOT")" = "$(id -un)"

MEM_AVAILABLE_KIB="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
CGROUP_BYTES="$(< /sys/fs/cgroup/memory.current)"
test "$MEM_AVAILABLE_KIB" -ge 6291456
test "$CGROUP_BYTES" -le 10737418240

test "$(git -C "$SOURCE" rev-parse --is-shallow-repository)" = true
test "$(git -C "$SOURCE" rev-parse "$R1")" = "$OLD_A"
test "$(git -C "$SOURCE" rev-parse "$R2")" = "$OLD_B"
test "$(git -C "$SOURCE" rev-parse "$R3")" = "$OLD_A"
test "$(git -C "$SOURCE" rev-parse "$R4")" = "$OLD_B"
test "$(git -C "$SOURCE" symbolic-ref "$RHEAD")" = "$R2"
test "$(git -C "$SOURCE" rev-parse "$RHEAD")" = "$OLD_B"
git -C "$SOURCE" cat-file -e "$BAD_COMMIT^{commit}"
git -C "$SOURCE" cat-file -e "$BAD_BLOB^{blob}"
test "$(git -C "$SOURCE" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 1

if git -C "$SOURCE" merge-base --is-ancestor "$BAD_COMMIT" main; then
  exit 92
fi
if git -C "$SOURCE" merge-base --is-ancestor "$BAD_COMMIT" origin/main; then
  exit 93
fi

MAIN_BEFORE="$(git -C "$SOURCE" rev-parse refs/heads/main)"
ORIGIN_MAIN_BEFORE="$(git -C "$SOURCE" rev-parse refs/remotes/origin/main)"
STASH_BEFORE="$(git -C "$SOURCE" rev-parse refs/stash)"
git -C "$SOURCE" for-each-ref --format='%(refname) %(objectname)' |
  sort > "$PURGE_ROOT/live-before.refs"
git -C "$SOURCE" status --porcelain=v2 --untracked-files=all \
  > "$PURGE_ROOT/live-before.status"
git -C "$SOURCE" fsck --connectivity-only
~~~

The session-idle and workspace-freeze gates are lifecycle facts; do not infer
them only from a process count. Confirm them through the active session
supervisor/state and with the people or agents performing the other work.

## Phase 2 — make the independent backup

The no-local option prevents a local optimization from making the backup
depend on the live object store.

~~~bash
git clone --mirror --no-local "file://$SOURCE" "$BACKUP"

test "$(git --git-dir="$BACKUP" rev-parse --is-shallow-repository)" = true
cmp "$SOURCE/.git/shallow" "$BACKUP/shallow"

git --git-dir="$BACKUP" for-each-ref --format='%(refname) %(objectname)' |
  sort > "$PURGE_ROOT/backup.refs"
cmp "$PURGE_ROOT/live-before.refs" "$PURGE_ROOT/backup.refs"

git --git-dir="$BACKUP" cat-file -e "$BAD_COMMIT^{commit}"
git --git-dir="$BACKUP" cat-file -e "$BAD_BLOB^{blob}"
test "$(git --git-dir="$BACKUP" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 1
git --git-dir="$BACKUP" fsck --connectivity-only
~~~

Do not proceed if the backup ref set, shallow boundary, historical commit,
historical blob, or connectivity check differs from the live source.

## Phase 3 — build and verify the rewrite mirror

Use the pinned temporary tool invocation. It does not install
git-filter-repo globally. The rehearsed package version was 2.47.0 and its
reported build identifier was a40bce548d2c.

~~~bash
git clone --mirror --no-local "file://$SOURCE" "$REWRITE"

UV_CACHE_DIR="$PURGE_ROOT/uv-cache" \
  uvx --isolated --from git-filter-repo==2.47.0 \
  git-filter-repo --version

(
  cd "$REWRITE"
  UV_CACHE_DIR="$PURGE_ROOT/uv-cache" \
    uvx --isolated --from git-filter-repo==2.47.0 \
    git-filter-repo \
      --force \
      --sensitive-data-removal \
      --invert-paths \
      --path "$TARGET_PATH" \
      --refs "$R1" "$RHEAD" "$R2" "$R3" "$R4"
)
~~~

The force flag is required here because the mirror includes refs/stash and
git-filter-repo rejects it as a fresh clone without that flag. The flag is
confined to the disposable rewrite mirror.

Expire reflogs and prune unreachable objects in the rewrite mirror. Rehearsal
proved that the ref rewrite alone left the old commit and blob physically
present as dangling packed objects.

~~~bash
git --git-dir="$REWRITE" reflog expire --expire=now --all
git --git-dir="$REWRITE" gc --prune=now

test "$(git --git-dir="$REWRITE" rev-parse "$R1")" = "$EXPECTED_NEW_A"
test "$(git --git-dir="$REWRITE" rev-parse "$R2")" = "$EXPECTED_NEW_B"
test "$(git --git-dir="$REWRITE" rev-parse "$R3")" = "$EXPECTED_NEW_A"
test "$(git --git-dir="$REWRITE" rev-parse "$R4")" = "$EXPECTED_NEW_B"
test "$(git --git-dir="$REWRITE" rev-parse "$RHEAD")" = "$EXPECTED_NEW_B"
test "$(git --git-dir="$REWRITE" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 0

if git --git-dir="$REWRITE" cat-file -e "$BAD_COMMIT^{commit}" 2>/dev/null; then
  exit 94
fi
if git --git-dir="$REWRITE" cat-file -e "$BAD_BLOB^{blob}" 2>/dev/null; then
  exit 95
fi

git --git-dir="$BACKUP" for-each-ref --format='%(refname) %(objectname)' |
  awk -v r1="$R1" -v rh="$RHEAD" -v r2="$R2" -v r3="$R3" -v r4="$R4" \
    '$1 != r1 && $1 != rh && $1 != r2 && $1 != r3 && $1 != r4' |
  sort > "$PURGE_ROOT/backup-nontarget.refs"
git --git-dir="$REWRITE" for-each-ref --format='%(refname) %(objectname)' |
  awk -v r1="$R1" -v rh="$RHEAD" -v r2="$R2" -v r3="$R3" -v r4="$R4" \
    '$1 != r1 && $1 != rh && $1 != r2 && $1 != r3 && $1 != r4' |
  sort > "$PURGE_ROOT/rewrite-nontarget.refs"
cmp "$PURGE_ROOT/backup-nontarget.refs" "$PURGE_ROOT/rewrite-nontarget.refs"

test "$(git --git-dir="$REWRITE" rev-parse refs/heads/main)" = "$MAIN_BEFORE"
test "$(git --git-dir="$REWRITE" rev-parse refs/remotes/origin/main)" = "$ORIGIN_MAIN_BEFORE"
test "$(git --git-dir="$REWRITE" rev-parse refs/stash)" = "$STASH_BEFORE"
git --git-dir="$REWRITE" fsck --full --strict --no-dangling
~~~

The mirror clone materializes the remote HEAD as an ordinary ref. In the live
repository it must remain a symbolic ref to gitsafe-backup/main.

## Phase 4 — explicit live-change gate

This is the destructive boundary. Pause and obtain the explicit confirmation
described above now, after showing the verified backup and rewrite results.

Recheck all lifecycle, memory, and exact-OID guards. If any direct ref moved,
discard the prepared rewrite and reconstruct the plan from the new state.

~~~bash
test "$(git -C "$SOURCE" rev-parse "$R1")" = "$OLD_A"
test "$(git -C "$SOURCE" rev-parse "$R2")" = "$OLD_B"
test "$(git -C "$SOURCE" rev-parse "$R3")" = "$OLD_A"
test "$(git -C "$SOURCE" rev-parse "$R4")" = "$OLD_B"
test "$(git -C "$SOURCE" symbolic-ref "$RHEAD")" = "$R2"

MEM_AVAILABLE_KIB="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
CGROUP_BYTES="$(< /sys/fs/cgroup/memory.current)"
test "$MEM_AVAILABLE_KIB" -ge 6291456
test "$CGROUP_BYTES" -le 10737418240

for stage_ref in \
  refs/purge-stage/heads/replit-agent \
  refs/purge-stage/remotes/gitsafe-backup/main \
  refs/purge-stage/replit/agent-ledger \
  refs/purge-stage/tags/replit-fiasco-20260610
do
  if git -C "$SOURCE" show-ref --verify --quiet "$stage_ref"; then
    exit 96
  fi
done
~~~

Import the four rewritten direct refs into a temporary namespace, verify them,
then update all four live direct refs in one guarded transaction.

~~~bash
git -C "$SOURCE" fetch --no-tags "$REWRITE" \
  "+$R1:refs/purge-stage/heads/replit-agent" \
  "+$R2:refs/purge-stage/remotes/gitsafe-backup/main" \
  "+$R3:refs/purge-stage/replit/agent-ledger" \
  "+$R4:refs/purge-stage/tags/replit-fiasco-20260610"

NEW1="$(git -C "$SOURCE" rev-parse refs/purge-stage/heads/replit-agent)"
NEW2="$(git -C "$SOURCE" rev-parse refs/purge-stage/remotes/gitsafe-backup/main)"
NEW3="$(git -C "$SOURCE" rev-parse refs/purge-stage/replit/agent-ledger)"
NEW4="$(git -C "$SOURCE" rev-parse refs/purge-stage/tags/replit-fiasco-20260610)"

test "$NEW1" = "$EXPECTED_NEW_A"
test "$NEW2" = "$EXPECTED_NEW_B"
test "$NEW3" = "$EXPECTED_NEW_A"
test "$NEW4" = "$EXPECTED_NEW_B"
test "$(git -C "$SOURCE" rev-list "$NEW1" -- "$TARGET_PATH" | wc -l)" -eq 0
test "$(git -C "$SOURCE" rev-list "$NEW2" -- "$TARGET_PATH" | wc -l)" -eq 0
test "$(git -C "$SOURCE" rev-list "$NEW3" -- "$TARGET_PATH" | wc -l)" -eq 0
test "$(git -C "$SOURCE" rev-list "$NEW4" -- "$TARGET_PATH" | wc -l)" -eq 0

git -C "$SOURCE" update-ref --stdin <<EOF
start
update $R1 $NEW1 $OLD_A
update $R2 $NEW2 $OLD_B
update $R3 $NEW3 $OLD_A
update $R4 $NEW4 $OLD_B
prepare
commit
EOF

test "$(git -C "$SOURCE" symbolic-ref "$RHEAD")" = "$R2"
test "$(git -C "$SOURCE" rev-parse "$RHEAD")" = "$NEW2"

for stage_ref in \
  refs/purge-stage/heads/replit-agent \
  refs/purge-stage/remotes/gitsafe-backup/main \
  refs/purge-stage/replit/agent-ledger \
  refs/purge-stage/tags/replit-fiasco-20260610
do
  git -C "$SOURCE" update-ref -d "$stage_ref"
done
~~~

The old-OID fields make the transaction fail atomically if any target changed
between validation and commit. Do not replace this with four unrelated
force-update commands.

## Phase 5 — prune and verify the live object store

Keep the independent backup mirror mounted and read-only while doing this.

~~~bash
git -C "$SOURCE" reflog expire --expire=now --all
git -C "$SOURCE" gc --prune=now

test "$(git -C "$SOURCE" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 0
if git -C "$SOURCE" cat-file -e "$BAD_COMMIT^{commit}" 2>/dev/null; then
  exit 97
fi
if git -C "$SOURCE" cat-file -e "$BAD_BLOB^{blob}" 2>/dev/null; then
  exit 98
fi

test "$(git -C "$SOURCE" rev-parse "$R1")" = "$EXPECTED_NEW_A"
test "$(git -C "$SOURCE" rev-parse "$R2")" = "$EXPECTED_NEW_B"
test "$(git -C "$SOURCE" rev-parse "$R3")" = "$EXPECTED_NEW_A"
test "$(git -C "$SOURCE" rev-parse "$R4")" = "$EXPECTED_NEW_B"
test "$(git -C "$SOURCE" symbolic-ref "$RHEAD")" = "$R2"
test "$(git -C "$SOURCE" rev-parse "$RHEAD")" = "$EXPECTED_NEW_B"

git -C "$SOURCE" for-each-ref --format='%(refname) %(objectname)' |
  awk -v r1="$R1" -v rh="$RHEAD" -v r2="$R2" -v r3="$R3" -v r4="$R4" \
    '$1 != r1 && $1 != rh && $1 != r2 && $1 != r3 && $1 != r4' |
  sort > "$PURGE_ROOT/live-after-nontarget.refs"
cmp "$PURGE_ROOT/backup-nontarget.refs" "$PURGE_ROOT/live-after-nontarget.refs"

test "$(git -C "$SOURCE" rev-parse refs/heads/main)" = "$MAIN_BEFORE"
test "$(git -C "$SOURCE" rev-parse refs/remotes/origin/main)" = "$ORIGIN_MAIN_BEFORE"
test "$(git -C "$SOURCE" rev-parse refs/stash)" = "$STASH_BEFORE"
git -C "$SOURCE" status --porcelain=v2 --untracked-files=all \
  > "$PURGE_ROOT/live-after.status"
cmp "$PURGE_ROOT/live-before.status" "$PURGE_ROOT/live-after.status"
git -C "$SOURCE" fsck --full --strict --no-dangling
~~~

Do not discard the backup after these local checks. First complete any
separately authorized server-side cleanup, fresh-clone verification, and Replit
retention request.

## Rollback before external publication

Rollback is appropriate if any local verification fails or if the maintenance
owner cancels before server-side refs are changed. This selective rollback was
rehearsed independently. It restores only the four direct target refs and
preserves the symbolic fifth ref.

~~~bash
git -C "$SOURCE" fetch --no-tags "$BACKUP" \
  "+$R1:refs/purge-rollback/heads/replit-agent" \
  "+$R2:refs/purge-rollback/remotes/gitsafe-backup/main" \
  "+$R3:refs/purge-rollback/replit/agent-ledger" \
  "+$R4:refs/purge-rollback/tags/replit-fiasco-20260610"

CUR1="$(git -C "$SOURCE" rev-parse "$R1")"
CUR2="$(git -C "$SOURCE" rev-parse "$R2")"
CUR3="$(git -C "$SOURCE" rev-parse "$R3")"
CUR4="$(git -C "$SOURCE" rev-parse "$R4")"
ORIG1="$(git -C "$SOURCE" rev-parse refs/purge-rollback/heads/replit-agent)"
ORIG2="$(git -C "$SOURCE" rev-parse refs/purge-rollback/remotes/gitsafe-backup/main)"
ORIG3="$(git -C "$SOURCE" rev-parse refs/purge-rollback/replit/agent-ledger)"
ORIG4="$(git -C "$SOURCE" rev-parse refs/purge-rollback/tags/replit-fiasco-20260610)"

test "$ORIG1" = "$OLD_A"
test "$ORIG2" = "$OLD_B"
test "$ORIG3" = "$OLD_A"
test "$ORIG4" = "$OLD_B"

git -C "$SOURCE" update-ref --stdin <<EOF
start
update $R1 $ORIG1 $CUR1
update $R2 $ORIG2 $CUR2
update $R3 $ORIG3 $CUR3
update $R4 $ORIG4 $CUR4
prepare
commit
EOF

git -C "$SOURCE" symbolic-ref "$RHEAD" "$R2"

for stage_ref in \
  refs/purge-rollback/heads/replit-agent \
  refs/purge-rollback/remotes/gitsafe-backup/main \
  refs/purge-rollback/replit/agent-ledger \
  refs/purge-rollback/tags/replit-fiasco-20260610
do
  git -C "$SOURCE" update-ref -d "$stage_ref"
done

git -C "$SOURCE" reflog expire --expire=now --all
git -C "$SOURCE" gc --prune=now

git -C "$SOURCE" for-each-ref --format='%(refname) %(objectname)' |
  sort > "$PURGE_ROOT/live-rollback.refs"
cmp "$PURGE_ROOT/live-before.refs" "$PURGE_ROOT/live-rollback.refs"
test "$(git -C "$SOURCE" symbolic-ref "$RHEAD")" = "$R2"
git -C "$SOURCE" cat-file -e "$BAD_COMMIT^{commit}"
git -C "$SOURCE" cat-file -e "$BAD_BLOB^{blob}"
test "$(git -C "$SOURCE" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 1
git -C "$SOURCE" fsck --full --strict --no-dangling
~~~

If server-side refs have already been changed, stop and construct a
remote-specific rollback using the recorded remote leases. Do not assume the
local rollback changes any server or provider copy.

## Separate remote and provider cleanup

The configured remote names observed locally are origin, gitsafe-backup, and
subrepl-iqi08uk6. Their local fetch mappings do not prove which server refs
currently exist.

With separate maintenance authorization:

1. Capture git ls-remote --symref for each configured remote without printing
   credential-bearing URLs.
2. Map each server-side head or tag to the local rewritten history. A
   refs/remotes path is local state and must never be pushed as if it were a
   server namespace.
3. Present the exact server refs, old leases, new tips, and rollback commands
   for approval.
4. Use lease-guarded force updates only for approved server refs.
5. Verify from a fresh clone that neither historical object nor path is
   reachable.
6. Submit the prepared secret-free Replit retention/deletion request only with
   explicit authorization, and preserve the response.

The prepared request is:
.local/security-results/replit-historical-copy-deletion-request-20260720.md

## Rehearsal result

The 2026-07-21 disposable rehearsal passed:

- git-filter-repo parsed 1,491 commits and rewrote 1,391.
- All non-target refs were identical before and after the rewrite.
- main, origin/main, and refs/stash were unchanged.
- The historical path had zero reachable commits after rewrite.
- Reflog expiration and garbage collection removed the old commit and blob.
- Full strict fsck passed.
- A broad mirror restoration test passed in a disposable bare repository.
- The safer four-ref atomic application test passed.
- A separate four-ref atomic selective rollback test restored all 78 refs, the
  symbolic remote HEAD, the old objects, and the historical path; strict fsck
  passed.
- After the validator passed, the exact mode-0700 rehearsal directory was
  deleted. A post-cleanup scan found no Git object store under /tmp retaining
  either historical object.
- The live workspace refs were not changed and no external action was taken.

Machine-readable evidence is in
.local/security-results/ibkr-historical-credential-purge-rehearsal-20260721.json.
