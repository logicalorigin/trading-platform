import { useRef } from "react";

// @ts-expect-error JSX module imported into TypeScript context
import { StatusPill } from "../../components/platform/primitives.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { Button } from "../../components/ui/Button.jsx";
// @ts-expect-error JSX module imported into TypeScript context
import { CSS_COLOR } from "../../lib/uiTokens.jsx";
import {
  OnboardingSurface,
  type OnboardingPresentation,
} from "./OnboardingSurface";
import type {
  OnboardingStatusTone,
} from "./OnboardingGoalPicker";

export type SafetyReadinessFact = {
  id: string;
  label: "Data" | "Provider" | "Account" | string;
  status: string;
  tone: OnboardingStatusTone;
};

export type SafetyReadinessState =
  | "loading"
  | "ready"
  | "setup-needed"
  | "stale"
  | "error";

export type SafetyEssentialsProps = {
  open: boolean;
  step: 1 | 2 | 3;
  readinessFacts: readonly SafetyReadinessFact[];
  readinessState: SafetyReadinessState;
  completed?: boolean;
  onAdvance: () => void;
  onBack: () => void;
  onFinish: () => void;
  onRetryReadiness?: () => void;
  onChooseGoal: () => void;
  onClose: () => void;
  presentation?: OnboardingPresentation;
};

const toneColor = (tone: OnboardingStatusTone) => {
  switch (tone) {
    case "accent":
      return CSS_COLOR.accent;
    case "ready":
      return CSS_COLOR.green;
    case "warning":
      return CSS_COLOR.amber;
    case "danger":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.textMuted;
  }
};

export function SafetyEssentials({
  open,
  step,
  readinessFacts,
  readinessState,
  completed = false,
  onAdvance,
  onBack,
  onFinish,
  onRetryReadiness,
  onChooseGoal,
  onClose,
  presentation = "auto",
}: SafetyEssentialsProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const readinessMessage =
    readinessState === "error"
      ? "Current readiness is unavailable. Retry, or finish with the state shown."
      : readinessState === "setup-needed"
        ? "Account setup needed. Connect Account remains available after essentials are complete."
        : null;

  return (
    <OnboardingSurface
      open={open}
      title="Safety essentials"
      description="Review three operating boundaries before starting an optional walkthrough. The workspace remains available."
      closeLabel="Close and pause Getting Started"
      onClose={onClose}
      initialFocusRef={primaryActionRef}
      presentation={presentation}
      testId="onboarding-safety-essentials"
    >
      {completed ? (
        <section
          className="onboarding-safety-complete"
          aria-labelledby="onboarding-safety-complete-title"
        >
          <span className="onboarding-eyebrow">GETTING STARTED</span>
          <h2 id="onboarding-safety-complete-title">Essentials complete</h2>
          <p>
            Optional walkthroughs are available. Workspace access and execution
            gates are unchanged.
          </p>
          <div className="onboarding-safety-actions">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              ref={primaryActionRef}
              variant="primary"
              onClick={onChooseGoal}
            >
              Choose a goal
            </Button>
          </div>
        </section>
      ) : (
        <section
          className="onboarding-safety"
          aria-labelledby="onboarding-safety-step-title"
        >
          <div className="onboarding-safety-progress">
            <span className="onboarding-eyebrow">GETTING STARTED</span>
            <span>Step {step} of 3</span>
          </div>

          {step === 1 ? (
            <div className="onboarding-safety-step">
              <div className="onboarding-safety-step-copy">
                <h2 id="onboarding-safety-step-title">Live and Shadow</h2>
                <p>
                  Verify the execution environment before every order review.
                </p>
              </div>
              <dl
                className="onboarding-environment-ledger"
                aria-label="Execution environment comparison"
              >
                <div data-environment="live">
                  <dt>LIVE / REAL</dt>
                  <dd>
                    Can route real orders through the selected broker account.
                  </dd>
                </div>
                <div data-environment="shadow">
                  <dt>SHADOW</dt>
                  <dd>
                    {
                      "Simulated execution in PYRUS’s internal ledger. No live broker order is created."
                    }
                  </dd>
                </div>
              </dl>
              <div className="onboarding-safety-actions">
                <Button
                  ref={primaryActionRef}
                  variant="primary"
                  onClick={onAdvance}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-safety-step">
              <div className="onboarding-safety-step-copy">
                <h2 id="onboarding-safety-step-title">
                  Onboarding has no execution access
                </h2>
                <p>
                  {
                    "Onboarding never submits. Live execution remains in Trade and still requires PYRUS review and confirmation."
                  }
                </p>
              </div>
              <p className="onboarding-boundary-note">
                No walkthrough changes an order or bypasses an execution gate.
              </p>
              <div className="onboarding-safety-actions">
                <Button variant="secondary" onClick={onBack}>
                  Back
                </Button>
                <Button
                  ref={primaryActionRef}
                  variant="primary"
                  onClick={onAdvance}
                >
                  I understand the boundary
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onboarding-safety-step">
              <div className="onboarding-safety-step-copy">
                <h2 id="onboarding-safety-step-title">
                  Inspect current readiness
                </h2>
                <p>
                  Readiness comes from current system state, not walkthrough
                  progress. Setup-needed, stale, or unavailable states do not
                  block the workspace.
                </p>
              </div>
              <div
                className="onboarding-safety-readiness"
                role="status"
                aria-live="polite"
                aria-busy={readinessState === "loading"}
              >
                <dl>
                  {readinessFacts.map((fact) => (
                    <div key={fact.id}>
                      <dt>{fact.label}</dt>
                      <dd>
                        <StatusPill
                          color={toneColor(fact.tone)}
                          variant="ghost"
                        >
                          {fact.status}
                        </StatusPill>
                      </dd>
                    </div>
                  ))}
                </dl>
                {readinessMessage ? (
                  <p
                    className="onboarding-readiness-message"
                    data-tone={
                      readinessState === "error" ? "danger" : "warning"
                    }
                  >
                    {readinessMessage}
                  </p>
                ) : null}
                <p className="onboarding-readiness-note">
                  Not ready does not fail this review.
                </p>
              </div>
              <div className="onboarding-safety-actions">
                <Button variant="secondary" onClick={onBack}>
                  Back
                </Button>
                {readinessState === "error" && onRetryReadiness ? (
                  <Button
                    variant="secondary"
                    onClick={onRetryReadiness}
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  ref={primaryActionRef}
                  variant="primary"
                  aria-disabled={readinessState === "loading"}
                  onClick={
                    readinessState === "loading" ? undefined : onFinish
                  }
                >
                  {readinessState === "loading"
                    ? "Checking readiness…"
                    : "Finish essentials"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </OnboardingSurface>
  );
}
