import { useEffect } from "react";

const DEFAULT_ARTIFACT_ID = "artifacts/pyrus";
const CHANNEL_PREFIX = "pyrus-platform-freshness:";
const STORAGE_PREFIX = "pyrus:platform-freshness:";
const MESSAGE_TYPE = "pyrus-platform-freshness-snapshot:v1";
const REQUEST_TYPE = "pyrus-platform-freshness-request:v1";
const sharedPayloadOrigins = new WeakMap<object, string>();

export type PlatformFreshnessPayloadSize = "small" | "medium" | "heavy";
export type PlatformFreshnessSourceState =
  | "live"
  | "shared"
  | "cached"
  | "refreshing"
  | "waiting"
  | "stale";

export type PlatformFreshnessSnapshot<TPayload = unknown> = {
  family: string;
  key: string;
  payload?: TPayload;
  fetchedAt: number;
  expiresAt: number;
  sourceTabId: string;
  sourceVisible: boolean;
  payloadSizeClass: PlatformFreshnessPayloadSize;
  metadataOnly: boolean;
};

export type PlatformFreshnessMetadata = Omit<
  PlatformFreshnessSnapshot,
  "payload"
>;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

type ChannelLike = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close?(): void;
};

type ChannelFactory = (name: string) => ChannelLike;

type FreshnessListener = (
  snapshot: PlatformFreshnessSnapshot,
) => void;

type FreshnessRequest = {
  family: string;
  key: string;
  requesterTabId: string;
};

type FreshnessRequestListener = (request: FreshnessRequest) => void;

type FreshnessSubscription = {
  family?: string | null;
  key?: string | null;
  listener: FreshnessListener;
};

type FreshnessRequestSubscription = {
  family?: string | null;
  key?: string | null;
  listener: FreshnessRequestListener;
};

type PublishSnapshotInput<TPayload = unknown> = {
  family: string;
  key: unknown;
  payload: TPayload;
  ttlMs: number;
  fetchedAt?: number;
  expiresAt?: number;
  sourceVisible?: boolean;
  payloadSizeClass?: PlatformFreshnessPayloadSize;
  metadataOnly?: boolean;
};

type HydrateQueryCacheInput = {
  queryClient: {
    setQueryData(queryKey: unknown, value: unknown): unknown;
  };
  queryKey: unknown;
  snapshot: PlatformFreshnessSnapshot | PlatformFreshnessMetadata | null | undefined;
  tabId?: string | null;
  now?: number;
};

const cleanText = (value: unknown, fallback = "") =>
  String(value ?? "").trim() || fallback;

const createTabId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const readDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

const normalizePayloadSizeClass = (
  value: unknown,
): PlatformFreshnessPayloadSize =>
  value === "medium" || value === "heavy" ? value : "small";

const stableSerialize = (value: unknown, seen = new WeakSet<object>()): string => {
  if (value == null) return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(
          (value as Record<string, unknown>)[key],
          seen,
        )}`,
    )
    .join(",")}}`;
};

export const createFreshnessKey = (value: unknown): string => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || stableSerialize(value);
};

const metadataRecordKey = (family: string, key: string) =>
  `${family}\u001f${key}`;

const safeJsonParse = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const stripPayload = (
  snapshot: PlatformFreshnessSnapshot,
): PlatformFreshnessMetadata => {
  const { payload: _payload, ...metadata } = snapshot;
  return metadata;
};

const markSharedFreshnessPayload = (snapshot: PlatformFreshnessSnapshot) => {
  const payload = snapshot.payload;
  if (payload && typeof payload === "object") {
    sharedPayloadOrigins.set(payload, snapshot.sourceTabId);
  }
};

export const isSharedFreshnessPayload = (payload: unknown) =>
  Boolean(
    payload &&
      typeof payload === "object" &&
      sharedPayloadOrigins.has(payload),
  );

const isSnapshotMessage = (
  value: unknown,
): value is { type: typeof MESSAGE_TYPE; snapshot: PlatformFreshnessSnapshot } =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === MESSAGE_TYPE &&
      (value as { snapshot?: unknown }).snapshot &&
      typeof (value as { snapshot?: unknown }).snapshot === "object",
  );

const isRequestMessage = (
  value: unknown,
): value is { type: typeof REQUEST_TYPE; request: FreshnessRequest } =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === REQUEST_TYPE &&
      (value as { request?: unknown }).request &&
      typeof (value as { request?: unknown }).request === "object",
  );

