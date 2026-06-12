import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

test("account position broker mutations refresh positions and broker caches", () => {
  assert.match(source, /import \{ useQueryClient \} from "@tanstack\/react-query";/);
  assert.match(source, /const queryClient = useQueryClient\(\);/);
  assert.match(
    source,
    /const refreshBrokerQueries = useCallback\([\s\S]*queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/orders"\] \}\);/,
  );
  assert.match(
    source,
    /const refreshBrokerQueries = useCallback\([\s\S]*queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/positions"\] \}\);/,
  );
  assert.match(
    source,
    /const refreshBrokerQueries = useCallback\([\s\S]*queryClient\.invalidateQueries\(\{ queryKey: \["broker-executions"\] \}\);/,
  );
  assert.match(
    source,
    /const placeOrderMutation = usePlaceOrder\(\{\s*mutation:\s*\{\s*onSuccess: refreshBrokerQueries,/,
  );
  assert.match(
    source,
    /const replaceOrderMutation = useReplaceOrder\(\{\s*mutation:\s*\{\s*onSuccess: refreshBrokerQueries,/,
  );
});

test("account roll action is not exposed as a fake broker workflow", () => {
  const rollAction = source.match(/id: "roll",[\s\S]*?tone: "info",/);

  assert.ok(rollAction, "expected DensePositionActions to define the roll action");
  assert.match(rollAction[0], /disabled: true,/);
  assert.match(rollAction[0], /Roll workflow is disabled until a broker-safe multi-leg order flow exists\./);
  assert.doesNotMatch(rollAction[0], /onSelect: \(\) => onJumpToChart\?\.\(row\.symbol\)/);
});
