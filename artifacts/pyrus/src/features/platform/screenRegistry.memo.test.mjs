import assert from "node:assert/strict";
import test from "node:test";

import { skipStableHiddenScreenRender } from "./screenRegistry.jsx";

const stableHandler = () => {};

test("visible screens skip unrelated parent rerenders when their props are unchanged", () => {
  const props = {
    isVisible: true,
    sym: "SPY",
    onSelectSymbol: stableHandler,
  };

  assert.equal(skipStableHiddenScreenRender(props, { ...props }), true);
});

test("visible screens rerender for real prop changes", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: true, sym: "SPY", onSelectSymbol: stableHandler },
      { isVisible: true, sym: "QQQ", onSelectSymbol: stableHandler },
    ),
    false,
  );
});

test("screen activation always receives the latest props", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: false, sym: "SPY" },
      { isVisible: true, sym: "QQQ" },
    ),
    false,
  );
});

test("screen activation rerenders when visibility is the only change", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: false, sym: "SPY" },
      { isVisible: true, sym: "SPY" },
    ),
    false,
  );
});

test("screen deactivation rerenders when visibility is the only change", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: true, sym: "SPY" },
      { isVisible: false, sym: "SPY" },
    ),
    false,
  );
});

test("a hidden deferred route rerenders when its host becomes urgent", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: false, isHostVisible: false, sym: "SPY" },
      { isVisible: false, isHostVisible: true, sym: "SPY" },
    ),
    false,
  );
});

test("stable hidden screens keep ignoring background prop churn", () => {
  assert.equal(
    skipStableHiddenScreenRender(
      { isVisible: false, sym: "SPY" },
      { isVisible: false, sym: "QQQ" },
    ),
    true,
  );
});
