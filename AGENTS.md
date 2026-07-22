# Agent Run Rules

- Replit owns the outer dev-app lifecycle. The Run button starts the selected `artifacts/pyrus: web` artifact; its development command lives in `artifacts/pyrus/.replit-artifact/artifact.toml`.
- Agents may run targeted build, test, and typecheck commands directly. To load
  backend changes, use Replit's native restart-run-workflow action for
  `artifacts/pyrus: web` when that tool is exposed; otherwise use the workspace
  Run/Stop controls. Never signal the launcher or pid2, and never shell-launch
  a second app copy. Vite handles frontend hot reload.
- `.replit`, `replit.nix`, and artifact TOML files are ordinary tracked configuration. Change them only when the task requires it, and validate the resulting command directly.
- Keep the active per-session handoff updated during substantial work: refresh it at session start, after meaningful edits or validation, before risky/long-running actions, and before handing off. Each durable handoff belongs in its own `SESSION_HANDOFF_YYYY-MM-DD_<full-codex-session-id>.md`; `SESSION_HANDOFF_MASTER.md` is the changelog/table of contents; `SESSION_HANDOFF_CURRENT.md` is only a compact pointer to the active handoff.
- For logic validation, prefer targeted `pnpm` test/typecheck/build commands (the fast path); restart the app for runtime/preview verification when needed.
- Treat shared Replit workspace memory as lifecycle-critical. Across all agents and
  sessions, serialize package installs, broad builds/typechecks, repeated bundling,
  browser/performance-capture processing, and large file patches. Do not launch nested
  `codex exec` sessions. Size and interrupt memory-heavy actions according to current
  headroom and observed pressure instead of blocking them behind fixed memory
  thresholds. Inspect large generated captures with path/size/status commands only —
  never print or patch their payloads.
- For PYRUS browser or HTTP runtime QA, use the normal Replit runtime URL (`https://${REPLIT_DEV_DOMAIN}` when available). Never probe `localhost`, `127.0.0.1`, direct Vite/API ports, or alternate sideports as an app target. Gstack's generic target discovery does not override this rule. Use `?pyrusQa=safe` only when intentionally testing the safe-QA mode itself. Wait on explicit readiness selectors instead of `networkidle`, avoid raw generated click targets like `@e*`, and get explicit approval before live full-app navigation or side-effectful controls.
- When a request has ambiguous product/UI semantics, especially wording like "share", "separate", "combine", "source", "pressure", or "footer", stop after repo inspection and ask a clarifying question before editing. Do not guess layout intent from implementation details alone; flatten ambiguity first, then implement.

## Fact-first operating rules

- Never guess when a fact can be checked locally. Before calling an endpoint, route, script, workflow, file path, or tool target, confirm it from source, generated clients, tests, route registration, or existing repo documentation.
- Separate facts, inferences, and unknowns in status updates and final reports. Say "observed" only for evidence from commands, source, logs, tests, browser/runtime output, or user-provided data. Say "inferred" when connecting evidence. Say "unknown" when not verified.
- Challenge assumptions before acting. For each non-trivial bug, plan, or implementation, identify the assumption that could be wrong and run the smallest factual check to confirm or reject it before expanding scope.
- If a request is even slightly ambiguous in a way that could change product behavior, data semantics, trading behavior, startup/runtime state, user-visible UI meaning, or the user's larger goals, stop after repo inspection and ask a concise clarifying question. Do not silently choose the most convenient interpretation.
- If instructions, existing code, runtime evidence, or prior handoffs conflict, surface the conflict with file/line or command evidence and ask which source of truth should win unless the repo already contains an explicit precedence rule.
- Stay inside the user's stated scope. Do not broaden from diagnosis to fixes, from scoped validation to full-app QA, or from source-confirmed probes to exploratory endpoint guessing without saying why and getting confirmation when scope is uncertain.
- Do not use speculative probes as discovery. Use `rg`, generated clients, route files, tests, or docs to find the correct command/URL/schema first; then run the probe.
- When evidence disproves the current theory, update the theory explicitly instead of forcing the data to fit the original plan.

## Karpathy-inspired operating rules

Behavioral guidelines from https://github.com/multica-ai/andrej-karpathy-skills. These bias toward caution over speed; use judgment for trivial one-line work.

- Think before coding. State assumptions, surface ambiguity and tradeoffs, push back when warranted, and ask when uncertainty would change the implementation.
- Keep solutions simple. Ship the minimum code that solves the request; do not add speculative features, one-off abstractions, or configurability that was not requested.
- Make surgical changes. Touch only what the task requires, match existing style, avoid drive-by refactors, and clean up only unused imports or code made obsolete by your own change.
- Work from verifiable goals. For non-trivial changes, define success criteria, use tests or focused checks where practical, and loop until the stated checks pass or a blocker is factual.
- For recurring bugs, remove the source. Identify the persisted state, creator path, and reader path; block stale state from re-entering before treating cleanup as permanent.

## Skill routing

When the user's request matches an available skill, invoke it. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming -> invoke `/office-hours`
- Strategy/scope -> invoke `/plan-ceo-review`
- Architecture -> invoke `/plan-eng-review`
- Design system/plan review -> invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline -> invoke `/autoplan`
- Bugs/errors -> invoke `/investigate`
- QA/testing site behavior -> invoke `/qa` or `/qa-only`
- Code review/diff check -> invoke `/review`
- Visual polish -> invoke `/design-review`
- Ship/deploy/PR -> invoke `/ship` or `/land-and-deploy`
- Save progress -> invoke `/context-save`
- Resume context -> invoke `/context-restore`
- Author a backlog-ready spec/issue -> invoke `/spec`
- Question tuning, developer profile, or "stop asking me that" -> invoke `/plan-tune`

## Ponytail discipline (all coding work, all agents)

Before writing or changing code, read `.claude/skills/ponytail/SKILL.md` and apply it at
level **full**: climb the ladder (does it need to exist -> reuse what's in the codebase ->
stdlib -> native platform -> installed dep -> one line -> minimum code), fix root causes not
symptoms, shortest working diff, mark deliberate shortcuts with a `ponytail:` comment naming
the ceiling and upgrade path. Never simplify away trust-boundary validation, data-loss error
handling, security, accessibility, or anything explicitly requested — and never skip
understanding the code before shortening the solution. Codex workers: treat this as a
standing rule from ignition, and leaders must repeat it in work-order prompts.

## Agent model vertical discipline

- Unless the user explicitly requests another model family, delegate only within the
  current agent's own model vertical. A Codex leader uses Codex workers; do not silently
  substitute Claude, Gemini, or another provider's agents.
- Vary cost and depth inside that vertical through the available model and reasoning
  profiles. State the selected model/profile in each worker assignment.
- If the available delegation tool cannot pin the requested vertical, disclose that
  limitation and use a pin-capable Codex mechanism or work inline. Do not cross model
  verticals as an implicit fallback.
- Workers may delegate further only when those subagents can also be pinned to the same
  vertical. Otherwise they must self-review inline or return the review lane to the
  leader for a separately pinned Codex worker.
