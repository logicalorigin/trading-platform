import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const cloneJson = (value) => JSON.parse(JSON.stringify(value ?? null));

const defaultIsEqual = (left, right) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const pathParts = (path) =>
  Array.isArray(path)
    ? path
    : String(path || "")
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean);

const setPathValue = (source, path, value) => {
  const parts = pathParts(path);
  if (!parts.length) return value;

  const root = Array.isArray(source) ? source.slice() : { ...(source || {}) };
  let cursor = root;
  parts.slice(0, -1).forEach((part) => {
    const current = cursor[part];
    const next =
      current && typeof current === "object"
        ? Array.isArray(current)
          ? current.slice()
          : { ...current }
        : {};
    cursor[part] = next;
    cursor = next;
  });
  cursor[parts[parts.length - 1]] = value;
  return root;
};

const syncTokenFor = (syncKeys) => JSON.stringify(syncKeys || []);

export const createServerSyncedDraftState = ({
  draft,
  baseline,
  serverValue,
  syncChanged,
  clone = cloneJson,
  isEqual = defaultIsEqual,
}) => {
  const dirty = !isEqual(draft, baseline);
  if (syncChanged || !dirty) {
    const next = clone(serverValue);
    return { draft: next, baseline: clone(serverValue) };
  }
  return { draft, baseline };
};

export const useServerSyncedDraft = (
  serverValue,
  {
    syncKeys = [],
    clone = cloneJson,
    isEqual = defaultIsEqual,
    onDirtySyncKeyChange,
  } = {},
) => {
  const [draft, setDraft] = useState(() => clone(serverValue));
  const [baseline, setBaseline] = useState(() => clone(serverValue));
  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  const syncToken = useMemo(() => syncTokenFor(syncKeys), [syncKeys]);
  const previousSyncTokenRef = useRef(syncToken);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  useEffect(() => {
    const syncChanged = previousSyncTokenRef.current !== syncToken;
    const dirty = !isEqual(draftRef.current, baselineRef.current);
    if (syncChanged && dirty) {
      onDirtySyncKeyChange?.();
    }
    previousSyncTokenRef.current = syncToken;
    if (!syncChanged && dirty) {
      return;
    }

    const next = clone(serverValue);
    setDraft(next);
    setBaseline(clone(serverValue));
  }, [clone, isEqual, onDirtySyncKeyChange, serverValue, syncToken]);

  const patch = useCallback(
    (path, value) => {
      setDraft((current) => setPathValue(clone(current), path, value));
    },
    [clone],
  );

  const replace = useCallback(
    (nextDraft) => {
      setDraft((current) =>
        clone(typeof nextDraft === "function" ? nextDraft(current) : nextDraft),
      );
    },
    [clone],
  );

  const reset = useCallback(() => {
    const next = clone(baselineRef.current);
    setDraft(next);
  }, [clone]);

  const markClean = useCallback(
    (nextServerValue) => {
      const next =
        nextServerValue === undefined
          ? clone(draftRef.current)
          : clone(nextServerValue);
      setDraft(next);
      setBaseline(clone(next));
    },
    [clone],
  );

  const isDirty = !isEqual(draft, baseline);

  return {
    draft,
    baseline,
    patch,
    replace,
    reset,
    markClean,
    isDirty,
  };
};

export const __internalsForTests = {
  defaultIsEqual,
  setPathValue,
  createServerSyncedDraftState,
};
