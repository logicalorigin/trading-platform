import type { PyrusSignalsRuntimeSettings } from "./pyrusSignalsPineAdapter";

type AlgoPyrusSignalsSettingsSource = {
  deployment?: unknown;
  signalMonitorProfile?: unknown;
  settings?: unknown;
};

export function resolveAlgoPyrusSignalsSettingsPatch(
  source?: AlgoPyrusSignalsSettingsSource,
): Partial<PyrusSignalsRuntimeSettings>;

export function resolvePyrusSignalsSettingsWithAlgoDefaults(source?: {
  currentSettings?: Partial<PyrusSignalsRuntimeSettings> | Record<string, unknown> | null;
  deployment?: unknown;
  signalMonitorProfile?: unknown;
  previousAlgoSettings?: Partial<PyrusSignalsRuntimeSettings> | Record<string, unknown> | null;
}): PyrusSignalsRuntimeSettings;
