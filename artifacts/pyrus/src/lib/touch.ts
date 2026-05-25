import { useCallback, useEffect, useMemo, useRef } from "react";

type PointerLike = {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
};

type TimerApi = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

type LongPressOptions = {
  ms?: number;
  moveTolerance?: number;
};

type LongPressControllerOptions = LongPressOptions & {
  timers?: TimerApi;
};

type TapToSelectOptions<TItem> = {
  onSelect?: (item: TItem, event: PointerEvent) => void;
  onClear?: (event: PointerEvent) => void;
  getItemAtPoint?: (event: PointerEvent) => TItem | null | undefined;
};

const defaultTimers: TimerApi = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

export const pointerDistance = (
  start: PointerLike | null,
  current: PointerLike,
) => {
  if (!start) return 0;
  const dx = Number(current.clientX ?? 0) - Number(start.clientX ?? 0);
  const dy = Number(current.clientY ?? 0) - Number(start.clientY ?? 0);
  return Math.hypot(dx, dy);
};

export const createLongPressController = (
  handler: (event: PointerLike) => void,
  options: LongPressControllerOptions = {},
) => {
  const ms = options.ms ?? 450;
  const moveTolerance = options.moveTolerance ?? 8;
  const timers = options.timers ?? defaultTimers;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startPoint: PointerLike | null = null;
  let startEvent: PointerLike | null = null;

  const clear = () => {
    if (timer) {
      timers.clearTimeout(timer);
      timer = null;
    }
    startPoint = null;
    startEvent = null;
  };

  return {
    start(event: PointerLike) {
      clear();
      startPoint = {
        clientX: event.clientX ?? 0,
        clientY: event.clientY ?? 0,
        pointerId: event.pointerId,
      };
      startEvent = event;
      timer = timers.setTimeout(() => {
        timer = null;
        if (startEvent) {
          handler(startEvent);
        }
        startPoint = null;
        startEvent = null;
      }, ms);
    },
    move(event: PointerLike) {
      if (!timer) return;
      if (pointerDistance(startPoint, event) > moveTolerance) {
        clear();
      }
    },
    cancel: clear,
    isPending() {
      return Boolean(timer);
    },
  };
};

export const useLongPress = (
  handler: (event: React.PointerEvent<HTMLElement>) => void,
  options: LongPressOptions = {},
) => {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const controllerRef = useRef(
    createLongPressController(
      (event) => handlerRef.current(event as React.PointerEvent<HTMLElement>),
      options,
    ),
  );

  useEffect(() => {
    controllerRef.current = createLongPressController(
      (event) => handlerRef.current(event as React.PointerEvent<HTMLElement>),
      options,
    );
    return () => controllerRef.current.cancel();
  }, [options.ms, options.moveTolerance]);

  return useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        controllerRef.current.start(event);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        controllerRef.current.move(event);
      },
      onPointerUp: () => {
        controllerRef.current.cancel();
      },
      onPointerCancel: () => {
        controllerRef.current.cancel();
      },
      onPointerLeave: () => {
        controllerRef.current.cancel();
      },
    }),
    [],
  );
};

export const useTapToSelect = <TItem>({
  onSelect,
  onClear,
  getItemAtPoint,
}: TapToSelectOptions<TItem>) => {
  const selectRef = useRef(onSelect);
  const clearRef = useRef(onClear);
  const getItemRef = useRef(getItemAtPoint);

  useEffect(() => {
    selectRef.current = onSelect;
    clearRef.current = onClear;
    getItemRef.current = getItemAtPoint;
  }, [getItemAtPoint, onClear, onSelect]);

  return useCallback((event: PointerEvent) => {
    const item = getItemRef.current?.(event);
    if (item == null) {
      clearRef.current?.(event);
      return;
    }
    selectRef.current?.(item, event);
  }, []);
};
