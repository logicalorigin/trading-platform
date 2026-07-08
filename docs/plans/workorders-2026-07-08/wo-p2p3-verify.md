# WO-P2P3-VERIFY — adversarially verify the recovered P2/P3 backlog (READ-ONLY, report only)

Codex worker, /home/runner/workspace. STRICTLY READ-ONLY: do NOT edit any code, do NOT run any git
command that mutates state, do NOT run tests. No ~/.claude/ or .claude/skills/ or agents/ access.

Input: `.codex-watch/wo-p2p3-recovery-report.md` (~18 single-pass P2/P3 findings, each with file:line).

For EACH finding: open the cited `file:line` and enough surrounding code to judge it, then adversarially
verify — be skeptical, try to REFUTE it:
- Is the described mechanism REAL (does it actually occur), or is it already handled / guarded / not
  reachable? 
- Is the SEVERITY right (P1 / P2 / P3 / not_a_defect)?
- Has it ALREADY been fixed? Check `git log 7a517820..HEAD` — note several perf/correctness fixes
  landed today (WO-P1-*, WO-P2-T7/T8/T10/T11). If a finding is now moot, mark it fixed/stale.
- Some cited files may be mid-edit by a concurrent session — if a finding no longer matches the current
  code, say so (do not assume).

Deliverable: write `.codex-watch/wo-p2p3-verify-report.md`. For each finding: `file:line`, original
severity, VERDICT (CONFIRMED_REAL | NOT_A_DEFECT | ALREADY_FIXED | CANT_TELL), effective severity,
one-line why, and a one-line recommended action. Then a ranked shortlist of CONFIRMED_REAL findings,
most-severe first. No code changes.
