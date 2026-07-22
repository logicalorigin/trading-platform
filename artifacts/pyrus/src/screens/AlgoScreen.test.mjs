import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./AlgoScreen.jsx", import.meta.url),
  "utf8",
);
const settingsRegionSource = readFileSync(
  new URL("./algo/AlgoSettingsRegion.jsx", import.meta.url),
  "utf8",
);
const confirmDialogSource = readFileSync(
  new URL("../components/ui/ConfirmDialog.jsx", import.meta.url),
  "utf8",
);
const createDeploymentModalSource = readFileSync(
  new URL("./algo/CreateDeploymentModal.jsx", import.meta.url),
  "utf8",
);

test("Algo owns the inline account-assignment state and data lifecycle", () => {
  assert.match(
    source,
    /import \{ DeploymentAccountsPanel \} from "\.\/algo\/DeploymentAccountsModal\.jsx";/,
  );
  assert.match(
    source,
    /const \[accountControlsOpen, setAccountControlsOpen\] = useState\(false\);/,
  );
  assert.match(
    source,
    /enabled: Boolean\(\s*isVisible && accountControlsOpen && focusedDeployment\?\.id,?\s*\)/,
  );
  assert.match(source, /accountControlsOpen=\{accountControlsOpen\}/);
  assert.match(source, /accountControls=\{\s*<DeploymentAccountsPanel/);
  assert.match(source, /<DeploymentAccountsPanel[\s\S]*?isPhone=\{algoIsPhone\}/);
  assert.match(
    source,
    /const EMPTY_ALGO_DEPLOYMENT_ACCOUNTS = Object\.freeze\(\[\]\);/,
  );
  assert.match(
    source,
    /accounts=\{\s*deploymentAccountsQuery\.data\?\.accounts \|\|\s*EMPTY_ALGO_DEPLOYMENT_ACCOUNTS\s*\}/,
  );
  assert.match(
    source,
    /onManageAccounts=\{\(\) =>\s*setAccountControlsOpen\(\(current\) => !current\)\s*\}/,
  );
});

test("owned-account discovery refreshes on every panel entry and fails out of loading", () => {
  const query = source.match(
    /const deploymentAccountsQuery = useListAlgoDeploymentAccounts\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(query, "Missing generated owned-account query");
  assert.match(source, /const ALGO_ACCOUNT_LIST_TIMEOUT_MS = 8_000;/);
  assert.match(query, /timeoutMs: ALGO_ACCOUNT_LIST_TIMEOUT_MS/);
  assert.match(query, /staleTime: 0/);
  assert.match(query, /refetchOnWindowFocus: true/);
  assert.match(query, /retry: false/);
  assert.doesNotMatch(query, /customFetch/);
});

test("Algo readiness uses Massive market data instead of the retired IBKR bridge", () => {
  assert.match(
    source,
    /const isMarketDataReadyForAlgo = \(session\) =>\s*Boolean\(session\?\.configured\?\.massive\);/,
  );
  assert.match(
    source,
    /const marketDataConfigured = Boolean\(session\?\.configured\?\.massive\);/,
  );
  assert.match(
    source,
    /const marketDataReady = isMarketDataReadyForAlgo\(session\);/,
  );
  assert.doesNotMatch(
    source,
    /isGatewayReadyForAlgo|hasGatewayLiveDataProof|bridgeRuntimeTone/,
  );
});

test("Algo account positions do not substitute previous query data", () => {
  const query = source.match(
    /const signalOptionsLedgerPositionsQuery = useGetAccountPositions\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(query, "Missing Algo account positions query");
  assert.doesNotMatch(source, /retainPreviousAccountData/);
  assert.doesNotMatch(query, /placeholderData/);
});

test("Algo account positions keep the initial snapshot structural", () => {
  const query = source.match(
    /const signalOptionsLedgerPositionsQuery = useGetAccountPositions\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(query, "Missing Algo account positions query");
  assert.equal((query.match(/detail: "fast"/g) || []).length, 2);
  assert.equal((query.match(/liveQuotes: false/g) || []).length, 2);
  assert.doesNotMatch(query, /liveQuotes: true/);
});

test("Algo account positions use the same full selected-account source as Accounts", () => {
  const query = source.match(
    /const signalOptionsLedgerPositionsQuery = useGetAccountPositions\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(query, "Missing Algo account positions query");
  assert.match(
    source,
    /const \[algoAccountTabRaw, setAlgoAccountTab\] = useAccountTab\(\);/,
  );
  assert.doesNotMatch(source, /useAccountTab\("shadow"\)/);
  assert.doesNotMatch(query, /source:\s*"automation"/);
});

test("Algo deployment inventory is independent of the process trading environment", () => {
  const query = source.match(
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*?\n  \);/,
  )?.[0];

  assert.ok(query, "Missing Algo deployments query");
  assert.match(
    query,
    /useListAlgoDeployments\(\s*\{\s*includeArchived:\s*true,?\s*\},/,
  );
  assert.doesNotMatch(query, /mode:\s*environment/);
});

test("Algo deployment mutation updates the canonical all-mode cache", () => {
  const start = source.indexOf("const setDeploymentCache");
  const cacheSetter = source.slice(
    start,
    source.indexOf("const refreshAlgoQueries", start),
  );

  assert.notEqual(start, -1, "Missing Algo deployment cache updater");
  assert.match(cacheSetter, /getListAlgoDeploymentsQueryKey\(\)/);
  assert.doesNotMatch(
    cacheSetter,
    /getListAlgoDeploymentsQueryKey\(\{\s*mode:/,
  );
});

test("account Apply success is not reclassified by a redundant follow-up read", () => {
  const start = source.indexOf("const applyDeploymentAccounts = async");
  const handler = source.slice(
    start,
    source.indexOf("const refreshAlgoQueries", start),
  );

  assert.notEqual(start, -1, "Missing account Apply handler");
  assert.match(handler, /mergeAppliedDeploymentTargets/);
  assert.match(handler, /setDeploymentCache/);
  assert.doesNotMatch(
    handler,
    /await customFetch\(\s*`\/api\/algo\/deployments\/\$\{encodeURIComponent\(focusedDeployment\.id\)\}`/,
  );
});

test("admin live activation submits only explicit target IDs and refreshes Algo state", () => {
  const start = source.indexOf("const activateDeploymentLiveMutation");
  const end = source.indexOf("const updateProfileMutation", start);
  const activation = source.slice(start, end);

  assert.notEqual(start, -1, "Missing live activation mutation");
  assert.match(
    activation,
    /`\/api\/algo\/deployments\/\$\{encodeURIComponent\(deploymentId\)\}\/activate-live`/,
  );
  assert.match(activation, /body: JSON\.stringify\(\{ targetIds \}\)/);
  assert.match(activation, /setDeploymentCache\(deployment\)/);
  assert.match(activation, /refreshAlgoQueries\(\)/);
  assert.match(activation, /getListAlgoDeploymentAccountsQueryKey/);
  assert.match(activation, /title: "Live trading activated"/);
  assert.doesNotMatch(activation, /executionEnabled\s*:/);
  assert.match(source, /canActivateLive=\{authSession\.isAdmin\}/);
  assert.match(source, /onActivateLive=\{activateDeploymentLive\}/);
  assert.match(
    source,
    /activationPending=\{activateDeploymentLiveMutation\.isPending\}/,
  );
});

test("legacy live-money actions open selected-account controls without mutating mode or enablement", () => {
  const modeHandler = source.slice(
    source.indexOf("const handleToggleDeploymentMode"),
    source.indexOf("const handleToggleDeploymentArchive"),
  );

  assert.match(modeHandler, /setAccountControlsOpen\(true\)/);
  assert.doesNotMatch(
    modeHandler,
    /setDeploymentModeMutation|enableDeploymentMutation|pauseDeploymentMutation/,
  );
  assert.doesNotMatch(source, /useSetAlgoDeploymentMode/);
  assert.doesNotMatch(source, /pendingLiveSwitch/);
  assert.doesNotMatch(source, /Run this algo with real money/);
});

test("Algo live-mode cancel and Escape use the dialog's focus-restoring path", () => {
  assert.match(
    confirmDialogSource,
    /onOpenAutoFocus=\{\(\) => \{\s*restoreFocusRef\.current = document\.activeElement;/,
  );
  assert.match(
    confirmDialogSource,
    /onCloseAutoFocus=\{\(event\) => \{\s*event\.preventDefault\(\);\s*restoreFocusRef\.current\?\.focus\?\.\(\);/,
  );
  assert.match(
    confirmDialogSource,
    /onEscapeKeyDown=\{\(event\) => \{\s*if \(pending \|\| requireExplicitDecision\) event\.preventDefault\(\);/,
  );
  assert.match(
    confirmDialogSource,
    /if \(!nextOpen && !pending && !requireExplicitDecision\) onCancel\?\.\(\);/,
  );
});

test("Algo archives only after confirmation and restores into the canonical inventory", () => {
  const lifecycleMutation = source.slice(
    source.indexOf("const deploymentLifecycleMutation"),
    source.indexOf("const createDeploymentMutation"),
  );

  assert.match(
    lifecycleMutation,
    /`\/api\/algo\/deployments\/\$\{encodeURIComponent\(deploymentId\)\}\/\$\{action\}`/,
  );
  assert.match(lifecycleMutation, /method: "POST"/);
  assert.match(lifecycleMutation, /headers: csrfHeaders/);
  assert.match(lifecycleMutation, /setDeploymentCache\(deployment\)/);
  assert.match(
    source,
    /if \(deployment\.archivedAt\) \{[\s\S]*action: "restore"/,
  );
  assert.match(source, /setPendingArchiveDeployment\(\{/);
  assert.match(source, /action: "archive"/);
  assert.match(source, /dialogTestId="algo-archive-confirm"/);
  assert.match(source, /Archive and pause this deployment\?/);
  assert.match(
    source,
    /Archived deployments cannot scan, change mode, or update accounts until restored\./,
  );
  assert.match(
    source,
    /const controlBaselineReady = Boolean\(\s*focusedDeployment && !focusedDeployment\.archivedAt,\s*\);/,
  );
});

test("Algo does not latch an inferred render fallback into focused deployment state", () => {
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*const resolvedId = focusedDeployment\?\.id \|\| null;\s*setFocusedDeploymentId\([\s\S]*?\);\s*\}, \[focusedDeployment\?\.id\]\);/,
  );
});

test("Algo stream and creation mode belong to the focused deployment, not TRADING_MODE", () => {
  const stream = source.match(
    /const algoCockpitStreamFreshness = useAlgoCockpitStream\([\s\S]*?\n  \);/,
  )?.[0];
  const createHandler = source.slice(
    source.indexOf("const handleCreateDeployment"),
    source.indexOf(
      "const handleToggleDeployment",
      source.indexOf("const handleCreateDeployment"),
    ),
  );

  assert.ok(stream, "Missing Algo cockpit stream");
  assert.match(
    stream,
    /mode:\s*focusedDeployment\?\.mode \|\| DEFAULT_ALGO_DEPLOYMENT_MODE/,
  );
  assert.doesNotMatch(stream, /mode:\s*environment/);
  assert.match(createHandler, /mode:\s*DEFAULT_ALGO_DEPLOYMENT_MODE/);
  assert.doesNotMatch(createHandler, /mode:\s*environment/);
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
  assert.doesNotMatch(
    source,
    /The bridge is authenticated, but no IBKR data account is active yet\./,
  );
});

test("Algo keeps the labeled modal as its sole deployment form", () => {
  const livePageUsage = source.match(/<AlgoLivePage\b[\s\S]*?\/>/)?.[0];

  assert.ok(livePageUsage, "Missing AlgoLivePage usage");
  assert.equal((source.match(/<CreateDeploymentModal\b/g) || []).length, 1);
  assert.match(
    livePageUsage,
    /onAddDeployment=\{\(\) => setCreateModalOpen\(true\)\}/,
  );
  assert.doesNotMatch(
    livePageUsage,
    /selectedDraft=|setSelectedDraftId=|deploymentName=|setDeploymentName=|symbolUniverseInput=|setSymbolUniverseInput=|handleCreateDeployment=|createDeploymentMutation=/,
  );
  for (const label of ["Strategy draft", "Deployment name", "Symbols"]) {
    assert.match(
      createDeploymentModalSource,
      new RegExp(
        `<Field label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      ),
    );
  }
});

test("Algo create UI names the two strategy families Options and Equities", () => {
  assert.match(
    createDeploymentModalSource,
    /\{ kind: ALGO_DEPLOYMENT_KIND\.SIGNAL_OPTIONS, label: "Options" \}/,
  );
  assert.match(
    createDeploymentModalSource,
    /\{ kind: ALGO_DEPLOYMENT_KIND\.OVERNIGHT_SPOT, label: "Equities" \}/,
  );
  assert.match(createDeploymentModalSource, /"Create Equities"/);
  assert.doesNotMatch(
    createDeploymentModalSource,
    /ALGO_DEPLOYMENT_KIND\.OVERNIGHT_SPOT, label: "Overnight"/,
  );
});

test("Algo create requests preserve a zero-account draft instead of fabricating Shadow", () => {
  const createHandler = source.slice(
    source.indexOf("const handleCreateDeployment"),
    source.indexOf(
      "const handleToggleDeployment",
      source.indexOf("const handleCreateDeployment"),
    ),
  );
  const createSuccess = source.slice(
    source.indexOf("const createDeploymentMutation"),
    source.indexOf("const enableDeploymentMutation"),
  );

  assert.doesNotMatch(createHandler, /providerAccountId:\s*"shadow"/);
  assert.doesNotMatch(createHandler, /executionAccountId:\s*"shadow"/);
  assert.doesNotMatch(createSuccess, /deployment\.providerAccountId/);
  assert.match(createSuccess, /"No accounts"/);
  assert.match(createSuccess, /deployment\.isDraft\s*\?\s*"Draft"/);
});

test("Algo removes the dead pre-cockpit grid templates", () => {
  for (const name of [
    "algoMetricsGridTemplate",
    "algoCommandGridTemplate",
    "algoTwoColumnTemplate",
    "algoCandidateGridTemplate",
    "algoDetailGridTemplate",
    "algoPerformanceGridTemplate",
    "algoProfileGridTemplate",
    "algoDiagnosticsGridTemplate",
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\bconst ${name}\\b`));
  }
});

test("Algo account tabs use the live brokerage account list", () => {
  assert.match(source, /accountTabsAccounts = accounts,/);
  assert.match(
    source,
    /const positionAccounts =\s*accountTabsAccounts\.length\s*\?\s*accountTabsAccounts\s*:\s*accounts;/,
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
  assert.match(source, /const signalMatrixStateUniverseSymbols = useMemo\(/);
  assert.match(
    source,
    /const staSignalUniverseSymbols = signalMonitorUniverseSymbols\.length\s*\?\s*signalMonitorUniverseSymbols\s*:\s*signalMatrixStateUniverseSymbols\.length\s*\?\s*signalMatrixStateUniverseSymbols\s*:\s*focusedDeployment\?\.symbolUniverse \|\| \[\];/,
  );
  assert.match(source, /universeSymbols: staSignalUniverseSymbols,/);
});

test("Algo settings save mutations fail fast instead of spinning indefinitely", () => {
  assert.match(source, /const ALGO_SETTINGS_SAVE_TIMEOUT_MS = 25_000;/);
  assert.match(source, /const ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS = 300;/);
  assert.match(
    source,
    /const ALGO_SETTINGS_SAVE_PAUSE_TTL_MS =\s*ALGO_SETTINGS_SAVE_TIMEOUT_MS \+ ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS \+ 5_000;/,
  );
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
  assert.match(
    source,
    /getGetSignalOptionsAutomationStateQueryKey\(deploymentId\)/,
  );
  assert.match(source, /getGetAlgoDeploymentCockpitQueryKey\(deploymentId\)/);
  assert.match(
    source,
    /getGetSignalOptionsPerformanceQueryKey\(deploymentId\)/,
  );
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

test("Algo settings omit the retired Expanded Limits preset surface", () => {
  assert.doesNotMatch(settingsRegionSource, /Expanded Limits/);
  assert.doesNotMatch(settingsRegionSource, /signal-options-expanded-capacity/);
  assert.doesNotMatch(settingsRegionSource, /ExpandedLimitsSection/);
  assert.doesNotMatch(source, /handleApplyExpandedCapacity/);
  assert.doesNotMatch(source, /buildExpandedSignalOptionsProfile/);
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
    /const updateStrategySettingsMutation =\s*useUpdateAlgoDeploymentStrategySettings\([\s\S]*?const createDeploymentMutation =/u,
  )?.[0];
  assert.ok(strategySaveSuccess, "strategy save mutation block should exist");
  assert.match(strategySaveSuccess, /includeSignalOptionsPerformance: false,/);
});

test("Algo deployments query does not substitute previous data through refetches", () => {
  const deploymentsQueryBlock = source.match(
    /const deploymentsQuery = useListAlgoDeployments\([\s\S]*?\n  \);/u,
  )?.[0];
  assert.ok(deploymentsQueryBlock, "deployments query block should exist");
  assert.doesNotMatch(deploymentsQueryBlock, /placeholderData/);
  assert.doesNotMatch(source, /isPlaceholderData/);
});

test("Algo keeps a successful deployment list visible during a failed background refresh", () => {
  assert.match(
    source,
    /const deploymentsResponse = deploymentsQuery\.data \|\| null;/,
  );
  assert.match(
    source,
    /const deploymentListUnavailable = Boolean\(\s*deploymentsQuery\.isError && !deploymentsQuery\.data,?\s*\);/,
  );
  assert.doesNotMatch(
    source,
    /const deploymentsResponse = deploymentsQuery\.isError\s*\? null\s*:\s*deploymentsQuery\.data;/,
  );
});

test("Algo retains deployment and cockpit status through background refetch errors", () => {
  assert.match(
    source,
    /const deploymentsResponse = deploymentsQuery\.data \|\| null;/,
  );
  assert.match(
    source,
    /const draftsResponse = draftsQuery\.isError \? null : draftsQuery\.data;/,
  );
  assert.match(
    source,
    /const eventsResponse = eventsQuery\.isError \? null : eventsQuery\.data;/,
  );
  assert.match(source, /const cockpit = cockpitQuery\.data \|\| null;/);
  assert.match(
    source,
    /signalOptionsPerformanceQuery\.isError\s*\? null\s*:\s*signalOptionsPerformanceQuery\.data \|\| null/,
  );
  assert.match(
    source,
    /signalOptionsStateQuery\.isError\s*\? null\s*:\s*signalOptionsStateQuery\.data \|\| null/,
  );
  assert.match(
    source,
    /signalOptionsLedgerPositionsQuery\.isError\s*\? \{ \.\.\.signalOptionsLedgerPositionsQuery, data: undefined \}/,
  );
});

test("Algo operational status ignores routine background reconciliation fetches", () => {
  assert.match(
    source,
    /refreshPending=\{\s*\(deploymentsQuery\.isFetching && !deploymentsQuery\.data\) \|\|\s*\(cockpitQuery\.isFetching && !cockpitQuery\.data\)\s*\}/,
  );
});

test("Algo Signal Monitor scan readiness is independent of options execution readiness", () => {
  assert.match(source, /const signalScanReady = true;/);
  assert.doesNotMatch(
    source,
    /const signalScanReady = cockpit\s*\?\s*cockpit\.readiness\?\.ready !== false/,
  );
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
  assert.doesNotMatch(source, /import\("\.\/algo\/saveAllAlgoAdjustments"\)/);
});
