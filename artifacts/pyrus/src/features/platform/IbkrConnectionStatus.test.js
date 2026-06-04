import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildIbkrGatewayTitle,
  formatIbkrPingMs,
  getIbkrConnection,
  getIbkrGatewayBadges,
  getIbkrConnectionTone,
  getIbkrStreamStateMeta,
  IbkrConnectionLane,
  IbkrPingWavelength,
  IbkrStatusWave,
  isIbkrWaveActive,
  maskIbkrAccountId,
  resolveIbkrStatusWaveProfile,
  resolveIbkrGatewayHealth,
  shouldShowIbkrReconnectAction,
} from "./IbkrConnectionStatus.jsx";
import {
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
  hasGatewayLiveDataProof,
} from "./bridgeRuntimeModel.js";
import { buildHeaderIbkrPopoverModel } from "./ibkrPopoverModel.js";
import { streamStateTokenVar } from "./streamSemantics";
import { TooltipProvider } from "../../components/ui/tooltip";

const CSS_COLOR = {
  accent: "var(--ra-color-accent)",
  green: "var(--ra-green-500)",
  amber: "var(--ra-amber-500)",
  red: "var(--ra-red-500)",
};

const findPopoverDetailRow = (model, label) =>
  model.detailGroups
    .flatMap((group) => group.rows)
    .find((row) => row.label === label);

const ibkrSource = () =>
  readFileSync(new URL("./IbkrConnectionStatus.jsx", import.meta.url), "utf8");

test("formatIbkrPingMs formats millisecond and second values", () => {
  assert.equal(formatIbkrPingMs(null), "--");
  assert.equal(formatIbkrPingMs(42.4), "42ms");
  assert.equal(formatIbkrPingMs(1_250), "1.3s");
  assert.equal(formatIbkrPingMs(12_500), "13s");
});

test("IBKR connection lane uses structured failure-point tooltip content", () => {
  const source = ibkrSource();

  assert.match(source, /FailurePointContent/);
  assert.match(source, /buildIbkrConnectionFailurePoint/);
  assert.match(source, /const proof = resolveConnectionProof\(connection\)/);
  assert.match(source, /content=\{<FailurePointContent point=\{failurePoint\} compact \/>/);
});

test("getIbkrConnectionTone maps configured connection states", () => {
  assert.equal(
    getIbkrConnectionTone({ configured: false }).label,
    "offline",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: false,
      authenticated: false,
      lastError: "socket closed",
    }).label,
    "error",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: false,
    }).label,
    "login",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      strictReady: true,
    }).label,
    "online",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      liveMarketDataAvailable: false,
      configuredLiveMarketDataMode: false,
      accountsLoaded: true,
    }).label,
    "delayed",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "stale",
      accountsLoaded: true,
      strictReady: false,
    }).label,
    "quote stale",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "quiet",
      accountsLoaded: true,
      strictReady: false,
    }).label,
    "quiet stream",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "quiet",
      streamStateReason: "no_active_quote_consumers",
      strictReady: true,
    }).label,
    "online",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "reconnecting",
      streamStateReason: "quote_stream_error",
      accountsLoaded: true,
      strictReady: false,
      strictReason: "stream_not_fresh",
    }).label,
    "online",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: false,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "reconnect_needed",
      accountsLoaded: true,
      strictReady: false,
    }).label,
    "reconnect",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      socketConnected: true,
      brokerServerConnected: false,
      authenticated: false,
      healthFresh: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "reconnect_needed",
      streamStateReason: "gateway_server_disconnected",
      accountsLoaded: false,
      strictReady: false,
      strictReason: "gateway_server_disconnected",
    }).label,
    "server disconnected",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: false,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "capacity_limited",
      streamStateReason: "backpressure",
      accountsLoaded: true,
      strictReady: false,
    }).label,
    "line limited",
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      accountsLoaded: false,
      strictReady: false,
    }).label,
    "checking",
  );
});

test("getIbkrConnectionTone maps status colors", () => {
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      streamFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      strictReady: true,
    }).color,
    CSS_COLOR.green,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      accountsLoaded: false,
      strictReady: false,
    }).color,
    CSS_COLOR.accent,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: false,
    }).color,
    CSS_COLOR.amber,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      liveMarketDataAvailable: false,
      configuredLiveMarketDataMode: false,
      accountsLoaded: true,
    }).color,
    CSS_COLOR.amber,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "stale",
      accountsLoaded: true,
      strictReady: false,
    }).color,
    streamStateTokenVar("stale"),
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: false,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "capacity_limited",
      streamStateReason: "backpressure",
      accountsLoaded: true,
      strictReady: false,
    }).color,
    streamStateTokenVar("capacity-limited"),
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: false,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "reconnect_needed",
      accountsLoaded: true,
      strictReady: false,
    }).color,
    streamStateTokenVar("reconnecting"),
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: false,
      authenticated: false,
      lastError: "socket closed",
    }).color,
    CSS_COLOR.red,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: false,
      authenticated: false,
    }).color,
    CSS_COLOR.red,
  );
});

test("bridgeRuntimeTone maps in-progress bridge states to accent", () => {
  assert.equal(
    bridgeRuntimeTone({
      configured: { ibkr: true },
      ibkrBridge: {
        connected: true,
        authenticated: true,
        accountsLoaded: false,
      },
    }).color,
    CSS_COLOR.accent,
  );
  assert.equal(
    bridgeRuntimeTone({
      configured: { ibkr: true },
      ibkrBridge: {
        connected: true,
        authenticated: true,
      },
    }).color,
    CSS_COLOR.accent,
  );
  assert.equal(
    bridgeRuntimeTone({
      configured: { ibkr: true },
      ibkrBridge: {
        connected: true,
        authenticated: false,
      },
    }).color,
    CSS_COLOR.amber,
  );
});

