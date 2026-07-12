# Review — Issue #51: "Restore startup config and harden against recovery clobbers"

**Reviewer:** Claude Code · **Date:** 2026-07-08 · **Method:** every claim below was checked against the live repo (commands shown) or against the known-good ref `31c9a5e9`. A multi-agent pass adversarially re-verified the sharpest findings; where that pass *refuted* a claim, it is marked.

---

## TL;DR

The plan is **directionally right** (restore → canonicalize → detect → clean debris) but **misframed in three load-bearing ways** that, if executed literally, would leave the exact outage undetected and the repo's own gate still red.

1. **The repo is already broken right now.** `.replit` at HEAD fails the startup audit (stale ports + missing `runButton`), which means **`pnpm typecheck` is red repo-wide today** — independent of anything in this plan. Immediate one-line fix exists and is verified green.
2. **Step 3's detection is blind to the actual outage.** The event that bricked all shells was a deleted `replit.nix` + stripped `[nix]` channel. The existing audit — and the plan's proposed detection — do **not** check either of those, nor the `postgresql-16` module. A repeat clobber of the real vectors stays **green**. Meanwhile the one thing Step 3 *does* propose to detect (`runButton`) is **already** detected today.
3. **Detection can't run in the failure mode it targets, and "re-lock" doesn't protect anything.** A stripped `[nix]` channel removes node/pnpm/bash, so any in-container node detector is inside its own blast radius. And `chmod 0o444` does not stop Replit's recovery process (it runs as the file owner). Both give false assurance.

**Recommendation: rework the plan before execution** (corrected sequence at the end). The single highest-value change is *extending the existing audit* to cover `replit.nix`/`[nix]`/`postgresql-16`, plus **standing up off-container CI** — not building a new snapshot subsystem or a supervisor-side warning.

---

## Verified current state (facts, not inference)

| Check | Result | Evidence |
|---|---|---|
| `node scripts/check-replit-startup-guards.mjs` on HEAD | **FAILS, exit 1** | Two errors: 14 stale `[[ports]]` present; `[workflows] runButton` missing |
| `pnpm typecheck` gate | **red** | `audit:replit-startup` is the first step of both `typecheck` and `audit:guards` (package.json) |
| Restore to known-good: `git checkout 31c9a5e9 -- .replit` | **audit exit 0** | Verified by swapping the file in and re-running the guard |
| `.replit` vs `31c9a5e9` | diverges **both** ways | Missing `postgresql-16`, `[workflows] runButton`, `[userenv.development]`; **plus 14 extra stale `[[ports]]`** (3002,3007,3008,4010,8000,8081,8082,18081,18082,18083,18084,18748,18749,18759) |
| `replit.nix` vs `31c9a5e9` | **identical** | `git diff` empty — nix pair already restored; `[nix] channel="stable-25_05"` present in `.replit` |
| Config lock state | **half-applied** | `.replit` 644 *writable*, `replit.nix` 644 *writable*, `artifact.toml` 444 read-only — the two clobbered files are currently **unlocked** |
| Codex debris tracked in HEAD | **164 files** | `git ls-files .codex-watch .codex-log-watch .codex-watch-current .codex-watch-live .codex-watch-live-auth` → 164; HEAD commit `ab77d365` added ~137 of them |
| `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED` consumers | **none in source** | `rg` over `*.ts/tsx/js/mjs/py` → 0 hits; only in `.env.example` + handoff docs |

---

## Findings by severity

### 🔴 Blocker / load-bearing

**B1 — Step 3 detection is blind to the exact clobber that caused the outage.**
The existing guard (`scripts/check-replit-startup-guards.mjs`) enforces the port table, `runButton`, `stack`, `run`, and ~30 artifact/package invariants — but has **no check** for `postgresql-16` in `modules`, `[nix]` channel presence, or `replit.nix` existence (its only `replit.nix` mention, line 384, just asserts the protector script *names* the file; it never reads it). The outage deleted `replit.nix` and stripped `[nix]` — the guard would report **green** through all of it.
→ **Fix (highest value in the whole plan):** extend the *existing* guard with 3 cheap invariants — `modules` includes `postgresql-16`; `.replit` contains a `[nix]` `channel = …`; `existsSync(replit.nix)` (optionally: contains `[nix]`-critical pkgs). ~10 lines in a file already wired into `typecheck`. Do **not** build a second detector.