export const isFreshnessSnapshotFresh = (
  snapshot: PlatformFreshnessSnapshot | PlatformFreshnessMetadata | null | undefined,
  now = Date.now(),
) => {
  if (!snapshot) return false;
  const expiresAt = Number(snapshot.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
};

export const hydrateQueryCacheFromFreshnessSnapshot = ({
  queryClient,
  queryKey,
  snapshot,
  tabId = null,
  now = Date.now(),
}: HydrateQueryCacheInput) => {
  if (!snapshot) {
    return { applied: false, reason: "missing", sourceState: "waiting" as const };
  }
  if (!isFreshnessSnapshotFresh(snapshot, now)) {
    return { applied: false, reason: "stale", sourceState: "stale" as const };
  }
  if (tabId && snapshot.sourceTabId === tabId) {
    return { applied: false, reason: "self", sourceState: "live" as const };
  }
  if (
    snapshot.metadataOnly ||
    !Object.prototype.hasOwnProperty.call(snapshot, "payload")
  ) {
    return {
      applied: false,
      reason: "metadata-only",
      sourceState: "waiting" as const,
    };
  }

  markSharedFreshnessPayload(snapshot as PlatformFreshnessSnapshot);
  queryClient.setQueryData(
    queryKey,
    (snapshot as PlatformFreshnessSnapshot).payload,
  );
  return {
    applied: true,
    reason: "shared",
    sourceState: "shared" as const,
    ageMs: Math.max(0, now - Number(snapshot.fetchedAt || now)),
  };
};

export const createPlatformFreshnessBus = ({
  artifactId = DEFAULT_ARTIFACT_ID,
  tabId = createTabId(),
  storage = typeof window !== "undefined" ? window.localStorage : null,
  channelFactory =
    typeof BroadcastChannel !== "undefined"
      ? (name: string) => new BroadcastChannel(name)
      : null,
  now = () => Date.now(),
}: {
  artifactId?: string;
  tabId?: string;
  storage?: StorageLike | null;
  channelFactory?: ChannelFactory | null;
  now?: () => number;
} = {}) => {
  const channelName = `${CHANNEL_PREFIX}${artifactId}`;
  const storageKey = `${STORAGE_PREFIX}${artifactId}`;
  const listeners = new Set<FreshnessSubscription>();
  const requestListeners = new Set<FreshnessRequestSubscription>();
  let channel: ChannelLike | null = null;

  const readMetadataMap = (): Record<string, PlatformFreshnessMetadata> => {
    const parsed = safeJsonParse(storage?.getItem(storageKey) ?? null);
    return parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, PlatformFreshnessMetadata>)
      : {};
  };

  const writeMetadata = (snapshot: PlatformFreshnessSnapshot) => {
    if (!storage) return;
    const metadataMap = readMetadataMap();
    metadataMap[metadataRecordKey(snapshot.family, snapshot.key)] =
      stripPayload(snapshot);
    try {
      storage.setItem(storageKey, JSON.stringify(metadataMap));
    } catch {
      // Metadata is diagnostic/warm-start only; storage quota should not block data flow.
    }
  };

  const notify = (snapshot: PlatformFreshnessSnapshot) => {
    for (const subscription of listeners) {
      if (subscription.family && subscription.family !== snapshot.family) continue;
      if (subscription.key && subscription.key !== snapshot.key) continue;
      subscription.listener(snapshot);
    }
  };

  const notifyRequest = (request: FreshnessRequest) => {
    for (const subscription of requestListeners) {
      if (subscription.family && subscription.family !== request.family) continue;
      if (subscription.key && subscription.key !== request.key) continue;
      subscription.listener(request);
    }
  };

  try {
    channel = channelFactory?.(channelName) ?? null;
    if (channel) {
      channel.onmessage = (event) => {
        const message = event?.data;
        if (isSnapshotMessage(message)) {
          const snapshot = message.snapshot;
          if (snapshot.sourceTabId === tabId) return;
          writeMetadata(snapshot);
          notify(snapshot);
          return;
        }
        if (isRequestMessage(message)) {
          const request = message.request;
          if (request.requesterTabId === tabId) return;
          notifyRequest(request);
        }
      };
    }
  } catch {
    channel = null;
  }

  const publish = <TPayload,>({
    family,
    key,
    payload,
    ttlMs,
    fetchedAt,
    expiresAt,
    sourceVisible,
    payloadSizeClass,
    metadataOnly,
  }: PublishSnapshotInput<TPayload>) => {
    const resolvedFamily = cleanText(family);
    const resolvedKey = createFreshnessKey(key);
    if (!resolvedFamily || !resolvedKey) return null;

    const resolvedFetchedAt = Number.isFinite(Number(fetchedAt))
      ? Number(fetchedAt)
      : now();
    const sizeClass = normalizePayloadSizeClass(payloadSizeClass);
    const payloadAllowed = sizeClass === "small" || sizeClass === "medium";
    const resolvedMetadataOnly = Boolean(metadataOnly || !payloadAllowed);
    const snapshot: PlatformFreshnessSnapshot<TPayload> = {
      family: resolvedFamily,
      key: resolvedKey,
      ...(resolvedMetadataOnly ? {} : { payload }),
      fetchedAt: resolvedFetchedAt,
      expiresAt: Number.isFinite(Number(expiresAt))
        ? Number(expiresAt)
        : resolvedFetchedAt + Math.max(0, Number(ttlMs) || 0),
      sourceTabId: tabId,
      sourceVisible: sourceVisible ?? readDocumentVisible(),
      payloadSizeClass: sizeClass,
      metadataOnly: resolvedMetadataOnly,
    };

    writeMetadata(snapshot);
    channel?.postMessage({ type: MESSAGE_TYPE, snapshot });
    return snapshot;
  };

  const subscribe = (
    filter: { family?: string | null; key?: unknown } | FreshnessListener,
    listener?: FreshnessListener,
  ) => {
    const subscription: FreshnessSubscription =
      typeof filter === "function"
        ? { listener: filter }
        : {
            family: filter.family ? cleanText(filter.family) : null,
            key: filter.key != null ? createFreshnessKey(filter.key) : null,
            listener: listener!,
          };
    if (typeof subscription.listener !== "function") {
      return () => {};
    }
    listeners.add(subscription);
    return () => {
      listeners.delete(subscription);
    };
  };

  const subscribeRequests = (
    filter: { family?: string | null; key?: unknown },
    listener: FreshnessRequestListener,
  ) => {
    const subscription = {
      family: filter.family ? cleanText(filter.family) : null,
      key: filter.key != null ? createFreshnessKey(filter.key) : null,
      listener,
    };
    requestListeners.add(subscription);
    return () => {
      requestListeners.delete(subscription);
    };
  };

  const request = ({ family, key }: { family: string; key: unknown }) => {
    const resolvedFamily = cleanText(family);
    const resolvedKey = createFreshnessKey(key);
    if (!resolvedFamily || !resolvedKey) return null;
    const requestMessage = {
      family: resolvedFamily,
      key: resolvedKey,
      requesterTabId: tabId,
    };
    channel?.postMessage({ type: REQUEST_TYPE, request: requestMessage });
    return requestMessage;
  };

  const readMetadata = (family: string, key: unknown) =>
    readMetadataMap()[metadataRecordKey(cleanText(family), createFreshnessKey(key))] ??
    null;

  const close = () => {
    listeners.clear();
    requestListeners.clear();
    channel?.close?.();
    channel = null;
  };

  return {
    artifactId,
    tabId,
    channelName,
    storageKey,
    publish,
    request,
    subscribe,
    subscribeRequests,
    readMetadata,
    readAllMetadata: readMetadataMap,
    close,
  };
};

