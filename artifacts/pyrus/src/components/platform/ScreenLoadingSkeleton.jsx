import { Skeleton, surfaceStyle } from "./primitives.jsx";
import { dim, sp, RADII } from "../../lib/uiTokens.jsx";

// Lightweight, data-free layout skeleton shown while a screen's code chunk is
// still downloading (the registry loading branch). It imports ONLY the shared
// Skeleton primitive + tokens — never a heavy screen module — so it lives in the
// already-loaded ui-core chunk and can paint immediately, giving the user the
// page's shape (toolbar + panel grid, with chart-axes scaffolds) instead of a
// lone centered spinner while the chunk resolves. Sizes are reserved so the real
// screen replacing it causes minimal layout shift.

const PanelSkeleton = ({ chart = false, rows = 4 }) => (
  <div
    style={{
      ...surfaceStyle({ border: "light" }),
      padding: sp(14),
      display: "flex",
      flexDirection: "column",
      gap: sp(10),
      minHeight: dim(chart ? 220 : 140),
    }}
  >
    <Skeleton width="42%" height={dim(12)} radius={RADII.sm} />
    {chart ? (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-end",
          gap: sp(6),
          minHeight: dim(140),
        }}
      >
        {Array.from({ length: 14 }).map((_, index) => (
          // Deterministic bar heights (no Math.random) so the skeleton is stable
          // across renders.
          <Skeleton
            key={index}
            width="100%"
            height={`${28 + ((index * 37) % 62)}%`}
            radius={RADII.xs}
          />
        ))}
      </div>
    ) : (
      Array.from({ length: rows }).map((_, index) => (
        <Skeleton
          key={index}
          width={`${92 - index * 9}%`}
          height={dim(index === 0 ? 16 : 12)}
          radius={RADII.sm}
        />
      ))
    )}
  </div>
);

const ScreenLoadingSkeleton = ({ label }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      minHeight: dim(240),
      display: "flex",
      flexDirection: "column",
      gap: sp(12),
      padding: sp(12),
      boxSizing: "border-box",
    }}
    aria-label={label ? `Loading ${label}` : undefined}
  >
    {/* toolbar */}
    <div style={{ display: "flex", gap: sp(10), alignItems: "center" }}>
      <Skeleton width={dim(120)} height={dim(22)} radius={RADII.md} />
      <Skeleton width={dim(84)} height={dim(22)} radius={RADII.md} />
      <div style={{ flex: 1 }} />
      <Skeleton width={dim(140)} height={dim(22)} radius={RADII.md} />
    </div>
    {/* panel grid */}
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gridAutoRows: "minmax(160px, auto)",
        gap: sp(12),
      }}
    >
      <PanelSkeleton chart />
      <PanelSkeleton rows={5} />
      <PanelSkeleton rows={4} />
      <PanelSkeleton chart />
    </div>
  </div>
);

export default ScreenLoadingSkeleton;
