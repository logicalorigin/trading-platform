import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./AccountScreen.jsx", import.meta.url),
  "utf8",
);

test("Account routes SnapTrade working-order cancellation through its broker endpoint", () => {
  assert.match(
    source,
    /import \{ cancelSnapTradeOrderRequest \} from "\.\/account\/snapTradeOrderCancelRequest\.js";/,
  );

  const mutation = source.match(
    /const cancelSnapTradeOrderMutation = useMutation\(\{[\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(mutation, "missing SnapTrade cancel mutation");
  assert.match(mutation, /cancelSnapTradeOrderRequest\(\{/);
  assert.match(mutation, /csrfToken: authSession\.csrfToken/);
  const reconciliation = mutation.match(
    /onSettled: \(_response, _error, variables\) => \{[\s\S]*?\n    \},/,
  )?.[0];
  assert.ok(
    reconciliation,
    "cancellation must reconcile recent orders after success or an unknown outcome",
  );
  assert.match(
    reconciliation,
    /queryKey: getGetSnapTradeRecentOrdersQueryKey\(variables\.accountId\)/,
  );
  assert.match(
    mutation,
    /queryKey: getGetSnapTradeAccountPortfolioQueryKey\(variables\.accountId\)/,
  );
  assert.doesNotMatch(
    mutation,
    /queryKey: snapTrade(?:Portfolio|RecentOrders)Query\.queryKey/,
  );
  assert.match(mutation, /\/api\/accounts\/\$\{variables\.accountId\}\/orders/);
  assert.match(mutation, /\/api\/accounts\/\$\{variables\.accountId\}\/positions/);
  assert.match(mutation, /title: "Cancellation not confirmed"/);
  assert.match(mutation, /Refresh recent orders before trying again/);

  const handler = source.match(
    /const handleCancelOrder = async \(order\) => \{[\s\S]*?\n  \};/,
  )?.[0];
  assert.ok(handler, "missing Account order cancellation handler");
  assert.match(handler, /snapTradeAccountPanelsEnabled/);
  assert.match(handler, /cancelSnapTradeOrderMutation\.mutateAsync\(\{/);
  assert.match(handler, /orderId: order\.brokerOrderId/);
  assert.match(handler, /assetClass: order\.assetClass/);
  assert.ok(
    handler.indexOf("!order.brokerOrderId") < handler.indexOf("window.confirm"),
    "missing broker order identity must fail closed before confirmation",
  );
  assert.ok(
    handler.indexOf("window.confirm") <
      handler.indexOf("cancelSnapTradeOrderMutation.mutateAsync"),
    "the confirmation must happen before the broker mutation",
  );
});

test("Account enables SnapTrade cancellation only when that account is execution-ready", () => {
  assert.match(
    source,
    /const snapTradeOrderCancellationReady = Boolean\([\s\S]*?executionReady,?\s*\);/,
  );
  assert.match(source, /snapTradeOrderCancellationMessage/);

  const ordersPanel = source.match(/<OrdersPanel[\s\S]*?\/>/)?.[0];
  assert.ok(ordersPanel, "missing Account orders panel");
  assert.match(
    ordersPanel,
    /cancelPending=\{\s*snapTradeAccountPanelsEnabled\s*\?\s*cancelSnapTradeOrderMutation\.isPending\s*:\s*cancelOrderMutation\.isPending\s*\}/,
  );
  assert.match(
    ordersPanel,
    /cancelDisabled=\{\s*snapTradeAccountPanelsEnabled\s*\?\s*!snapTradeOrderCancellationReady\s*:\s*!ORDER_BLOTTER_CANCELLATION_AVAILABLE\s*\}/,
  );
  assert.doesNotMatch(
    ordersPanel,
    /SnapTrade order cancellation is handled outside this panel/,
  );
});

test("Account keeps generic broker-order cancellation disabled when prepared lifecycle ownership is unknown", () => {
  assert.match(
    source,
    /ORDER_BLOTTER_CANCELLATION_AVAILABLE/,
  );
  assert.match(
    source,
    /const cancellationReady = snapTradeAccountPanelsEnabled\s*\? snapTradeOrderCancellationReady\s*:\s*ORDER_BLOTTER_CANCELLATION_AVAILABLE;/,
  );

  const ordersPanel = source.match(/<OrdersPanel[\s\S]*?\/>/)?.[0];
  assert.ok(ordersPanel, "missing Account orders panel");
  assert.match(
    ordersPanel,
    /cancelDisabled=\{\s*snapTradeAccountPanelsEnabled\s*\? !snapTradeOrderCancellationReady\s*:\s*!ORDER_BLOTTER_CANCELLATION_AVAILABLE\s*\}/,
  );
  assert.match(
    ordersPanel,
    /ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON/,
  );
});