test("bridgeRuntimeTone surfaces desktop reconnect when IBKR is unconfigured", () => {
  const readyTone = bridgeRuntimeTone({
    configured: { ibkr: false },
    runtime: {
      ibkr: {
        runtimeOverrideActive: false,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: false,
        reconnectAvailable: true,
      },
    },
  });
  assert.equal(readyTone.label, "reconnect");
  assert.equal(readyTone.color, CSS_COLOR.amber);
  assert.equal(readyTone.pulse, true);
  assert.match(
    bridgeRuntimeMessage({
      configured: { ibkr: false },
      runtime: {
        ibkr: {
          runtimeOverrideActive: false,
          desktopAgentOnline: true,
          desktopAgentUpgradeRequired: false,
        },
      },
    }),
    /Reconnect IBKR/,
  );

  const upgradeTone = bridgeRuntimeTone({
    configured: { ibkr: false },
    runtime: {
      ibkr: {
        runtimeOverrideActive: false,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: true,
        reconnectAvailable: false,
      },
    },
  });
  assert.equal(upgradeTone.label, "helper update");
  assert.match(
    bridgeRuntimeMessage({
      configured: { ibkr: false },
      runtime: {
        ibkr: {
          runtimeOverrideActive: false,
          desktopAgentOnline: true,
          desktopAgentUpgradeRequired: true,
        },
      },
    }),
    /must update/,
  );

  assert.match(
    bridgeRuntimeMessage({
      configured: { ibkr: false },
      runtime: {
        ibkr: {
          runtimeOverrideActive: false,
          desktopAgentOnline: true,
          desktopAgentKnownBad: true,
          desktopAgentCompatibility: "known_bad",
          desktopAgentUpgradeRequired: true,
        },
      },
    }),
    /blocked helper version/,
  );
});

test("bridgeRuntimeTone keeps reconnect-needed streams out of generic offline tone", () => {
  const tone = bridgeRuntimeTone({
    configured: { ibkr: true },
    ibkrBridge: {
      bridgeReachable: true,
      connected: false,
      streamState: "reconnect_needed",
      streamStateReason: "gateway_socket_disconnected",
    },
  });

  assert.equal(tone.label, "reconnect");
  assert.equal(tone.color, streamStateTokenVar("reconnecting"));
  assert.equal(tone.pulse, true);
});

test("bridgeRuntimeTone treats quote standby as connected once Gateway proof is ready", () => {
  const tone = bridgeRuntimeTone({
    configured: { ibkr: true },
    ibkrBridge: {
      connected: true,
      authenticated: true,
      healthFresh: true,
      bridgeReachable: true,
      socketConnected: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      liveMarketDataAvailable: true,
      streamState: "quiet",
      streamStateReason: "no_active_quote_consumers",
      strictReady: true,
    },
  });

  assert.equal(tone.label, "live");
  assert.equal(tone.color, CSS_COLOR.green);
});

test("bridgeRuntimeTone keeps Gateway live when only the quote stream is cycling", () => {
  const tone = bridgeRuntimeTone({
    configured: { ibkr: true },
    ibkrBridge: {
      connected: true,
      authenticated: true,
      healthFresh: true,
      bridgeReachable: true,
      socketConnected: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      liveMarketDataAvailable: true,
      streamFresh: false,
      streamState: "reconnecting",
      streamStateReason: "quote_stream_error",
      strictReady: false,
      strictReason: "stream_not_fresh",
    },
  });

  assert.equal(tone.label, "live");
  assert.equal(tone.color, CSS_COLOR.green);
});

test("bridge runtime treats live stream proof as ready while health is refreshing", () => {
  const session = {
    configured: { ibkr: true },
    ibkrBridge: {
      connected: true,
      authenticated: true,
      healthFresh: false,
      bridgeReachable: true,
      socketConnected: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      liveMarketDataAvailable: true,
      streamFresh: true,
      streamState: "live",
      streamStateReason: "fresh_stream_event_health_stale",
      strictReady: true,
    },
  };

  assert.equal(hasGatewayLiveDataProof(session.ibkrBridge), true);
  const tone = bridgeRuntimeTone(session);
  assert.notEqual(tone.label, "health pending");
  assert.notEqual(tone.color, CSS_COLOR.amber);
  assert.notEqual(tone.color, CSS_COLOR.red);
  assert.match(bridgeRuntimeMessage(session), /live stream is active/);
});

test("getIbkrStreamStateMeta keeps quiet reasons visually distinct", () => {
  assert.deepEqual(
    [
      getIbkrStreamStateMeta("quiet", "no_active_quote_consumers").label,
      getIbkrStreamStateMeta("quiet", "market_session_quiet").label,
      getIbkrStreamStateMeta("quiet", null).label,
      getIbkrStreamStateMeta("live", "fresh_stream_event").label,
      getIbkrStreamStateMeta("stale", "stream_not_fresh").label,
      getIbkrStreamStateMeta("capacity_limited", "backpressure").label,
      getIbkrStreamStateMeta("reconnecting", "quote_stream_error").label,
    ],
    [
      "standby",
      "market closed",
      "quiet stream",
      "online",
      "quote stale",
      "line limited",
      "reconnecting",
    ],
  );
  assert.deepEqual(
    [
      getIbkrStreamStateMeta("quiet", "no_active_quote_consumers").badge,
      getIbkrStreamStateMeta("quiet", "market_session_quiet").badge,
      getIbkrStreamStateMeta("quiet", null).badge,
      getIbkrStreamStateMeta("capacity_limited", "backpressure").badge,
    ],
    ["STANDBY", "CLOSED", "QUIET", "LIMITED"],
  );
});

test("IBKR limited-line state does not leak capacity wording into display copy", () => {
  const meta = getIbkrStreamStateMeta("capacity_limited", "backpressure");

  assert.equal(meta.label, "line limited");
  assert.equal(meta.healthLabel, "Line Limited");
  assert.equal(meta.badge, "LIMITED");
  assert.equal(
    /\bcap(s|acity)?\b/i.test(`${meta.label} ${meta.healthLabel} ${meta.badge}`),
    false,
  );
});

