# WO-FB-S3B — CONDITIONAL: incremental aggregation (slice 1c) — DISPATCH ONLY AFTER RE-PROFILE GATE

STATUS: HELD. Per `docs/plans/elu-p3-proposal.md` §4 Slice 1c and §5 step 3, this lever ("maintain rolling
per-(symbol,timeframe) aggregated series updated on minute-bar close instead of per-call re-bucketing";
risk med-high: partial-bar, delayed-flag, gap-fill semantics) is dispatched ONLY IF the re-profile after
WO-FB-S3A/S3C/S3D/T14 shows the aggregation cluster is STILL a top CPU consumer (GC >10% or aggregation
incl >10% of on-CPU time, measured warm via `scripts/diag/cpu-profile-running-api.mjs`).

Orchestrator: at the decision gate, if the profile justifies it, expand this WO with fresh anchors +
the parity-fixture requirements from the brief (`docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md`
Stage 4: gate behind byte-identical signal fixtures — incremental result === from-scratch result over
recorded fixtures incl. bucket-boundary and gap cases) before dispatching. If the profile does NOT justify
it, close this WO with the measured numbers in `.codex-watch/wo-fb-s3b-decision.md`.
