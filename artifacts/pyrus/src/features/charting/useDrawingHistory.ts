import { useCallback, useRef, useState, type SetStateAction } from "react";

type HistoryState<T> = {
  entries: T[][];
  index: number;
};

// Cap on retained undo snapshots. Without this the history array grows once per
// drawing action for the lifetime of the hook (which is not reset on symbol
// changes), so a long session accumulates an unbounded list of array snapshots.
const MAX_HISTORY_ENTRIES = 100;
// ponytail: reuse the snapshot ceiling for inactive scopes; replace this
// in-memory LRU with persisted drawing storage if more scopes must survive.
const MAX_HISTORY_SCOPES = MAX_HISTORY_ENTRIES;

const DEFAULT_DRAWING_SCOPE = "__default__";

const resolveNextDrawings = <T,>(
  current: T[],
  next: SetStateAction<T[]>,
): T[] => (typeof next === "function" ? next(current) : next);

export const useDrawingHistory = <T,>(
  initialDrawings: T[] = [],
  scopeKey: string = DEFAULT_DRAWING_SCOPE,
) => {
  const [state, setState] = useState<HistoryState<T>>({
    entries: [initialDrawings],
    index: 0,
  });

  // Per-scope (symbol/contract) history store so drawings persist when the user
  // switches symbols and are restored on return, while only the active scope's
  // drawings are ever shown. The swap is performed during render (React's
  // "adjust state when a prop changes" pattern) so the previous symbol's
  // drawings never paint against the newly selected symbol.
  const historyStoreRef = useRef<Map<string, HistoryState<T>>>(new Map());
  const activeScopeRef = useRef(scopeKey);
  if (activeScopeRef.current !== scopeKey) {
    const historyStore = historyStoreRef.current;
    const incoming = historyStore.get(scopeKey) ?? {
      entries: [initialDrawings],
      index: 0,
    };
    historyStore.delete(scopeKey);
    historyStore.set(activeScopeRef.current, state);
    while (historyStore.size > MAX_HISTORY_SCOPES) {
      const oldestScope = historyStore.keys().next().value;
      if (oldestScope === undefined) {
        break;
      }
      historyStore.delete(oldestScope);
    }
    activeScopeRef.current = scopeKey;
    setState(incoming);
  }

  const drawings = state.entries[state.index] ?? initialDrawings;

  const setDrawings = useCallback((next: SetStateAction<T[]>) => {
    setState((currentState) => {
      const currentDrawings = currentState.entries[currentState.index] ?? [];
      const nextDrawings = resolveNextDrawings(currentDrawings, next);
      if (
        nextDrawings.length === currentDrawings.length &&
        nextDrawings.every((drawing, index) =>
          Object.is(drawing, currentDrawings[index]),
        )
      ) {
        return currentState;
      }
      const trimmedEntries = currentState.entries.slice(0, currentState.index + 1);
      const appendedEntries = [...trimmedEntries, nextDrawings];
      const overflow = Math.max(0, appendedEntries.length - MAX_HISTORY_ENTRIES);
      const cappedEntries = overflow
        ? appendedEntries.slice(overflow)
        : appendedEntries;

      return {
        entries: cappedEntries,
        index: cappedEntries.length - 1,
      };
    });
  }, []);

  const addDrawing = useCallback((drawing: T) => {
    setDrawings((current) => [...current, drawing]);
  }, [setDrawings]);

  const clearDrawings = useCallback(() => {
    setDrawings([]);
  }, [setDrawings]);

  const undo = useCallback(() => {
    setState((currentState) => (
      currentState.index > 0
        ? { ...currentState, index: currentState.index - 1 }
        : currentState
    ));
  }, []);

  const redo = useCallback(() => {
    setState((currentState) => (
      currentState.index < currentState.entries.length - 1
        ? { ...currentState, index: currentState.index + 1 }
        : currentState
    ));
  }, []);

  const resetDrawings = useCallback((nextDrawings: T[] = []) => {
    setState({
      entries: [nextDrawings],
      index: 0,
    });
  }, []);

  return {
    drawings,
    setDrawings,
    addDrawing,
    clearDrawings,
    undo,
    redo,
    canUndo: state.index > 0,
    canRedo: state.index < state.entries.length - 1,
    resetDrawings,
  };
};
