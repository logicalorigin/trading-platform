import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleOff,
  PlugZap,
  RadioTower,
} from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens";

const EMPTY_ACCOUNTS = [];

export const formatIbkrPingMs = (value) => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.max(0, Math.round(value))}ms`;
};

const formatRelativeTimeShort = (value) => {
  if (!value) {
    return "--";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "--";
  }

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 5_000) return "now";
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1000)}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.round(elapsedMs / 60_000)}m ago`;
  return `${Math.round(elapsedMs / 3_600_000)}h ago`;
};

const fallbackConnection = (session, key) => {
  const bridge = session?.ibkrBridge;
  const configured = Boolean(session?.configured?.ibkr);
  const activeKey = bridge?.transport === "tws" ? "tws" : "clientPortal";
  const active = configured && key === activeKey;

  return {
    transport: key === "tws" ? "tws" : "client_portal",
    role: key === "tws" ? "market_data" : "account",
    configured: active,
    reachable: active ? Boolean(bridge?.connected) : false,
    authenticated: active ? Boolean(bridge?.authenticated) : false,
    competing: active ? Boolean(bridge?.competing) : false,
    target: active ? bridge?.connectionTarget || null : null,
    mode: active ? bridge?.sessionMode || session?.environment || null : null,
    clientId: active ? bridge?.clientId ?? null : null,
    selectedAccountId: active ? bridge?.selectedAccountId || null : null,
    accounts: active ? bridge?.accounts || EMPTY_ACCOUNTS : EMPTY_ACCOUNTS,
    lastPingMs: null,
    lastPingAt: null,
    lastTickleAt: active ? bridge?.lastTickleAt || null : null,
    lastError: active ? bridge?.lastError || bridge?.lastRecoveryError || null : null,
    marketDataMode: active ? bridge?.marketDataMode || null : null,
    liveMarketDataAvailable: active ? bridge?.liveMarketDataAvailable ?? null : null,
  };
};

export const getIbkrConnection = (session, key) =>
  session?.ibkrBridge?.connections?.[key] || fallbackConnection(session, key);

export const getIbkrConnectionTone = (connection) => {
  if (!connection?.configured) {
    return {
      label: "offline",
      color: T.textDim,
      Icon: CircleOff,
      wave: "flat",
    };
  }

  if (connection.liveMarketDataAvailable === false) {
    return {
      label: "delayed",
      color: T.amber,
      Icon: Activity,
      wave: "medium",
    };
  }

  if (connection.authenticated) {
    return {
      label: "online",
      color: T.green,
      Icon: CircleCheck,
      wave: "fast",
    };
  }

  if (connection.reachable) {
    return {
      label: "login",
      color: T.amber,
      Icon: PlugZap,
      wave: "medium",
    };
  }

  if (connection.lastError) {
    return {
      label: "error",
      color: T.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  return {
    label: "ready",
    color: T.textDim,
    Icon: RadioTower,
    wave: "flat",
  };
};

const resolveWaveDuration = (connection, tone) => {
  const ping = connection?.lastPingMs;
  if (!connection?.configured || !Number.isFinite(ping)) {
    return null;
  }
  if (tone.wave === "fast" || ping <= 180) return "0.9s";
  if (tone.wave === "medium" || ping <= 650) return "1.45s";
  return "2.15s";
};

const buildConnectionTitle = (label, connection, tone) => {
  const details = [
    `${label}: ${tone.label}`,
    `role ${String(connection?.role || "").replace(/_/g, " ") || "--"}`,
    `target ${connection?.target || "--"}`,
    `ping ${formatIbkrPingMs(connection?.lastPingMs)}`,
    `heartbeat ${formatRelativeTimeShort(connection?.lastTickleAt)}`,
  ];

  if (connection?.mode) details.push(`mode ${connection.mode}`);
  if (connection?.clientId != null) details.push(`client ${connection.clientId}`);
  if (connection?.selectedAccountId) {
    details.push(`account ${connection.selectedAccountId}`);
  }
  if (connection?.lastError) details.push(connection.lastError);

  return details.join(" | ");
};

export const IbkrPingWavelength = ({ connection, tone }) => {
  const duration = resolveWaveDuration(connection, tone);
  const active = Boolean(duration);
  const color = active ? tone.color : T.textMuted;

  return (
    <span
      aria-hidden="true"
      data-ibkr-wave
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: dim(2),
        width: dim(32),
        height: dim(10),
        opacity: active ? 1 : 0.55,
      }}
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          style={{
            width: dim(5),
            height: dim(2 + index * 2),
            background: color,
            display: "inline-block",
            transformOrigin: "center",
            animation: active
              ? `ibkrWavePulse ${duration} ease-in-out ${index * 110}ms infinite`
              : "none",
          }}
        />
      ))}
    </span>
  );
};

export const IbkrConnectionLane = ({
  label,
  connection,
  compact = false,
}) => {
  const tone = getIbkrConnectionTone(connection);
  const Icon = tone.Icon;

  return (
    <div
      title={buildConnectionTitle(label, connection, tone)}
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "auto 1fr auto" : "auto 1fr auto auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: compact ? dim(112) : dim(150),
      }}
    >
      <Icon size={dim(13)} strokeWidth={2.2} color={tone.color} />
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: sp(5),
          minWidth: 0,
          color: T.text,
          fontSize: fs(9),
          fontWeight: 800,
          fontFamily: T.sans,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span
          style={{
            color: tone.color,
            fontSize: fs(8),
            fontWeight: 800,
          }}
        >
          {tone.label.toUpperCase()}
        </span>
      </span>
      <IbkrPingWavelength connection={connection} tone={tone} />
      {!compact ? (
        <span
          style={{
            color: T.textDim,
            fontSize: fs(8),
            fontFamily: T.mono,
            textAlign: "right",
            minWidth: dim(34),
            whiteSpace: "nowrap",
          }}
        >
          {formatIbkrPingMs(connection?.lastPingMs)}
        </span>
      ) : null}
    </div>
  );
};

export const IbkrConnectionStatusPair = ({
  session,
  compact = false,
}) => {
  const clientPortal = getIbkrConnection(session, "clientPortal");
  const tws = getIbkrConnection(session, "tws");

  return (
    <div
      style={{
        display: "grid",
        gap: sp(5),
        minWidth: 0,
      }}
    >
      <IbkrConnectionLane
        label="CP"
        connection={clientPortal}
        compact={compact}
      />
      <IbkrConnectionLane label="TWS" connection={tws} compact={compact} />
    </div>
  );
};
