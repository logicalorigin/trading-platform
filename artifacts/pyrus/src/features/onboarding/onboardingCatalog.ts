export type OnboardingCompletionOwner = "manual" | "runtime" | "simulation";
export type OnboardingCompletionKey =
  | "account.connection-verified"
  | "simulation.review-reached";
export type OnboardingTargetPolicy = "required" | "optional" | "none";

export type OnboardingCatalogStep = {
  id: string;
  title: string;
  body: string;
  completionOwner: OnboardingCompletionOwner;
  completionKey?: OnboardingCompletionKey;
  screenId?: string;
  anchorId?: string;
  targetPolicy: OnboardingTargetPolicy;
};

export type OnboardingCatalogTrack = {
  id: string;
  version: number;
  required?: boolean;
  label: string;
  description: string;
  completionAnnouncement: string;
  steps: readonly OnboardingCatalogStep[];
};

export const ONBOARDING_CATALOG_VERSION = 1;
export const ONBOARDING_SAFETY_VERSION = 1;

export const ONBOARDING_CATALOG: {
  version: number;
  tracks: readonly OnboardingCatalogTrack[];
} = {
  version: ONBOARDING_CATALOG_VERSION,
  tracks: [
    {
      id: "safety",
      version: ONBOARDING_SAFETY_VERSION,
      required: true,
      label: "Safety essentials",
      description: "Know the execution boundary and inspect current readiness.",
      completionAnnouncement: "Safety essentials complete.",
      steps: [
        {
          id: "environment",
          title: "Know Live and Shadow",
          body: "Live can route real orders. Shadow uses simulated execution.",
          completionOwner: "manual",
          targetPolicy: "none",
        },
        {
          id: "review-boundary",
          title: "Keep review in the loop",
          body:
            "Onboarding never submits. Real execution still requires PYRUS review and confirmation.",
          completionOwner: "manual",
          targetPolicy: "none",
        },
        {
          id: "readiness-inspection",
          title: "Inspect current readiness",
          body:
            "Not ready is a setup state, not a tutorial failure. Current server facts remain authoritative.",
          completionOwner: "manual",
          targetPolicy: "none",
        },
      ],
    },
    {
      id: "connect-account",
      version: 1,
      label: "Connect an account",
      description: "Choose a provider and verify one account connection.",
      completionAnnouncement: "Account connection verified.",
      steps: [
        {
          id: "open-settings",
          title: "Open account setup",
          body: "Open Settings and find Data & Broker.",
          completionOwner: "manual",
          screenId: "settings",
          anchorId: "settings-data-broker-tab",
          targetPolicy: "required",
        },
        {
          id: "choose-provider",
          title: "Choose a provider",
          body:
            "Use the existing provider controls. PYRUS will not connect or sync automatically.",
          completionOwner: "manual",
          screenId: "settings",
          anchorId: "broker-provider-controls",
          targetPolicy: "required",
        },
        {
          id: "verify-readiness",
          title: "Verify the account connection",
          body:
            "At least one current account must have a server-confirmed broker connection.",
          completionOwner: "runtime",
          completionKey: "account.connection-verified",
          screenId: "settings",
          anchorId: "broker-readiness",
          targetPolicy: "required",
        },
      ],
    },
    {
      id: "read-signal",
      version: 1,
      label: "Read a signal",
      description: "Read side, freshness, gates, and thesis.",
      completionAnnouncement: "Signal reading complete.",
      steps: [
        {
          id: "open-signals",
          title: "Open Signals",
          body: "Choose a visible signal row.",
          completionOwner: "manual",
          screenId: "signals",
          anchorId: "signal-list",
          targetPolicy: "required",
        },
        {
          id: "read-evidence",
          title: "Read the evidence",
          body: "Check side, freshness, timeframe agreement, gates, and thesis.",
          completionOwner: "manual",
          screenId: "signals",
          anchorId: "signal-evidence",
          targetPolicy: "required",
        },
      ],
    },
    {
      id: "practice-review",
      version: 1,
      label: "Practice order review",
      description: "Use synthetic fields and stop at a practice-only review.",
      completionAnnouncement: "Practice complete. No order was created.",
      steps: [
        {
          id: "build-practice",
          title: "Build a synthetic order",
          body: "Use only the fixed practice account, asset, and quote.",
          completionOwner: "simulation",
          targetPolicy: "none",
        },
        {
          id: "review-practice",
          title: "Review the synthetic order",
          body: "Nothing will be sent.",
          completionOwner: "simulation",
          completionKey: "simulation.review-reached",
          targetPolicy: "none",
        },
      ],
    },
    {
      id: "manage-risk",
      version: 1,
      label: "Manage position risk",
      description: "Inspect exposure, concentration, and review handoff.",
      completionAnnouncement: "Risk walkthrough complete.",
      steps: [
        {
          id: "open-account",
          title: "Open Account",
          body: "Identify the active account source.",
          completionOwner: "manual",
          screenId: "account",
          anchorId: "account-active-source",
          targetPolicy: "required",
        },
        {
          id: "read-risk",
          title: "Read risk context",
          body: "Inspect exposure, concentration, and position context.",
          completionOwner: "manual",
          screenId: "account",
          anchorId: "account-risk-context",
          targetPolicy: "required",
        },
      ],
    },
  ],
};
