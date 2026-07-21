# PYRUS CSO 13-Finding Closure Matrix

Prepared: 2026-07-21 10:01:09 MDT / 2026-07-21T16:01:09Z

Decision: `HOLD` for publication.

## What this matrix means

The original 2026-07-19 census reported 13 findings. The 2026-07-20 daily
machine report lists only F1, with trend counts of 12 resolved, one persistent,
and zero new. That is the latest completed audit result.

It is not a fresh certification of the current shared worktree. No product
suite, build, runtime, browser flow, provider system, or live database was
rerun in this session because the shared tree remains mutable and other
sessions are active. `Historically resolved` below means resolved by the July
20 audit evidence and omitted from its surviving-finding list. Every such item
must pass again on one immutable release candidate.

## Finding status

| ID | Original finding | Latest audit state | Supporting evidence | Required frozen-candidate proof |
| --- | --- | --- | --- | --- |
| F1 | Historical IBKR bridge credential reachable through named Git refs | **Persistent verified / publication blocker** | Latest report retains F1 at High, confidence 10/10. Five refs still contain commit `ce7173d...`; the live commit and blob remain packed. The purge rehearsal and fail-closed preflight pass, but no live rewrite ran. Service decommission is owner-attested; time, post-event use review, and reviewer are missing. | Complete the local purge, separately verify/remediate remotes and Replit-managed copies, and obtain acceptable decommission/revocation evidence or an explicit reviewed risk exception. Then rerun secret and release gates. |
| F2 | Current worktree removed fail-closed production and publication gates | Historically resolved | The latest report counts it among 12 resolved. Prior closeout recorded restored supervisor/session-host/startup/publication controls and passing production guard/build/typecheck chains. | `pnpm run audit:guards`, root typecheck, and `pnpm run build:pyrus-app` on the exact clean candidate. |
| F3 | Raw IBKR Flex statements retained without expiry | Historically resolved | Prior handoff records the production purge: all 54 normalized audit rows retained, `raw_xml` dropped, and approximately 137 MB removed. The latest report does not retain F3. Provider recovery copies remain a separate retention question. | Verify migration/schema state and retention regression on the candidate; retain provider deletion/expiry evidence for historical database copies. |
| F4 | Handoff discovery accepted ancestor-CWD sessions | Historically resolved | Strict descendant containment and focused handoff security tests were previously green 7/7, including foreign/ancestor rejection. The latest report does not retain F4. | Rerun the handoff writer security suite from the frozen tree. |
| F5 | Member diagnostics could overwrite global incidents without provenance | Historically resolved | Provenance/actor scoping and MCP quarantine had focused green evidence; the latest report does not retain F5. | Rerun the exact API, route-auth, MCP, generated-contract, and package typecheck lanes selected from frozen source. |
| F6 | Non-exposable `HttpError` returned or logged internal message/detail | Historically resolved | Central response and logging redaction had focused green evidence; the prior consolidated security set was green 14/14. The latest report does not retain F6. | Rerun serializer/log-boundary tests and API typecheck; review any changed error paths. |
| F7 | Pentest market proxy logged query-string API keys | Historically resolved | Access logging was disabled with source and harness regressions; the prior guarded pentest set was green 15/15. The latest report does not retain F7. | Rerun proxy source contracts and the non-active harness safety suite; no real key or provider request. |
| F8 | Ignored mutable skills were live-linked without provenance | Historically resolved | The unused global sync installer was retired and the audited global skill state contained only `.system`; the latest report does not retain F8. | Confirm the installer and callers remain absent and publication/runtime behavior does not consume mutable ignored skills. |
| F9 | OpenAPI omitted runtime routes and security semantics | Historically resolved | Prior handoff records bidirectional completeness across 226 first-party operations with explicit public/user/admin/service/CSRF classifications. The latest report does not retain F9. | Rerun route/spec/security-manifest parity and API codegen drift checks on the candidate. |
| F10 | User-scoped table registry was incomplete and tested only one direction | Historically resolved | Reverse-completeness remediation previously passed 2/2 with no omitted-query IDOR found. The latest report does not retain F10. | Rerun bidirectional exported-schema parity and the scoped query audit. |
| F11 | IBKR gateway-host lifecycle router was defined but not mounted | Historically resolved | Production mount parity previously passed 8/8; HMAC/replay controls 5/5 and lifecycle client 6/6. The latest report does not retain F11. | Rerun mount, HMAC/replay, client, session-host build, and API typecheck lanes. |
| F12 | Handoff master updates were unlocked and non-atomic | Historically resolved | Serialized atomic replacement and the concurrent-writer regression were previously green within the 7/7 handoff suite. The latest report does not retain F12. | Rerun the handoff writer suite, including concurrent writers, from the candidate. |
| F13 | Broker authorization popups retained `window.opener` | Historically resolved at source/focused level | Same-origin blank-popup isolation and fail-closed cleanup passed focused helper tests 4/4; the latest report counts F13 resolved. Real provider navigation was not run. | Rerun helper/source tests and normal-URL browser acceptance without an unapproved broker/provider side effect. |

