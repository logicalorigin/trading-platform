import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

export const DEFAULT_DEBOUNCED_TEXT_COMMIT_DELAY_MS = 180;

const toText = (value: unknown): string =>
  value == null ? "" : String(value);

type DebouncedTextCommitOptions = {
  value?: unknown;
  onCommit?: (value: string) => void;
  delayMs?: number;
  autoCommit?: boolean;
  transformInput?: (value: string) => string;
};

export const useDebouncedTextCommit = ({
  value,
  onCommit,
  delayMs = DEFAULT_DEBOUNCED_TEXT_COMMIT_DELAY_MS,
  autoCommit = true,
  transformInput,
}: DebouncedTextCommitOptions) => {
  const externalText = toText(value);
  const [draft, setDraftState] = useState(externalText);
  const draftRef = useRef(externalText);
  const externalTextRef = useRef(externalText);
  const committedTextRef = useRef(externalText);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  const delayMsRef = useRef(delayMs);
  const autoCommitRef = useRef(autoCommit);
  const transformInputRef = useRef(transformInput);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    delayMsRef.current = delayMs;
    autoCommitRef.current = autoCommit;
    transformInputRef.current = transformInput;
  }, [autoCommit, delayMs, transformInput]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (nextValue?: unknown) => {
      const nextText = toText(nextValue ?? draftRef.current);
      clearTimer();
      if (nextText === committedTextRef.current) {
        return nextText;
      }
      committedTextRef.current = nextText;
      onCommitRef.current?.(nextText);
      return nextText;
    },
    [clearTimer],
  );

  const scheduleCommit = useCallback(
    (nextText: string) => {
      if (!autoCommitRef.current) return;
      clearTimer();
      const nextDelayMs = Math.max(0, Number(delayMsRef.current) || 0);
      if (nextDelayMs === 0) {
        commit(nextText);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commit(nextText);
      }, nextDelayMs);
    },
    [clearTimer, commit],
  );

  const setDraft = useCallback(
    (nextValue: unknown) => {
      const rawText = toText(nextValue);
      const nextText = transformInputRef.current
        ? transformInputRef.current(rawText)
        : rawText;
      draftRef.current = nextText;
      setDraftState(nextText);
      scheduleCommit(nextText);
    },
    [scheduleCommit],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
    },
    [setDraft],
  );

  const handleBlur = useCallback(() => {
    commit();
  }, [commit]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Enter") {
        commit();
      }
    },
    [commit],
  );

  useEffect(() => {
    if (externalText === externalTextRef.current) return;
    externalTextRef.current = externalText;
    committedTextRef.current = externalText;
    draftRef.current = externalText;
    setDraftState(externalText);
    clearTimer();
  }, [clearTimer, externalText]);

  useEffect(() => clearTimer, [clearTimer]);

  const inputProps = useMemo(
    () => ({
      value: draft,
      onChange: handleChange,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
    }),
    [draft, handleBlur, handleChange, handleKeyDown],
  );

  return {
    draft,
    setDraft,
    commit,
    flush: commit,
    cancel: clearTimer,
    inputProps,
  };
};