test("isIbkrWaveActive only animates reachable connection health", () => {
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: false,
      authenticated: false,
      lastPingMs: 493,
      lastError: "HTTP 404 Not Found",
    }),
    false,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      authenticated: false,
      lastPingMs: 493,
    }),
    false,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      authenticated: true,
      strictReady: false,
    }),
    false,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      accountsLoaded: true,
      streamState: "quiet",
      strictReady: false,
    }),
    true,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      authenticated: true,
      healthFresh: true,
      accountsLoaded: true,
      streamState: "stale",
      strictReady: false,
    }),
    false,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      authenticated: true,
      strictReady: true,
    }),
    true,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: true,
      reachable: true,
      competing: true,
      lastPingMs: 493,
    }),
    false,
  );
  assert.equal(
    isIbkrWaveActive({
      configured: false,
      reachable: true,
      lastPingMs: 493,
    }),
    false,
  );
});

test("IbkrPingWavelength renders connected wire as an animated green sine wave", () => {
  const html = renderToStaticMarkup(
    React.createElement(IbkrPingWavelength, {
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        healthFresh: true,
        accountsLoaded: true,
        strictReady: true,
        lastPingMs: 80,
      },
      tone: { color: CSS_COLOR.green, wave: "fast" },
    }),
  );

  assert.equal(html.includes("stroke-dasharray"), false);
  assert.equal(html.includes("translateX"), false);
  assert.equal(
    (html.match(new RegExp(`stroke="${streamStateTokenVar("healthy").replace(/[()]/g, "\\$&")}"`, "g")) || []).length,
    2,
  );
  assert.equal((html.match(/<polyline /g) || []).length, 2);
  assert.equal((html.match(/<animate /g) || []).length, 2);
  assert.match(html, /attributeName="points"/);
  assert.match(html, /1\.00,6\.00/);
});

test("IbkrStatusWave maps status states to animated and static wave glyphs", () => {
  assert.deepEqual(resolveIbkrStatusWaveProfile({ status: "healthy" }), {
    state: "healthy",
    wave: "fast",
    duration: "0.9s",
    active: true,
  });
  assert.equal(
    resolveIbkrStatusWaveProfile({ status: "capacity-limited" }).wave,
    "slow",
  );
  assert.equal(
    resolveIbkrStatusWaveProfile({ status: "stale" }).active,
    false,
  );
  assert.equal(
    resolveIbkrStatusWaveProfile({ status: "offline" }).wave,
    "flat",
  );

  const healthyHtml = renderToStaticMarkup(
    React.createElement(IbkrStatusWave, {
      status: "healthy",
      tone: { color: CSS_COLOR.green },
      decorative: false,
      ariaLabel: "IBKR status Ready",
    }),
  );
  assert.match(healthyHtml, /data-ibkr-wave-motion="animated"/);
  assert.match(healthyHtml, /data-ibkr-wave-state="healthy"/);
  assert.match(healthyHtml, /role="img"/);
  assert.equal((healthyHtml.match(/<animate /g) || []).length, 2);

  const staleHtml = renderToStaticMarkup(
    React.createElement(IbkrStatusWave, {
      status: "stale",
      tone: { color: CSS_COLOR.amber },
    }),
  );
  assert.match(staleHtml, /data-ibkr-wave-motion="static"/);
  assert.match(staleHtml, /data-ibkr-wave-state="stale"/);
  assert.equal((staleHtml.match(/<animate /g) || []).length, 0);
});

test("resolveIbkrGatewayHealth maps Gateway readiness states", () => {
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: { configured: false },
    }).status,
    "misconfigured",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: { configured: true, reachable: false },
    }).status,
    "offline",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: { configured: true, reachable: true, competing: true },
    }).status,
    "competing",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: { configured: true, reachable: true, authenticated: false },
    }).status,
    "login-required",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        accountsLoaded: false,
      },
    }).status,
    "checking",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        accountsLoaded: false,
      },
    }).color,
    streamStateTokenVar("checking"),
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        healthFresh: true,
        liveMarketDataAvailable: false,
        configuredLiveMarketDataMode: false,
      },
    }).status,
    "delayed",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
      },
    }).status,
    "healthy",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "stale",
        strictReady: false,
      },
    }).status,
    "stale",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: false,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "capacity_limited",
        streamStateReason: "backpressure",
        strictReady: false,
      },
    }).status,
    "capacity-limited",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "reconnecting",
        streamStateReason: "quote_stream_error",
        strictReady: false,
        strictReason: "stream_not_fresh",
      },
    }).status,
    "healthy",
  );
  assert.equal(
    resolveIbkrGatewayHealth({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
      },
    }).status,
    "no-subscribers",
  );
});

test("IBKR reconnect action policy targets intervention states", () => {
  [
    "misconfigured",
    "offline",
    "stale",
    "login-required",
    "reconnecting",
  ].forEach((status) => {
    assert.equal(
      shouldShowIbkrReconnectAction({ status }),
      true,
      `${status} should show reconnect`,
    );
  });

  ["healthy", "checking", "delayed", "capacity-limited", "no-subscribers"].forEach(
    (status) => {
      assert.equal(
        shouldShowIbkrReconnectAction({ status }),
        false,
        `${status} should not show reconnect`,
      );
    },
  );
});

