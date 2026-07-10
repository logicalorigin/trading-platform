/**
 * The 2D SVG Pyrus mark - the canonical, dependency-free brand mark used across
 * the site (nav, loaders, and signed-out surfaces).
 *
 * Geometry + gradient come from src/lib/pyrus-mark-geometry.ts so the SVG and 3D
 * mark stays aligned with the neural logo target.
 */
import {
  MarkDefs,
  useMarkIds,
} from "@/components/marketing/pyrus-mark-shared";
import {
  MARK_CENTER,
  MARK_VIEWBOX,
  RIM_DOTS,
  RING_SPECS,
  rimDotPositions,
} from "@/lib/pyrus-mark-geometry";
import { cn } from "@/lib/utils";

export function PyrusMark({
  className,
  title = "",
  // Glow blur, in viewBox units - it scales WITH the mark, so a large render
  // (e.g. the hero animation's h-72) needs a tighter glow or the fine dotted
  // rings fuzz out. Defaults match the small nav/footer mark.
  haloBlur = 0.5,
  bloomBlur = 2,
}: {
  className?: string;
  title?: string;
  haloBlur?: number;
  bloomBlur?: number;
}) {
  const { gradientId, filterId } = useMarkIds();
  const stroke = `url(#${gradientId})`;

  // Geometry comes from the shared source of truth so the 2D and 3D marks stay
  // in parity. RING_SPECS is outermost-first; stroke order is immaterial because
  // no element overlaps another.
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      fill="none"
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      className={cn("h-10 w-10", className)}
      role={title ? "img" : undefined}
    >
      <MarkDefs
        gradientId={gradientId}
        filterId={filterId}
        haloBlur={haloBlur}
        bloomBlur={bloomBlur}
      />

      <g filter={`url(#${filterId})`}>
        <g
          id="ring-07-particles"
          fill={stroke}
        >
          {rimDotPositions().map((d, i) => (
            <circle key={`rim-${i}`} cx={d.cx} cy={d.cy} r={RIM_DOTS.dotR} />
          ))}
        </g>
        {/* NO data-node rects and NO gauge tick comb: they exist in the source
            SVG's numbers but are invisible in the real artwork render - drawing
            them reads as a different ("wrong") logo. The approved composition is
            the 6 dashed rings + the 72-dot rim, nothing else (matches the
            opener's analytic particle bake, .cap/_genlogopts.mjs). */}
        {RING_SPECS.map((ring) => (
          <circle
            key={ring.id}
            id={ring.id}
            cx={MARK_CENTER}
            cy={MARK_CENTER}
            r={ring.r}
            stroke={stroke}
            strokeOpacity={ring.opacity}
            strokeWidth={ring.strokeWidth}
            strokeDasharray={ring.dash ? `${ring.dash[0]} ${ring.dash[1]}` : undefined}
            strokeLinecap="round"
          />
        ))}

        {/* No center boundary - reference shows fully empty hub. */}
      </g>
    </svg>
  );
}
