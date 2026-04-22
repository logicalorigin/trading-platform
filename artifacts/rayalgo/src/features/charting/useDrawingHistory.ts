import { useCallback, useState, type SetStateAction } from "react";

type HistoryState<T> = {
  entries: T[][];
  index: number;
};

const resolveNextDrawings = <T,>(
  current: T[],
  next: SetStateAction<T[]>,
): T[] => (typeof next === "function" ? next(current) : next);

export const useDrawingHistory = <T,>(initialDrawings: T[] = []) => {
  const [state, setState] = useState<HistoryState<T>>({
    entries: [initialDrawings],
    index: 0,
  });

  const drawings = state.entries[state.index] ?? initialDrawings;

  const setDrawings = useCallback((next: SetStateAction<T[]>) => {
    setState((currentState) => {
      const currentDrawings = currentState.entries[currentState.index] ?? [];
      const nextDrawings = resolveNextDrawings(currentDrawings, next);
      const trimmedEntries = currentState.entries.slice(0, currentState.index + 1);

      return {
        entries: [...trimmedEntries, nextDrawings],
        index: trimmedEntries.length,
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