test("IbkrConnectionLane renders reconnect action for disconnected Gateway states", () => {
  const onReconnect = () => {};
  const lane = IbkrConnectionLane({
    label: "IB Gateway",
    connection: {
      configured: true,
      reachable: true,
      socketConnected: false,
      authenticated: false,
      streamState: "reconnect_needed",
      streamStateReason: "gateway_socket_disconnected",
    },
    onReconnect,
  });
  const laneRoot = lane.props.children;
  const action = React.Children.toArray(laneRoot.props.children).find(
    (child) => child?.props?.dataTestId === "ibkr-connection-reconnect",
  );

  assert.equal(action?.props?.onClick, onReconnect);

  const html = renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(IbkrConnectionLane, {
        label: "IB Gateway",
        connection: {
          configured: true,
          reachable: true,
          socketConnected: false,
          authenticated: false,
          streamState: "reconnect_needed",
          streamStateReason: "gateway_socket_disconnected",
        },
        onReconnect,
      }),
    ),
  );

  assert.match(html, /data-testid="ibkr-connection-reconnect"/);
  assert.match(html, />Reconnect</);
});

test("IbkrConnectionLane hides reconnect action for healthy Gateway states", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(IbkrConnectionLane, {
        label: "IB Gateway",
        connection: {
          configured: true,
          reachable: true,
          authenticated: true,
          liveMarketDataAvailable: true,
          healthFresh: true,
          accountsLoaded: true,
          configuredLiveMarketDataMode: true,
          streamFresh: true,
          strictReady: true,
        },
        onReconnect: () => {},
      }),
    ),
  );

  assert.doesNotMatch(html, /data-testid="ibkr-connection-reconnect"/);
});

test("buildIbkrGatewayTitle masks accounts and includes streaming health", () => {
  assert.equal(maskIbkrAccountId("DU1234567"), "DU...4567");

  const title = buildIbkrGatewayTitle({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      target: "127.0.0.1:4002",
      clientId: 101,
      selectedAccountId: "DU1234567",
      accounts: ["DU1234567"],
      marketDataMode: "live",
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    latencyStats: {
      bridgeToApiMs: { p95: 38 },
      apiToReactMs: { p95: 21 },
      totalMs: { p95: 59 },
      stream: {
        activeConsumerCount: 3,
        unionSymbolCount: 12,
        eventCount: 420,
        reconnectCount: 1,
        streamGapCount: 2,
        maxGapMs: 1700,
        lastEventAgeMs: 200,
      },
    },
  });

  assert.match(title, /IB Gateway: Ready/);
  assert.match(title, /account DU\.\.\.4567/);
  assert.doesNotMatch(title, /DU1234567/);
  assert.match(title, /total p95 59ms/);
  assert.match(title, /symbols 12/);
  assert.match(title, /gaps 2/);
});

test("getIbkrGatewayBadges surfaces live data and stream gaps", () => {
  const badges = getIbkrGatewayBadges({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    latencyStats: {
      stream: { streamGapCount: 2 },
    },
  });

  assert.deepEqual(
    badges.map((badge) => badge.label),
    ["LIVE", "GAPS 2"],
  );
  assert.deepEqual(
    getIbkrGatewayBadges({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: false,
      },
    }).map((badge) => badge.label),
    ["DELAYED"],
  );
  assert.deepEqual(
    getIbkrGatewayBadges({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        accountsLoaded: false,
      },
    }).map((badge) => badge.label),
    ["CHECKING"],
  );
  assert.deepEqual(
    getIbkrGatewayBadges({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
      },
    }).map((badge) => badge.label),
    ["STANDBY"],
  );
  assert.deepEqual(
    getIbkrGatewayBadges({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamState: "quiet",
        streamStateReason: "market_session_quiet",
      },
    }).map((badge) => badge.label),
    ["CLOSED"],
  );
});

test("getIbkrConnection falls back to the active Gateway bridge transport", () => {
  const session = {
    environment: "paper",
    configured: { ibkr: true },
    ibkrBridge: {
      transport: "tws",
      connected: true,
      authenticated: true,
      selectedAccountId: "DU123",
      accounts: ["DU123"],
      connectionTarget: "127.0.0.1:4002",
      clientId: 101,
    },
  };

  const tws = getIbkrConnection(session, "tws");

  assert.equal(tws.configured, true);
  assert.equal(tws.authenticated, true);
  assert.equal(tws.target, "127.0.0.1:4002");
});

test("buildHeaderIbkrPopoverModel includes concrete runtime errors for gateway failures", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        bridgeTokenConfigured: false,
        healthError: "connect ECONNREFUSED 127.0.0.1:7497",
      },
    },
    latencyStats: {
      stream: {
        streamGapCount: 2,
      },
    },
  });

  assert.equal(model.issue.key, "offline");
  assert.match(model.issue.label, /Gateway bridge is not reachable/);
  assert.match(model.issue.label, /ECONNREFUSED/);
  assert.match(findPopoverDetailRow(model, "Last error").value, /ECONNREFUSED/);
});

test("buildHeaderIbkrPopoverModel prefers governor root failures over health backoff text", () => {
  const rootFailure =
    "HTTP 502 Bad Gateway: 502 Bad Gateway\nUnable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared";
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        reachable: false,
        connected: false,
        authenticated: false,
        healthFresh: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        governor: {
          health: {
            lastFailure: rootFailure,
          },
        },
      },
    },
  });

  assert.equal(model.issue.key, "offline");
  assert.match(model.issue.label, /Gateway bridge is not reachable/);
  assert.match(model.issue.label, /Unable to reach the origin service/);
  assert.doesNotMatch(model.issue.label, /temporarily backed off/);
  assert.equal(findPopoverDetailRow(model, "Last error").value, rootFailure);
  assert.match(
    findPopoverDetailRow(model, "Health status").value,
    /temporarily backed off/,
  );
});

