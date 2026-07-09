# WO-10: SnapTrade mocked-state browser QA (READ-ONLY, report + screenshots)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. NO code changes, NO commits, NO app restarts (preview is pid2-anchored). Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`.

## Context

`019f1eea` (Jul 1) built the SnapTrade hosted-brokerage surfaces but its browser QA was never done and no later session claimed it: header SnapTrade broker popover (`HeaderSnapTradeBrokerStatus.jsx`, `HeaderStatusCluster.jsx`), Settings SnapTrade panel (`SnapTradeConnectPanel.jsx`), Trade-ticket SHARES route. QA is in mocked/no-live-credential state — no live brokerage calls, no orders.

Tooling: the app is already running (web preview port 18747, API 8080). Use the committed headless-shot helper:
`pnpm shot "https://$REPLIT_DEV_DOMAIN/?screen=<screen>" --out /tmp/wo10-<name>.png --full --json` with `--wait-for <css>`/`--wait <ms>` (SSE keeps networkidle from firing — never rely on idle). `--fail-on-console` to catch console errors. Auth: if the login gate blocks, use `--storage-state` support added in `de3421cc` (see `scripts/headless-shot.mjs --help`); if no stored state is available, report BLOCKED for the gated screens rather than working around auth.

## Task

For each surface — (a) header broker popover, (b) Settings SnapTrade panel, (c) Trade ticket SHARES route:
1. Screenshot default state, light + dark if the shot helper exposes theme (check its flags; else note).
2. Capture console errors (`--fail-on-console` run) and failed network calls (`--match snaptrade` to count SnapTrade API calls and their statuses).
3. Exercise the no-credential path: panels must render an honest empty/disconnected state — no crash, no infinite spinner, no fabricated data.
4. Check the popover/panel against `DESIGN.md` doctrine at a smoke level (tone/primitives obviously off? note it for WO-07's batches, don't fix).

## Deliverable

`.codex-watch/wo-10-snaptrade-qa-2026-07-07.md`: per-surface verdict (PASS / issue list with screenshot paths), console/network findings, and a ranked defect list (file:line where identifiable). Screenshots under `/tmp/wo10-*.png` referenced by path.
