#!/usr/bin/env bash
set -euo pipefail

BAD_COMMIT=ce7173dfe39cd50bf54b413437b3ec3a37046356
BAD_BLOB=0a8d666023a1e01905897606a4cd444e675c5443
TARGET_PATH=artifacts/api-server/data/ibkr-bridge-runtime-override.json.dead-tunnel.disabled-20260610T120616
OLD_A=1e927435497f59973fb34a77de78a029f94af933
OLD_B=ce7173dfe39cd50bf54b413437b3ec3a37046356
R1=refs/heads/replit-agent
R2=refs/remotes/gitsafe-backup/main
R3=refs/replit/agent-ledger
R4=refs/tags/replit-fiasco-20260610
RHEAD=refs/remotes/gitsafe-backup/HEAD
MIN_MEM_AVAILABLE_KIB=6291456
MAX_CGROUP_MEMORY_BYTES=10737418240

fail() {
  local reason=$1
  trap - ERR
  printf 'machine_preflight=fail\n'
  printf 'reason=%s\n' "$reason"
  printf 'authorizes_live_change=false\n'
  exit 1
}

unexpected_failure() {
  local status=$?
  trap - ERR
  printf 'machine_preflight=fail\n' >&2
  printf 'reason=unexpected_command_failure\n' >&2
  printf 'authorizes_live_change=false\n' >&2
  exit "$status"
}
trap unexpected_failure ERR

if test "$#" -ne 2 || test "$1" != --repo; then
  fail invalid_arguments
fi

REPO=$2
test -d "$REPO" || fail repository_not_found
REPO="$(realpath -e -- "$REPO" 2>/dev/null)" || fail repository_not_found

test "$(git -C "$REPO" rev-parse --is-inside-work-tree 2>/dev/null)" = true ||
  fail repository_not_worktree
test "$(git -C "$REPO" rev-parse --is-bare-repository 2>/dev/null)" = false ||
  fail repository_not_worktree
test "$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)" = "$REPO" ||
  fail repository_not_toplevel
test "$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null)" = main ||
  fail current_branch_not_main
test "$(git -C "$REPO" rev-parse --is-shallow-repository 2>/dev/null)" = true ||
  fail repository_not_shallow

GIT_DIR="$(git -C "$REPO" rev-parse --absolute-git-dir)"
SHALLOW_FILE="$(git -C "$REPO" rev-parse --git-path shallow)"
test -f "$SHALLOW_FILE" || fail shallow_boundary_missing
test "$(wc -l < "$SHALLOW_FILE")" -eq 1 || fail shallow_boundary_mismatch
if awk -v oid="$BAD_COMMIT" '$0 == oid { found = 1 } END { exit found ? 0 : 1 }' "$SHALLOW_FILE"; then
  fail historical_commit_is_shallow_boundary
fi

test "$(git -C "$REPO" rev-parse "$R1" 2>/dev/null)" = "$OLD_A" ||
  fail target_ref_mismatch
test "$(git -C "$REPO" rev-parse "$R2" 2>/dev/null)" = "$OLD_B" ||
  fail target_ref_mismatch
test "$(git -C "$REPO" rev-parse "$R3" 2>/dev/null)" = "$OLD_A" ||
  fail target_ref_mismatch
test "$(git -C "$REPO" rev-parse "$R4" 2>/dev/null)" = "$OLD_B" ||
  fail target_ref_mismatch

test "$(git -C "$REPO" symbolic-ref "$RHEAD" 2>/dev/null)" = "$R2" ||
  fail symbolic_ref_mismatch
test "$(git -C "$REPO" rev-parse "$RHEAD" 2>/dev/null)" = "$OLD_B" ||
  fail symbolic_ref_mismatch

STAGING_REFS="$(
  git -C "$REPO" for-each-ref --format='%(refname)' \
    refs/purge-stage refs/purge-rollback
)"
test -z "$STAGING_REFS" || fail purge_staging_refs_present

EXPECTED_CONTAINING="$(
  printf '%s\n' "$R1" "$RHEAD" "$R2" "$R3" "$R4" | sort
)"
ACTUAL_CONTAINING="$(
  git -C "$REPO" for-each-ref --contains "$BAD_COMMIT" \
    --format='%(refname)' |
    sort
)"
test "$ACTUAL_CONTAINING" = "$EXPECTED_CONTAINING" ||
  fail unexpected_containing_refs

test "$(git -C "$REPO" cat-file -t "$BAD_COMMIT" 2>/dev/null)" = commit ||
  fail historical_commit_missing
test "$(git -C "$REPO" cat-file -t "$BAD_BLOB" 2>/dev/null)" = blob ||
  fail historical_blob_missing
test "$(git -C "$REPO" rev-list --all -- "$TARGET_PATH" | wc -l)" -eq 1 ||
  fail historical_path_reachability_mismatch
if git -C "$REPO" cat-file -e "HEAD:$TARGET_PATH" 2>/dev/null; then
  fail current_tree_contains_historical_path
fi
test ! -e "$REPO/$TARGET_PATH" || fail working_tree_contains_historical_path

if git -C "$REPO" merge-base --is-ancestor "$BAD_COMMIT" refs/heads/main; then
  fail main_contains_historical_commit
fi
if git -C "$REPO" merge-base --is-ancestor \
  "$BAD_COMMIT" refs/remotes/origin/main; then
  fail origin_main_contains_historical_commit
fi

