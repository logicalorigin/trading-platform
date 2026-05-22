const SHADOW_ENTRY_EVENT = "signal_options_shadow_entry";
const SHADOW_EXIT_EVENT = "signal_options_shadow_exit";

const readNumber = (value) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

export function buildAlgoEventToast(event) {
  if (event?.eventType === SHADOW_ENTRY_EVENT) {
    return {
      kind: "success",
      title: event.summary,
      body: "Algo entry filled",
      duration: 5000,
    };
  }

  if (event?.eventType === SHADOW_EXIT_EVENT) {
    const pnl = readNumber(event.payload?.pnl);
    const kind =
      pnl == null ? "info" : pnl > 0 ? "success" : pnl < 0 ? "error" : "info";
    const body =
      pnl == null
        ? "Algo exit filled"
        : `Algo exit · PnL ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`;

    return {
      kind,
      title: event.summary,
      body,
      duration: 5000,
    };
  }

  return null;
}
