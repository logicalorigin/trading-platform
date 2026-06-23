import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AlgoScreen.jsx", import.meta.url), "utf8");

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
    /const staSignalUniverseSymbols = signalMonitorUniverseSymbols\.length\s*\?\s*signalMonitorUniverseSymbols\s*:\s*focusedDeployment\?\.symbolUniverse \|\| \[\];/,
  );
  assert.match(source, /universeSymbols: staSignalUniverseSymbols,/);
});

test("Algo settings save mutations fail fast instead of spinning indefinitely", () => {
  assert.match(source, /const ALGO_SETTINGS_SAVE_TIMEOUT_MS = 8_000;/);
  assert.match(source, /const ALGO_SETTINGS_SAVE_STREAM_DRAIN_MS = 300;/);
  assert.match(source, /const ALGO_SETTINGS_SAVE_API_BASE_URL = normalizeAlgoSettingsSaveApiBaseUrl\(/);
  assert.match(source, /import\.meta\.env\?\.VITE_PROXY_API_TARGET/);
  assert.match(
    source,
    /const ALGO_SETTINGS_SAVE_REQUEST_OPTIONS = Object\.freeze\(\{\s*timeoutMs: ALGO_SETTINGS_SAVE_TIMEOUT_MS,[\s\S]*?baseUrl: ALGO_SETTINGS_SAVE_API_BASE_URL/s,
  );
  assert.match(
    source,
    /useUpdateSignalOptionsExecutionProfile\(\{\s*request: ALGO_SETTINGS_SAVE_REQUEST_OPTIONS,/s,
  );
  assert.match(
    source,
    /useUpdateAlgoDeploymentStrategySettings\(\{\s*request: ALGO_SETTINGS_SAVE_REQUEST_OPTIONS,/s,
  );
  assert.match(source, /title: "Save failed"/);
});

test("Algo settings save frees live stream connection slots before mutating", () => {
  assert.match(source, /useCriticalApiMutationPause\(\)/);
  assert.match(source, /isVisible && !criticalApiMutationPaused/);
  assert.match(source, /const releaseConnectionPause = beginCriticalApiMutationPause\(\);/);
  assert.match(source, /getListSignalMonitorEventsQueryKey/);
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
});

test("Algo settings save helper is not lazy-loaded at click time", () => {
  assert.match(
    source,
    /import \{ saveAllAlgoAdjustments \} from "\.\/algo\/saveAllAlgoAdjustments";/,
  );
  assert.doesNotMatch(
    source,
    /import\("\.\/algo\/saveAllAlgoAdjustments"\)/,
  );
});