**B2 — The detector cannot execute in the failure mode it targets (bootstrap paradox).**
A stripped `[nix]` channel breaks Nix evaluation, which is what provides node/pnpm/bash. Every run surface for the audit/supervisor depends on that toolchain. Confirmed: **no CI** (`.github/workflows` absent), git hooks are husky no-ops (call non-existent `precommit`/`prepush` scripts), and `runDevApp.mjs` never reads config or invokes the audit. So an in-container node detector is structurally incapable of firing exactly when it's needed.
→ **Fix:** the only surviving surface is **off-container CI validating the tracked `.replit`/`replit.nix` on push** (this catches the *committed* "Post-Recovery checkpoint" — which does commit). Stand that up. For the live bricked-shell case, document a **toolchain-free restore** the user can paste or apply via Replit's file UI: `git checkout 31c9a5e9 -- .replit replit.nix`. A node-based "restore script" that can't run when the shell is bricked is not real protection.

### 🟠 High

**H1 — "Restore the three missing lines" is the wrong mental model; the file diverges both ways.** *(verified: holds up)*
Adding 3 lines cannot pass the audit — the exact-equality port check still fails on the 14 stale ports. The clean fix restores lines *and* strips ports atomically:
```bash
git checkout 31c9a5e9 -- .replit replit.nix
```
This also eliminates hand-edit TOML risk (see M3). **Reframe Step 1 from "add 3 lines" to "replace file with canonical," and set the success criterion to "`audit:replit-startup` passes," not "3 lines present."**

**H2 — The "data loss from restoring the 14 ports" worry is unfounded — restore is safe.** *(adversarially verified → risk DROPPED)*
The guard *hardcodes* the canonical port set to `{8080→8080, 18747→3000}` and its failure message literally says "Do not restore stale/generated ports such as 8000, 3002, 3007, 18748, or 18749." Three independent sources (guard message, known-good commit, a prior handoff that removed these same ports) classify them as Replit-generated debris. Keeping them is not even a valid passing state. → Proceed with the wholesale restore; do not try to preserve those ports.

**H3 — "Re-lock config" gives false assurance.** *(verified across all agents)*
`protect-replit-config.mjs` only does `chmod 0o444` on `runner`-owned files. Replit's "Post-Recovery checkpoint" rewrote `.replit` and deleted `replit.nix` *three times* regardless — it writes with at least owner privileges. The lock blocks accidental **in-session** edits only, never platform recovery (the stated, out-of-scope root cause). Keep the lock as hygiene, but **do not sequence any protection as depending on it**, and say so plainly. (Also: currently only `artifact.toml` is locked; `.replit`/`replit.nix` are writable — the lock is inconsistently applied.)

**H4 — Step 4 (gitignore-only) cannot meet its own stated goal.** *(verified empirically)*
**164 debris files are already tracked** in HEAD; `.gitignore` is never consulted for tracked paths. Adding the globs stops *future new* debris but does nothing about the 164 tracked files — a checkpoint's `git add -A`/`commit -a` still commits their changes.
→ **Add an explicit sub-step:** `git rm -r --cached .codex-watch .codex-watch-current .codex-watch-live .codex-watch-live-auth .codex-log-watch` (index-only removal; files stay on disk), committed with the `.gitignore` edit. Verify `git ls-files | grep -c codex-watch` → 0. This is an **index mutation, not a history rewrite**, so it does *not* violate the "no history rewrites" scope — but the plan's framing conflicts with it, so **the plan owner should explicitly authorize this narrow index cleanup**, because the goal is impossible without it.

### 🟡 Medium

**M1 — Step 2 is NOT redundant/wrong — keep it, but source it from git.** *(adversarial pass REFUTED the "drop Step 2" recommendation)*
A guard can only *fail* a check; it cannot rewrite the bytes of a deleted `replit.nix`. Restoration needs the known-good bytes stored somewhere restorable — that *is* Step 2's job, and dropping it removes the only real restore capability. **However**, those bytes already exist as the immutable git blob `31c9a5e9`, so prefer a **named git tag** (e.g. `replit-config-known-good`) + a documented one-liner over a hand-maintained duplicate file that can itself silently drift from the guard's expectations. If a restore *script* is kept, add a cheap test asserting its output passes `check-replit-startup-guards.mjs` (exit 0).

**M2 — Restore-vs-lock interaction is unhandled, with a silent-failure trap.** *(verified)*
A write-back to a locked file fails with **EACCES** (not EPERM) — including the shell-redirect form `git show REF > .replit`. But `git checkout REF -- file` / `git restore` *succeed* on a `0o444` file and **silently reset its mode to `0o644`**, stripping the lock with no warning. → Any restore must explicitly `unlock → write → re-lock`, or the git-checkout path must be followed by a deliberate re-lock. State the ordering; don't leave it to a redirect that fails silently during a lockout recovery.

