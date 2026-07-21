#!/usr/bin/env bash
set -euo pipefail

WORKSPACE=/home/runner/workspace
SCRIPT="$WORKSPACE/.local/security-tools/ibkr-historical-credential-purge-preflight.sh"
OLD_A=1e927435497f59973fb34a77de78a029f94af933
OLD_B=ce7173dfe39cd50bf54b413437b3ec3a37046356
R1=refs/heads/replit-agent
R2=refs/remotes/gitsafe-backup/main
R3=refs/replit/agent-ledger
R4=refs/tags/replit-fiasco-20260610
RHEAD=refs/remotes/gitsafe-backup/HEAD

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_line() {
  local output=$1
  local expected=$2
  printf '%s\n' "$output" | awk -v expected="$expected" '
    $0 == expected { found = 1 }
    END { exit found ? 0 : 1 }
  ' || fail "missing output line: $expected"
}

expect_fail() {
  local repo=$1
  local reason=$2
  local output
  local status

  set +e
  output="$(bash "$SCRIPT" --repo "$repo" 2>&1)"
  status=$?
  set -e

  test "$status" -ne 0 || fail "expected failure: $reason"
  assert_line "$output" machine_preflight=fail
  assert_line "$output" "reason=$reason"
  assert_line "$output" authorizes_live_change=false
}

expect_pass() {
  local repo=$1
  local output
  local status

  set +e
  output="$(bash "$SCRIPT" --repo "$repo" 2>&1)"
  status=$?
  set -e

  if test "$status" -ne 0; then
    printf '%s\n' "$output" >&2
    fail "expected machine preflight to pass for $repo"
  fi
  printf '%s\n' "$output"
}

test -f "$SCRIPT" || fail "RED: implementation does not exist"

LIVE_TARGETS_BEFORE="$(
  git -C "$WORKSPACE" for-each-ref --format='%(refname) %(objectname) %(symref)' \
    "$R1" "$RHEAD" "$R2" "$R3" "$R4"
)"
LIVE_OUTPUT="$(expect_pass "$WORKSPACE")"
LIVE_TARGETS_AFTER="$(
  git -C "$WORKSPACE" for-each-ref --format='%(refname) %(objectname) %(symref)' \
    "$R1" "$RHEAD" "$R2" "$R3" "$R4"
)"

test "$LIVE_TARGETS_BEFORE" = "$LIVE_TARGETS_AFTER" ||
  fail "protected live refs changed"
assert_line "$LIVE_OUTPUT" machine_preflight=pass
assert_line "$LIVE_OUTPUT" containing_ref_count=5
assert_line "$LIVE_OUTPUT" all_other_sessions_idle=unverified
assert_line "$LIVE_OUTPUT" workspace_frozen=unverified
assert_line "$LIVE_OUTPUT" destructive_authorization=required
assert_line "$LIVE_OUTPUT" authorizes_live_change=false

expect_fail /tmp/not-a-pyrus-repository repository_not_found

TEST_ROOT="$(mktemp -d /tmp/pyrus-purge-preflight-test.XXXXXX)"
chmod 700 "$TEST_ROOT"
cleanup() {
  case "$TEST_ROOT" in
    /tmp/pyrus-purge-preflight-test.*)
      test ! -L "$TEST_ROOT" || return
      test "$(stat -c '%U' "$TEST_ROOT")" = "$(id -un)" || return
      test "$(stat -c '%a' "$TEST_ROOT")" = 700 || return
      rm -rf --one-file-system -- "$TEST_ROOT"
      ;;
  esac
}
trap cleanup EXIT

FIXTURE="$TEST_ROOT/fixture"
git clone --no-local "$WORKSPACE" "$FIXTURE" >/dev/null 2>&1
git -C "$FIXTURE" update-ref -d refs/remotes/origin/replit-agent
git -C "$FIXTURE" fetch --no-tags "$WORKSPACE" \
  "+$R1:$R1" \
  "+$R2:$R2" \
  "+$R3:$R3" \
  "+$R4:$R4" >/dev/null 2>&1
