import { platformJsonRequest } from "../../features/platform/platformJsonRequest.js";

export async function cancelSnapTradeOrderRequest({
  accountId,
  orderId,
  assetClass,
  csrfToken,
} = {}) {
  const normalizedAccountId = String(accountId || "").trim();
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedAccountId || !normalizedOrderId) {
    throw new Error(
      "SnapTrade cancellation requires an account and broker order id.",
    );
  }
  if (assetClass !== "equity" && assetClass !== "option") {
    throw new Error(
      "SnapTrade cancellation requires an equity or option order.",
    );
  }

  const orderPath = assetClass === "option" ? "options" : "orders";
  return platformJsonRequest(
    `/api/broker-execution/snaptrade/accounts/${encodeURIComponent(normalizedAccountId)}/${orderPath}/cancel`,
    {
      method: "POST",
      body: { orderId: normalizedOrderId },
      csrfToken,
    },
  );
}
