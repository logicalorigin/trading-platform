import { useId } from "react";

/** Per-instance IDs so multiple marks on a page don't share `<defs>`. */
export function useMarkIds() {
  const raw = useId().replace(/:/g, "");
  return {
    gradientId: `pyrus-grad-${raw}`,
    filterId: `pyrus-glow-${raw}`,
  };
}

/** The shared blue→violet→red gradient + per-chip glow filter. The blur picks
 *  up the colored source, so each dash/tick emits in its own region color. */
export function MarkDefs({
  gradientId,
  filterId,
  /** stdDeviation of the inner halo blur, in viewBox units. */
  haloBlur = 0.6,
  /** stdDeviation of the broader bloom blur, in viewBox units. */
  bloomBlur = 2.4,
}: {
  gradientId: string;
  filterId: string;
  haloBlur?: number;
  bloomBlur?: number;
}) {
  return (
    <defs>
      <linearGradient
        id={gradientId}
        x1="6"
        y1="100"
        x2="194"
        y2="100"
        gradientUnits="userSpaceOnUse"
      >
        {/* Reference shows chips fading toward the centerline - analyze→adapt→
            execute symbolism preserved via a *dark* desaturated violet hint,
            not a bright bridge. Chips near x=100 fade into the dark hub. */}
        <stop offset="0" stopColor="#3DB8FF" stopOpacity="1" />
        <stop offset="0.32" stopColor="#2BA8FF" stopOpacity="1" />
        <stop offset="0.44" stopColor="#3A2A8C" stopOpacity="0.45" />
        <stop offset="0.5" stopColor="#1A0F33" stopOpacity="0.18" />
        <stop offset="0.56" stopColor="#7A1E26" stopOpacity="0.45" />
        <stop offset="0.68" stopColor="#FF3D2A" stopOpacity="1" />
        <stop offset="1" stopColor="#FF4D3D" stopOpacity="1" />
      </linearGradient>
      <filter
        id={filterId}
        x="-17%"
        y="-17%"
        width="135%"
        height="135%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation={haloBlur} result="halo" />
        <feGaussianBlur in="SourceGraphic" stdDeviation={bloomBlur} result="bloom" />
        <feMerge>
          <feMergeNode in="bloom" />
          <feMergeNode in="halo" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