**M3 — The `[userenv.development]` IBKR flag is dead config, not a behavior restore.** *(verified: no source consumer)*
`IBKR_ASYNC_SIDECAR_ROUTING_ENABLED` has **no consumer** in any `.ts/.tsx/.js/.mjs/.py` at HEAD (only `.env.example` + handoff docs); its consumer was removed at `0c284e27` (2026-07-05), *before* known-good `31c9a5e9`. Restoring it changes **no runtime behavior** — it re-introduces orphaned config. → Don't describe it as "restoring IBKR routing." Decide explicitly: **parity** (keep, matches locked baseline) *or* **cleanup** (drop it and its `.env.example` placeholder). Either way, split this behavior-adjacent flag out from the plumbing fixes so it isn't silently bundled.

**Resolution (2026-07-12):** cleanup was chosen after a second zero-consumer census; the flag and its example placeholder were retired without changing the active Client Portal bridge path.

**M4 — `postgresql-16` must be restored as the Replit *module*, and it isn't audit-verifiable.** *(verified)*
`31c9a5e9:replit.nix` has no postgres pkg — psql/managed PG came solely from the `modules = […, "postgresql-16"]` line. The guard does **not** check the modules line, so "run the audit" won't prove this restored. → Restore it in `modules` (compatible with the guard, which only forbids *workspace-local* postgres). Verify separately with `which psql` — and note psql only resolves **after** the container re-provisions the module, not instantly, so a momentarily-failing `which psql` is not a bad restore.

**M5 — No post-restore "done" verification in the plan.**
→ Add an explicit done-check: guard exit 0 · `.replit` parses as TOML · `replit.nix` present with `[nix]` channel · `https://$REPLIT_DEV_DOMAIN/api/healthz` → 200 and `/` title `PYRUS Platform` · `which psql` (with the re-nix latency caveat).

### 🔵 Low

- **L1 — Don't over-broaden the gitignore.** Keep exactly `.codex-watch*` and `.codex-log-watch/` (the latter isn't matched by the former — different prefix). Do **not** add global `*.png`/`*.pid`/`*.registry` rules — the repo has legitimately tracked PNGs, and the dir globs already cover every nested watch PNG/pid/registry. `*.cpuprofile` is **already** ignored (line 115). Note `.codex-watch*` (no leading slash) matches at any depth — beneficial for worktree scratch, but anchor with `/` if root-only is intended.
- **L2 — Sequencing.** Pin canonical (Step 2) *before* restore (Step 1): the restore is `git checkout <canonical>`, so the canonical definition logically precedes it.
- **L3 — CLAUDE.md imprecision.** `runButton` lives in `.replit` `[workflows]`, **not** in `artifact.toml` (which has no `runButton` field). Cheap to correct if docs are touched; directs the edit to the right file.

---

## What the plan gets right

- Correct overall shape: restore → canonicalize → detect → clean debris.
- Correctly identifies all three missing `.replit` items and the debris problem.
- Correctly scopes the platform-recovery root cause as *out of controllable scope* — the honest constraint.
- The "one batched save inside a maintenance window" instinct (minimize the unlocked window) is the right mitigation given H3.

---

## Recommended corrected plan

1. **Unblock now (independent of the rest):** `git checkout 31c9a5e9 -- .replit replit.nix` → run `node scripts/check-replit-startup-guards.mjs` (expect exit 0). This restores `postgresql-16` + `runButton` + strips the 14 stale ports in one atomic step, turning `typecheck` green. Then re-lock **both** files consistently.
2. **Decide the IBKR flag on purpose** (M3): parity vs. cleanup. Don't bundle it silently.
3. **Extend the existing guard** (B1) with `postgresql-16`-in-modules, `[nix]`-channel, and `replit.nix`-exists checks — hard-fail, matching the existing pattern. This is the highest-value change.
4. **Stand up off-container CI** (B2) that runs `audit:guards` on push, so committed recovery-checkpoint clobbers are caught where node still runs. Document the toolchain-free `git checkout` restore for the bricked-shell case.
5. **Canonical restore = a git tag + documented one-liner** (M1), not a bespoke snapshot subsystem. If a script is kept, test that its output passes the guard, and wrap unlock→write→re-lock (M2).
6. **Debris:** add `.codex-watch*` + `.codex-log-watch/` to `.gitignore` **and** `git rm -r --cached` the 164 tracked files across all 5 dirs (H4). Skip the global `*.png`/`*.pid`/`*.cpuprofile` rules (L1).
7. **Add the post-restore done-check** (M5).

## Open decisions for the owner

- **IBKR flag:** restore for parity, or drop as cleanup? (It's dead config either way.)
- **`git rm --cached` authorization:** the untracking is required for Step 4 to work but brushes against the "no history rewrites" scope line — confirm the narrow index cleanup is authorized.
- **Canonical mechanism:** git tag + one-liner (recommended) vs. checked-in duplicate file + restore script?
- **CI:** is standing up an off-container check (`.github/workflows`) in scope? It's the only place detection actually survives the clobber.
