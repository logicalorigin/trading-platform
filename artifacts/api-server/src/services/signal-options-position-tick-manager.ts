import type { SignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import type { AlgoDeployment, ExecutionEvent } from "@workspace/db";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import { logger as defaultLogger } from "../lib/logger";
import type { OptionQuoteSnapshotPayload } from "./bridge-option-quote-stream";
import {
  subscribeIbkrLiveDemand,
  type IbkrLiveDemandDeclaration,
} from "./ibkr-live-demand-coordinator";
import { getSignalMonitorProfileRow } from "./signal-monitor";
import {
  listEnabledSignalOptionsDeployments,
  listSignalOptionsActivePositionsForDeployment,
  manageSignalOptionsActivePositionQuote,
  type SignalOptionsActivePositionQuoteManageResult,
  type SignalOptionsPosition,
} from "./signal-options-automation";

const DEFAULT_RECONCILE_INTERVAL_MS = 5_000;

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

type SubscribeDemand = (
  input: IbkrLiveDemandDeclaration,
  onSnapshot: (payload: OptionQuoteSnapshotPayload) => void,
) => () => void;

type ManageQuote = (input: {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  quote: QuoteSnapshot & { source?: "ibkr" };
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
  resolveProfile?: (deployment: AlgoDeployment) => SignalOptionsExecutionProfile;
  loadPyrusSignalsSettings?: (
    deployment: AlgoDeployment,
  ) => Promise<Record<string, unknown> | null>;
  now?: () => Date;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  reconcileIntervalMs?: number;
  logger?: Logger;
};

type Runtime = {
  key: string;
  owner: string;
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  position: SignalOptionsPosition;
  providerContractId: string;
  requiresGreeks: boolean;
  pyrusSignalsSettings: Record<string, unknown> | null;
  recentEvents: ExecutionEvent[];
  pendingQuote: (QuoteSnapshot & { source?: "ibkr" }) | null;
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
  providerContractId: string;
}): string {
  return `${input.deployment.id}:${input.position.id}:${input.providerContractId}`;
}

function positionDemandOwner(input: {
  deployment: AlgoDeployment;
  position: SignalOptionsPosition;
}): string {
  return `signal-options-position-mark:${input.deployment.id}:${input.position.id}:tick`;
}

function requiresGreeks(profile: SignalOptionsExecutionProfile): boolean {
  const exitPolicy = asRecord(profile.exitPolicy);
  const greekPositionManagement = asRecord(exitPolicy.greekPositionManagement);
  const wireGreekTrail = asRecord(exitPolicy.wireGreekTrail);
  return (
    wireGreekTrail.enabled === true ||
    greekPositionManagement.enabled === true
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
}): (QuoteSnapshot & { source?: "ibkr" }) | null {
  let matched: (QuoteSnapshot & { source?: "ibkr" }) | null = null;
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
  private readonly logger: Logger;
  private readonly runtimes = new Map<string, Runtime>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileInFlight: Promise<void> | null = null;

  constructor(dependencies: SignalOptionsPositionTickManagerDependencies = {}) {
    this.listDeployments =
      dependencies.listDeployments ?? listEnabledSignalOptionsDeployments;
    this.listActivePositions =
      dependencies.listActivePositions ??
      ((input) =>
        listSignalOptionsActivePositionsForDeployment({
          deploymentId: input.deployment.id,
        }));
    this.subscribeDemand = dependencies.subscribeDemand ?? subscribeIbkrLiveDemand;
    this.manageQuote =
      dependencies.manageQuote ?? manageSignalOptionsActivePositionQuote;
    this.resolveProfile =
      dependencies.resolveProfile ?? resolveSignalOptionsExecutionProfile;
    this.loadPyrusSignalsSettings =
      dependencies.loadPyrusSignalsSettings ?? defaultLoadPyrusSignalsSettings;
    this.now = dependencies.now ?? (() => new Date());
    this.setIntervalFn = dependencies.setInterval ?? setInterval;
    this.clearIntervalFn = dependencies.clearInterval ?? clearInterval;
    this.reconcileIntervalMs =
      dependencies.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.logger = dependencies.logger ?? defaultLogger;
  }

  start(): void {
    if (this.timer) {
      return;
    }
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
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    for (const key of [...this.runtimes.keys()]) {
      this.releaseRuntime(key);
    }
  }

  async runOnce(): Promise<void> {
    if (this.reconcileInFlight) {
      return this.reconcileInFlight;
    }
    const work = this.reconcile();
    this.reconcileInFlight = work;
    try {
      await work;
    } finally {
      if (this.reconcileInFlight === work) {
        this.reconcileInFlight = null;
      }
    }
  }

  private async reconcile(): Promise<void> {
    const deployments = await this.listDeployments();
    const desiredKeys = new Set<string>();

    for (const deployment of deployments) {
      const profile = this.resolveProfile(deployment);
      const activeSnapshot = await this.listActivePositions({ deployment });
      const pyrusSignalsSettings =
        usesWireTrail(profile) && activeSnapshot.positions.length > 0
          ? await this.safeLoadPyrusSignalsSettings(deployment)
          : null;
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
          providerContractId,
        });
        desiredKeys.add(key);
        const existing = this.runtimes.get(key);
        if (existing && existing.requiresGreeks === greekDemand) {
          existing.deployment = deployment;
          existing.profile = profile;
          existing.position = position;
          existing.recentEvents = activeSnapshot.events;
          existing.pyrusSignalsSettings = pyrusSignalsSettings;
          continue;
        }
        // Greek-demand change: resubscribe. unsubscribe→subscribe runs in one
        // synchronous turn so no callback can land in between; the only loss
        // path is an undelivered pendingQuote on the old runtime — carry it
        // across the swap so a buffered stop-trigger tick is never dropped.
        const carriedQuote = existing?.pendingQuote ?? null;
        if (existing) {
          this.releaseRuntime(key);
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
        if (carriedQuote) {
          const installed = this.runtimes.get(key);
          if (installed && !installed.pendingQuote) {
            installed.pendingQuote = carriedQuote;
            void this.drainQuoteQueue(key);
          }
        }
      }
    }

    for (const key of [...this.runtimes.keys()]) {
      if (!desiredKeys.has(key)) {
        this.releaseRuntime(key);
      }
    }
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
    runtime.unsubscribe = this.subscribeDemand(
      {
        owner,
        underlying: input.position.symbol,
        providerContractIds: [input.providerContractId],
        intent: "automation-live",
        fallbackProvider: "cache",
        requiresGreeks: input.requiresGreeks,
        ttlMs: null,
      },
      (payload) => {
        this.handleSnapshot(input.key, payload);
      },
    );
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
    if (!runtime || runtime.processing) {
      return;
    }
    runtime.processing = true;
    try {
      while (this.runtimes.has(key)) {
        const active = this.runtimes.get(key);
        const quote = active?.pendingQuote ?? null;
        if (!active || !quote) {
          break;
        }
        active.pendingQuote = null;
        const result = await this.manageQuote({
          deployment: active.deployment,
          profile: active.profile,
          position: active.position,
          quote,
          pyrusSignalsSettings: active.pyrusSignalsSettings,
          recentEvents: active.recentEvents,
          now: this.now(),
        });
        if (result.position) {
          active.position = result.position;
        }
        if (result.exited) {
          this.releaseRuntime(key);
          break;
        }
      }
    } catch (error) {
      this.logger.warn?.(
        { err: error, key },
        "Signal-options position tick quote management failed",
      );
    } finally {
      const active = this.runtimes.get(key);
      if (active) {
        active.processing = false;
        if (active.pendingQuote) {
          void this.drainQuoteQueue(key);
        }
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
