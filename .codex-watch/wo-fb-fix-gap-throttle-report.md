# WO-FB-FIX-GAP-THROTTLE Report

## Summary

Implemented the gap-fetch retry fix with a minimal diff:

- `artifacts/api-server/src/services/signal-monitor.ts:5032` adds a 4096-entry cap for the completed-bars gap-fetch last-attempt map.
- `artifacts/api-server/src/services/signal-monitor.ts:5592` stores only the per-cell attempt timestamp in the retry map.
- `artifacts/api-server/src/services/signal-monitor.ts:5689` now throttles retries by cell attempt time alone; the candidate window no longer has to match or move backward for the throttle to bind.
- `artifacts/api-server/src/services/signal-monitor.ts:5710` records attempts through the existing `lruCacheSet` bounded-cache helper, evicting oldest entries past the cap.
- `artifacts/api-server/src/services/signal-monitor.ts:14918` exposes `lastAttemptCount`, the queue helper, and the cap through test internals only.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:858` adds the empty-result moving-window throttle regression.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:918` adds the attempt-map cap regression.

## Diff Stat

Start:

```text
$ git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
<empty>
```

End:

```text
$ git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
 .../api-server/src/services/signal-monitor.ts      | 24 ++++++++++++++++------
 1 file changed, 18 insertions(+), 6 deletions(-)
```

## Validation

Source-only check passed:

```text
$ git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts
<empty>
exit 0
```

Requested pnpm validation was blocked by the local JS toolchain mount. Exact tails:

```text
$ pnpm --filter @workspace/api-server run typecheck
/bin/bash: line 1: pnpm: command not found
exit 127
```

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts
/bin/bash: line 1: pnpm: command not found
exit 127
```

Touched-suite attempt:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-completed-bars-cache.test.ts
/bin/bash: line 1: pnpm: command not found
exit 127
```

Toolchain probes:

```text
$ ls -l /nix/store/s7awkfc4pym4zj139fsxrjs5xwf5hhnd-nodejs-24.13.0-wrapped/bin/node
ls: cannot access '/nix/store/s7awkfc4pym4zj139fsxrjs5xwf5hhnd-nodejs-24.13.0-wrapped/bin/node': Transport endpoint is not connected
```

```text
$ ls -l /nix/store/61lr9izijvg30pcribjdxgjxvh3bysp4-pnpm-10.26.1/bin/pnpm
ls: cannot access '/nix/store/61lr9izijvg30pcribjdxgjxvh3bysp4-pnpm-10.26.1/bin/pnpm': Transport endpoint is not connected
```

```text
$ node --version
/bin/bash: line 1: node: command not found

$ pnpm --version
/bin/bash: line 1: pnpm: command not found
```

Observed: no usable local Node, Bun, Deno, Corepack, or workspace-local Node binary was found outside the broken Nix paths. Unknown: runtime/test status until the Replit/Nix toolchain mount is healthy again.
