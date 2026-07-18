import {
  getGetBrokerExecutionIncludedAccountsQueryKey,
  useGetBrokerExecutionIncludedAccounts,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ONBOARDING_CATALOG,
  ONBOARDING_CATALOG_VERSION,
  type OnboardingCatalogStep,
} from "./onboardingCatalog";
import {
  findCurrentOnboardingStep,
  buildGoalPresentations,
  buildReadinessPresentations,
  onboardingEssentialsComplete,
  selectConnectAccountAction,
  type AccountObservationState,
} from "./onboardingHostModel";
import {
  normalizeOnboardingProgress,
  reduceOnboardingProgress,
  shouldAutoOpenOnboarding,
  type OnboardingProgress,
  type OnboardingProgressAction,
} from "./onboardingModel";
import {
  deriveConnectAccountReadiness,
  type ConnectAccountReadiness,
} from "./onboardingRuntimeFacts";
import {
  OnboardingGoalPicker,
  type OnboardingReadinessPresentation,
} from "./OnboardingGoalPicker";
import {
  OnboardingGuide,
  type OnboardingTargetRect,
} from "./OnboardingGuide";
import {
  SafetyEssentials,
  type SafetyReadinessState,
} from "./SafetyEssentials";

type PreferenceRemoteStatus = "idle" | "loading" | "confirmed" | "failed";
type PreferenceStorageStatus = "none" | "stored" | "failed";

export type OnboardingHostProps = {
  requestedOpen: boolean;
  onRequestedOpenChange: (open: boolean) => void;
  activeScreen: string;
  onNavigate: (screenId: string) => void;
  userId: string | null;
  workspaceReady: boolean;
  sessionState: "loading" | "ready" | "error";
  dataConfigured: boolean;
  progress: OnboardingProgress;
  remoteStatus: PreferenceRemoteStatus;
  preferenceSaving: boolean;
  preferenceError: string | null;
  preferenceStorageStatus: PreferenceStorageStatus;
  onPersistProgress: (progress: OnboardingProgress) => Promise<void> | void;
  onReloadPreferences?: () => Promise<void> | void;
};

type TargetSnapshot = {
  status: "inactive" | "missing" | "loading" | "empty" | "error" | "stale" | "ready";
  rect: OnboardingTargetRect | null;
  selected: boolean;
  placement: "top" | "bottom";
};

const EMPTY_TARGET: TargetSnapshot = {
  status: "inactive",
  rect: null,
  selected: false,
  placement: "bottom",
};

const sameTarget = (left: TargetSnapshot, right: TargetSnapshot): boolean =>
  left.status === right.status &&
  left.selected === right.selected &&
  left.placement === right.placement &&
  left.rect?.top === right.rect?.top &&
  left.rect?.left === right.rect?.left &&
  left.rect?.width === right.rect?.width &&
  left.rect?.height === right.rect?.height;

