import React, { useCallback, useEffect, useRef, useState } from "react";

function formatDraftValue(value) {
  if (value == null || value === "") {
    return "";
  }
  return String(value);
}

function resolveParsedValue(rawValue, parseValue) {
  const parsed = parseValue(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function DraftNumberInput({
  value,
  onCommit,
  parseValue = Number,
  normalizeOnBlur = null,
  onBlur,
  onFocus,
  ...rest
}) {
  const [draft, setDraft] = useState(() => formatDraftValue(value));
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) {
      setDraft(formatDraftValue(value));
    }
  }, [value]);

  const handleFocus = useCallback((event) => {
    isEditingRef.current = true;
    onFocus?.(event);
  }, [onFocus]);

  const handleChange = useCallback((event) => {
    const nextValue = event.target.value;
    setDraft(nextValue);
    if (nextValue === "") {
      return;
    }
    const parsed = resolveParsedValue(nextValue, parseValue);
    if (parsed == null) {
      return;
    }
    onCommit(parsed);
  }, [onCommit, parseValue]);

  const handleBlur = useCallback((event) => {
    isEditingRef.current = false;
    if (draft === "") {
      onBlur?.(event);
      return;
    }

    const parsed = resolveParsedValue(draft, parseValue);
    if (parsed == null) {
      setDraft(formatDraftValue(value));
      onBlur?.(event);
      return;
    }

    const normalizedCandidate = typeof normalizeOnBlur === "function"
      ? normalizeOnBlur(parsed)
      : parsed;
    const normalized = Number.isFinite(normalizedCandidate) ? normalizedCandidate : parsed;

    if (!Object.is(normalized, value)) {
      onCommit(normalized);
    }
    setDraft(formatDraftValue(normalized));
    onBlur?.(event);
  }, [draft, normalizeOnBlur, onBlur, onCommit, parseValue, value]);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