test("buildHeaderIbkrPopoverModel separates reachable bridge tunnels from disconnected Gateway sockets", () => {
  const staleTunnelFailure =
    "HTTP 502 Bad Gateway: old cloudflared origin failure";
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      bridgeReachable: true,
      socketConnected: false,
      healthFresh: true,
      accountsLoaded: false,
      streamFresh: false,
      streamState: "reconnect_needed",
      streamStateReason: "gateway_socket_disconnected",
      strictReady: false,
      strictReason: "gateway_socket_disconnected",
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        reachable: true,
        bridgeReachable: true,
        connected: false,
        socketConnected: false,
        authenticated: false,
        healthFresh: true,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "gateway_socket_disconnected",
        strictReady: false,
        strictReason: "gateway_socket_disconnected",
        governor: {
          health: {
            lastFailure: staleTunnelFailure,
          },
        },
      },
    },
  });

  assert.equal(model.issue.key, "reconnecting");
  assert.equal(model.issue.severity, "error");
  assert.equal(model.priorityDetailGroup, "connection");
  assert.match(model.issue.label, /IB Gateway\/TWS is disconnected/);
  assert.doesNotMatch(model.issue.label, /not reachable/);
  assert.equal(findPopoverDetailRow(model, "Bridge HTTP").value, "reachable");
  assert.equal(findPopoverDetailRow(model, "Gateway").value, "disconnected");
  assert.equal(
    findPopoverDetailRow(model, "Ready reason").value,
    "gateway_socket_disconnected",
  );
  assert.equal(findPopoverDetailRow(model, "Last error"), undefined);
});

test("buildHeaderIbkrPopoverModel separates local Gateway sockets from IBKR server disconnects", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      socketConnected: true,
      brokerServerConnected: false,
      authenticated: false,
      bridgeReachable: true,
      healthFresh: true,
      accountsLoaded: false,
      streamFresh: false,
      streamState: "reconnect_needed",
      streamStateReason: "gateway_server_disconnected",
      strictReady: false,
      strictReason: "gateway_server_disconnected",
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        reachable: true,
        bridgeReachable: true,
        connected: true,
        socketConnected: true,
        brokerServerConnected: false,
        authenticated: false,
        healthFresh: true,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "gateway_server_disconnected",
        strictReady: false,
        strictReason: "gateway_server_disconnected",
      },
    },
  });

  assert.equal(model.issue.key, "reconnecting");
  assert.match(model.issue.label, /disconnected from IBKR servers/);
  assert.equal(findPopoverDetailRow(model, "Gateway").value, "connected");
  assert.equal(findPopoverDetailRow(model, "IBKR server").value, "disconnected");
  assert.equal(
    findPopoverDetailRow(model, "Ready reason").value,
    "gateway_server_disconnected",
  );
  assert.equal(model.tiles.find((tile) => tile.label === "Gateway").value, "Server offline");
});

test("buildHeaderIbkrPopoverModel keeps token state in details unless it causes a failure", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
        bridgeTokenConfigured: false,
        legacyIbkrEnvPresent: false,
      },
    },
  });

  assert.equal(model.issue.key, "healthy");
  assert.equal(findPopoverDetailRow(model, "Bridge token").value, "missing");
});

test("buildHeaderIbkrPopoverModel prioritizes ready-state stream and legacy warnings", () => {
  const streamGapModel = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
        legacyIbkrEnvPresent: true,
      },
    },
    latencyStats: {
      stream: {
        streamGapCount: 3,
      },
    },
  });
  assert.equal(streamGapModel.issue.key, "stream-gaps");
  assert.equal(streamGapModel.issue.severity, "warning");
  assert.equal(streamGapModel.priorityDetailGroup, "stream");

  assert.notEqual(
    buildHeaderIbkrPopoverModel({
      connection: {
        configured: true,
        reachable: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
      },
      latencyStats: {
        stream: {
          streamGapCount: 3,
          recentGapCount: 0,
        },
      },
    }).issue.key,
    "stream-gaps",
  );

  const legacyModel = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
        legacyIbkrEnvPresent: true,
      },
    },
  });

  assert.equal(legacyModel.issue.key, "legacy-env");
  assert.equal(legacyModel.issue.severity, "warning");
  assert.equal(legacyModel.priorityDetailGroup, "connection");
  assert.equal(legacyModel.autoOpenDetails, true);
});

test("buildHeaderIbkrPopoverModel keeps ready-state last errors in details", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
        lastError: "historical pacing warning",
      },
    },
  });

  assert.equal(model.issue.key, "healthy");
  assert.doesNotMatch(model.issue.label, /historical pacing warning/);
  assert.equal(findPopoverDetailRow(model, "Last error").wrap, true);
});

test("buildHeaderIbkrPopoverModel keeps diagnostics timeouts out of Gateway errors", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeError: "Request timed out after 8000ms",
  });

  assert.equal(model.issue.key, "healthy");
  assert.equal(findPopoverDetailRow(model, "Last error"), undefined);
  assert.equal(findPopoverDetailRow(model, "Diagnostics").value, "unavailable");
});

test("buildHeaderIbkrPopoverModel separates connected Gateway from stale data stream", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "stale",
      strictReady: false,
      strictReason: "stream_not_fresh",
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "stale",
        streamStateReason: "stream_not_fresh",
        strictReady: false,
        strictReason: "stream_not_fresh",
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        streamGapCount: 0,
        lastEventAgeMs: 973_138,
      },
    },
  });

  assert.equal(model.health.status, "stale");
  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Live mode"],
      ["Stream", "Silent"],
    ],
  );
  assert.match(model.tiles.find((tile) => tile.label === "Stream").detail, /since event/);
  assert.equal(findPopoverDetailRow(model, "Stream state").value, "stale");
});

test("buildHeaderIbkrPopoverModel keeps quote-stream reconnects out of Gateway loss state", () => {
  const lastError =
    "Error validating request.-'bO' : cause - Snapshot market data subscription is not applicable to generic ticks";
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "reconnecting",
      strictReady: false,
      strictReason: "stream_not_fresh",
      lastError,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "reconnecting",
        streamStateReason: "quote_stream_error",
        strictReady: false,
        strictReason: "stream_not_fresh",
        lastError,
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 2,
        unionSymbolCount: 1,
        streamGapCount: 0,
        lastEventAgeMs: 973_138,
      },
    },
  });

  assert.equal(model.health.status, "healthy");
  assert.equal(model.issue.key, "quote-stream-reconnecting");
  assert.equal(model.issue.severity, "warning");
  assert.match(model.issue.label, /quote stream is reconnecting/i);
  assert.equal(model.tiles.find((tile) => tile.label === "Gateway").value, "Connected");
  assert.equal(model.tiles.find((tile) => tile.label === "Data").value, "Live mode");
  assert.equal(model.tiles.find((tile) => tile.label === "Stream").value, "Reconnecting");
  assert.equal(findPopoverDetailRow(model, "Last error").value, lastError);
});

