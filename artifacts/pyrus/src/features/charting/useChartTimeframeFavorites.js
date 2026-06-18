import { useCallback, useEffect, useState } from "react";
import {
  resolveChartTimeframeFavorites,
  toggleChartTimeframeFavorite,
} from "./timeframes";
import {
  _initialState,
  persistState,
  readPersistedState,
} from "../../lib/workspaceState";
import {
  PYRUS_WORKSPACE_SETTINGS_EVENT,
} from "../../lib/workspaceStorage";

export const persistChartTimeframeFavorites = (role, favorites) => {
  const current = readPersistedState();
  persistState({
    chartTimeframeFavorites: {
      ...(current.chartTimeframeFavorites || {}),
      [role]: favorites,
    },
  });
  try {
    const detail = readPersistedState();
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail }));
  } catch (_error) {}
};

export const useChartTimeframeFavorites = (role) => {
  const [favoriteTimeframes, setFavoriteTimeframes] = useState(() =>
    resolveChartTimeframeFavorites(
      _initialState.chartTimeframeFavorites?.[role],
      role,
    ),
  );

  useEffect(() => {
    const refresh = () => {
      setFavoriteTimeframes(
        resolveChartTimeframeFavorites(
          readPersistedState().chartTimeframeFavorites?.[role],
          role,
        ),
      );
    };
    refresh();
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [role]);

  const toggleFavoriteTimeframe = useCallback(
    (timeframe) => {
      setFavoriteTimeframes((current) => {
        const next = toggleChartTimeframeFavorite(current, timeframe, role);
        persistChartTimeframeFavorites(role, next);
        return next;
      });
    },
    [role],
  );

  return { favoriteTimeframes, toggleFavoriteTimeframe };
};
