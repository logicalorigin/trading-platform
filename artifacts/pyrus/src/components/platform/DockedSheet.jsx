import { useId } from "react";
import { ELEVATION, RADII, T, dim } from "../../lib/uiTokens.jsx";

/**
 * DockedSheet — a persistent, NON-MODAL footer sheet.
 *
 * The collapsed bar is an IN-FLOW footer: it lives as a flex child at the
 * bottom of its parent column and reserves its own height, so it never overlays
 * page content. Tapping it raises the expanded `children` which pop UP from the
 * footer and float OVER the content above (no scrim, nothing behind is blocked).
 *
 * The `children` are EAGERLY mounted (kept clipped/hidden while collapsed), so
 * the body — e.g. the order ticket — is fully preloaded at page load and the
 * expand reveals it instantly with no wait. It's hidden via maxHeight:0 +
 * overflow:hidden + opacity:0, so the loading state is never visible on the page.
 */
export const DockedSheet = ({
  expanded = false,
  collapsedBar,
  children,
  title = "Sheet",
  maxHeight = "72dvh",
  collapsedHeight = 48,
  width = "100%",
  align = "stretch",
  testId = "platform-docked-sheet",
}) => {
  const bodyId = useId();

  return (
    <div
      data-testid={testId}
      data-expanded={expanded ? "true" : "false"}
      role="region"
      aria-label={title}
      style={{
        position: "relative",
        flexShrink: 0,
        width,
        alignSelf: align,
        zIndex: 40,
        fontFamily: T.sans,
      }}
    >
      {/* Expanded body — eagerly mounted (so the ticket is preloaded) but
          clipped/hidden while collapsed; floats up over the content on expand. */}
      <div
        id={bodyId}
        aria-hidden={expanded ? undefined : "true"}
        style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          right: 0,
          maxHeight: expanded ? maxHeight : 0,
          opacity: expanded ? 1 : 0,
          transform: expanded ? "translateY(0)" : "translateY(8px)",
          pointerEvents: expanded ? "auto" : "none",
          overflow: "hidden",
          transition:
            "max-height var(--ra-motion-standard) ease, opacity var(--ra-motion-standard) ease, transform var(--ra-motion-standard) ease",
          background: "var(--ra-surface-0)",
          color: "var(--ra-text-primary)",
          border: "1px solid var(--ra-border-default)",
          borderBottom: "none",
          borderTopLeftRadius: dim(RADII.lg),
          borderTopRightRadius: dim(RADII.lg),
          boxShadow: ELEVATION.lg,
        }}
      >
        <div
          className="ra-hide-scrollbar"
          style={{
            maxHeight,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {children}
        </div>
      </div>

      {/* Footer bar — always visible, in-flow, reserves its own height. The bar
          owns its interaction (expand affordance + BUY/SELL pills), so this
          wrapper is a plain container, not a nested button. */}
      <div
        style={{
          minHeight: dim(collapsedHeight),
          display: "flex",
          alignItems: "stretch",
          width: "100%",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          background: "var(--ra-surface-0)",
          color: "var(--ra-text-primary)",
          borderTop: "1px solid var(--ra-border-default)",
        }}
      >
        {collapsedBar}
      </div>
    </div>
  );
};

export default DockedSheet;
