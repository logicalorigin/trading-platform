# WO-R3B report

## Result

- Commit A SHA: `80f081f8b703b37bd045b49a4cf420fc553fea1b`
- Commit B SHA: `441a95959a0036f5e0d808be260bdca210de2d05`
- Commit C SHA: `594d46be66536fc0da5c6865b0220da37a4f761d`
- Staging: clean after commits. `git diff --cached --name-only` returned no paths.

## Verification before Commit A

### Typecheck

Command:

```sh
pnpm --filter @workspace/api-server run typecheck
```

Observed: EXIT=0.

Tail:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

### Dead-symbol search

Command:

```sh
rg -c 'SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY|shouldAllowSignalMonitorBrokerLiveEdgeRetry|retryReplacesNonIbkrLatest|liveEdgePriority' --type ts artifacts lib
```

Observed: EXIT=1 with no stdout, which is the expected no-match status.

Tail:

```text

```

### Targeted suites

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/runtime-flight-recorder.test.ts
```

Observed: EXIT=0, 54/54 pass.

Tail:

```text
✔ signal matrix stream bootstrap hydrates from stored canonical state (0.504088ms)
✔ signal matrix stream bootstrap keeps stored unavailable cells as row placeholders (0.26427ms)
✔ signal matrix stream bootstrap does not publish runtime fallback state as matrix truth (0.098979ms)
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27029.701414
```

## Verification before Commit B

### Typecheck

Command:

```sh
pnpm --filter @workspace/api-server run typecheck
```

Observed: EXIT=0.

Tail:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

### Dead-symbol search

Command:

```sh
rg -c 'SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY|shouldAllowSignalMonitorBrokerLiveEdgeRetry|retryReplacesNonIbkrLatest|liveEdgePriority' --type ts artifacts lib
```

Observed: EXIT=1 with no stdout, which is the expected no-match status.

Tail:

```text

```

### Targeted suites

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/runtime-flight-recorder.test.ts
```

Observed: EXIT=0, 54/54 pass.

Tail:

```text
✔ signal matrix stream bootstrap hydrates from stored canonical state (93.63646ms)
✔ signal matrix stream bootstrap keeps stored unavailable cells as row placeholders (1.269836ms)
✔ signal matrix stream bootstrap does not publish runtime fallback state as matrix truth (0.380123ms)
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27944.365999
```

## Verification before Commit C

### Standalone rider check

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-local-bar-cache-rollup.test.ts
```

Observed: EXIT=0, 3/3 pass.

Tail:

```text
✔ behavior preserved: deterministic multi-hour ingest rolls up exactly across timeframes (7.135458ms)
✔ disabled live aggregate persistence skips per-aggregate rollup scan work (0.547725ms)
✔ bound: per-aggregate scan is bounded by the recent session window, not deep history (124.793386ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1525.914815
```

### Typecheck

Command:

```sh
pnpm --filter @workspace/api-server run typecheck
```

Observed: EXIT=0.

Tail:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

### Dead-symbol search

Command:

```sh
rg -c 'SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY|shouldAllowSignalMonitorBrokerLiveEdgeRetry|retryReplacesNonIbkrLatest|liveEdgePriority' --type ts artifacts lib
```

Observed: EXIT=1 with no stdout, which is the expected no-match status.

Tail:

```text

```

### Targeted suites

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor-stream.test.ts src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/runtime-flight-recorder.test.ts
```

Observed: EXIT=0, 49/49 pass on this final pre-Commit-C run.

Tail:

```text
✔ server-owned producer subscriber does not count as real (0.120913ms)
✔ matrix stream wakes promptly when a real subscriber attaches during idle cadence (0.257412ms)
ℹ tests 49
ℹ suites 0
ℹ pass 49
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 78922.978255
```

## Notes

- Observed after Commit B: `artifacts/api-server/src/services/signal-monitor.ts` became dirty again with a reference-bar candidate cache diff. It was left unstaged and uncommitted.
- Carried exclusions still observed dirty and unstaged: `artifacts/api-server/src/providers/ibkr/client.ts`, `lib/ibkr-contracts/src/client.ts`.
- Unknown: why the final full targeted suite before Commit C reported 49 tests while the Commit A and Commit B runs reported 54. The command exited 0 with no failures, cancellations, skips, or todos.
