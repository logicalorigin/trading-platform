import { PyrusMark } from "./pyrus-mark";
import { PyrusWordmark } from "./pyrus-wordmark";

type LockupProps = {
  className?: string;
  compact?: boolean;
};

export { PyrusWordmark };

export function LogoMark({
  className,
  compact = false,
}: LockupProps) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        color: "var(--ra-text-primary, #F4F8FF)",
        gap: compact ? 8 : 10,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <PyrusMark className={compact ? "h-[22px] w-[22px]" : "h-7 w-7"} />
      <PyrusWordmark width={compact ? 116 : 150} title="PYRUS" />
    </div>
  );
}

type StackedLockupProps = {
  className?: string;
  descriptor?: string;
  markClassName?: string;
  wordmarkWidth?: number;
};

export function LogoLockup({
  className,
  descriptor = "Algo Trading Platform",
  markClassName = "h-32 w-32",
  wordmarkWidth = 190,
}: StackedLockupProps) {
  return (
    <div
      className={className}
      style={{
        alignItems: "center",
        display: "inline-flex",
        flexDirection: "column",
        gap: 18,
        justifyContent: "center",
        color: "var(--ra-text-primary, #F4F8FF)",
        lineHeight: 0,
        minWidth: 0,
        textAlign: "center",
      }}
    >
      <span
        className="pyrus-loader-mark"
        style={{
          alignItems: "center",
          display: "inline-flex",
          justifyContent: "center",
          lineHeight: 0,
        }}
      >
        <PyrusMark className={markClassName} />
      </span>
      <span
        style={{
          alignItems: "center",
          display: "inline-flex",
          flexDirection: "column",
          gap: 8,
          lineHeight: 1,
          minWidth: 0,
        }}
      >
        <PyrusWordmark className="pyrus-loader-wordmark" width={wordmarkWidth} title="PYRUS" />
        {descriptor ? (
          <span className="pyrus-lockup-descriptor">{descriptor}</span>
        ) : null}
      </span>
    </div>
  );
}

export const PyrusBrandLockup = LogoMark;

export default PyrusBrandLockup;