const useOnboardingTarget = (
  currentStep: OnboardingCatalogStep | null,
  activeScreen: string,
  enabled: boolean,
  retryEpoch: number,
): TargetSnapshot => {
  const [target, setTarget] = useState<TargetSnapshot>(EMPTY_TARGET);

  useEffect(() => {
    if (
      !enabled ||
      !currentStep?.screenId ||
      !currentStep.anchorId ||
      currentStep.screenId !== activeScreen ||
      typeof document === "undefined"
    ) {
      setTarget((current) =>
        sameTarget(current, EMPTY_TARGET) ? current : EMPTY_TARGET,
      );
      return undefined;
    }

    const publish = (next: TargetSnapshot) => {
      setTarget((current) => (sameTarget(current, next) ? current : next));
    };
    let scrolledIntoView = false;
    const measure = () => {
      const screenHost = document.querySelector(
        `[data-testid="screen-host-${currentStep.screenId}"]`,
      );
      if (
        !(screenHost instanceof HTMLElement) ||
        screenHost.getAttribute("aria-hidden") === "true"
      ) {
        publish({ ...EMPTY_TARGET, status: "missing" });
        return;
      }
      const candidates = Array.from(
        screenHost.querySelectorAll(
          `[data-onboarding-anchor="${currentStep.anchorId}"]`,
        ),
      );
      if (candidates.length !== 1) {
        publish({ ...EMPTY_TARGET, status: "missing" });
        return;
      }
      const element = candidates[0];
      if (
        !(element instanceof HTMLElement) ||
        !element.isConnected ||
        element.closest('[aria-hidden="true"], [inert]')
      ) {
        publish({ ...EMPTY_TARGET, status: "missing" });
        return;
      }
      const elementStyle = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        elementStyle.display === "none" ||
        elementStyle.visibility === "hidden" ||
        elementStyle.opacity === "0" ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        publish({ ...EMPTY_TARGET, status: "missing" });
        return;
      }
      const outsideViewport =
        bounds.left < 4 ||
        bounds.top < 4 ||
        bounds.right > window.innerWidth - 4 ||
        bounds.bottom > window.innerHeight - 4;
      if (outsideViewport) {
        if (!scrolledIntoView) {
          scrolledIntoView = true;
          element.scrollIntoView({
            behavior: "auto",
            block: "nearest",
            inline: "center",
          });
        } else {
          publish({ ...EMPTY_TARGET, status: "missing" });
        }
        return;
      }
      const declaredState = element.getAttribute("data-onboarding-state");
      if (
        declaredState === "loading" ||
        declaredState === "empty" ||
        declaredState === "error" ||
        declaredState === "stale"
      ) {
        publish({
          ...EMPTY_TARGET,
          status: declaredState,
          selected: element.getAttribute("aria-pressed") === "true",
        });
        return;
      }
      if (declaredState !== "ready") {
        publish({ ...EMPTY_TARGET, status: "missing" });
        return;
      }

      const left = Math.max(4, bounds.left - 4);
      const top = Math.max(4, bounds.top - 4);
      const right = Math.min(window.innerWidth - 4, bounds.right + 4);
      const bottom = Math.min(window.innerHeight - 4, bounds.bottom + 4);
      publish({
        status: "ready",
        selected: element.getAttribute("aria-pressed") === "true",
        placement: bounds.top + bounds.height / 2 > window.innerHeight / 2
          ? "top"
          : "bottom",
        rect: {
          top,
          left,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        },
      });
    };

    measure();
    const interval = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : null;
    const host = document.querySelector(
      `[data-testid="screen-host-${currentStep.screenId}"]`,
    );
    if (host instanceof HTMLElement) resizeObserver?.observe(host);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      resizeObserver?.disconnect();
    };
  }, [
    activeScreen,
    currentStep?.anchorId,
    currentStep?.screenId,
    enabled,
    retryEpoch,
  ]);

  return target;
};

const BLOCKING_OVERLAY_SELECTOR =
  'dialog[open], [role="dialog"]';

const useBlockingOverlayPresent = (): boolean => {
  const readCurrent = () =>
    typeof document !== "undefined" &&
    Boolean(document.querySelector(BLOCKING_OVERLAY_SELECTOR));
  const [present, setPresent] = useState(readCurrent);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const publish = () => {
      const next = readCurrent();
      setPresent((current) => (current === next ? current : next));
    };
    publish();
    if (typeof MutationObserver !== "function") return undefined;
    const observer = new MutationObserver(publish);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-modal", "data-state", "open", "role"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return present;
};

const syncLabel = (
  remoteStatus: PreferenceRemoteStatus,
  saving: boolean,
  error: string | null,
  preferenceStorageStatus: PreferenceStorageStatus,
): string => {
  if (saving) return "Syncing progress";
  if (error && preferenceStorageStatus === "failed") return "Not saved";
  if (error) return "Sync pending";
  if (remoteStatus === "confirmed") return "Progress synced";
  if (remoteStatus === "failed") return "Remote progress unavailable";
  return "Checking progress";
};