test("buildHeaderIbkrPopoverModel gives market-closed stream a unique connected readout", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "quiet",
      streamStateReason: "market_session_quiet",
      strictReady: false,
      strictReason: "market_session_quiet",
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "quiet",
        streamStateReason: "market_session_quiet",
        strictReady: false,
        strictReason: "market_session_quiet",
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        streamGapCount: 0,
        lastEventAgeMs: null,
      },
    },
  });

  assert.equal(model.health.status, "market-closed");
  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Live mode"],
      ["Stream", "Market closed"],
    ],
  );
  assert.equal(model.issue.key, "market-closed");
  assert.match(model.issue.label, /market session is closed/i);
  assert.equal(findPopoverDetailRow(model, "Stream state").value, "market closed");
  assert.equal(findPopoverDetailRow(model, "State reason").value, "market_session_quiet");
});

test("buildHeaderIbkrPopoverModel exposes provider and line usage summaries", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      providers: {
        massive: {
          configured: true,
          status: "ok",
          baseUrl: "https://api.massive.com",
          lastSuccessAt: new Date().toISOString(),
          lastFailureAt: null,
          lastError: null,
        },
      },
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
        streams: {
          marketDataAdmission: {
            activeLineCount: 77,
            accountMonitorLineCount: 12,
            accountMonitorRemainingLineCount: 8,
            flowScannerLineCount: 34,
            flowScannerRemainingLineCount: 6,
            leaseCount: 38,
            budget: {
              maxLines: 200,
              accountMonitorLineCap: 20,
              flowScannerLineCap: 40,
            },
            poolUsage: {
              "account-monitor": {
                activeLineCount: 12,
                maxLines: 20,
                remainingLineCount: 8,
                strict: true,
              },
              "flow-scanner": {
                activeLineCount: 34,
                maxLines: 40,
                remainingLineCount: 6,
                strict: true,
              },
              visible: {
                activeLineCount: 18,
                maxLines: 88,
                remainingLineCount: 70,
              },
            },
            counters: {},
          },
        },
      },
    },
  });

  assert.deepEqual(
    model.providerRows.map((row) => [row.label, row.value]),
    [
      ["IBKR", "Ready"],
      ["Massive", "OK"],
    ],
  );
  assert.equal(model.lineUsage.summary, "77 of 200");
  assert.equal(model.compactLineUsage.used, 77);
  assert.equal(model.compactLineUsage.cap, 200);
  assert.equal(model.compactLineUsage.free, 123);
  assert.equal(model.compactLineUsage.percent, 38.5);
  assert.equal(findPopoverDetailRow(model, "Massive").value.startsWith("OK · last "), true);
  assert.deepEqual(
    model.lineUsage.rows
      .filter((row) =>
        row.id === "account-monitor" ||
        row.id === "flow-scanner" ||
        row.id === "total"
      )
      .map((row) => [row.id, row.used, row.cap, row.free]),
    [
      ["account-monitor", 12, 20, 8],
      ["flow-scanner", 34, 40, 6],
      ["total", 77, 200, 123],
    ],
  );
});

test("buildHeaderIbkrPopoverModel surfaces Massive REST and WebSocket details", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      providers: {
        massive: {
          configured: true,
          status: "ok",
          baseUrl: "https://api.massive.com",
          lastSuccessAt: new Date().toISOString(),
        },
        massive: {
          configured: true,
          providerIdentity: "massive",
          baseUrlHost: "api.massive.com",
          stocksRealtimeConfigured: true,
          rest: {
            status: "ok",
            lastRequest: {
              purpose: "bars",
              symbol: "SPY",
              timeframe: "1 minute",
              resultCount: 2,
              durationMs: 42,
            },
            recentRequests: [],
          },
          websocket: {
            status: "ok",
            mode: "real-time",
            activeChannels: ["AM"],
            availableChannels: ["AM", "Q", "T"],
            subscribedSymbolCount: 8,
            activeConsumerCount: 1,
            eventCount: 22,
            lastMessageAgeMs: 750,
          },
        },
      },
    },
  });

  assert.deepEqual(
    model.providerRows.map((row) => [row.label, row.value]),
    [
      ["IBKR", "Ready"],
      ["Massive", "OK"],
    ],
  );
  assert.match(model.providerRows[1].detail, /WS AM/);
  assert.equal(model.providerRows[1].statusIconKey, "check");
  assert.equal(model.providerRows[1].host, "api.massive.com");
  assert.deepEqual(
    model.providerRows[1].summary.map((lane) => [lane.id, lane.iconKey, lane.statusIconKey]),
    [
      ["rest", "database", "check"],
      ["websocket", "websocket", "check"],
    ],
  );
  assert.ok(
    model.providerRows[1].summary[0].chips.some(
      (chip) => chip.iconKey === "hash" && chip.label === "SPY",
    ),
  );
  assert.ok(
    model.providerRows[1].summary[1].channels.some(
      (channel) => channel.label === "AM" && channel.active === true,
    ),
  );
  const massiveGroup = model.detailGroups.find((group) => group.title === "Massive");
  assert.ok(massiveGroup);
  assert.equal(
    massiveGroup.rows.find((row) => row.label === "REST")?.value,
    "bars SPY 1 minute · 2 rows",
  );
  assert.equal(
    massiveGroup.rows.find((row) => row.label === "WebSocket")?.value,
    "AM",
  );
});

