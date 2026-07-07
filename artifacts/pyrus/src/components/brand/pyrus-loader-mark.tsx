import { PyrusMark } from "./pyrus-mark";

export function PyrusLoaderMark({ className }: { className?: string }) {
  return (
    <PyrusMark
      animated
      className={["pyrus-loader-instrument", className].filter(Boolean).join(" ")}
      title=""
    />
  );
}
