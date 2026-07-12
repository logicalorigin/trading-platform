import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export const createVisibleScreenStore = (initialScreen) => {
  let screen = initialScreen;
  const listeners = new Set();

  const getSnapshot = () => screen;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const setScreen = (nextScreen) => {
    if (!nextScreen || nextScreen === screen) {
      return;
    }
    screen = nextScreen;
    listeners.forEach((listener) => listener());
  };

  return { getSnapshot, setScreen, subscribe };
};

export const useVisibleScreen = (store) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const useVisibleScreenNavigation = ({
  activeScreen,
  markScreenSwitch,
  preloadScreen,
  setScreen,
}) => {
  const [visibleScreenStore] = useState(() =>
    createVisibleScreenStore(activeScreen),
  );
  const canonicalHandoffGenerationRef = useRef(0);
  const scheduleCanonicalHandoff = useCallback(
    (screenId) => {
      const generation = canonicalHandoffGenerationRef.current + 1;
      canonicalHandoffGenerationRef.current = generation;
      const commit = () => {
        if (canonicalHandoffGenerationRef.current !== generation) {
          return;
        }
        setScreen(screenId);
      };
      if (typeof window === "undefined") {
        commit();
        return;
      }
      if (
        typeof document === "undefined" ||
        document.visibilityState === "hidden" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        window.setTimeout(commit, 0);
        return;
      }
      // ponytail: ceiling = one render opportunity before canonical work starts;
      // upgrade by moving screen-owned teardown below PlatformApp, then commit
      // canonical state in the urgent navigation task.
      window.requestAnimationFrame(() => window.setTimeout(commit, 0));
    },
    [setScreen],
  );
  const handleSetScreen = useCallback(
    (screenId) => {
      if (!screenId || screenId === visibleScreenStore.getSnapshot()) {
        return;
      }
      void preloadScreen(screenId);
      markScreenSwitch(screenId, "navigation");
      visibleScreenStore.setScreen(screenId);
      scheduleCanonicalHandoff(screenId);
    },
    [
      markScreenSwitch,
      preloadScreen,
      scheduleCanonicalHandoff,
      visibleScreenStore,
    ],
  );

  useLayoutEffect(() => {
    if (visibleScreenStore.getSnapshot() === activeScreen) {
      return;
    }
    canonicalHandoffGenerationRef.current += 1;
    visibleScreenStore.setScreen(activeScreen);
    markScreenSwitch(activeScreen, "programmatic");
  }, [activeScreen, markScreenSwitch, visibleScreenStore]);

  useEffect(
    () => () => {
      canonicalHandoffGenerationRef.current += 1;
    },
    [],
  );

  return { handleSetScreen, visibleScreenStore };
};
