import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AlgoScreen.jsx", import.meta.url), "utf8");

test("Algo readiness uses Massive market data instead of the retired IBKR bridge", () => {
  assert.match(
    source,
    /const isMarketDataReadyForAlgo = \(session\) => Boolean\(session\?\.configured\?\.massive\);/,
  );
  assert.match(source, /const marketDataConfigured = Boolean\(session\?\.configured\?\.massive\);/);
  assert.match(source, /const marketDataReady = isMarketDataReadyForAlgo\(session\);/);
  assert.doesNotMatch(source, /isGatewayReadyForAlgo|hasGatewayLiveDataProof|bridgeRuntimeTone/);
});

test("Algo shadow deployment creation is not blocked on IBKR account readiness", () => {
  assert.match(source, /if \(!marketDataConfigured\) \{/);
  assert.match(source, /title: "Market data not configured"/);
  assert.match(
    source,
    /body: "Market-data streaming \(Massive\) must be configured before creating a deployment\."/,
  );
  assert.match(source, /marketDataAccountId: activeAccountId \|\| "shadow"/);
  assert.doesNotMatch(source, /No data account selected/);
  assert.doesNotMatch(source, /The bridge is authenticated, but no IBKR data account is active yet\./);
});

test("Algo account tabs use the live brokerage account list", () => {
  assert.match(source, /accountTabsAccounts = accounts,/);
  assert.match(
    source,
    /const positionAccounts = accountTabsAccounts\.length \? accountTabsAccounts : accounts;/,
  );
  assert.match(
    source,
    /return positionAccounts\.some\(\(account\) => account\.id === algoAccountTabRaw\)/,
  );
  assert.match(source, /positionAccounts=\{positionAccounts\}/);
  assert.match(
    source,
    /algoPositionsUseShadowOverlay\s*\?\s*\{[\s\S]*?mode: "shadow"[\s\S]*?\}\s*:\s*\{[\s\S]*?mode: "live"/,
  );
});

test("Algo STA display does not use the legacy Signal Monitor profile poll as a source gate", () => {
  assert.doesNotMatch(source, /useGetSignalMonitorProfile/);
  assert.doesNotMatch(source, /signalMonitorProfile\?\.enabled\s*===\s*false/);
  assert.doesNotMatch(source, /Signal Monitor is paused/);
  assert.doesNotMatch(source, /showing cached signals/);
});

test("Algo STA display reads the profile bundled with live signal state", () => {
  assert.match(
    source,
    /const signalMonitorProfile = signalMonitorState\?\.profile \|\| null;/,
  );
  assert.match(source, /signal matrix current/);
});

test("Algo STA row universe follows the Signal Matrix universe before deployment symbols", () => {
  assert.match(
    source,
    /const signalMonitorUniverseSymbols = Array\.isArray\(\s*signalMonitorState\?\.universeSymbols,/,
  );
  assert.match(
    source,
    /const signalMatrixStateUniverseSymbols = useMemo\(/,
  );
  assert.match(
    source,
    /const staSignalUniverseSymbols = signalMonitorUniverseSymbols\.length\s*\?\s*signalMonitorUniverseSymbols\s*:\s*signalMatrixStateUniverseSymbols\.length\s*\?\s*signalMatrixStateUniverseSymbols\s*:\s*focusedDeployment\?\.symbolUniverse \|\| \[\];/,
  );
  assert.match(source, /universeSymbols: staSignalUniverseSymbols,/);
});

test("Algo settings save mutations fail fast instead of spinning indefinitely", () => {
  assert.match(source, /const ALGO_SETTINGS_SAVE_TIMEOUT_MS = 25_000;/);
  assert.match(source, /const ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS = 300;/);
  assert.match(source, /const ALGO_SETTINGS_SAVE_PAUSE_TTL_MS =\s*ALGO_SETTINGS_SAVE_TIMEOUT_MS \+ ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS \+ 5_000;/);
  assert.doesNotMatch(source, /ALGO_SETTINGS_SAVE_API_BASE_URL/);
  assert.doesNotMatch(source, /VITE_PROXY_API_TARGET/);
  assert.match(
    source,
    /const ALGO_SETTINGS_SAVE_REQUEST_OPTIONS = Object\.freeze\(\{\s*timeoutMs: ALGO_SETTINGS_SAVE_TIMEOUT_MS,\s*\}\);/,
  );
  assert.match(
    source,
    /useUpdateSignalOptionsExecutionProfile\(\{\s*request: \{ \.\.\.ALGO_SETTINGS_SAVE_REQUEST_OPTIONS, headers: csrfHeaders \},/s,
  );
  assert.match(
    source,
    /useUpdateAlgoDeploymentStrategySettings\(\{\s*request: \{ \.\.\.ALGO_SETTINGS_SAVE_REQUEST_OPTIONS, headers: csrfHeaders \},/s,
  );
  assert.match(source, /title: "Save failed"/);
});

test("Algo settings save frees live stream connection slots before mutating", () => {
  assert.match(source, /useCriticalApiMutationPause\(\)/);
  assert.match(source, /isVisible && !criticalApiMutationPaused/);
  assert.match(
    source,
    /const releaseConnectionPause = beginCriticalApiMutationPause\(\{\s*ttlMs: ALGO_SETTINGS_SAVE_PAUSE_TTL_MS,\s*\}\);/,
  );
  assert.match(source, /getListSignalMonitorEventsQueryKey/);
  assert.match(source, /getListAlgoDeploymentsQueryKey/);
  assert.match(source, /getListExecutionEventsQueryKey/);
  assert.match(source, /getGetAccountPositionsQueryKey\("shadow"\)/);
  assert.match(source, /getGetSignalOptionsAutomationStateQueryKey\(deploymentId\)/);
  assert.match(source, /getGetAlgoDeploymentCockpitQueryKey\(deploymentId\)/);
  assert.match(source, /getGetSignalOptionsPerformanceQueryKey\(deploymentId\)/);
  assert.match(
    source,
    /void queryClient\.cancelQueries\(\{\s*queryKey: getListSignalMonitorEventsQueryKey\(\),\s*\}\);/,
  );
  assert.match(
    source,
    /await waitForCriticalApiMutationPauseSettle\(\s*ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS,\s*\);/,
  );
  assert.match(source, /releaseConnectionPause\(\);/);
});

test("Algo settings save avoids the full performance refresh lane", () => {
  assert.match(source, /includeSignalOptionsPerformance = true,/);
  assert.match(source, /if \(includeSignalOptionsPerformance\) \{/);

  const profileSaveSuccess = source.match(
    /const updateProfileMutation = useUpdateSignalOptionsExecutionProfile\([\s\S]*?const updateStrategySettingsMutation =/u,
  )?.[0];
  assert.ok(profileSaveSuccess, "profile save mutation block should exist");
  assert.match(profileSaveSuccess, /includeSignalOptionsPerformance: false,/);

  const strategySaveSuccess = source.match(
    /const updateStrategySettingsMutation = useUpdateAlgoDeploymentStrategySettings\([\s\S]*?const createDeploymentMutation =/u,
  )?.[0];
  assert.ok(strategySaveSuccess, "strategy save mutation block should exist");
  assert.match(strategySaveSuccess, /includeSignalOptionsPerformance: false,/);
});

test("Algo deployments query retains previous data through refetches", () => {
  const deploymentsQueryBlock = source.match(
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*?\n  \);/u,
  )?.[0];
  assert.ok(deploymentsQueryBlock, "deployments query block should exist");
  assert.match(deploymentsQueryBlock, /placeholderData: retainPreviousData,/);
});

test("Algo settings all-save reconciles drafts from mutation payloads", () => {
  const allSaveBlock = source.match(
    /const handleSaveAllAdjustments = async \(\) => \{[\s\S]*?const handleOpenCandidateInTrade/u,
  )?.[0];
  assert.ok(allSaveBlock, "all-save handler should exist");
  assert.match(
    allSaveBlock,
    /profileDraftState\.markClean\(\s*result\.profileResult\?\.profile \|\| profileDraft,\s*\);/,
  );
  assert.match(
    allSaveBlock,
    /strategySettingsDraftState\.markClean\(\s*resolveStrategySignalSettings\(/,
  );
  // Regression guard: the Profile leg must only be cleaned/reported when it was
  // actually saved (gated), never on the raw profileDirty flag. Otherwise a
  // skipped Profile PATCH silently drops the edits while claiming success.
  assert.match(
    allSaveBlock,
    /planAlgoAdjustmentsSaveReconciliation\(\{\s*profileDirty,\s*strategyDirty,\s*profileSaved: shouldSaveProfile,/,
  );
  assert.match(allSaveBlock, /if \(reconciliation\.markProfileClean\)/);
  assert.match(allSaveBlock, /if \(reconciliation\.markStrategyClean\)/);
  assert.doesNotMatch(
    allSaveBlock,
    /Signal and profile adjustments were updated\./,
  );
});

test("Algo settings save helper is not lazy-loaded at click time", () => {
  assert.match(
    source,
    /import \{[\s\S]*?\bsaveAllAlgoAdjustments\b[\s\S]*?\} from "\.\/algo\/saveAllAlgoAdjustments";/,
  );
  assert.doesNotMatch(
    source,
    /import\("\.\/algo\/saveAllAlgoAdjustments"\)/,
  );
});