git -C "$FIXTURE" symbolic-ref "$RHEAD" "$R2"
git -C "$FIXTURE" fetch --no-tags "$WORKSPACE" refs/heads/main >/dev/null 2>&1
git -C "$FIXTURE" reflog expire --expire=now --all

FIXTURE_REFS_BEFORE="$(
  git -C "$FIXTURE" for-each-ref --format='%(refname) %(objectname) %(symref)'
)"
FIXTURE_STATUS_BEFORE="$(
  git -C "$FIXTURE" status --porcelain=v2 --untracked-files=all
)"
FIXTURE_OUTPUT="$(expect_pass "$FIXTURE")"
FIXTURE_REFS_AFTER="$(
  git -C "$FIXTURE" for-each-ref --format='%(refname) %(objectname) %(symref)'
)"
FIXTURE_STATUS_AFTER="$(
  git -C "$FIXTURE" status --porcelain=v2 --untracked-files=all
)"
test "$FIXTURE_REFS_BEFORE" = "$FIXTURE_REFS_AFTER" ||
  fail "fixture refs changed"
test "$FIXTURE_STATUS_BEFORE" = "$FIXTURE_STATUS_AFTER" ||
  fail "fixture status changed"
assert_line "$FIXTURE_OUTPUT" machine_preflight=pass

TARGET_REFLOG_DESCENDANT="$(
  git -C "$FIXTURE" rev-list --ancestry-path "$OLD_B..$OLD_A" |
    sed -n '2p'
)"
test -n "$TARGET_REFLOG_DESCENDANT" ||
  fail "could not select target-branch descendant fixture"
git -C "$FIXTURE" update-ref "$R1" "$TARGET_REFLOG_DESCENDANT" "$OLD_A"
git -C "$FIXTURE" update-ref "$R1" "$OLD_A" "$TARGET_REFLOG_DESCENDANT"
expect_pass "$FIXTURE" >/dev/null
git -C "$FIXTURE" reflog expire --expire=now --all

git -C "$FIXTURE" update-ref "$R1" "$OLD_B" "$OLD_A"
git -C "$FIXTURE" update-ref "$R1" "$OLD_A" "$OLD_B"
expect_fail "$FIXTURE" reflog_mentions_historical_commit
git -C "$FIXTURE" reflog expire --expire=now --all

git -C "$FIXTURE" update-ref --no-deref "$RHEAD" "$OLD_B"
expect_fail "$FIXTURE" symbolic_ref_mismatch
git -C "$FIXTURE" symbolic-ref "$RHEAD" "$R2"

git -C "$FIXTURE" update-ref refs/heads/unexpected-retainer "$OLD_B"
expect_fail "$FIXTURE" unexpected_containing_refs
git -C "$FIXTURE" update-ref -d refs/heads/unexpected-retainer

git -C "$FIXTURE" update-ref refs/purge-stage/unexpected "$OLD_B"
expect_fail "$FIXTURE" purge_staging_refs_present
git -C "$FIXTURE" update-ref -d refs/purge-stage/unexpected
git -C "$FIXTURE" reflog expire --expire=now --all

git -C "$FIXTURE" update-ref --create-reflog \
  refs/heads/unexpected-reflog-retainer "$OLD_A"
git -C "$FIXTURE" update-ref refs/heads/unexpected-reflog-retainer \
  refs/heads/main "$OLD_A"
expect_fail "$FIXTURE" unexpected_reflog_retention
git -C "$FIXTURE" update-ref -d refs/heads/unexpected-reflog-retainer
git -C "$FIXTURE" reflog expire --expire=now --all

git -C "$FIXTURE" update-ref "$R1" refs/heads/main
expect_fail "$FIXTURE" target_ref_mismatch
git -C "$FIXTURE" update-ref "$R1" "$OLD_A"

printf 'PASS: preflight is read-only and fails closed on tested ref hazards\n'