export type PlatformFreshnessBus = ReturnType<
  typeof createPlatformFreshnessBus
>;

export const usePlatformFreshnessQueryHydration = ({
  bus,
  family,
  freshnessKey,
  queryKey,
  queryClient,
  enabled = true,
  onHydration,
}: {
  bus: PlatformFreshnessBus | null | undefined;
  family: string;
  freshnessKey: unknown;
  queryKey: unknown;
  queryClient: HydrateQueryCacheInput["queryClient"];
  enabled?: boolean;
  onHydration?: (
    result: ReturnType<typeof hydrateQueryCacheFromFreshnessSnapshot>,
    snapshot: PlatformFreshnessSnapshot | PlatformFreshnessMetadata | null,
  ) => void;
}) => {
  const key = createFreshnessKey(freshnessKey);
  useEffect(() => {
    if (!enabled || !bus) return undefined;

    const metadata = bus.readMetadata(family, key);
    if (metadata && !isFreshnessSnapshotFresh(metadata)) {
      onHydration?.(
        { applied: false, reason: "stale", sourceState: "stale" },
        metadata,
      );
    }

    const unsubscribe = bus.subscribe({ family, key }, (snapshot) => {
      const result = hydrateQueryCacheFromFreshnessSnapshot({
        queryClient,
        queryKey,
        snapshot,
        tabId: bus.tabId,
      });
      onHydration?.(result, snapshot);
    });
    bus.request({ family, key });
    return unsubscribe;
  }, [bus, enabled, family, key, onHydration, queryClient, queryKey]);
};

export const usePlatformFreshnessQueryPublisher = ({
  bus,
  family,
  freshnessKey,
  data,
  enabled = true,
  ttlMs,
  payloadSizeClass = "small",
  sourceVisible,
}: {
  bus: PlatformFreshnessBus | null | undefined;
  family: string;
  freshnessKey: unknown;
  data: unknown;
  enabled?: boolean;
  ttlMs: number;
  payloadSizeClass?: PlatformFreshnessPayloadSize;
  sourceVisible?: boolean;
}) => {
  const key = createFreshnessKey(freshnessKey);
  useEffect(() => {
    if (!enabled || !bus || data == null) return undefined;
    if (isSharedFreshnessPayload(data)) return undefined;
    const publish = () =>
      bus.publish({
        family,
        key,
        payload: data,
        ttlMs,
        payloadSizeClass,
        sourceVisible,
      });

    publish();
    return bus.subscribeRequests({ family, key }, publish);
  }, [bus, data, enabled, family, key, payloadSizeClass, sourceVisible, ttlMs]);
};
