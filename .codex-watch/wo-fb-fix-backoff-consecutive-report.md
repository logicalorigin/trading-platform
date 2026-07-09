# WO-FB-FIX-BACKOFF-CONSECUTIVE Report

## Changed

- `artifacts/api-server/src/services/platform.ts:11371` adds the local-timeout threshold `3` and a `4096` entry cap.
- `artifacts/api-server/src/services/platform.ts:14015` adds the per-backoff-key local-timeout count map; `platform.ts:14028` resets it in test cache reset.
- `artifacts/api-server/src/services/platform.ts:15125` classifies only `massive_options_request_timeout` as the local timeout counted for this guard.
- `artifacts/api-server/src/services/platform.ts:15139` increments the bounded count map and evicts the oldest key when the cap is reached.
- `artifacts/api-server/src/services/platform.ts:15166` clears both normal backoff and the local-timeout count on success.
- `artifacts/api-server/src/services/platform.ts:15199` keeps upstream 5xx/429/transport failures backing off immediately and sets normal backoff on the third consecutive local timeout.
- `artifacts/api-server/src/services/option-chain-policy.test.ts:110` covers two local timeouts without backoff and third timeout with backoff.
- `artifacts/api-server/src/services/option-chain-policy.test.ts:169` covers success reset of the consecutive local-timeout count.

## Diff Stat

Start:

```text
$ git diff --stat -- artifacts/api-server/src/services/platform.ts
# no output
```

End:

```text
$ git diff --stat -- artifacts/api-server/src/services/platform.ts
 artifacts/api-server/src/services/platform.ts | 62 ++++++++++++++++++++++++---
 1 file changed, 56 insertions(+), 6 deletions(-)
```

Full touched-code stat:

```text
 .../src/services/option-chain-policy.test.ts       | 24 ++++++++-
 artifacts/api-server/src/services/platform.ts      | 62 +++++++++++++++++++---
 2 files changed, 79 insertions(+), 7 deletions(-)
```

## Verification

RED check before implementation:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/option-chain-policy.test.ts
✖ local option metadata timeout backs off only after consecutive stalls (17.868219ms)
ℹ tests 9
ℹ pass 8
ℹ fail 1
exit 1
```

Focused GREEN check:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/option-chain-policy.test.ts
✔ local option metadata timeout backs off only after consecutive stalls (0.920556ms)
✔ upstream 500 and 429 option errors set backoff (0.46782ms)
✔ successful option fetch clears existing backoff for the key (0.46336ms)
✔ successful option fetch resets consecutive local timeout count (0.327617ms)
✔ cache fallback predicate stays broad for transient local timeouts (0.510841ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 59079.684715
exit 0
```

API typecheck:

```text
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
exit 0
```

Diff whitespace:

```text
$ git diff --check -- artifacts/api-server/src/services/platform.ts artifacts/api-server/src/services/option-chain-policy.test.ts .codex-watch/wo-fb-fix-backoff-consecutive-report.md
exit 0
```

Targeted signal suite:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts
/bin/bash: line 1: pnpm: command not found
exit 127
```

Blocked after the successful focused test and typecheck by the local Node toolchain mount. Narrow checks showed the Nix store entries for `pnpm`, `node`, and `bun` returning `Transport endpoint is not connected`; a later `pnpm --version` retry still returned `command not found`. The 446+/0 signal suite was not re-run in this shell after that environment failure.
