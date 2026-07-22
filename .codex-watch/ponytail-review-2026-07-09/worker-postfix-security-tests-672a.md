You are the pinned Codex gpt-5.6-sol high independent security/test-authenticity reviewer for the PYRUS Full Ponytail Unit 05 repair.

IMPORTANT: Do not read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, or agents/. Do not modify agents/openai.yaml. Apply Full Ponytail directly. You did not author this patch.

Scope:
- Repo /home/runner/workspace, main at d744a4ad8002fab0dcc79eae1227811ed50c8ce3, heavily dirty from concurrent owners. Review only lib/db/src/{runtime.ts,runtime.test.ts,index.ts,runtime-pool-options.test.ts,positive-integer.ts,admission.ts,admission.test.ts,pool-error-handler.ts} and exact behavior callers.
- Current hashes: runtime.ts bcaf74df9b6a71e38140a9ac49eaf3b35738183fd38b12243aeb946b0f894c00; index.ts c5b58360d008511ab02448ed22875e2dfbc30910851d273ddedf66f6bb4d2b71; admission.ts 58574bfe3a4461bd4c180cf75e03d6e9c36070a4a5df3567b0ccec732e2c0aea; admission.test.ts 0f5eada1aebf91d878df34025f50b2201b507325d18768f5991c1b920b064621; runtime-pool-options.test.ts 3f5a5904852b40f99f0ea604c95659c2ca543dd79c674e33704609a20c0de170; runtime.test.ts d8c976145fca4acb944ce206a7e452c7a73173d8dce029441471cbfa2f789e93; positive-integer.ts 55467130abbac496cb4aa14de540567ec6d07ca222327c5043ee2f7bf04f59f8; pool-error-handler.ts 81212aa7a1a83c8fa2159d301fe0fb5ffd8bc2dd1cfdf03e19f3af45d031eccc.
- GREEN evidence: 56/56 retained tests; 5/5 diagnostic integration tests; DB-package typecheck; diff check.

Independently audit:
1. Treat DATABASE_URL/PG* env as untrusted configuration. Prove the canonicalization cannot leak credentials or preserve an application-owned override, and that it does not silently break valid socket/TCP/IPv6 endpoint precedence.
2. Prove DatabaseRuntimeDescription is safe in both TypeScript and runtime JSON shape, including failure/unconfigured branches and current callers.
3. Prove __setDbForTests redirects/restores all three database lanes, including nested restore behavior and real consumers.
4. Adversarially assess admission timers for orphaned clients, unhandled rejections, incorrect counters, unbounded queues, timer handles, and exceptional release behavior.
5. Review test type authenticity, isolation from process.env/module cache, flakiness, and whether the GREEN commands actually exercise each claim.
6. Review performance: hot-path allocations/linear work must be bounded or exceptional.

Constraints:
- STRICT READ-ONLY. No repository edits/writes, stage/commit/stash/push, app launch/reload, signals, live DB/provider/external network, migrations, or Replit actions.
- Bounded network-free probes only; do not leave processes running. No unrelated dirty files. Stop on hash drift.
- No further delegation unless explicitly pinning Codex gpt-5.6-sol; otherwise perform a fresh inline adversarial pass.

Return a concise APPROVE or REQUEST_CHANGES with required issues first (severity, file:line, counterexample), refuted hypotheses, validation assessment, five-axis verdict, residual optional risks, and final no-write/hash confirmation.
