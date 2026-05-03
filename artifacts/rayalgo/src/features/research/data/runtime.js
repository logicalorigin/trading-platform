import { useEffect, useState } from "react";
import { retryDynamicImport } from "../../../lib/dynamicImport";

const EMPTY_RESEARCH_META = {
  AI_MACRO: [],
  THEMES: {},
  THEME_ORDER: [],
  VX: {},
  themeMatchesCompany: () => false,
  resolveCompanyVertical: (company) => company?.v ?? null,
};

const EMPTY_THEME_DATA = {
  themeId: null,
  COMPANIES: [],
  EDGES: [],
};

const themeDatasetModules = import.meta.glob("./theme-datasets/*.js");

let cachedResearchMeta = EMPTY_RESEARCH_META;
let cachedResearchMetaPromise = null;

const cachedThemeDatasets = new Map();
const cachedThemeDatasetPromises = new Map();

function mapResearchMetaModule(mod) {
  return {
    AI_MACRO: mod.AI_MACRO || mod.MACRO || [],
    THEMES: mod.THEMES || {},
    THEME_ORDER: mod.THEME_ORDER || [],
    VX: mod.VX || {},
    themeMatchesCompany: mod.themeMatchesCompany || EMPTY_RESEARCH_META.themeMatchesCompany,
    resolveCompanyVertical:
      mod.resolveCompanyVertical || EMPTY_RESEARCH_META.resolveCompanyVertical,
  };
}

function mapThemeDatasetModule(themeId, mod) {
  return {
    themeId,
    COMPANIES: mod.COMPANIES || [],
    EDGES: mod.EDGES || [],
  };
}

function getThemeDatasetImportPath(themeId) {
  return `./theme-datasets/${String(themeId || "ai")}.js`;
}

export function getResearchRuntimeData(themeId = null) {
  const themeData = themeId ? cachedThemeDatasets.get(themeId) || EMPTY_THEME_DATA : EMPTY_THEME_DATA;
  return {
    ...cachedResearchMeta,
    COMPANIES: themeData.COMPANIES,
    EDGES: themeData.EDGES,
  };
}

export async function loadResearchRuntimeMeta() {
  if (!cachedResearchMetaPromise) {
    cachedResearchMetaPromise = retryDynamicImport(
      () => import("./researchThemes.js"),
      { label: "researchThemes", reloadOnFailure: false },
    )
      .then((mod) => {
        cachedResearchMeta = mapResearchMetaModule(mod);
        return cachedResearchMeta;
      })
      .catch(() => EMPTY_RESEARCH_META);
  }
  return cachedResearchMetaPromise;
}

export async function loadResearchThemeDataset(themeId) {
  const normalizedThemeId = String(themeId || "ai");

  if (cachedThemeDatasets.has(normalizedThemeId)) {
    return cachedThemeDatasets.get(normalizedThemeId);
  }

  if (!cachedThemeDatasetPromises.has(normalizedThemeId)) {
    const importPath = getThemeDatasetImportPath(normalizedThemeId);
    const loader = themeDatasetModules[importPath];

    if (!loader) {
      const emptyData = { ...EMPTY_THEME_DATA, themeId: normalizedThemeId };
      cachedThemeDatasets.set(normalizedThemeId, emptyData);
      return emptyData;
    }

    cachedThemeDatasetPromises.set(
      normalizedThemeId,
      retryDynamicImport(loader, {
        label: `researchThemeDataset:${normalizedThemeId}`,
        reloadOnFailure: false,
      })
        .then((mod) => {
          const data = mapThemeDatasetModule(normalizedThemeId, mod);
          cachedThemeDatasets.set(normalizedThemeId, data);
          cachedThemeDatasetPromises.delete(normalizedThemeId);
          return data;
        })
        .catch(() => {
          const emptyData = { ...EMPTY_THEME_DATA, themeId: normalizedThemeId };
          cachedThemeDatasets.set(normalizedThemeId, emptyData);
          cachedThemeDatasetPromises.delete(normalizedThemeId);
          return emptyData;
        }),
    );
  }

  return cachedThemeDatasetPromises.get(normalizedThemeId);
}

export function prefetchResearchThemeDataset(themeId) {
  void loadResearchThemeDataset(themeId);
}

export function useResearchRuntimeData(themeId = "ai") {
  const normalizedThemeId = String(themeId || "ai");
  const [state, setState] = useState(() => {
    const cachedThemeData = cachedThemeDatasets.get(normalizedThemeId) || EMPTY_THEME_DATA;
    const metaReady = cachedResearchMeta !== EMPTY_RESEARCH_META;
    const themeReady = cachedThemeData.themeId === normalizedThemeId;

    return {
      meta: cachedResearchMeta,
      metaReady,
      themeData: cachedThemeData,
      themeReady,
    };
  });

  useEffect(() => {
    let cancelled = false;

    const cachedThemeData = cachedThemeDatasets.get(normalizedThemeId) || EMPTY_THEME_DATA;
    const metaReady = cachedResearchMeta !== EMPTY_RESEARCH_META;
    const themeReady = cachedThemeData.themeId === normalizedThemeId;

    setState({
      meta: cachedResearchMeta,
      metaReady,
      themeData: cachedThemeData,
      themeReady,
    });

    loadResearchRuntimeMeta().then((meta) => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        meta,
        metaReady: true,
      }));
    });

    loadResearchThemeDataset(normalizedThemeId).then((themeData) => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        themeData,
        themeReady: themeData.themeId === normalizedThemeId,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedThemeId]);

  return {
    data: {
      ...state.meta,
      COMPANIES: state.themeData.COMPANIES,
      EDGES: state.themeData.EDGES,
    },
    ready: state.metaReady && state.themeReady,
    metaReady: state.metaReady,
    themeReady: state.themeReady,
    loading: !(state.metaReady && state.themeReady),
  };
}