for PSEUDO in HEAD ORIG_HEAD MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD REVERT_HEAD AUTO_MERGE; do
  PSEUDO_OID="$(
    git -C "$REPO" rev-parse --verify --quiet "$PSEUDO^{commit}" 2>/dev/null ||
      true
  )"
  test -n "$PSEUDO_OID" || continue
  if git -C "$REPO" merge-base --is-ancestor \
    "$BAD_COMMIT" "$PSEUDO_OID" 2>/dev/null; then
    fail pseudoref_contains_historical_commit
  fi
done

if test -f "$GIT_DIR/FETCH_HEAD"; then
  while read -r FETCH_OID REST; do
    if git -C "$REPO" cat-file -e "$FETCH_OID^{commit}" 2>/dev/null &&
      git -C "$REPO" merge-base --is-ancestor \
        "$BAD_COMMIT" "$FETCH_OID" 2>/dev/null; then
      fail fetch_head_contains_historical_commit
    fi
  done < "$GIT_DIR/FETCH_HEAD"
fi

declare -A DESCENDANT_OIDS=()
DESCENDANT_OIDS[$BAD_COMMIT]=1
while IFS= read -r DESCENDANT_OID; do
  DESCENDANT_OIDS[$DESCENDANT_OID]=1
done < <(
  git -C "$REPO" rev-list --all --reflog --ancestry-path "$BAD_COMMIT"..
)

EXPECTED_RETAINING_LOG="$GIT_DIR/logs/$R1"
REFLOG_DESCENDANT_FIELD_COUNT=0
while IFS= read -r LOG_PATH; do
  while read -r OLD_LOG_OID NEW_LOG_OID LOG_REMAINDER; do
    for LOG_OID in "$OLD_LOG_OID" "$NEW_LOG_OID"; do
      test "$LOG_OID" != "$BAD_COMMIT" ||
        fail reflog_mentions_historical_commit
      if test -n "${DESCENDANT_OIDS[$LOG_OID]+present}"; then
        REFLOG_DESCENDANT_FIELD_COUNT=$((
          REFLOG_DESCENDANT_FIELD_COUNT + 1
        ))
        test "$LOG_PATH" = "$EXPECTED_RETAINING_LOG" ||
          fail unexpected_reflog_retention
      fi
    done
  done < "$LOG_PATH"
done < <(
  find "$GIT_DIR/logs" "$GIT_DIR/worktrees" \
    -type f -path '*/logs/*' 2>/dev/null |
    sort -u
)

WORKTREE_COUNT=0
CURRENT_WORKTREE=
while IFS= read -r LINE; do
  case "$LINE" in
    worktree\ *)
      CURRENT_WORKTREE="$(printf '%s\n' "$LINE" | sed 's/^worktree //')"
      WORKTREE_COUNT=$((WORKTREE_COUNT + 1))
      ;;
    HEAD\ *)
      WORKTREE_HEAD="$(printf '%s\n' "$LINE" | sed 's/^HEAD //')"
      if git -C "$REPO" merge-base --is-ancestor \
        "$BAD_COMMIT" "$WORKTREE_HEAD" 2>/dev/null; then
        fail worktree_head_contains_historical_commit
      fi
      test ! -e "$CURRENT_WORKTREE/$TARGET_PATH" ||
        fail worktree_file_contains_historical_path
      ;;
  esac
done < <(git -C "$REPO" worktree list --porcelain)

test "$(git -C "$REPO" replace -l | wc -l)" -eq 0 ||
  fail replace_objects_present
test ! -s "$GIT_DIR/info/grafts" || fail legacy_grafts_present
test ! -s "$GIT_DIR/objects/info/alternates" || fail alternates_present
test -z "$(printenv GIT_ALTERNATE_OBJECT_DIRECTORIES 2>/dev/null || true)" ||
  fail alternate_environment_present
if git -C "$REPO" config --get extensions.partialClone >/dev/null 2>&1; then
  fail partial_clone_present
fi
test "$(
  git -C "$REPO" config --get-regexp '^remote\..*\.promisor$' 2>/dev/null |
    wc -l
)" -eq 0 || fail promisor_remote_present
test "$(find "$GIT_DIR/objects/pack" -maxdepth 1 -type f -name '*.promisor' | wc -l)" -eq 0 ||
  fail promisor_pack_present

MEM_AVAILABLE_KIB="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
CGROUP_MEMORY_BYTES="$(< /sys/fs/cgroup/memory.current)"
case "$MEM_AVAILABLE_KIB" in
  ''|*[!0-9]*) fail invalid_memory_reading ;;
esac
case "$CGROUP_MEMORY_BYTES" in
  ''|*[!0-9]*) fail invalid_cgroup_memory_reading ;;
esac
test "$MEM_AVAILABLE_KIB" -ge "$MIN_MEM_AVAILABLE_KIB" ||
  fail insufficient_available_memory
test "$CGROUP_MEMORY_BYTES" -le "$MAX_CGROUP_MEMORY_BYTES" ||
  fail excessive_cgroup_memory

trap - ERR
printf 'machine_preflight=pass\n'
printf 'repo=%s\n' "$REPO"
printf 'containing_ref_count=5\n'
printf 'worktree_count=%s\n' "$WORKTREE_COUNT"
printf 'reflog_descendant_field_count=%s\n' \
  "$REFLOG_DESCENDANT_FIELD_COUNT"
printf 'mem_available_kib=%s\n' "$MEM_AVAILABLE_KIB"
printf 'cgroup_memory_bytes=%s\n' "$CGROUP_MEMORY_BYTES"
printf 'all_other_sessions_idle=unverified\n'
printf 'workspace_frozen=unverified\n'
printf 'destructive_authorization=required\n'
printf 'authorizes_live_change=false\n'
