import { useMemo } from "react";
import {
  useListPineScripts,
  type PineScriptRecord,
} from "@workspace/api-client-react";
import {
  defaultIndicatorCatalog,
  defaultIndicatorRegistry,
} from "./indicators";
import {
  createRayReplicaPineRuntimeAdapter,
  RAY_REPLICA_PINE_SCRIPT_KEY,
} from "./rayReplicaPineAdapter";
import type {
  IndicatorCatalogEntry,
  IndicatorPlugin,
  IndicatorRegistry,
} from "./types";

export type PineRuntimeAdapterFactory = (
  script: PineScriptRecord,
) => IndicatorPlugin;

const pineRuntimeAdapterRegistry: Record<string, PineRuntimeAdapterFactory> = {
  [RAY_REPLICA_PINE_SCRIPT_KEY]: createRayReplicaPineRuntimeAdapter,
};

export function registerPineRuntimeAdapter(
  scriptKey: string,
  factory: PineRuntimeAdapterFactory,
): void {
  pineRuntimeAdapterRegistry[scriptKey] = factory;
}

export function hasPineRuntimeAdapter(scriptKey: string): boolean {
  return typeof pineRuntimeAdapterRegistry[scriptKey] === "function";
}

export function resolvePineScriptChartState(script: PineScriptRecord): {
  runtimeAvailable: boolean;
  chartReady: boolean;
  reason: string;
} {
  const runtimeAvailable = hasPineRuntimeAdapter(script.scriptKey);

  if (script.status !== "ready") {
    return {
      runtimeAvailable,
      chartReady: false,
      reason: "Marked as draft or not ready for chart runtime.",
    };
  }

  if (!script.chartAccessEnabled) {
    return {
      runtimeAvailable,
      chartReady: false,
      reason: "Chart access is disabled for this script.",
    };
  }

  if (!runtimeAvailable) {
    return {
      runtimeAvailable,
      chartReady: false,
      reason: "No JS runtime adapter is registered for this Pine script yet.",
    };
  }

  return {
    runtimeAvailable,
    chartReady: true,
    reason: "Ready for chart menus and indicator rendering.",
  };
}

export function buildIndicatorLibrary(pineScripts: PineScriptRecord[] = []): {
  studies: IndicatorCatalogEntry[];
  indicatorRegistry: IndicatorRegistry;
  chartReadyPineScripts: PineScriptRecord[];
} {
  const chartReadyPineScripts = pineScripts.filter(
    (script) => resolvePineScriptChartState(script).chartReady,
  );

  const pineStudies = chartReadyPineScripts.map<IndicatorCatalogEntry>(
    (script) => ({
      id: script.scriptKey,
      label: script.name,
      kind: "pine",
      paneType: script.defaultPaneType,
      description:
        script.description ??
        "User-supplied Pine script exposed through the chart indicator library.",
    }),
  );

  const indicatorRegistry: IndicatorRegistry = {
    ...defaultIndicatorRegistry,
  };
  chartReadyPineScripts.forEach((script) => {
    const adapter = pineRuntimeAdapterRegistry[script.scriptKey];
    if (adapter) {
      indicatorRegistry[script.scriptKey] = adapter(script);
    }
  });

  return {
    studies: [...defaultIndicatorCatalog, ...pineStudies],
    indicatorRegistry,
    chartReadyPineScripts,
  };
}

export function useIndicatorLibrary() {
  const pineScriptsQuery = useListPineScripts({
    query: {
      queryKey: ["/api/charting/pine-scripts"],
      staleTime: 5_000,
      refetchInterval: 15_000,
    },
  });
  const pineScripts = pineScriptsQuery.data?.scripts ?? [];
  const library = useMemo(
    () => buildIndicatorLibrary(pineScripts),
    [pineScripts],
  );

  return {
    ...library,
    pineScripts,
    pineScriptsQuery,
  };
}