test("buildHeaderIbkrPopoverModel keeps Massive visible when runtime provider diagnostics lag", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        streamFresh: true,
      },
    },
    lineUsageSnapshot: {
      streams: {
        stockAggregates: {
          provider: "massive-websocket",
          activeProvider: "massive-websocket",
          activeConsumerCount: 1,
          unionSymbolCount: 37,
          eventCount: 420,
          lastAggregateAgeMs: 250,
          massiveDelayedWebSocket: {
            configured: true,
            providerIdentity: "massive",
            mode: "real-time",
            socketHost: "socket.massive.com",
            availableChannels: ["AM"],
            subscribedChannels: ["AM"],
            connected: true,
            authState: "authenticated",
            subscribedSymbolCount: 37,
            activeConsumerCount: 1,
            eventCount: 420,
            lastMessageAgeMs: 250,
          },
        },
      },
    },
  });

  const massiveRow = model.providerRows.find((row) => row.label === "Massive");
  assert.ok(massiveRow);
  assert.equal(massiveRow.value, "OK");
  assert.match(massiveRow.detail, /WS AM/);
  assert.ok(
    massiveRow.summary[1].chips.some(
      (chip) => chip.iconKey === "hash" && chip.label === "37 sym",
    ),
  );
  assert.ok(model.detailGroups.find((group) => group.title === "Massive"));
});

test("buildHeaderIbkrPopoverModel does not invent Massive while provider diagnostics load", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        strictReady: true,
      },
    },
  });

  assert.deepEqual(
    model.providerRows.map((row) => row.label),
    ["IBKR"],
  );
});

test("buildHeaderIbkrPopoverModel keeps line usage when runtime diagnostics are unavailable", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeError: "Request timed out after 6500ms",
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 77,
        accountMonitorLineCount: 12,
        flowScannerLineCount: 34,
        budget: {
          maxLines: 200,
          accountMonitorLineCap: 20,
          flowScannerLineCap: 40,
        },
        poolUsage: {
          "account-monitor": {
            activeLineCount: 12,
            maxLines: 20,
            remainingLineCount: 8,
            strict: true,
          },
          "flow-scanner": {
            activeLineCount: 34,
            maxLines: 40,
            remainingLineCount: 6,
            strict: true,
          },
        },
        counters: {},
      },
    },
  });

  assert.equal(model.lineUsage.available, true);
  assert.equal(model.lineUsage.summary, "77 of 200");
  assert.deepEqual(
    model.lineUsage.rows
      .filter((row) =>
        row.id === "account-monitor" ||
        row.id === "flow-scanner" ||
        row.id === "total"
      )
      .map((row) => [row.id, row.used, row.cap, row.free]),
    [
      ["account-monitor", 12, 20, 8],
      ["flow-scanner", 34, 40, 6],
      ["total", 77, 200, 123],
    ],
  );
});

test("buildHeaderIbkrPopoverModel omits retired watchlist line rows", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 121,
        visibleLineCount: 120,
        watchlistLineCount: 0,
        budget: {
          maxLines: 200,
          visibleLineCap: 120,
          watchlistLineCap: 0,
          flowScannerLineCap: 80,
        },
        poolUsage: {
          visible: {
            activeLineCount: 120,
            maxLines: 120,
            remainingLineCount: 0,
          },
          watchlist: {
            activeLineCount: 0,
            maxLines: 0,
            effectiveMaxLines: 0,
            remainingLineCount: 0,
            strict: true,
          },
          "flow-scanner": {
            activeLineCount: 0,
            maxLines: 80,
            remainingLineCount: 80,
            strict: true,
          },
        },
        counters: {},
      },
      watchlistPrewarm: {
        primaryActiveSymbolCount: 118,
        primarySymbolLimit: 120,
      },
    },
  });

  assert.equal(
    model.lineUsage.rows.some((row) => row.id === "watchlist"),
    false,
  );
  assert.equal("watchlist" in (model.lineUsage.pools || {}), false);
});

test("buildHeaderIbkrPopoverModel uses one active line meter with pending reconciliation", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 143,
        accountMonitorLineCount: 3,
        flowScannerLineCount: 10,
        budget: {
          maxLines: 190,
          flowScannerLineCap: 100,
        },
        poolUsage: {
          "account-monitor": {
            activeLineCount: 3,
            maxLines: 10,
            remainingLineCount: 7,
            strict: true,
          },
          "flow-scanner": {
            activeLineCount: 10,
            maxLines: 100,
            effectiveMaxLines: 40,
            remainingLineCount: 30,
            strict: true,
          },
        },
        counters: {},
      },
      bridge: {
        activeLineCount: 15,
        lineBudget: 190,
        remainingLineCount: 175,
        diagnostics: {
          pressure: "stalled",
          subscriptions: {
            activeEquitySubscriptions: 14,
            activeOptionSubscriptions: 1,
          },
        },
      },
      drift: {
        admissionVsBridgeLineDelta: 128,
        reconciliation: {
          status: "api_active_bridge_missing",
          apiLineCount: 143,
          bridgeLineCount: 15,
        },
      },
      warmup: {
        state: "pending",
        targetLineCount: 90,
        activeBridgeLineCount: 63,
        pendingLineCount: 27,
        accountTargetLineCount: 4,
        accountPendingLineCount: 1,
        visibleTargetLineCount: 86,
        visiblePendingLineCount: 26,
      },
    },
  });

  assert.equal(model.lineUsage.summary, "143 of 190");
  assert.equal(model.lineUsage.activeLineCount, 143);
  assert.equal(model.lineUsage.requestedLineCount, 143);
  assert.equal(model.lineUsage.pendingLineCount, 128);
  assert.equal(model.lineUsage.foregroundPendingLineCount, 27);
  assert.equal(model.lineUsage.requestedSummary, "143 of 190");
  assert.equal(model.lineUsage.demandSummary, "143 of 190");
  assert.equal(model.lineUsage.bridge.summary, "15 of 190");
  assert.equal(model.compactLineUsage.used, 143);
  assert.equal(model.compactLineUsage.cap, 190);
  assert.equal(model.compactLineUsage.free, 47);
  assert.equal(model.compactLineUsage.summary, "143 of 190");
  assert.equal(model.lineUsage.drift.label, "pending bridge");
  assert.equal(model.lineUsage.warmup.pendingLineCount, 27);
  assert.equal(model.lineUsage.warmup.accountPendingLineCount, 1);
});

