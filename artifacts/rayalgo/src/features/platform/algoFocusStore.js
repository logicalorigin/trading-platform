import { useSyncExternalStore } from "react";

const ALGO_FOCUS_STORE_KEY = Symbol.for("rayalgo.algoFocusStore");

const DEFAULT_STATE = Object.freeze({
  focusedSymbol: null,
  drillTab: "overview",
});

const DRILL_TABS = Object.freeze(["overview", "action", "position", "history"]);

const createStore = () => {
  let state = { ...DEFAULT_STATE };
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFocus: (symbol, drillTab) => {
      const nextSymbol = symbol ? String(symbol).toUpperCase() : null;
      const nextDrillTab = DRILL_TABS.includes(drillTab)
        ? drillTab
        : state.drillTab;
      if (
        nextSymbol === state.focusedSymbol &&
        nextDrillTab === state.drillTab
      ) {
        return;
      }
      state = { focusedSymbol: nextSymbol, drillTab: nextDrillTab };
      emit();
    },
    clearFocus: () => {
      if (state.focusedSymbol === null && state.drillTab === DEFAULT_STATE.drillTab) {
        return;
      }
      state = { ...DEFAULT_STATE };
      emit();
    },
    setDrillTab: (drillTab) => {
      if (!DRILL_TABS.includes(drillTab) || drillTab === state.drillTab) return;
      state = { ...state, drillTab };
      emit();
    },
    __resetForTests: () => {
      state = { ...DEFAULT_STATE };
      emit();
    },
  };
};

const store =
  globalThis[ALGO_FOCUS_STORE_KEY] ?? (globalThis[ALGO_FOCUS_STORE_KEY] = createStore());

export const algoFocusStore = store;
export const ALGO_DRILL_TABS = DRILL_TABS;

export const useAlgoFocus = () =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const setAlgoFocus = (symbol, drillTab) => store.setFocus(symbol, drillTab);
export const clearAlgoFocus = () => store.clearFocus();
export const setAlgoDrillTab = (drillTab) => store.setDrillTab(drillTab);
