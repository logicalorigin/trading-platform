import assert from "node:assert/strict";
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
  IbkrPingWavelength,
  isIbkrWaveActive,
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus.jsx";
import { bridgeRuntimeTone } from "./bridgeRuntimeModel.js";
import { buildHeaderIbkrPopoverModel } from "./ibkrPopoverModel.js";
import { T } from "../../lib/uiTokens.jsx";
import { streamStateTokenVar } from "./streamSemantics";

const findPopoverDetailRow = (model, label) =>
  model.detailGroups
    .flatMap((group) => group.rows)
    .find((row) => row.label === label);

test("formatIbkrPingMs formats millisecond and second values", () => {
  assert.equal(formatIbkrPingMs(null), "--");
  assert.equal(formatIbkrPingMs(42.4), "42ms");
  assert.equal(formatIbkrPingMs(1_250), "1.3s");
  assert.equal(formatIbkrPingMs(12_500), "13s");
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
    "stale",
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
    "no quote subscribers",
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
      accountsLoaded: true,
      strictReady: false,
    }).label,
    "reconnecting",
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
    "capacity limited",
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
    T.green,
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
    T.accent,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: true,
      authenticated: false,
    }).color,
    T.amber,
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
    T.amber,
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
    T.red,
  );
  assert.equal(
    getIbkrConnectionTone({
      configured: true,
      reachable: false,
      authenticated: false,
    }).color,
    T.red,
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
    T.accent,
  );
  assert.equal(
    bridgeRuntimeTone({
      configured: { ibkr: true },
      ibkrBridge: {
        connected: true,
        authenticated: true,
      },
    }).color,
    T.accent,
  );
  assert.equal(
    bridgeRuntimeTone({
      configured: { ibkr: true },
      ibkrBridge: {
        connected: true,
        authenticated: false,
      },
    }).color,
    T.amber,
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
      "no quote subscribers",
      "market closed",
      "quiet stream",
      "online",
      "stale",
      "capacity limited",
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
    ["STANDBY", "CLOSED", "QUIET", "CAPACITY"],
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
      tone: { color: T.green, wave: "fast" },
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
        streamState: "quiet",
        streamStateReason: "no_active_quote_consumers",
        strictReady: true,
      },
    }).status,
    "no-subscribers",
  );
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
  assert.equal(
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
    }).issue.key,
    "stream-gaps",
  );

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
      ["Data", "Stale stream"],
      ["Stream", "Silent"],
    ],
  );
  assert.match(model.tiles.find((tile) => tile.label === "Stream").detail, /since event/);
  assert.equal(findPopoverDetailRow(model, "Stream state").value, "stale");
});

test("buildHeaderIbkrPopoverModel preserves full reconnecting Gateway error text", () => {
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

  assert.equal(model.issue.key, "reconnecting");
  assert.match(model.issue.label, /Gateway is authenticated and the quote stream is reconnecting/);
  assert.match(model.issue.label, /Snapshot market data subscription is not applicable to generic ticks/);
  assert.doesNotMatch(model.issue.label, /\.\.\.$/);
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
      ["Data", "Live"],
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
        polygon: {
          configured: true,
          status: "ok",
          baseUrl: "https://api.polygon.io",
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
      ["Polygon", "OK"],
    ],
  );
  assert.equal(model.lineUsage.summary, "77 / 200");
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
  assert.equal(model.lineUsage.summary, "77 / 200");
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
      ["account-monitor", 0, 20, 20],
      ["visible", 40, 88, 48],
      ["total", 100, 200, 100],
    ],
  );
});

test("buildHeaderIbkrPopoverModel shows missing quote subscribers when no quote stream subscribers are active", () => {
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
      ["Data", "Live"],
      ["Stream", "No quote subscribers"],
    ],
  );
  assert.equal(model.issue.key, "no-subscribers");
  assert.match(model.issue.label, /no UI panel is subscribed/i);
  assert.equal(
    findPopoverDetailRow(model, "Stream state").value,
    "no quote-stream subscribers",
  );
  assert.equal(
    findPopoverDetailRow(model, "State reason").value,
    "no_active_quote_consumers",
  );
});

test("buildHeaderIbkrPopoverModel does not show missing quote subscribers when stream counters are live", () => {
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
      ["Data", "Live"],
      ["Stream", "3 / 79"],
    ],
  );
  assert.equal(findPopoverDetailRow(model, "Stream state").value, "live");
});

test("buildHeaderIbkrPopoverModel keeps delayed data distinct from missing quote subscribers", () => {
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
      ["Stream", "No quote subscribers"],
    ],
  );
  assert.equal(model.issue.key, "delayed");
  assert.equal(
    findPopoverDetailRow(model, "Stream state").value,
    "no quote-stream subscribers",
  );
});
