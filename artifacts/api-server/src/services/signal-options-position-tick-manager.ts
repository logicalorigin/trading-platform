import type { SignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import type { AlgoDeployment, ExecutionEvent } from "@workspace/db";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import { logger as defaultLogger } from "../lib/logger";
import type { OptionQuoteSnapshotPayload } from "./massive-option-quote-stream";
import {
  subscribeOptionQuoteDemand,
  type OptionQuoteDemandDeclaration,
} from "./option-quote-demand-coordinator";
import { getSignalMonitorProfileRow } from "./signal-monitor";
import {
  listEnabledSignalOptionsDeployments,
  listSignalOptionsActivePositionsForDeployment,
  manageSignalOptionsActivePositionQuote,
  type SignalOptionsActivePositionQuoteManageResult,
  type SignalOptionsPosition,
} from "./signal-options-automation";

const DEFAULT_RECONCILE_INTERVAL_MS = 5_000;
const DEFAULT_ACTIVE_POSITION_SNAPSHOT_TTL_MS = 15_000;

type Logger = {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type ActivePositionSnapshot = {
  positions: SignalOptionsPosition[];
  events: ExecutionEvent[];
};

type ActivePositionSnapshotCacheEntry = {
  snapshot: ActivePositionSnapshot;
  loadedAtMs: number;
  generation: number;
};

type SubscribeDemand = (
  input: OptionQuoteDemandDeclaration,
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
) => () => void;

type OptionQuoteSource = "ibkr" | "massive";

type ManageQuote = (input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  quote: QuoteSnapshot & { source?: OptionQuoteSource };
  pyrusSignalsSettings?: Record<string, unknown> | null;
  recentEvents?: ExecutionEvent[];
  now?: Date;
}) => Promise<SignalOptionsActivePositionQuoteManageResult>;

export type SignalOptionsPositionTickManagerDependencies = {
  listDeployments?: () => Promise<AlgoDeployment[]>;
  listActivePositions?: (input: {
    deployment: AlgoDeployment;
  }) => Promise<ActivePositionSnapshot>;
  subscribeDemand?: SubscribeDemand;
  manageQuote?: ManageQuote;
  resolveProfile?: (
    deployment: AlgoDeployment,
  ) => SignalOptionsExecutionProfile;
  loadPyrusSignalsSettings?: (
    deployment: AlgoDeployment,
  ) => Promise<Record<string, unknown> | null>;
  now?: () => Date;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  reconcileIntervalMs?: number;
  activePositionSnapshotTtlMs?: number;
  logger?: Logger;
};

type Runtime = {
  key: string;
  owner: string;
  revision: number;
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  providerContractId: string;
  requiresGreeks: boolean;
  pyrusSignalsSettings: Record<string, unknown> | null;
  recentEvents: ExecutionEvent[];
  pendingQuote: (QuoteSnapshot & { source?: OptionQuoteSource }) | null;
  processing: boolean;
  unsubscribe: () => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function positionProviderContractId(
  position: SignalOptionsPosition,
): string | null {
  return compactString(asRecord(position.selectedContract).providerContractId);
}

function positionKey(input: {
  deployment: AlgoDeployment;
  position: SignalOptionsPosition;
}): string {
  return `${input.deployment.id}:${input.position.id}:${input.position.openedAt}`;
}

function positionDemandOwner(input: {
  deployment: AlgoDeployment;
  position: SignalOptionsPosition;
}): string {
  return `signal-options-position-mark:${input.deployment.id}:${input.position.id}:${input.position.openedAt}:tick`;
}

function mergeActivePosition(
  existing: SignalOptionsPosition,
  snapshot: SignalOptionsPosition,
): SignalOptionsPosition {
  // The active-position snapshot is cached up to activePositionSnapshotTtlMs
  // and can therefore be stale relative to ticks the runtime has already
  // processed since it was loaded. Never let a stale snapshot lower a
  // trailing-ratchet high; keep whichever mark is fresher.
  const peakPrice = Math.max(existing.peakPrice, snapshot.peakPrice);
  const existingMarkedAtMs = existing.lastMarkedAt
    ? Date.parse(existing.lastMarkedAt)
    : NaN;
  const snapshotMarkedAtMs = snapshot.lastMarkedAt
    ? Date.parse(snapshot.lastMarkedAt)
    : NaN;
  const preferExisting =
    Number.isFinite(existingMarkedAtMs) &&
    (!Number.isFinite(snapshotMarkedAtMs) ||
      existingMarkedAtMs > snapshotMarkedAtMs);
  if (preferExisting) {
    return {
      ...snapshot,
      peakPrice,
      stopPrice: existing.stopPrice,
      lastMarkPrice: existing.lastMarkPrice,
      lastMarkedAt: existing.lastMarkedAt,
      lastStop: existing.lastStop,
      lastWireTrail: existing.lastWireTrail,
      entryGreeks: existing.entryGreeks,
      greekBaselineSource: existing.greekBaselineSource,
    };
  }
  return {
    ...snapshot,
    peakPrice,
  };
}

function activePositionSnapshotSupersedes(
  existing: SignalOptionsPosition,
  snapshot: SignalOptionsPosition,
): boolean {
  const existingMarkedAtMs = existing.lastMarkedAt
    ? Date.parse(existing.lastMarkedAt)
    : NaN;
  const snapshotMarkedAtMs = snapshot.lastMarkedAt
    ? Date.parse(snapshot.lastMarkedAt)
    : NaN;
  return (
    (Number.isFinite(snapshotMarkedAtMs) &&
      (!Number.isFinite(existingMarkedAtMs) ||
        snapshotMarkedAtMs > existingMarkedAtMs)) ||
    snapshot.quantity !== existing.quantity ||
    snapshot.premiumAtRisk !== existing.premiumAtRisk ||
    positionProviderContractId(snapshot) !==
      positionProviderContractId(existing) ||
    oppositeSignalPendingConfirmChanged(existing, snapshot)
  );
}

function oppositeSignalPendingConfirmChanged(
  existing: SignalOptionsPosition,
  snapshot: SignalOptionsPosition,
): boolean {
  const previous = existing.oppositeSignalPendingConfirm;
  const next = snapshot.oppositeSignalPendingConfirm;
  if (!previous || !next) {
    return Boolean(previous) !== Boolean(next);
  }
  return (
    previous.signalKey !== next.signalKey ||
    previous.signalAt !== next.signalAt ||
    previous.direction !== next.direction ||
    (previous.candidateId ?? null) !== (next.candidateId ?? null)
  );
}

function mergeScaledOutPosition(
  current: SignalOptionsPosition,
  scaledOut: SignalOptionsPosition,
): SignalOptionsPosition {
  return mergeActivePosition(scaledOut, {
    ...current,
    quantity: Math.min(current.quantity, scaledOut.quantity),
    premiumAtRisk: Math.min(current.premiumAtRisk, scaledOut.premiumAtRisk),
  });
}

function requiresGreeks(profile: SignalOptionsExecutionProfile): boolean {
  const exitPolicy = asRecord(profile.exitPolicy);
  const greekPositionManagement = asRecord(exitPolicy.greekPositionManagement);
  const wireGreekTrail = asRecord(exitPolicy.wireGreekTrail);
  return (
    wireGreekTrail.enabled === true || greekPositionManagement.enabled === true
  );
}

function usesWireTrail(profile: SignalOptionsExecutionProfile): boolean {
  return asRecord(asRecord(profile.exitPolicy).wireGreekTrail).enabled === true;
}

async function defaultLoadPyrusSignalsSettings(
  deployment: AlgoDeployment,
): Promise<Record<string, unknown> | null> {
  const profile = await getSignalMonitorProfileRow({
    environment: deployment.mode,
  });
  const settings = asRecord(profile.pyrusSignalsSettings);
  return Object.keys(settings).length ? settings : null;
}

function matchingQuote(input: {
  payload: OptionQuoteSnapshotPayload;
  providerContractId: string;
}): (QuoteSnapshot & { source?: OptionQuoteSource }) | null {
  let matched: (QuoteSnapshot & { source?: OptionQuoteSource }) | null = null;
  for (const quote of input.payload.quotes) {
    if (compactString(quote.providerContractId) === input.providerContractId) {
      matched = quote;
    }
  }
  return matched;
}

export class SignalOptionsPositionTickManager {
  private readonly listDeployments: () => Promise<AlgoDeployment[]>;
  private readonly listActivePositions: (input: {
    deployment: AlgoDeployment;
  }) => Promise<ActivePositionSnapshot>;
  private readonly subscribeDemand: SubscribeDemand;
  private readonly manageQuote: ManageQuote;
  private readonly resolveProfile: (
    deployment: AlgoDeployment,
  ) => SignalOptionsExecutionProfile;
  private readonly loadPyrusSignalsSettings: (
    deployment: AlgoDeployment,
  ) => Promise<Record<string, unknown> | null>;
  private readonly now: () => Date;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly reconcileIntervalMs: number;
  private readonly activePositionSnapshotTtlMs: number;
  private readonly logger: Logger;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly activePositionSnapshots = new Map<
    string,
    ActivePositionSnapshotCacheEntry
  >();
  private readonly activePositionSnapshotGenerations = new Map<
    string,
    number
  >();
  private readonly drainingOwners = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileInFlight: Promise<void> | null = null;
  private reconcileInFlightEpoch: number | null = null;
  private lifecycleEpoch = 0;
  private stopped = false;

  constructor(dependencies: SignalOptionsPositionTickManagerDependencies = {}) {
    this.listDeployments =
      dependencies.listDeployments ?? listEnabledSignalOptionsDeployments;
    this.listActivePositions =
      dependencies.listActivePositions ??
      ((input) =>
        listSignalOptionsActivePositionsForDeployment({
          deployment: input.deployment,
        }));
    this.subscribeDemand =
      dependencies.subscribeDemand ?? subscribeOptionQuoteDemand;
    this.manageQuote =
      dependencies.manageQuote ?? manageSignalOptionsActivePositionQuote;
    this.resolveProfile =
      dependencies.resolveProfile ??
      ((deployment) => resolveSignalOptionsExecutionProfile(deployment.config));
    this.loadPyrusSignalsSettings =
      dependencies.loadPyrusSignalsSettings ?? defaultLoadPyrusSignalsSettings;
    this.now = dependencies.now ?? (() => new Date());
    this.setIntervalFn = dependencies.setInterval ?? setInterval;
    this.clearIntervalFn = dependencies.clearInterval ?? clearInterval;
    this.reconcileIntervalMs =
      dependencies.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.activePositionSnapshotTtlMs =
      dependencies.activePositionSnapshotTtlMs ??
      DEFAULT_ACTIVE_POSITION_SNAPSHOT_TTL_MS;
    this.logger = dependencies.logger ?? defaultLogger;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.stopped = false;
    this.timer = this.setIntervalFn(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.warn?.(
          { err: error },
          "Signal-options position tick reconcile failed",
        );
      });
    }, this.reconcileIntervalMs);
    this.timer.unref?.();
    void this.runOnce().catch((error: unknown) => {
      this.logger.warn?.(
        { err: error },
        "Signal-options position tick initial reconcile failed",
      );
    });
  }

  stop(): void {
    // Set before releasing anything so an in-flight reconcile — possibly
    // paused mid-await on a DB call — bails out on resume instead of
    // re-installing subscriptions after we've torn everything down.
    this.stopped = true;
    this.lifecycleEpoch += 1;
    this.activePositionSnapshots.clear();
    this.activePositionSnapshotGenerations.clear();
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    for (const key of [...this.runtimes.keys()]) {
      this.releaseRuntime(key);
    }
  }

  async runOnce(): Promise<void> {
    const epoch = this.lifecycleEpoch;
    const inFlight = this.reconcileInFlight;
    if (inFlight) {
      const inFlightEpoch = this.reconcileInFlightEpoch;
      try {
        await inFlight;
      } catch (error) {
        if (this.stopped || inFlightEpoch === this.lifecycleEpoch) {
          throw error;
        }
      }
      if (!this.stopped && inFlightEpoch !== this.lifecycleEpoch) {
        return this.runOnce();
      }
      return;
    }
    const work = this.reconcile(epoch);
    this.reconcileInFlight = work;
    this.reconcileInFlightEpoch = epoch;
    try {
      await work;
    } finally {
      if (this.reconcileInFlight === work) {
        this.reconcileInFlight = null;
        this.reconcileInFlightEpoch = null;
      }
    }
  }

  private lifecycleIsCurrent(epoch: number): boolean {
    return !this.stopped && epoch === this.lifecycleEpoch;
  }

  private async reconcile(epoch: number): Promise<void> {
    const deployments = (await this.listDeployments()).filter(
      (deployment) => deployment.mode === "shadow",
    );
    if (!this.lifecycleIsCurrent(epoch)) {
      return;
    }
    const deploymentIds = new Set(
      deployments.map((deployment) => deployment.id),
    );
    for (const deploymentId of this.activePositionSnapshots.keys()) {
      if (!deploymentIds.has(deploymentId)) {
        this.invalidateActivePositionSnapshot(deploymentId);
      }
    }
    const desiredKeys = new Set<string>();

    for (const deployment of deployments) {
      try {
        const profile = this.resolveProfile(deployment);
        let activeSnapshot: ActivePositionSnapshot | null = null;
        let pyrusSignalsSettings: Record<string, unknown> | null = null;
        while (!activeSnapshot) {
          const loaded = await this.loadActivePositionSnapshot(
            deployment,
            epoch,
          );
          if (!loaded || !this.lifecycleIsCurrent(epoch)) {
            return;
          }
          const loadedPyrusSignalsSettings =
            usesWireTrail(profile) && loaded.snapshot.positions.length > 0
              ? await this.safeLoadPyrusSignalsSettings(deployment)
              : null;
          if (!this.lifecycleIsCurrent(epoch)) {
            return;
          }
          if (
            loaded.generation !==
            this.activePositionSnapshotGeneration(deployment.id)
          ) {
            continue;
          }
          activeSnapshot = loaded.snapshot;
          pyrusSignalsSettings = loadedPyrusSignalsSettings;
        }
        const greekDemand = requiresGreeks(profile);

        for (const position of activeSnapshot.positions) {
          const providerContractId = positionProviderContractId(position);
          if (!providerContractId) {
            continue;
          }
          // Position marks are kept warm in ALL sessions (time-of-day gates only
          // execution, never market data). Renewing the live-demand lease here keeps the
          // held-position quote subscription alive 24/7 so reads never hit the cold path.
          // Actual exits/orders remain gated by the execution session checks in
          // signal-options-automation (entry/exit/overnight-window).
          const key = positionKey({
            deployment,
            position,
          });
          desiredKeys.add(key);
          const existing = this.runtimes.get(key);
          if (
            existing &&
            existing.requiresGreeks === greekDemand &&
            existing.providerContractId === providerContractId
          ) {
            const snapshotSupersedes = activePositionSnapshotSupersedes(
              existing.position,
              position,
            );
            existing.deployment = deployment;
            existing.profile = profile;
            existing.position = mergeActivePosition(
              existing.position,
              position,
            );
            if (snapshotSupersedes) {
              existing.revision += 1;
            }
            existing.recentEvents = activeSnapshot.events;
            existing.pyrusSignalsSettings = pyrusSignalsSettings;
            continue;
          }
          if (existing) {
            // Preserve the runtime's processing and pending-quote state while
            // replacing only its demand registration. Installing a second
            // runtime here would let it start another drain while the first is
            // still awaiting manageQuote.
            const previousPosition = existing.position;
            const snapshotSupersedes = activePositionSnapshotSupersedes(
              existing.position,
              position,
            );
            existing.deployment = deployment;
            existing.profile = profile;
            existing.position = mergeActivePosition(
              existing.position,
              position,
            );
            if (snapshotSupersedes) {
              existing.revision += 1;
            }
            existing.recentEvents = activeSnapshot.events;
            existing.pyrusSignalsSettings = pyrusSignalsSettings;
            const previousRequiresGreeks = existing.requiresGreeks;
            const previousProviderContractId = existing.providerContractId;
            const replacementBaseRevision = existing.revision;
            const providerContractChanged =
              previousProviderContractId !== providerContractId;
            existing.providerContractId = providerContractId;
            if (providerContractChanged) {
              existing.revision += 1;
            }
            try {
              const unsubscribe = this.subscribeRuntimeDemand(
                existing,
                greekDemand,
              );
              existing.requiresGreeks = greekDemand;
              existing.unsubscribe = unsubscribe;
            } catch (error) {
              existing.providerContractId = previousProviderContractId;
              existing.requiresGreeks = previousRequiresGreeks;
              if (providerContractChanged) {
                existing.position = {
                  ...existing.position,
                  selectedContract: previousPosition.selectedContract,
                };
                existing.revision = replacementBaseRevision;
              } else {
                existing.revision = replacementBaseRevision;
              }
              try {
                existing.unsubscribe = this.subscribeRuntimeDemand(
                  existing,
                  previousRequiresGreeks,
                );
              } catch (restoreError) {
                this.invalidateActivePositionSnapshot(existing.deployment.id);
                this.releaseRuntime(existing.key);
                throw new AggregateError(
                  [error, restoreError],
                  "Signal-options position tick demand replacement and rollback failed",
                  { cause: error },
                );
              }
              throw error;
            }
            continue;
          }
          this.installRuntime({
            key,
            deployment,
            profile,
            position,
            providerContractId,
            pyrusSignalsSettings,
            recentEvents: activeSnapshot.events,
            requiresGreeks: greekDemand,
          });
        }
      } catch (error) {
        // An errored deployment has no authoritative desired-key result. Retain
        // its last known-good runtimes until a successful reconcile says otherwise.
        for (const [key, runtime] of this.runtimes) {
          if (runtime.deployment.id === deployment.id) {
            desiredKeys.add(key);
          }
        }
        // Never let one deployment's failure abort the loop before the
        // stale-key sweep below runs — that sweep is what releases closed
        // positions' subscriptions, and skipping it leaks them.
        this.logger.warn?.(
          { err: error, deploymentId: deployment.id },
          "Signal-options position tick reconcile failed for deployment",
        );
      }
    }

    for (const key of [...this.runtimes.keys()]) {
      if (!desiredKeys.has(key)) {
        this.releaseRuntime(key);
      }
    }
  }

  private async loadActivePositionSnapshot(
    deployment: AlgoDeployment,
    lifecycleEpoch: number,
  ): Promise<ActivePositionSnapshotCacheEntry | null> {
    while (true) {
      if (!this.lifecycleIsCurrent(lifecycleEpoch)) {
        return null;
      }
      const generation = this.activePositionSnapshotGeneration(deployment.id);
      const nowMs = this.now().getTime();
      const cached = this.activePositionSnapshots.get(deployment.id);
      if (
        cached &&
        cached.generation === generation &&
        nowMs - cached.loadedAtMs < this.activePositionSnapshotTtlMs
      ) {
        return cached;
      }
      const snapshot = await this.listActivePositions({ deployment });
      const entry = { snapshot, loadedAtMs: nowMs, generation };
      if (!this.lifecycleIsCurrent(lifecycleEpoch)) {
        return null;
      }
      if (generation !== this.activePositionSnapshotGeneration(deployment.id)) {
        continue;
      }
      this.activePositionSnapshots.set(deployment.id, entry);
      return entry;
    }
  }

  private activePositionSnapshotGeneration(deploymentId: string): number {
    return this.activePositionSnapshotGenerations.get(deploymentId) ?? 0;
  }

  private invalidateActivePositionSnapshot(deploymentId: string): void {
    this.activePositionSnapshotGenerations.set(
      deploymentId,
      this.activePositionSnapshotGeneration(deploymentId) + 1,
    );
    this.activePositionSnapshots.delete(deploymentId);
  }

  private async safeLoadPyrusSignalsSettings(
    deployment: AlgoDeployment,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.loadPyrusSignalsSettings(deployment);
    } catch (error) {
      this.logger.warn?.(
        { err: error, deploymentId: deployment.id },
        "Signal-options position tick manager could not load Pyrus settings",
      );
      return null;
    }
  }

  private subscribeRuntimeDemand(
    runtime: Runtime,
    requiresGreeks: boolean,
  ): () => void {
    return this.subscribeDemand(
      {
        owner: runtime.owner,
        underlying: runtime.position.symbol,
        providerContractIds: [runtime.providerContractId],
        intent: "automation-live",
        fallbackProvider: "cache",
        requiresGreeks,
        ttlMs: null,
      },
      (payload) => {
        this.handleSnapshot(runtime.key, payload);
      },
    );
  }

  private installRuntime(input: {
    key: string;
    deployment: AlgoDeployment;
    profile: SignalOptionsExecutionProfile;
    position: SignalOptionsPosition;
    providerContractId: string;
    pyrusSignalsSettings: Record<string, unknown> | null;
    recentEvents: ExecutionEvent[];
    requiresGreeks: boolean;
  }): void {
    const owner = positionDemandOwner({
      deployment: input.deployment,
      position: input.position,
    });
    const runtime: Runtime = {
      key: input.key,
      owner,
      revision: 0,
      deployment: input.deployment,
      profile: input.profile,
      position: input.position,
      providerContractId: input.providerContractId,
      requiresGreeks: input.requiresGreeks,
      pyrusSignalsSettings: input.pyrusSignalsSettings,
      recentEvents: input.recentEvents,
      pendingQuote: null,
      processing: false,
      unsubscribe: () => {},
    };
    this.runtimes.set(input.key, runtime);
    try {
      runtime.unsubscribe = this.subscribeRuntimeDemand(
        runtime,
        input.requiresGreeks,
      );
    } catch (error) {
      this.runtimes.delete(input.key);
      throw error;
    }
    this.logger.debug?.(
      {
        deploymentId: input.deployment.id,
        positionId: input.position.id,
        providerContractId: input.providerContractId,
      },
      "Signal-options position tick subscription installed",
    );
  }

  private releaseRuntime(key: string): void {
    const runtime = this.runtimes.get(key);
    if (!runtime) {
      return;
    }
    this.runtimes.delete(key);
    // The demand owner is scoped to deployment+position, not the contract,
    // so a contract change (new key, same owner) can leave a stale runtime
    // for the old key coexisting with a fresh one for the new key. If some
    // other live runtime still holds this owner, unsubscribing here would
    // release *that* runtime's coordinator registration instead of this
    // stale one's — skip it and let that runtime's own eventual release own
    // the unsubscribe.
    const ownerStillInUse = [...this.runtimes.values()].some(
      (other) => other.owner === runtime.owner,
    );
    if (ownerStillInUse) {
      return;
    }
    try {
      runtime.unsubscribe();
    } catch (error) {
      this.logger.warn?.(
        { err: error, owner: runtime.owner },
        "Signal-options position tick unsubscribe failed",
      );
    }
  }

  private handleSnapshot(
    key: string,
    payload: OptionQuoteSnapshotPayload,
  ): void {
    const runtime = this.runtimes.get(key);
    if (!runtime) {
      return;
    }
    const quote = matchingQuote({
      payload,
      providerContractId: runtime.providerContractId,
    });
    if (!quote) {
      return;
    }
    runtime.pendingQuote = quote;
    void this.drainQuoteQueue(key);
  }

  private async drainQuoteQueue(key: string): Promise<void> {
    const runtime = this.runtimes.get(key);
    if (
      !runtime ||
      runtime.processing ||
      this.drainingOwners.has(runtime.owner)
    ) {
      return;
    }
    runtime.processing = true;
    this.drainingOwners.add(runtime.owner);
    try {
      while (this.runtimes.get(key) === runtime) {
        const quote = runtime.pendingQuote;
        if (!quote) {
          break;
        }
        runtime.pendingQuote = null;
        if (
          compactString(quote.providerContractId) !== runtime.providerContractId
        ) {
          continue;
        }
        const revision = runtime.revision;
        const result = await this.manageQuote({
          deployment: runtime.deployment,
          profile: runtime.profile,
          position: runtime.position,
          quote,
          pyrusSignalsSettings: runtime.pyrusSignalsSettings,
          recentEvents: runtime.recentEvents,
          now: this.now(),
        });
        if (result.scaledOut || result.exited) {
          this.invalidateActivePositionSnapshot(runtime.deployment.id);
        }
        const current = [...this.runtimes.values()].find(
          (candidate) => candidate.owner === runtime.owner,
        );
        if (result.exited) {
          if (current) {
            this.releaseRuntime(current.key);
          }
          break;
        }
        if (result.position && !current && !result.scaledOut) {
          this.invalidateActivePositionSnapshot(runtime.deployment.id);
        }
        const runtimeIsCurrent =
          this.runtimes.get(key) === runtime && runtime.revision === revision;
        if (result.scaledOut && !result.position) {
          if (current) {
            this.releaseRuntime(current.key);
          }
          break;
        }
        if (result.position && !runtimeIsCurrent && current) {
          current.position = result.scaledOut
            ? mergeScaledOutPosition(current.position, result.position)
            : mergeActivePosition(result.position, current.position);
          current.revision += 1;
        }
        if (!runtimeIsCurrent) {
          continue;
        }
        if (result.position) {
          runtime.position = result.position;
        }
      }
    } catch (error) {
      this.logger.warn?.(
        { err: error, key },
        "Signal-options position tick quote management failed",
      );
    } finally {
      if (this.runtimes.get(key) === runtime) {
        runtime.processing = false;
      }
      this.drainingOwners.delete(runtime.owner);
      const current = [...this.runtimes.values()].find(
        (candidate) => candidate.owner === runtime.owner,
      );
      if (current?.pendingQuote) {
        void this.drainQuoteQueue(current.key);
      }
    }
  }
}

export function createSignalOptionsPositionTickManager(
  dependencies: SignalOptionsPositionTickManagerDependencies = {},
): SignalOptionsPositionTickManager {
  return new SignalOptionsPositionTickManager(dependencies);
}

const signalOptionsPositionTickManager =
  createSignalOptionsPositionTickManager();

export function startSignalOptionsPositionTickManager(): void {
  signalOptionsPositionTickManager.start();
}

export function stopSignalOptionsPositionTickManager(): void {
  signalOptionsPositionTickManager.stop();
}