## F1 has separate closure tracks

A successful history rewrite closes only the local Git-copy subgate. F1 cannot
be called closed until all applicable tracks are resolved:

1. Credential/service: acceptable revocation or decommission evidence, plus
   post-event use review when available; otherwise an explicit reviewed
   release-risk exception.
2. Local Git: four direct refs atomically rewritten, symbolic ref preserved,
   reflogs expired, objects pruned, strict fsck and clean-transfer proof pass.
3. Remote Git: actual server namespaces discovered, approved refs updated with
   exact leases, and fresh remote mirrors prove absence.
4. Provider retention: Replit copy classes are deleted or reach documented
   terminal expiry, or each residual class is explicitly risk-accepted.
5. Release candidate: all 12 historically resolved findings and the complete
   build/scanner/runtime/browser suite pass on immutable bytes.

## Adversarial audit of the conclusion

| Claim | Evidence for it | Strongest counterexample or unknown | Decision |
| --- | --- | --- | --- |
| Twelve findings were resolved | July 20 machine report: `resolved=12`, `persistent=1`, `new=0`; only F1 is listed. | The shared tree has continued changing and those suites were not rerun here. | Use `historically resolved`; require frozen-candidate reruns. |
| The live purge is ready | Disposable rewrite/application/rollback passed; retention census and fail-closed preflight passed. | Other sessions are not proven idle; live refs and packed objects remain; destructive authorization is absent. | Ready as a procedure, not executed or authorized. |
| Decommission makes the credential harmless | Owner states the old bridge is decommissioned. | Decommission time, service records, post-event logs, and reviewer are unavailable; reuse or backup restoration is unverified. | F1 remains open unless evidence or explicit reviewed exception is accepted. |
| Local cleanup removes all copies | Local ref/reflog/object/worktree checks can prove the live repository and a clean mirror. | Remote hidden refs, checkpoints, Agent context, File History, database recovery, and disaster-recovery systems are not locally observable. | Require remote fresh mirrors and provider evidence/exception. |
| An all-ref local scan covers the whole repository lifetime | It covers every ref and object available in the local object store. | The repository has a shallow boundary, so older server history can exist outside the local graph. | Label the local scope and require server-side full-history/fresh-mirror evidence. |
| A scanner pass proves publication readiness | Gitleaks, OSV, guards, typecheck, and builds cover important lanes. | Gitleaks default rules can miss secrets; no repository policy exists; scanners do not prove runtime authorization or provider deletion. | Treat scanners as necessary but not sufficient. |

## Source evidence

- Original 13 findings:
  `.gstack/security-reports/2026-07-19-230625.json`
- Latest daily report:
  `.gstack/security-reports/2026-07-20-211827.json`
- Detailed census and dated remediation updates:
  `.local/security-results/cso-comprehensive-20260719.md`
- Prior session closeout:
  `SESSION_HANDOFF_2026-07-20_019f80c9-5232-7d93-8cb1-2e2988b662ff.md`
- Credential evidence boundary:
  `.local/security-results/retired-ibkr-bridge-token-rotation-runbook-20260716.md`
- Purge evidence and verification package:
  `.local/security-results/ibkr-historical-credential-purge-rehearsal-20260721.json`
  and
  `.local/security-results/ibkr-historical-credential-post-purge-verification-plan-20260721.md`

No status in this matrix authorizes publication. Final acceptance requires an
independent reviewer; the latest machine report itself records self-verification
because a model-pinned independent worker was unavailable.
