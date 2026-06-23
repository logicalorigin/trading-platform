import { useSyncExternalStore } from "react";

// Shared focused-deployment id published by the Algo screen so other surfaces
// (the global algo monitor sidebar) can follow the screen's active deployment
// tab. Mirrors algoStaExecutionTimeframeStore. The sidebar follows this by
// default but can pin its own selection (see PlatformAlgoMonitorSidebar); the
// store is one-way: the Algo screen publishes, the sidebar reads.
const ALGO_DEPLOYMENT_FOCUS_STORE_KEY = Symbol.for(
  "pyrus.algoDeploymentFocusStore",
);

const createStore = () => {
  let deploymentId = "";
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => deploymentId,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDeploymentId: (next) => {
      const normalized = String(next || "").trim();
      if (normalized === deploymentId) return;
      deploymentId = normalized;
      emit();
    },
    reset: () => {
      if (!deploymentId) return;
      deploymentId = "";
      emit();
    },
  };
};

const store =
  globalThis[ALGO_DEPLOYMENT_FOCUS_STORE_KEY] ??
  (globalThis[ALGO_DEPLOYMENT_FOCUS_STORE_KEY] = createStore());

export const publishAlgoDeploymentFocus = (id) => store.setDeploymentId(id);

export const clearAlgoDeploymentFocus = () => store.reset();

export const useAlgoDeploymentFocus = () =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const getAlgoDeploymentFocusForTests = () => store.getSnapshot();

export const resetAlgoDeploymentFocusForTests = () => store.reset();
