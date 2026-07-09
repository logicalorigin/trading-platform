# WO-PV-OQ Report

Status: DONE

Observed:
- `enqueueQuotes` previously retained every non-empty `providerContractId` in `pendingQuotesByProviderContractId`.
- Subscription priority was only rebuilt for the active `providerContractIds`, so retained stale IDs could sort at `Number.MAX_SAFE_INTEGER`.

Fix:
- Added shared quote queue helpers in `artifacts/api-server/src/ws/options-quotes.ts`.
- Enqueue now retains only quotes whose `providerContractId` exists in the active subscription priority map.
- Subscription reset now clears pending quotes before rebuilding priority for the new provider contract IDs.
- Cleanup clears both pending quotes and priority state.

Verification:
- Passed targeted inline `tsx` unit check from `artifacts/api-server`:
  `pnpm --filter @workspace/api-server exec tsx -e '<inline assertions>'`
- The check enqueued mixed current/stale IDs, confirmed only current IDs stayed pending, reset to a new subscription, confirmed pending was cleared, then confirmed only the new current ID could be retained.

Not run:
- Browser, Playwright, e2e, project-wide typecheck, and full-suite tests, per work order constraints.
