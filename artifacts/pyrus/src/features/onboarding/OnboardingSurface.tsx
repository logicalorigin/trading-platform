import { useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

// @ts-expect-error JSX module imported into TypeScript context
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { useViewportBelow } from "../../lib/responsive";
import "./onboardingPresentation.css";

export type OnboardingPresentation = "auto" | "dialog" | "sheet";

type OnboardingSurfaceProps = {
  open: boolean;
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  presentation?: OnboardingPresentation;
  testId?: string;
};

export function OnboardingSurface({
  open,
  title,
  description,
  closeLabel,
  onClose,
  children,
  initialFocusRef,
  presentation = "auto",
  testId = "onboarding-surface",
}: OnboardingSurfaceProps) {
  const viewportIsPhone = useViewportBelow("phone");
  const useSheet =
    presentation === "sheet" ||
    (presentation === "auto" && viewportIsPhone);
  const restoreFocusRef = useRef<Element | null>(null);
  const descriptionId = `${testId}-description`;

  if (useSheet) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={title}
        description={description}
        descriptionId={descriptionId}
        closeLabel={closeLabel}
        initialFocusRef={initialFocusRef}
        maxHeight="84dvh"
        testId={testId}
      >
        {children}
      </BottomSheet>
    );
  }

  if (!open || typeof document === "undefined") return null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className="onboarding-dialog-layer"
          data-testid={`${testId}-backdrop`}
          role="presentation"
        >
          <Dialog.Overlay className="onboarding-dialog-overlay" />
          <Dialog.Content
            className="onboarding-dialog"
            data-testid={testId}
            aria-describedby={descriptionId}
            onOpenAutoFocus={(event) => {
              restoreFocusRef.current = document.activeElement;
              if (initialFocusRef?.current) {
                event.preventDefault();
                initialFocusRef.current.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (restoreFocusRef.current instanceof HTMLElement) {
                restoreFocusRef.current.focus();
              }
            }}
          >
            <header className="onboarding-dialog-header">
              <div className="onboarding-dialog-heading">
                <Dialog.Title className="onboarding-dialog-title">
                  {title}
                </Dialog.Title>
                <Dialog.Description
                  id={descriptionId}
                  className="onboarding-dialog-description"
                >
                  {description}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="onboarding-dialog-close"
                  type="button"
                  aria-label={closeLabel}
                >
                  <X aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </Dialog.Close>
            </header>
            <div className="onboarding-dialog-body">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