test("buildHeaderIbkrPopoverModel keeps broker capacity separate from usable fill target", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 189,
        budget: {
          maxLines: 200,
          configuredMaxLines: 200,
          bridgeLineBudget: 200,
          reserveLines: 10,
          usableLines: 190,
          targetFillLines: 190,
        },
        poolUsage: {},
        counters: {},
      },
      allocation: {
        activeLineCount: 189,
        targetFillLines: 190,
        remainingToTargetLineCount: 1,
        bridgeLineBudget: 200,
      },
      bridge: {
        activeLineCount: 200,
        lineBudget: 200,
        remainingLineCount: 0,
      },
    },
  });

  assert.equal(model.lineUsage.summary, "189 of 200");
  assert.equal(model.compactLineUsage.used, 189);
  assert.equal(model.compactLineUsage.cap, 200);
  assert.equal(model.compactLineUsage.free, 11);
  assert.equal(model.compactLineUsage.targetFillLines, 190);
  assert.equal(model.compactLineUsage.remainingToTargetLineCount, 1);
  assert.equal(model.compactLineUsage.reserveLineCount, 10);
  assert.equal(model.compactLineUsage.summary, "189 of 200");
});

test("buildHeaderIbkrPopoverModel fills account monitor line usage for legacy diagnostics", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      strictReady: true,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streams: {
          marketDataAdmission: {
            activeLineCount: 100,
            flowScannerLineCount: 0,
            budget: {
              maxLines: 200,
              flowScannerLineCap: 40,
            },
            poolUsage: {
              visible: {
                activeLineCount: 40,
                maxLines: 100 + 8,
                remainingLineCount: 48 + 20,
              },
              convenience: {
                activeLineCount: 80,
                maxLines: 0,
                remainingLineCount: 0,
              },
            },
            counters: {},
          },
        },
      },
    },
  });

  assert.deepEqual(
    model.lineUsage.rows
      .filter((row) =>
        row.id === "account-monitor" ||
        row.id === "visible" ||
        row.id === "total"
      )
      .map((row) => [row.id, row.used, row.cap, row.free]),
    [
      ["account-monitor", 0, 30, 30],
      ["visible", 40, 78, 38],
      ["total", 100, 200, 100],
    ],
  );
});

test("buildHeaderIbkrPopoverModel shows stream standby when no quote stream is requested", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "quiet",
      streamStateReason: "no_active_quote_consumers",
      strictReady: true,
      strictReason: null,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
        strictReason: null,
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        streamGapCount: 0,
        lastEventAgeMs: null,
      },
    },
  });

  assert.equal(model.health.status, "no-subscribers");
  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Live mode"],
      ["Stream", "Standby"],
    ],
  );
  assert.equal(model.issue.key, "no-subscribers");
  assert.match(model.issue.label, /will start when a live panel requests it/i);
  assert.equal(
    findPopoverDetailRow(model, "Stream state").value,
    "standby",
  );
  assert.equal(
    findPopoverDetailRow(model, "State reason").value,
    "no_active_quote_consumers",
  );
});

test("buildHeaderIbkrPopoverModel does not show stream standby when stream counters are live", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: false,
      streamState: "quiet",
      streamStateReason: "no_active_quote_consumers",
      strictReady: false,
      strictReason: null,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: false,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: false,
        strictReason: null,
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 3,
        unionSymbolCount: 79,
        streamGapCount: 0,
        lastEventAgeMs: 250,
      },
    },
  });

  assert.equal(model.health.status, "healthy");
  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Live mode"],
      ["Stream", "3 / 79"],
    ],
  );
  assert.equal(findPopoverDetailRow(model, "Stream state").value, "live");
});

test("buildHeaderIbkrPopoverModel avoids empty live stream count labels", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: true,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: true,
      streamFresh: true,
      streamState: "live",
      streamStateReason: "fresh_stream_event",
      strictReady: true,
      strictReason: null,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: true,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: true,
        streamFresh: true,
        streamState: "live",
        streamStateReason: "fresh_stream_event",
        strictReady: true,
        strictReason: null,
      },
    },
    latencyStats: {
      stream: {},
    },
  });

  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Live mode"],
      ["Stream", "Live"],
    ],
  );
});

test("buildHeaderIbkrPopoverModel keeps delayed data distinct from stream standby", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      liveMarketDataAvailable: false,
      healthFresh: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: false,
      streamFresh: false,
      streamState: "quiet",
      streamStateReason: "no_active_quote_consumers",
      strictReady: false,
      strictReason: null,
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        reachable: true,
        connected: true,
        authenticated: true,
        liveMarketDataAvailable: false,
        healthFresh: true,
        accountsLoaded: true,
        configuredLiveMarketDataMode: false,
        streamFresh: false,
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: false,
        strictReason: null,
      },
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 0,
        unionSymbolCount: 0,
        streamGapCount: 0,
        lastEventAgeMs: null,
      },
    },
  });

  assert.equal(model.health.status, "delayed");
  assert.deepEqual(
    model.tiles.map((tile) => [tile.label, tile.value]),
    [
      ["Gateway", "Connected"],
      ["Auth", "Yes"],
      ["Data", "Delayed"],
      ["Stream", "Standby"],
    ],
  );
  assert.equal(model.issue.key, "delayed");
  assert.equal(
    findPopoverDetailRow(model, "Stream state").value,
    "standby",
  );
});
