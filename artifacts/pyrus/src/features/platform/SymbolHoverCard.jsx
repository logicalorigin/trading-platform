/**
 * SymbolHoverCard — hover-intent wrapper that floats a SymbolIntelPanel next
 * to any ticker text (Workstream B3 pilot, watchlist-only adoption).
 *
 * Built on Radix HoverCard (via the `radix-ui` meta package, same wiring
 * family as components/ui/popover.tsx / tooltip.tsx): ~280ms open intent,
 * interactive content that stays open while the pointer is inside it,
 * focus-opens for keyboard users, Esc dismisses, collision-aware
 * positioning. The trigger is rendered via `asChild`, so the caller's
 * element is reused unchanged (zero layout change) — pass a focusable
 * child (tabIndex={0}) so keyboard focus can open the card.
 *
 * The panel (and its lightweight-charts dependency) is code-split and only
 * mounted while the card is open — virtualized/long tables never pay for
 * closed cards.
 *
 * TODO(symbol-intel-pilot): touch fallback (tap → BottomSheet) lands with
 * the app-wide B3 sweep; the pilot targets the desktop watchlist sidebar.
 */
import { Suspense, lazy } from "react";
import { HoverCard } from "radix-ui";
import { ChartSkeleton } from "../../components/platform/primitives.jsx";
import { ELEVATION, dim } from "../../lib/uiTokens.jsx";

const LazySymbolIntelPanel = lazy(() =>
  import("./SymbolIntelPanel.jsx").then((module) => ({
    default: module.SymbolIntelPanel,
  })),
);

const HOVER_OPEN_DELAY_MS = 280;
const HOVER_CLOSE_DELAY_MS = 200;
const CARD_WIDTH = 360;

export const SymbolHoverCard = ({ symbol, onTrade, onResearch, children }) => (
  <HoverCard.Root openDelay={HOVER_OPEN_DELAY_MS} closeDelay={HOVER_CLOSE_DELAY_MS}>
    <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
    <HoverCard.Portal>
      <HoverCard.Content
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        data-testid="symbol-hover-card"
        style={{
          zIndex: 1000,
          width: dim(CARD_WIDTH),
          maxWidth: "min(94vw, 400px)",
          maxHeight: "var(--radix-hover-card-content-available-height)",
          overflowY: "auto",
          outline: "none",
          boxShadow: ELEVATION.lg,
        }}
      >
        <Suspense fallback={<ChartSkeleton height={220} />}>
          <LazySymbolIntelPanel
            symbol={symbol}
            onTrade={onTrade}
            onResearch={onResearch}
          />
        </Suspense>
      </HoverCard.Content>
    </HoverCard.Portal>
  </HoverCard.Root>
);

export default SymbolHoverCard;