const targetLabelFor = (stepId: string): string => {
  if (stepId === "open-settings") return "Data & Broker";
  if (stepId === "choose-provider") return "Broker target";
  return "Broker accounts";
};

export function OnboardingHost({
  requestedOpen,
  onRequestedOpenChange,
  activeScreen,
  onNavigate,
  userId,
  workspaceReady,
  sessionState,
  dataConfigured,
  progress,
  remoteStatus,
  preferenceSaving,
  preferenceError,
  preferenceStorageStatus,
  onPersistProgress,
  onReloadPreferences,
}: OnboardingHostProps) {
  const queryClient = useQueryClient();
  const blockingOverlayPresent = useBlockingOverlayPresent();
  const normalizedProgress = useMemo(
    () => normalizeOnboardingProgress(progress),
    [progress],
  );
  const activeTrackId = normalizedProgress.activeTrackId;
  const currentStep = useMemo(
    () => findCurrentOnboardingStep(normalizedProgress),
    [normalizedProgress],
  );
  const factsRequested = Boolean(
    userId &&
      workspaceReady &&
      (requestedOpen ||
        activeTrackId === "safety" ||
        activeTrackId === "connect-account"),
  );
  const [queryIdentity, setQueryIdentity] = useState<string | null>(null);
  const attachedQueryIdentityRef = useRef<string | null | undefined>(undefined);
  const includedAccountsQueryKey = useMemo(
    () => getGetBrokerExecutionIncludedAccountsQueryKey(),
    [],
  );

  useEffect(() => {
    if (attachedQueryIdentityRef.current === userId) return undefined;
    attachedQueryIdentityRef.current = userId;
    setQueryIdentity(null);
    let cancelled = false;
    void queryClient
      .cancelQueries({ queryKey: includedAccountsQueryKey, exact: true })
      .finally(() => {
        if (attachedQueryIdentityRef.current !== userId) return;
        queryClient.removeQueries({
          queryKey: includedAccountsQueryKey,
          exact: true,
        });
        if (!cancelled) setQueryIdentity(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [includedAccountsQueryKey, queryClient, userId]);

  const queryIdentityReady = Boolean(userId && queryIdentity === userId);
  const inclusionQuery = useGetBrokerExecutionIncludedAccounts({
    query: {
      queryKey: includedAccountsQueryKey,
      enabled: factsRequested && queryIdentityReady,
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  });
  const accountState: AccountObservationState =
    !queryIdentityReady || (inclusionQuery.isLoading && !inclusionQuery.data)
      ? "loading"
      : inclusionQuery.isError && !inclusionQuery.data
        ? "error"
        : inclusionQuery.isStale
          ? "stale"
          : "ready";
  const connectReadiness = useMemo<ConnectAccountReadiness>(
    () =>
      deriveConnectAccountReadiness(
        accountState === "ready" ? inclusionQuery.data : undefined,
      ),
    [accountState, inclusionQuery.data],
  );
  const readiness = useMemo<OnboardingReadinessPresentation[]>(
    () =>
      buildReadinessPresentations({
        sessionState,
        dataConfigured,
        accountState,
        connectReadiness,
      }),
    [accountState, connectReadiness, dataConfigured, sessionState],
  );
  const goals = useMemo(
    () =>
      buildGoalPresentations(
        normalizedProgress,
        connectReadiness,
        accountState,
      ),
    [accountState, connectReadiness, normalizedProgress],
  );
  const essentialsComplete = onboardingEssentialsComplete(normalizedProgress);

  const persistAction = useCallback(
    (action: OnboardingProgressAction): OnboardingProgress => {
      const next = reduceOnboardingProgress(normalizedProgress, action);
      void onPersistProgress(next);
      return next;
    },
    [normalizedProgress, onPersistProgress],
  );

  const autoOpenIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !userId ||
      !workspaceReady ||
      blockingOverlayPresent ||
      remoteStatus !== "confirmed" ||
      !shouldAutoOpenOnboarding(normalizedProgress)
    ) {
      return;
    }
    const identityVersion = `${userId}:${ONBOARDING_CATALOG_VERSION}`;
    if (autoOpenIdentityRef.current === identityVersion) return;
    autoOpenIdentityRef.current = identityVersion;
    onRequestedOpenChange(true);
    void onPersistProgress(
      reduceOnboardingProgress(normalizedProgress, {
        type: "mark-auto-open-shown",
      }),
    );
  }, [
    blockingOverlayPresent,
    normalizedProgress,
    onPersistProgress,
    onRequestedOpenChange,
    remoteStatus,
    userId,
    workspaceReady,
  ]);

  useEffect(() => {
    if (
      activeTrackId &&
      activeTrackId !== "safety" &&
      activeTrackId !== "connect-account"
    ) {
      persistAction({
        type: "pause-active-track",
        trackId: activeTrackId,
      });
    }
  }, [activeTrackId, persistAction]);

  const closeAndPause = useCallback(() => {
    if (activeTrackId) {
      persistAction({
        type: "pause-active-track",
        trackId: activeTrackId,
      });
    }
    onRequestedOpenChange(false);
  }, [activeTrackId, onRequestedOpenChange, persistAction]);

  const reviewEssentials = useCallback(() => {
    persistAction({ type: "activate-track", trackId: "safety" });
    onRequestedOpenChange(false);
  }, [onRequestedOpenChange, persistAction]);

  const selectGoal = useCallback(
    (goalId: string) => {
      if (goalId !== "connect-account") return;
      const selectedGoal = goals.find((goal) => goal.id === goalId);
      if (selectedGoal?.retryable) {
        void inclusionQuery.refetch();
        return;
      }
      const action = selectConnectAccountAction(
        normalizedProgress,
        accountState,
        connectReadiness,
      );
      if (!action) return;
      persistAction(action);
      onRequestedOpenChange(false);
    },
    [
      accountState,
      connectReadiness,
      goals,
      inclusionQuery.refetch,
      normalizedProgress,
      onRequestedOpenChange,
      persistAction,
    ],
  );

  const [safetyViewStep, setSafetyViewStep] = useState<number | null>(null);
  const safetyTrack = ONBOARDING_CATALOG.tracks.find(
    (track) => track.id === "safety",
  );
  const actualSafetyStep =
    activeTrackId === "safety" && currentStep && safetyTrack
      ? safetyTrack.steps.findIndex((step) => step.id === currentStep.id) + 1
      : 1;
  const displayedSafetyStep = Math.max(
    1,
    Math.min(3, safetyViewStep ?? actualSafetyStep),
  ) as 1 | 2 | 3;
  useEffect(() => {
    setSafetyViewStep(null);
  }, [activeTrackId, currentStep?.id]);

  const completeManualStep = useCallback(() => {
    if (
      !activeTrackId ||
      !currentStep ||
      currentStep.completionOwner !== "manual"
    ) {
      return;
    }
    persistAction({
      type: "complete-current-step",
      trackId: activeTrackId,
      stepId: currentStep.id,
      owner: "manual",
      completedAt: new Date().toISOString(),
    });
  }, [activeTrackId, currentStep, persistAction]);

  const advanceSafety = useCallback(() => {
    if (displayedSafetyStep < actualSafetyStep) {
      setSafetyViewStep(displayedSafetyStep + 1);
      return;
    }
    completeManualStep();
  }, [actualSafetyStep, completeManualStep, displayedSafetyStep]);

  const finishSafety = useCallback(() => {
    if (displayedSafetyStep !== 3 || actualSafetyStep !== 3) return;
    completeManualStep();
    onRequestedOpenChange(true);
  }, [
    actualSafetyStep,
    completeManualStep,
    displayedSafetyStep,
    onRequestedOpenChange,
  ]);

  const [targetRetryEpoch, setTargetRetryEpoch] = useState(0);
  const guideVisible = Boolean(
    userId &&
      workspaceReady &&
      activeTrackId === "connect-account" &&
      currentStep &&
      !blockingOverlayPresent &&
      !requestedOpen,
  );
  const target = useOnboardingTarget(
    activeTrackId === "connect-account" ? currentStep : null,
    activeScreen,
    guideVisible,
    targetRetryEpoch,
  );

  const runtimeCompletionRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      activeTrackId !== "connect-account" ||
      currentStep?.id !== "verify-readiness"
    ) {
      runtimeCompletionRef.current = null;
    }
  }, [activeTrackId, currentStep?.id]);
  useEffect(() => {
    if (
      activeTrackId !== "connect-account" ||
      currentStep?.id !== "verify-readiness" ||
      currentStep.completionOwner !== "runtime" ||
      currentStep.completionKey !== "account.connection-verified" ||
      accountState !== "ready" ||
      !guideVisible ||
      currentStep.screenId !== activeScreen ||
      target.status !== "ready" ||
      !connectReadiness.satisfied
    ) {
      return;
    }
    const completionAttempt = `${userId}:${currentStep.id}:${inclusionQuery.dataUpdatedAt}`;
    if (runtimeCompletionRef.current === completionAttempt) return;
    runtimeCompletionRef.current = completionAttempt;
    persistAction({
      type: "complete-current-step",
      trackId: "connect-account",
      stepId: currentStep.id,
      owner: "runtime",
      evidenceKey: "account.connection-verified",
      completedAt: new Date().toISOString(),
    });
    onRequestedOpenChange(true);
  }, [
    accountState,
    activeScreen,
    activeTrackId,
    connectReadiness.satisfied,
    currentStep,
    guideVisible,
    inclusionQuery.dataUpdatedAt,
    onRequestedOpenChange,
    persistAction,
    target.status,
    userId,
  ]);

  let primaryLabel = "Continue";
  let primaryDisabled = false;
  let primaryAction = completeManualStep;
  let guideStatus: string | null = null;
  let guideStatusTone: "neutral" | "warning" | "danger" | "ready" =
    "neutral";
  let retryTarget: (() => void) | undefined;

  if (currentStep?.screenId && currentStep.screenId !== activeScreen) {
    primaryLabel = `Open ${
      currentStep.screenId === "settings"
        ? "Settings"
        : currentStep.screenId
    }`;
    primaryAction = () => onNavigate(currentStep.screenId!);
    guideStatus = "The walkthrough will wait for the requested workspace.";
  } else if (currentStep?.id === "open-settings") {
    if (target.status !== "ready") {
      primaryLabel = "Waiting for Data & Broker";
      primaryDisabled = true;
      guideStatus = "The Data & Broker tab is not ready yet.";
      guideStatusTone = target.status === "error" ? "danger" : "warning";
      retryTarget = () => setTargetRetryEpoch((current) => current + 1);
    } else if (!target.selected) {
      primaryLabel = "Select Data & Broker";
      primaryDisabled = true;
      guideStatus = "Select the highlighted Data & Broker tab.";
    } else {
      primaryLabel = "Continue with Data & Broker";
      guideStatus = "Data & Broker is open.";
      guideStatusTone = "ready";
    }
  } else if (currentStep?.id === "choose-provider") {
    if (target.status !== "ready") {
      primaryLabel = "Waiting for provider controls";
      primaryDisabled = true;
      guideStatus = "Provider controls are not ready yet.";
      guideStatusTone = target.status === "error" ? "danger" : "warning";
      retryTarget = () => setTargetRetryEpoch((current) => current + 1);
    } else {
      primaryLabel = "Continue with current selection";
      guideStatus =
        "Use the production controls if you need a different provider. This walkthrough will not activate them.";
    }
  } else if (currentStep?.id === "verify-readiness") {
    primaryLabel = inclusionQuery.isFetching
      ? "Checking connection…"
      : "Refresh connection";
    primaryDisabled = inclusionQuery.isFetching;
    primaryAction = () => {
      void inclusionQuery.refetch();
    };
    if (accountState === "error") {
      guideStatus = "Connection status is unavailable. Retry when convenient.";
      guideStatusTone = "danger";
    } else if (accountState === "stale") {
      guideStatus = "Connection status is stale. Refresh before completion.";
      guideStatusTone = "warning";
    } else if (connectReadiness.accountCount === 0) {
      guideStatus =
        "Connect and sync at least one account, then refresh this check.";
      guideStatusTone = "warning";
    } else if (connectReadiness.verifiedAccountCount === 0) {
      guideStatus =
        "No current account has a verified broker connection yet. Follow the production connection status, then refresh.";
      guideStatusTone = "warning";
    } else {
      guideStatus = "Account connection verified. Completing the walkthrough.";
      guideStatusTone = "ready";
    }
  }

  const readinessState: SafetyReadinessState =
    sessionState === "loading" || accountState === "loading"
      ? "loading"
      : sessionState === "error" || accountState === "error"
        ? "error"
        : accountState === "stale"
          ? "stale"
          : connectReadiness.satisfied && dataConfigured
            ? "ready"
            : "setup-needed";
  const surfaceAllowed = Boolean(userId && workspaceReady);

  return (
    <>
      <OnboardingGoalPicker
        open={surfaceAllowed && requestedOpen}
        goals={goals}
        readiness={readiness}
        essentialsComplete={essentialsComplete}
        recommendedGoalId="connect-account"
        syncLabel={syncLabel(
          remoteStatus,
          preferenceSaving,
          preferenceError,
          preferenceStorageStatus,
        )}
        loading={remoteStatus === "idle" || remoteStatus === "loading"}
        errorMessage={preferenceError}
        onRetry={() => {
          void onReloadPreferences?.();
          void inclusionQuery.refetch();
        }}
        onClose={closeAndPause}
        onReviewEssentials={reviewEssentials}
        onSelectGoal={selectGoal}
      />
      <SafetyEssentials
        open={
          surfaceAllowed &&
          activeTrackId === "safety" &&
          !requestedOpen
        }
        step={displayedSafetyStep}
        readinessFacts={readiness}
        readinessState={readinessState}
        onAdvance={advanceSafety}
        onBack={() =>
          setSafetyViewStep(Math.max(1, displayedSafetyStep - 1))
        }
        onFinish={finishSafety}
        onRetryReadiness={() => {
          void inclusionQuery.refetch();
        }}
        onChooseGoal={() => onRequestedOpenChange(true)}
        onClose={closeAndPause}
      />
      {guideVisible && currentStep ? (
        <OnboardingGuide
          goalLabel="Connect an account"
          stepIndex={
            ONBOARDING_CATALOG.tracks
              .find((track) => track.id === "connect-account")
              ?.steps.findIndex((step) => step.id === currentStep.id)! + 1
          }
          totalSteps={3}
          title={currentStep.title}
          body={currentStep.body}
          targetLabel={targetLabelFor(currentStep.id)}
          targetRect={target.status === "ready" ? target.rect : null}
          placement={target.placement}
          statusMessage={guideStatus}
          statusTone={guideStatusTone}
          primaryLabel={primaryLabel}
          primaryDisabled={primaryDisabled}
          onPrimary={primaryAction}
          onRetry={retryTarget}
          onPause={closeAndPause}
          onOpenGoals={() => onRequestedOpenChange(true)}
        />
      ) : null}
    </>
  );
}
