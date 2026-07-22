# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.
Source: https://github.com/multica-ai/andrej-karpathy-skills

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Project Run Rules

- Replit's Run/Stop controls own the managed artifact lifecycle. The selected
  `artifacts/pyrus: web` artifact runs the development command declared in
  `artifacts/pyrus/.replit-artifact/artifact.toml`.
- Agents may build, test, and typecheck directly. The API uses a built bundle, so loading
  backend changes requires Replit's native restart-run-workflow action when exposed, or the
  workspace Run/Stop controls otherwise. Never signal the launcher or pid2, and never
  shell-launch a second app copy. Vite hot-reloads frontend changes.
- Confirm what the user sees by hitting the public preview URL from the container:
  `https://$REPLIT_DEV_DOMAIN/` (web) and `.../api/healthz` (API) — 200 + `<title>PYRUS Platform</title>`
  means the preview will render the live app on refresh.
- Canonical ports are API `8080` and web/preview `18747`.
- Targeted `pnpm` test/typecheck/build commands remain the fast path for logic validation; restart
  only when you need runtime/preview verification.
- Shared Replit memory is lifecycle-critical. Serialize package installs, broad builds/typechecks,
  repeated bundling, browser/performance-capture processing, and large file patches across all
  agents and sessions. Do not launch nested `codex exec` sessions. Before memory-heavy work,
  require at least 6 GiB `MemAvailable` and no more than 10 GiB in cgroup `memory.current`;
  otherwise reduce load first. Never print or patch the payload of a large generated capture.

**Headless browser (visual verification + screenshots) — repo-native, no setup.** To actually SEE a
rendered page (catch blank screens, crashes, console errors, network patterns), use the committed
helper instead of any external/ephemeral browser daemon:
`pnpm shot "https://$REPLIT_DEV_DOMAIN/?screen=market-demo" --out /tmp/x.png --full --json`
(`scripts/headless-shot.mjs`; flags: `--wait-for <css>`, `--wait <ms>`, `--match <substr>` to count
network calls, `--viewport WxH`, `--fail-on-console`). It drives the already-installed
`@playwright/test` pointed at Replit's Nix-provided Chromium via
`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`; the shared libs are declared in `replit.nix`, so there is NO
`playwright install` step and it survives container rebuilds. The same wiring is in
`artifacts/pyrus/playwright.config.ts`, so the e2e specs (`pnpm --filter @workspace/pyrus run
browser:waterfall`) run in-container too. The app holds open SSE streams, so `networkidle` never
fires — use `--wait`/`--wait-for`, not idle waits. Then Read the PNG to view it. Off Replit, run
`pnpm exec playwright install chromium` once (the env var is unset and Playwright uses its own browser).

## Fact-First Operating Rules

- Never guess when a fact can be checked locally. Before calling an endpoint, route, script, workflow, file path, or tool target, confirm it from source, generated clients, tests, route registration, or existing repo documentation.
- Separate facts, inferences, and unknowns in status updates and final reports. Say "observed" only for evidence from commands, source, logs, tests, browser/runtime output, or user-provided data. Say "inferred" when connecting evidence. Say "unknown" when not verified.
- Challenge assumptions before acting. For each non-trivial bug, plan, or implementation, identify the assumption that could be wrong and run the smallest factual check to confirm or reject it before expanding scope.
- If a request is even slightly ambiguous in a way that could change product behavior, data semantics, trading behavior, startup/runtime state, user-visible UI meaning, or the user's larger goals, stop after repo inspection and ask a concise clarifying question. Do not silently choose the most convenient interpretation.
- If instructions, existing code, runtime evidence, or prior handoffs conflict, surface the conflict with file/line or command evidence and ask which source of truth should win unless the repo already contains an explicit precedence rule.
- Stay inside the user's stated scope. Do not broaden from diagnosis to fixes, from scoped validation to full-app QA, or from source-confirmed probes to exploratory endpoint guessing without saying why and getting confirmation when scope is uncertain.
- Do not use speculative probes as discovery. Use `rg`, generated clients, route files, tests, or docs to find the correct command/URL/schema first; then run the probe.
- When evidence disproves the current theory, update the theory explicitly instead of forcing the data to fit the original plan.
- Trace every "because." Any causal claim — "the stream stalled because the connection died", "it's slow because of pressure" — is a HYPOTHESIS, not a finding, until the cause is verified from source or runtime. The instant you write "because", STOP: the clause after "because" is the actual deliverable and must be investigated, not asserted. A symptom is not a cause ("the connection died" is a symptom; WHY it died is the answer); chase the chain down to a verified root, not the first plausible-sounding link. Never present an unverified cause as the answer. If the root isn't proven yet, label it "cause unverified" and state the single check that would confirm it — then run that check before concluding.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- ANY coding task (writing, refactoring, fixing, reviewing, dependency choice) -> apply /ponytail
  discipline by default (level: full): read `.claude/skills/ponytail/SKILL.md` and climb its ladder
  before writing code. This binds subagents and codex workers too — work-orders should say so.
- Product ideas/brainstorming -> invoke /office-hours
- Strategy/scope -> invoke /plan-ceo-review
- Architecture -> invoke /plan-eng-review
- Design system/plan review -> invoke /design-consultation or /plan-design-review
- Full review pipeline -> invoke /autoplan
- Bugs/errors -> invoke /investigate
- QA/testing site behavior -> invoke /qa or /qa-only
- Code review/diff check -> invoke /review
- Visual polish -> invoke /design-review
- Ship/deploy/PR -> invoke /ship or /land-and-deploy
- Save progress -> invoke /context-save
- Resume context -> invoke /context-restore
- Author a backlog-ready spec/issue -> invoke /spec

## Dynamic workflow orchestration (Workflow tool)

When authoring `Workflow` scripts, tier model + effort per stage — do NOT default every `agent()`
to Fable. Omitting `model` inherits the session model (Opus); that is the default.

| Stage archetype | model | effort |
|---|---|---|
| Discover / grep / list / scan | `haiku` (or `agentType: 'Explore'`) | `low` |
| Read + map subsystem / transform / review | omit → Opus | med–high |
| Final synthesis / adversarial verify / hard judgment | `fable` (reserve here ONLY) | high/xhigh |

Fable is allowed only on the single hardest terminal stage (a miss is expensive); keep that stage
on the strong model even when finders are cheap — cheap finders + one strong verifier is optimal.

Highest-leverage token rules (bigger savings than the model swap; they stack):
- One sharp deliverable per subagent with explicit inputs (paths/symbols) + a `schema`; prompt
  agents to "return data, do not echo file contents".
- Scout-then-fan-out: a cheap step builds the work-list; workers take narrow slices.
- Prefer `pipeline()` over a `parallel()` barrier; dedup before verify; `.filter(Boolean)`.
- Resume via `resumeFromRunId` after edits; avoid `worktree` isolation unless mutating in parallel.
- Scale fan-out + vote-count to the ask; `log()` any truncation; `budget`-scale depth.

Detail: memory `workflow-model-effort-tiering` and `workflow-decomposition-token-savers`.
