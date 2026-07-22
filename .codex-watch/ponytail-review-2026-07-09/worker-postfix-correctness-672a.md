You are the pinned Codex gpt-5.6-sol xhigh final correctness reviewer for the PYRUS Full Ponytail Unit 05 repair.

IMPORTANT: Do not read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, or agents/. Do not modify agents/openai.yaml. Apply the Full Ponytail ladder directly from this prompt. This is an independent review of leader-authored code.

Context and required behavior:
- Shared dirty repo: /home/runner/workspace, branch main, HEAD d744a4ad8002fab0dcc79eae1227811ed50c8ce3. Do not inspect unrelated dirty paths.
- The retained repair must: reject fractional/noncanonical positive-integer env values; strip application-owned PostgreSQL URL controls (application_name, statement_timeout, query_timeout, idle_in_transaction_session_timeout, options); normalize effective IPv6 hosts for Node resolution; omit credential-bearing url from database descriptions; redirect db, dbTrading, and dbAuth through __setDbForTests; bound total admission wait with the same effective shared-pool connection timeout; remove queued timeouts; release late successful clients exactly once; free reservations after late failure.
- Focused evidence is already GREEN: 56/56 retained tests, 5/5 diagnostic integration tests, DB-package no-emit typecheck, and git diff --check.
- Current hashes: runtime.ts bcaf74df9b6a71e38140a9ac49eaf3b35738183fd38b12243aeb946b0f894c00; index.ts c5b58360d008511ab02448ed22875e2dfbc30910851d273ddedf66f6bb4d2b71; admission.ts 58574bfe3a4461bd4c180cf75e03d6e9c36070a4a5df3567b0ccec732e2c0aea; admission.test.ts 0f5eada1aebf91d878df34025f50b2201b507325d18768f5991c1b920b064621; runtime-pool-options.test.ts 3f5a5904852b40f99f0ea604c95659c2ca543dd79c674e33704609a20c0de170; runtime.test.ts d8c976145fca4acb944ce206a7e452c7a73173d8dce029441471cbfa2f789e93; positive-integer.ts 55467130abbac496cb4aa14de540567ec6d07ca222327c5043ee2f7bf04f59f8; pool-error-handler.ts 81212aa7a1a83c8fa2159d301fe0fb5ffd8bc2dd1cfdf03e19f3af45d031eccc.

Review assignment:
1. Read the five changed files fully, tests first. Read runtime.test.ts, positive-integer.ts, and only the production callers/installed pg source required to prove behavior.
2. Review the exact diff against HEAD across correctness, race ordering, resource accounting, architecture, security, and performance.
3. Try to falsify the implementation with concrete counterexamples: timeout vs dequeue/success/failure ordering; queueHead/splice/compaction; double release; stale timer; callback and promise pool paths; URL duplicate params/query-host precedence; IPv6 authority/query hosts; safe description type/runtime shape; nested test-seam restores.
4. Verify tests are behavior-authentic and identify any missing regression that is required before approval.
5. Apply Full Ponytail: require the shortest root fix that preserves trust-boundary validation and resource safety. Do not request stylistic rewrites.

Constraints:
- STRICT READ-ONLY. Do not edit/write repository files, stage, commit, stash, push, format, launch/reload the app, signal processes, access live DB/providers/external network, run migrations, or touch Replit state.
- You may run bounded network-free tests/probes. Do not create a hanging process. No further delegation unless explicitly pinning Codex gpt-5.6-sol; otherwise self-review inline.
- Stop on hash drift or ownership conflict.

Return:
1. APPROVE or REQUEST_CHANGES.
2. Required findings first with severity and exact file:line plus executable counterexample.
3. Refuted concerns.
4. Test authenticity/gaps and exact evidence.
5. Five-axis review summary and residual non-blocking risks.
6. Confirm final hashes and no files changed.
