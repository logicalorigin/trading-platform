# WO-P2-T7 — cockpit change-detection re-serializes identical payload per subscriber

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/services/algo-cockpit-streams.ts
(~:272). Verify clean first; working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/
or agents/ access. Unit tests only.

PROBLEM (P2 perf, verified ≥0.85): the cockpit change-detection path serializes the SAME payload once
per subscriber; with N subscribers the identical payload is JSON-serialized N times per update. Locate
the per-subscriber serialize.

FIX: serialize once per payload version and share the serialized result across subscribers (memoize on
a payload version/identity). AC: one serialize per payload version regardless of subscriber count; no
behavior change to what each subscriber receives.

Verify: targeted unit test asserting a single serialize for multiple subscribers on one payload. Report:
.codex-watch/wo-p2-t7-report.md.
