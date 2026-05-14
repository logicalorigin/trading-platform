import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAM_STATE_LABEL,
  STREAM_STATE_TOKEN,
  canonicalizeStreamState,
  streamStateBackgroundVar,
  streamStateTokenVar,
} from "./streamSemantics";

test("canonicalizeStreamState accepts legacy stream vocabulary", () => {
  assert.equal(canonicalizeStreamState("live"), "healthy");
  assert.equal(canonicalizeStreamState("stale_stream"), "stale");
  assert.equal(canonicalizeStreamState("capacity_limited"), "capacity-limited");
  assert.equal(canonicalizeStreamState("reconnect_needed"), "reconnecting");
  assert.equal(canonicalizeStreamState("login_required"), "login-required");
  assert.equal(canonicalizeStreamState("market_session_quiet"), "market-closed");
  assert.equal(canonicalizeStreamState("no_active_quote_consumers"), "no-subscribers");
});

test("stream state helpers route every canonical state through semantic tokens", () => {
  assert.equal(STREAM_STATE_TOKEN.healthy, "--ra-stream-healthy");
  assert.equal(STREAM_STATE_LABEL["capacity-limited"], "CAPACITY");
  assert.equal(streamStateTokenVar("reconnect_needed"), "var(--ra-stream-reconnecting)");
  assert.equal(
    streamStateBackgroundVar("stale_stream"),
    "color-mix(in srgb, var(--ra-stream-stale) 14%, transparent)",
  );
});
