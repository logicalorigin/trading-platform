# WO-P1-SHADOW — shadow-account: silent trailing-stop failure (T2) + session gates (T1b-5)

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/services/shadow-account.ts
(clean). Working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/ access.
Two independent fixes, SEPARATE hunk sets.

FIX A (T2, P1 silent-failure) — trailing-stop enforcement swallowed inside mark refresh.
`enforceSignalOptionsTrailingStopFromShadowMark` is defined ~:5118 and called ~:6222 during the mark
refresh. A throw from it is currently swallowed (no diagnostic/incident). Record the failure via the
existing failure/diagnostic mechanism in this file (counter / recordFailure / incident) rather than
swallowing. AC: an enforcement failure is surfaced (recorded), not silent. Test: new targeted test
forcing enforcement to throw → assert a failure is recorded and the caller continues safely.

FIX B (T1b-5, 2 sites) — live-session gate (~:1263) and expiring-options force-close (~:1251) use
fixed hours, so options are force-closed ~3h late on half-days. Locate both by description (grep for
the shadow option live-session gate and the expiry force-close-time logic). Wire them to
@workspace/market-calendar (resolveUsEquityMarketSession / resolveUsEquityMarketStatus /
listNyseEarlyCloses) so early-close + holiday data drive the gate and the force-close time. AC:
half-day sessions force-close at the early close (13:00 ET); holidays gated closed. Test: half-day
fixture.

Run touched api-server suites; paste output. Report: .codex-watch/wo-p1-shadow-report.md.
