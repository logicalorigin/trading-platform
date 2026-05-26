import React from "react";
import { CSS_COLOR, T } from "../../lib/uiTokens.jsx";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog.jsx";

export const formatLiveBrokerActionError = (error) => {
  const message =
    error?.message ||
    "The broker action failed before the platform received a final response.";
  if (/timeout|timed out|504|gateway timeout/i.test(message)) {
    return `${message} If this reached IBKR, the outcome may be unknown. Check open orders and executions before retrying.`;
  }
  return message;
};

export const BrokerActionConfirmDialog = ({
  open,
  title,
  detail,
  lines = [],
  confirmLabel = "CONFIRM LIVE ACTION",
  confirmTone = CSS_COLOR.red,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}) => {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      detail={detail}
      lines={lines}
      confirmLabel={confirmLabel}
      confirmTone={confirmTone}
      pending={pending}
      error={error}
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
      eyebrow="Live IBKR Confirmation"
      note="This sends a live broker instruction. Review the account, instrument, side, size, and price before continuing."
      dialogTestId="broker-action-confirm-dialog"
      errorTestId="broker-action-confirm-error"
    />
  );
};
