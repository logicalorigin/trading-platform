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

const RAY_REPLICA_FALLBACK_RECORD: PineScriptRecord = {
  id: RAY_REPLICA_PINE_SCRIPT_KEY,
  scriptKey: RAY_REPLICA_PINE_SCRIPT_KEY,
  name: "RayReplica",
  description:
    "RayAlgo SMC Pro V3 replica indicator (built-in JS runtime adapter).",
  sourceCode: "",
  status: "ready",
  defaultPaneType: "price",
  chartAccessEnabled: true,
  notes: null,
  lastError: null,
  tags: ["builtin", "smc"],
  metadata: {},
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function buildIndicatorLibrary(pineScripts: PineScriptRecord[] = []): {
  studies: IndicatorCatalogEntry[];
  indicatorRegistry: IndicatorRegistry;
  chartReadyPineScripts: PineScriptRecord[];
} {
  const hasRayReplicaFromApi = pineScripts.some(
    (script) => script.scriptKey === RAY_REPLICA_PINE_SCRIPT_KEY,
  );
  const effectivePineScripts = hasRayReplicaFromApi
    ? pineScripts
    : [...pineScripts, RAY_REPLICA_FALLBACK_RECORD];

  const chartReadyPineScripts = effectivePineScripts.filter(
    (script) => resolvePineScriptChartState(script).chartReady,
  );

  const pineStudies = chartReadyPineScripts.map<IndicatorCatalogEntry>(
    (script) => ({
      id: script.scriptKey,
      label:
        script.scriptKey === RAY_REPLICA_PINE_SCRIPT_KEY
          ? "RayReplica"
          : script.name,
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
      staleTime: 5 * 60_000,
      refetchInterval: false,
      refetchOnMount: false,
      gcTime: 10 * 60_000,
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
