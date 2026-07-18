import { useEffect } from "react";
import { createPortal } from "react-dom";

// @ts-expect-error JSX module imported into TypeScript context
import { Button } from "../../components/ui/Button.jsx";
import "./onboardingPresentation.css";

export type OnboardingTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type OnboardingGuideProps = {
  goalLabel: string;
  stepIndex: number;
  totalSteps: number;
  title: string;
  body: string;
  targetLabel?: string | null;
  targetRect?: OnboardingTargetRect | null;
  placement?: "top" | "bottom";
  statusMessage?: string | null;
  statusTone?: "neutral" | "warning" | "danger" | "ready";
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  onRetry?: () => void;
  onPause: () => void;
  onOpenGoals: () => void;
};

export function OnboardingGuide({
  goalLabel,
  stepIndex,
  totalSteps,
  title,
  body,
  targetLabel = null,
  targetRect = null,
  placement = "bottom",
  statusMessage = null,
  statusTone = "neutral",
  primaryLabel,
  primaryDisabled = false,
  onPrimary,
  onRetry,
  onPause,
  onOpenGoals,
}: OnboardingGuideProps) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onPause();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onPause]);

  if (typeof document === "undefined") return null;
  const titleId = `onboarding-guide-${stepIndex}-title`;

  return createPortal(
    <>
      {targetRect ? (
        <div
          className="onboarding-target-outline"
          aria-hidden="true"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
        >
          <span>Current step</span>
        </div>
      ) : null}
      <section
        className="onboarding-guide"
        data-placement={placement}
        role="region"
        aria-labelledby={titleId}
      >
        <header className="onboarding-guide-header">
          <div>
            <span className="onboarding-eyebrow">{goalLabel}</span>
            <span className="onboarding-guide-progress">
              Step {stepIndex} of {totalSteps}
            </span>
          </div>
          <div className="onboarding-guide-utility-actions">
            <button type="button" onClick={onOpenGoals}>
              Goals
            </button>
            <button type="button" onClick={onPause}>
              Pause
            </button>
          </div>
        </header>
        <div className="onboarding-guide-body">
          <h2 id={titleId}>{title}</h2>
          <p>{body}</p>
          {targetLabel ? (
            <p className="onboarding-guide-target">
              Target <strong>{targetLabel}</strong>
            </p>
          ) : null}
          {statusMessage ? (
            <div
              className="onboarding-guide-status"
              data-tone={statusTone}
              role="status"
              aria-live="polite"
            >
              {statusMessage}
            </div>
          ) : null}
        </div>
        <footer className="onboarding-guide-actions">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            disabled={primaryDisabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        </footer>
      </section>
    </>,
    document.body,
  );
}
