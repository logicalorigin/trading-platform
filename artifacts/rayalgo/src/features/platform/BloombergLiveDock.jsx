import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Ellipsis,
  ExternalLink,
  FastForward,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  PictureInPicture2,
  RotateCcw,
  RotateCw,
  Scan,
  Tv,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  T,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens";
import { useRuntimeWorkloadFlag } from "./workloadStats";
import { AppTooltip } from "@/components/ui/tooltip";


const BLOOMBERG_LIVE_URL = "https://www.bloomberg.com/live/us";
const BLOOMBERG_HLS_SOURCES = [
  {
    id: "phoenix-us",
    label: "U.S. BTV+",
    url: "https://www.bloomberg.com/media-manifest/streams/phoenix-us.m3u8",
  },
  {
    id: "us",
    label: "U.S. BTV",
    url: "https://www.bloomberg.com/media-manifest/streams/us.m3u8",
  },
];
const BLOOMBERG_SOURCE_MODE_AUTO = "auto";
const BLOOMBERG_SOURCE_MODE_MANUAL = "manual";
const BLOOMBERG_LAST_GOOD_SOURCE_STORAGE_KEY =
  "rayalgo:bloomberg:lastGoodSource:v1";
const BLOOMBERG_LAST_GOOD_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const BLOOMBERG_SOURCE_COOLDOWN_MS = 5 * 60 * 1000;
const BLOOMBERG_WATCHDOG_INTERVAL_MS = 3_000;
const BLOOMBERG_WATCHDOG_STALL_MS = 10_000;
const BLOOMBERG_WATCHDOG_EMPTY_BUFFER_MS = 8_000;
const BLOOMBERG_WATCHDOG_RELOAD_LIMIT = 1;
const BLOOMBERG_DIAGNOSTICS_GLOBAL =
  "__RAYALGO_BLOOMBERG_DIAGNOSTICS__";
const BLOOMBERG_DOCK_Z_INDEX = 10020;
const BLOOMBERG_DVR_BUFFER_SECONDS = 30;
const BLOOMBERG_LIVE_EDGE_SLACK_SECONDS = 1;
const BLOOMBERG_HLS_LIVE_SYNC_DURATION_COUNT = 1;
const BLOOMBERG_HLS_LIVE_MAX_LATENCY_DURATION_COUNT = 3;
const BLOOMBERG_HLS_MAX_SYNC_PLAYBACK_RATE = 1.18;
const BLOOMBERG_AUTO_CATCHUP_SOFT_LAG_SECONDS = 2.5;
const BLOOMBERG_AUTO_CATCHUP_FAST_LAG_SECONDS = 5;
const BLOOMBERG_AUTO_CATCHUP_HARD_SEEK_SECONDS = 12;
const BLOOMBERG_AUTO_CATCHUP_SOFT_RATE = 1.04;
const BLOOMBERG_AUTO_CATCHUP_FAST_RATE = 1.12;
const BLOOMBERG_SEEK_STEP_SECONDS = 10;
const BLOOMBERG_PLAYBACK_RATES = [1, 1.25, 1.5, 2];
const BLOOMBERG_SCRUB_STEPS = 1000;
const BLOOMBERG_DEFAULT_VOLUME = 1;
const BLOOMBERG_STARTUP_TIMEOUT_MS = 12_000;
const BLOOMBERG_STARTUP_MANIFEST_FAILURE_LIMIT = 2;
const BLOOMBERG_STARTUP_FRAGMENT_FAILURE_LIMIT = 3;

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const getBloombergSourceAt = (index) =>
  BLOOMBERG_HLS_SOURCES[index] ?? BLOOMBERG_HLS_SOURCES[0];

const getBloombergSourceIndexById = (sourceId) =>
  BLOOMBERG_HLS_SOURCES.findIndex((source) => source.id === sourceId);

const getBloombergHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

const getConfiguredWindowNumber = (name, fallback) => {
  const configured =
    typeof window === "undefined" ? NaN : Number(window[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
};

const readLastGoodBloombergSource = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BLOOMBERG_LAST_GOOD_SOURCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const sourceIndex = getBloombergSourceIndexById(parsed?.sourceId);
    if (sourceIndex < 0) return null;
    if (
      !Number.isFinite(parsed?.storedAt) ||
      Date.now() - parsed.storedAt > BLOOMBERG_LAST_GOOD_SOURCE_TTL_MS
    ) {
      window.localStorage.removeItem(BLOOMBERG_LAST_GOOD_SOURCE_STORAGE_KEY);
      return null;
    }
    return {
      sourceId: parsed.sourceId,
      sourceIndex,
      label: getBloombergSourceAt(sourceIndex).label,
      storedAt: parsed.storedAt,
    };
  } catch {
    return null;
  }
};

const getInitialBloombergSourceIndex = () => {
  const lastGood = readLastGoodBloombergSource();
  return lastGood?.sourceIndex ?? 0;
};

const rememberLastGoodBloombergSource = (source) => {
  if (typeof window === "undefined" || !source?.id) return;
  try {
    window.localStorage.setItem(
      BLOOMBERG_LAST_GOOD_SOURCE_STORAGE_KEY,
      JSON.stringify({
        sourceId: source.id,
        label: source.label,
        storedAt: Date.now(),
      }),
    );
  } catch {
    /* Storage can be unavailable in private contexts. */
  }
};

const createBloombergWatchdogState = () => ({
  lastCurrentTime: 0,
  lastAdvancedAt: 0,
  emptyBufferSince: 0,
  startLoadAttempts: 0,
  mediaRecoverAttempts: 0,
  reloadAttempts: 0,
});

const serializeBloombergCounterMap = (map) =>
  Object.fromEntries(Array.from(map.entries()));

const serializeBloombergCooldowns = (map) => {
  const now = Date.now();
  return Object.fromEntries(
    Array.from(map.entries()).map(([sourceId, expiresAt]) => [
      sourceId,
      Math.max(0, expiresAt - now),
    ]),
  );
};

const classifyBloombergError = (detail, data = {}) => {
  const normalized = String(detail || data.details || data.type || "")
    .toLowerCase();

  if (normalized.includes("manifest") || normalized.includes("playlist")) {
    return "manifest";
  }
  if (
    normalized.includes("frag") ||
    normalized.includes("segment") ||
    normalized.includes("level") ||
    normalized.includes("buffer")
  ) {
    return "segments";
  }
  if (normalized.includes("autoplay")) return "autoplay";
  if (normalized.includes("stall")) return "stall";
  if (data.type && String(data.type).toLowerCase().includes("media")) {
    return "media";
  }
  return "network";
};

const formatBloombergError = (kind, detail) => {
  const suffix = detail ? ` (${detail})` : "";
  if (kind === "manifest") return `Bloomberg playlist failed${suffix}.`;
  if (kind === "segments") return `Bloomberg video segments failed${suffix}.`;
  if (kind === "media") return `Browser media recovery failed${suffix}.`;
  if (kind === "autoplay") return `Browser autoplay blocked playback${suffix}.`;
  if (kind === "stall") return `Bloomberg playback stalled${suffix}.`;
  return `Bloomberg stream failed${suffix}.`;
};

const createBloombergDiagnosticsSnapshot = ({
  sourceIndex = 0,
  mode = BLOOMBERG_SOURCE_MODE_AUTO,
  status = "loading",
} = {}) => {
  const source = getBloombergSourceAt(sourceIndex);
  return {
    mode,
    status,
    activeSourceId: source.id,
    activeSourceLabel: source.label,
    activeSourceHost: getBloombergHost(source.url),
    variantHost: "",
    lastManifestAt: null,
    lastPlayableAt: null,
    lastErrorAt: null,
    lastErrorKind: "",
    lastErrorDetail: "",
    failoverCount: 0,
    watchdogRecoveries: 0,
    sourceReloads: 0,
    hlsRecoveries: {
      fatal: 0,
      media: 0,
      network: 0,
      parsing: 0,
    },
    sourceFailures: {},
    sourceCooldowns: {},
    lastGoodSourceId: readLastGoodBloombergSource()?.sourceId ?? null,
    updatedAt: Date.now(),
  };
};

const RoundIconButton = ({
  icon: Icon,
  onClick,
  title,
  ariaLabel,
  active = false,
  disabled = false,
  size = 36,
  prominent = false,
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interactive = !disabled;

  return (
    <AppTooltip content={title}><button
      type="button"
      onClick={onClick}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onFocus={() => interactive && setHovered(true)}
      onBlur={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => interactive && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      disabled={disabled}
      aria-label={ariaLabel || title}
      style={{
        width: dim(size),
        height: dim(size),
        borderRadius: "999px",
        border: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active
          ? "rgba(255,255,255,0.22)"
          : hovered
            ? prominent
              ? "rgba(18, 24, 36, 0.92)"
              : "rgba(16, 20, 30, 0.78)"
            : prominent
              ? "rgba(8, 11, 18, 0.82)"
              : "rgba(8, 11, 18, 0.62)",
        color: "#f8fafc",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        backdropFilter: "blur(18px)",
        boxShadow: hovered
          ? prominent
            ? "0 20px 34px rgba(0, 0, 0, 0.34)"
            : "0 14px 28px rgba(0, 0, 0, 0.28)"
          : prominent
            ? "0 14px 30px rgba(0, 0, 0, 0.26)"
            : "0 10px 24px rgba(0, 0, 0, 0.18)",
        padding: 0,
        transform: pressed
          ? "translateY(1px) scale(0.96)"
          : hovered
            ? "translateY(-1px) scale(1.04)"
            : "translateY(0) scale(1)",
        transition:
          "transform 140ms ease, background 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
      }}
    >
      <Icon size={dim(prominent ? 20 : 15)} strokeWidth={prominent ? 2.2 : 2} />
    </button></AppTooltip>
  );
};

const AudioControlButton = ({
  muted,
  volumePercent,
  onToggleMute,
  onVolumeChange,
  size = 36,
  align = "left",
}) => {
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [sliderVisible, setSliderVisible] = useState(false);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const showSlider = () => {
    clearHideTimer();
    setHovered(true);
    setSliderVisible(true);
  };

  const hideSlider = () => {
    clearHideTimer();
    setHovered(false);
    setPressed(false);
    setSliderVisible(false);
  };

  const scheduleHideSlider = () => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setHovered(false);
      setPressed(false);
      setSliderVisible(false);
      hideTimerRef.current = null;
    }, 140);
  };

  useEffect(() => () => clearHideTimer(), []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={showSlider}
      onMouseLeave={scheduleHideSlider}
      onFocusCapture={showSlider}
      onBlurCapture={(event) => {
        if (containerRef.current?.contains(event.relatedTarget)) {
          return;
        }
        hideSlider();
      }}
    >
      <AppTooltip content={muted ? "Unmute Bloomberg audio" : "Mute Bloomberg audio"}><button
        type="button"
        onClick={onToggleMute}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        aria-label={muted ? "Unmute Bloomberg audio" : "Mute Bloomberg audio"}
        style={{
          width: dim(size),
          height: dim(size),
          borderRadius: "999px",
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: hovered
            ? "rgba(16, 20, 30, 0.78)"
            : "rgba(8, 11, 18, 0.62)",
          color: "#f8fafc",
          cursor: "pointer",
          opacity: 1,
          backdropFilter: "blur(18px)",
          boxShadow: hovered
            ? "0 14px 28px rgba(0, 0, 0, 0.28)"
            : "0 10px 24px rgba(0, 0, 0, 0.18)",
          padding: 0,
          transform: pressed
            ? "translateY(1px) scale(0.96)"
            : hovered
              ? "translateY(-1px) scale(1.04)"
              : "translateY(0) scale(1)",
          transition:
            "transform 140ms ease, background 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
        }}
      >
        {muted ? (
          <VolumeX size={dim(15)} strokeWidth={2} />
        ) : (
          <Volume2 size={dim(15)} strokeWidth={2} />
        )}
      </button></AppTooltip>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: "100%",
          [align]: 0,
          width: dim(56),
          height: sp(16),
          pointerEvents: sliderVisible ? "auto" : "none",
          opacity: 0,
          zIndex: 4,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: `calc(100% + ${sp(8)}px)`,
          [align]: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(8),
          minWidth: dim(44),
          minHeight: dim(150),
          padding: sp("10px 8px"),
          borderRadius: dim(22),
          background: "rgba(8, 11, 18, 0.86)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 16px 36px rgba(0, 0, 0, 0.32)",
          opacity: sliderVisible ? 1 : 0,
          transform: sliderVisible
            ? "translateY(0) scale(1)"
            : `translateY(${dim(6)}px) scale(0.98)`,
          pointerEvents: sliderVisible ? "auto" : "none",
          transition:
            "opacity 140ms ease, transform 140ms ease, box-shadow 140ms ease",
          zIndex: 5,
        }}
      >
        <span
          style={{
            fontSize: fs(7),
            fontFamily: T.mono,
            fontWeight: 700,
            color: muted ? T.amber : "#f8fafc",
            minWidth: dim(24),
            textAlign: "center",
          }}
        >
          {volumePercent}
        </span>
        <input
          aria-label="Bloomberg stream volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePercent}
          onChange={onVolumeChange}
          style={{
            WebkitAppearance: "slider-vertical",
            appearance: "auto",
            writingMode: "vertical-lr",
            direction: "rtl",
            width: dim(18),
            height: dim(92),
            accentColor: muted ? T.amber : T.green,
            cursor: "pointer",
            margin: 0,
          }}
        />
      </div>
    </div>
  );
};

const MenuPanel = ({
  children,
  align = "right",
  top = null,
  bottom = null,
}) => (
  <div
    style={{
      position: "absolute",
      [align]: sp(8),
      ...(top != null ? { top } : {}),
      ...(bottom != null ? { bottom } : {}),
      minWidth: dim(252),
      maxHeight: dim(176),
      padding: sp(8),
      borderRadius: dim(16),
      border: "1px solid rgba(148, 163, 184, 0.16)",
      background:
        "linear-gradient(180deg, rgba(8, 11, 18, 0.98), rgba(8, 11, 18, 0.94))",
      boxShadow:
        "0 24px 50px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.03)",
      backdropFilter: "blur(18px)",
      display: "flex",
      flexDirection: "column",
      gap: sp(6),
      zIndex: BLOOMBERG_DOCK_Z_INDEX + 1,
      overflowX: "hidden",
      overflowY: "auto",
    }}
  >
    {children}
  </div>
);

const MenuSectionLabel = ({ children }) => (
  <div
    style={{
      fontSize: fs(6.5),
      fontFamily: T.mono,
      color: T.textDim,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      padding: sp("6px 10px 2px"),
    }}
  >
    {children}
  </div>
);

const MenuDivider = () => (
  <div
    style={{
      height: 1,
      background: "rgba(148, 163, 184, 0.14)",
      margin: `${sp(4)} ${sp(2)}`,
    }}
  />
);

const MenuActionButton = ({
  icon: Icon,
  onClick,
  title,
  ariaLabel,
  active = false,
  accent = false,
  disabled = false,
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const activeColor = accent ? T.accent : "#f8fafc";
  const idleColor = disabled ? T.textMuted : accent ? T.accent : T.textSec;
  const foregroundColor = active || hovered ? activeColor : idleColor;

  return (
    <AppTooltip content={title}><button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onFocus={() => !disabled && setHovered(true)}
      onBlur={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      disabled={disabled}
      aria-label={ariaLabel || title}
      style={{
        width: dim(54),
        height: dim(54),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        padding: 0,
        border: "none",
        borderRadius: dim(14),
        background: active
          ? accent
            ? `${T.accent}1c`
            : "rgba(255, 255, 255, 0.12)"
          : hovered
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(255, 255, 255, 0.03)",
        color: foregroundColor,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: hovered || active
          ? "0 14px 28px rgba(0, 0, 0, 0.24)"
          : "0 8px 18px rgba(0, 0, 0, 0.14)",
        transform: disabled
          ? "translateY(0)"
          : pressed
          ? "translateY(1px) scale(0.99)"
          : hovered
            ? "translateY(-1px)"
            : "translateY(0)",
        transition:
          "transform 140ms ease, background 140ms ease, color 140ms ease, opacity 140ms ease",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {Icon ? (
          <span
            style={{
              width: dim(40),
              height: dim(40),
              borderRadius: dim(12),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: active
                ? accent
                  ? `${T.accent}24`
                  : "rgba(255, 255, 255, 0.16)"
                : hovered
                  ? "rgba(255, 255, 255, 0.12)"
                  : "rgba(255, 255, 255, 0.07)",
              color: foregroundColor,
              flex: "0 0 auto",
              boxShadow: active || hovered
                ? "0 10px 24px rgba(0, 0, 0, 0.24)"
                : "none",
            }}
          >
            <Icon size={dim(18)} strokeWidth={2.15} />
          </span>
        ) : null}
      </span>
    </button></AppTooltip>
  );
};

const MenuSpeedButton = ({
  children,
  onClick,
  active = false,
  disabled = false,
  title,
  ariaLabel,
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <AppTooltip content={title}><button
      type="button"
      onClick={onClick}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onFocus={() => !disabled && setHovered(true)}
      onBlur={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      disabled={disabled}
      aria-label={ariaLabel || title}
      style={{
        minWidth: 0,
        minHeight: dim(30),
        border: "none",
        borderRadius: dim(10),
        background: active
          ? `${T.green}22`
          : hovered
            ? "rgba(255, 255, 255, 0.05)"
            : "rgba(255, 255, 255, 0.03)",
        color: disabled ? T.textMuted : active ? T.green : T.textSec,
        fontSize: fs(8),
        fontFamily: T.mono,
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transform: pressed
          ? "translateY(1px) scale(0.98)"
          : hovered
            ? "translateY(-1px)"
            : "translateY(0)",
        transition:
          "transform 140ms ease, background 140ms ease, color 140ms ease, opacity 140ms ease",
      }}
    >
      {children}
    </button></AppTooltip>
  );
};

const MenuInfoRow = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: sp(10),
      padding: sp("2px 10px"),
      minHeight: dim(20),
      fontFamily: T.mono,
      fontSize: fs(7),
    }}
  >
    <span style={{ color: T.textDim }}>{label}</span>
    <span
      style={{
        color: tone,
        fontWeight: 700,
        maxWidth: dim(142),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: "right",
      }}
    >
      {value || "n/a"}
    </span>
  </div>
);

export default function BloombergLiveDock() {
  const panelRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideControlsTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const mediaElementRef = useRef(null);
  const gainNodeRef = useRef(null);
  const audioPreferenceRef = useRef(true);
  const volumeRef = useRef(BLOOMBERG_DEFAULT_VOLUME);
  const transportRateRef = useRef(1);
  const followLiveEdgeRef = useRef(true);
  const wasPlayingBeforeHiddenRef = useRef(false);
  const sourceCooldownsRef = useRef(new Map());
  const sourceFailureCountsRef = useRef(new Map());
  const watchdogRef = useRef(createBloombergWatchdogState());
  const recoveryRef = useRef({
    fatalRecoveries: 0,
    mediaRecoveries: 0,
    parsingRecoveries: 0,
    networkRecoveries: 0,
    lastRecoveryAt: 0,
  });
  const diagnosticsRef = useRef(createBloombergDiagnosticsSnapshot());

  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [playerStatus, setPlayerStatus] = useState("loading");
  const [errorDetail, setErrorDetail] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [nativePipActive, setNativePipActive] = useState(false);
  const [nativePipSupported, setNativePipSupported] = useState(false);
  const [transportRate, setTransportRate] = useState(1);
  const [volume, setVolume] = useState(BLOOMBERG_DEFAULT_VOLUME);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [streamSourceMode, setStreamSourceMode] = useState(
    BLOOMBERG_SOURCE_MODE_AUTO,
  );
  const [streamSourceIndex, setStreamSourceIndex] = useState(
    getInitialBloombergSourceIndex,
  );
  const [streamDiagnostics, setStreamDiagnostics] = useState(() =>
    createBloombergDiagnosticsSnapshot({
      sourceIndex: getInitialBloombergSourceIndex(),
    }),
  );
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    bufferedStart: null,
    bufferedEnd: null,
    paused: true,
    playbackRate: 1,
    muted: false,
  });

  const syncPlaybackState = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    let bufferedStart = null;
    let bufferedEnd = null;

    if (video.buffered.length) {
      bufferedStart = video.buffered.start(0);
      bufferedEnd = video.buffered.end(video.buffered.length - 1);
    }

    setPlaybackState({
      currentTime: video.currentTime || 0,
      bufferedStart,
      bufferedEnd,
      paused: video.paused,
      playbackRate: video.playbackRate || 1,
      muted: video.muted,
    });
  }, []);

  const publishDiagnostics = useCallback((patch = {}) => {
    const next = {
      ...diagnosticsRef.current,
      ...patch,
      updatedAt: Date.now(),
    };
    diagnosticsRef.current = next;
    setStreamDiagnostics(next);
  }, []);

  const resolveAutoStreamSourceIndex = useCallback(({
    skipIndex = null,
    allowCooled = false,
    fallbackToCooled = true,
  } = {}) => {
    const now = Date.now();
    const orderedIndexes = [];
    const lastGood = readLastGoodBloombergSource();

    if (lastGood && lastGood.sourceIndex !== skipIndex) {
      orderedIndexes.push(lastGood.sourceIndex);
    }

    BLOOMBERG_HLS_SOURCES.forEach((_source, index) => {
      if (index !== skipIndex && !orderedIndexes.includes(index)) {
        orderedIndexes.push(index);
      }
    });

    const availableIndex = orderedIndexes.find((index) => {
      const source = getBloombergSourceAt(index);
      const cooldownUntil = sourceCooldownsRef.current.get(source.id) || 0;
      return allowCooled || cooldownUntil <= now;
    });

    return availableIndex ?? (fallbackToCooled ? orderedIndexes[0] ?? 0 : null);
  }, []);

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setPageVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const getDiagnostics = () => ({
      ...diagnosticsRef.current,
      sourceCooldowns: serializeBloombergCooldowns(sourceCooldownsRef.current),
      sourceFailures: serializeBloombergCounterMap(sourceFailureCountsRef.current),
    });

    window[BLOOMBERG_DIAGNOSTICS_GLOBAL] = getDiagnostics;
    return () => {
      if (window[BLOOMBERG_DIAGNOSTICS_GLOBAL] === getDiagnostics) {
        delete window[BLOOMBERG_DIAGNOSTICS_GLOBAL];
      }
    };
  }, []);

  useEffect(() => {
    const activeSource = getBloombergSourceAt(streamSourceIndex);
    publishDiagnostics({
      mode: streamSourceMode,
      status: playerStatus,
      activeSourceId: activeSource.id,
      activeSourceLabel: activeSource.label,
      activeSourceHost: getBloombergHost(activeSource.url),
      errorDetail,
      sourceCooldowns: serializeBloombergCooldowns(sourceCooldownsRef.current),
      sourceFailures: serializeBloombergCounterMap(sourceFailureCountsRef.current),
    });
  }, [
    errorDetail,
    playerStatus,
    publishDiagnostics,
    streamSourceIndex,
    streamSourceMode,
  ]);

  const revealControls = useCallback(() => {
    clearHideControlsTimer();
    setControlsVisible(true);
  }, [clearHideControlsTimer]);

  const scheduleControlsHide = useCallback((delayMs = 1400) => {
    clearHideControlsTimer();
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideControlsTimerRef.current = null;
    }, delayMs);
  }, [clearHideControlsTimer]);

  const syncAudioGain = useCallback(({
    muted = videoRef.current?.muted ?? false,
    volume: nextVolume = volumeRef.current,
  } = {}) => {
    const gainNode = gainNodeRef.current;
    if (!gainNode) return;
    gainNode.gain.value = muted ? 0 : clampNumber(nextVolume, 0, 1);
  }, []);

  const ensureAudioGraph = useCallback(async () => {
    if (typeof window === "undefined") return false;

    const video = videoRef.current;
    if (!video) return false;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return false;

    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContextCtor();
      audioContextRef.current = context;
    }

    if (mediaElementRef.current !== video) {
      try {
        mediaSourceRef.current?.disconnect();
      } catch {}
      try {
        gainNodeRef.current?.disconnect();
      } catch {}

      const sourceNode = context.createMediaElementSource(video);
      const gainNode = context.createGain();
      sourceNode.connect(gainNode);
      gainNode.connect(context.destination);

      mediaSourceRef.current = sourceNode;
      mediaElementRef.current = video;
      gainNodeRef.current = gainNode;
    }

    syncAudioGain({ muted: video.muted, volume: volumeRef.current });

    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }

    return true;
  }, [syncAudioGain]);

  const startPlayback = useCallback(async ({
    preferAudio = audioPreferenceRef.current,
  } = {}) => {
    const video = videoRef.current;
    if (!video) return false;

    const nextVolume = clampNumber(volumeRef.current, 0, 1);

    if (preferAudio) {
      video.defaultMuted = false;
      video.muted = false;
      video.volume = nextVolume;
      syncAudioGain({ muted: false, volume: nextVolume });

      await ensureAudioGraph();

      try {
        await video.play();
        setAudioBlocked(false);
        syncPlaybackState();
        return true;
      } catch {
        setAudioBlocked(true);
      }
    } else {
      setAudioBlocked(false);
    }

    video.defaultMuted = true;
    video.muted = true;
    video.volume = nextVolume;
    syncAudioGain({ muted: true, volume: nextVolume });

    try {
      await video.play();
    } catch {
      // Browser autoplay policy can still block playback.
    }

    syncPlaybackState();
    return false;
  }, [ensureAudioGraph, syncAudioGain, syncPlaybackState]);

  const handleReload = useCallback(({
    sourceIndex = streamSourceIndex,
    sourceMode = streamSourceMode,
  } = {}) => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    watchdogRef.current = createBloombergWatchdogState();
    setStreamSourceMode(sourceMode);
    setStreamSourceIndex(sourceIndex);
    setPlayerStatus("loading");
    setErrorDetail("");
    setAudioBlocked(false);
    setTransportRate(1);
    setReloadKey((current) => current + 1);
    publishDiagnostics({
      status: "loading",
      mode: sourceMode,
      activeSourceId: getBloombergSourceAt(sourceIndex).id,
      activeSourceLabel: getBloombergSourceAt(sourceIndex).label,
      activeSourceHost: getBloombergHost(getBloombergSourceAt(sourceIndex).url),
      sourceReloads: (diagnosticsRef.current.sourceReloads || 0) + 1,
      lastErrorDetail: "",
      lastErrorKind: "",
    });
  }, [publishDiagnostics, streamSourceIndex, streamSourceMode]);

  const handleStreamFailover = useCallback((detail, kind = "network") => {
    const currentSource = getBloombergSourceAt(streamSourceIndex);
    const now = Date.now();
    const cooldownMs = getConfiguredWindowNumber(
      "__RAYALGO_BLOOMBERG_SOURCE_COOLDOWN_MS__",
      BLOOMBERG_SOURCE_COOLDOWN_MS,
    );
    const failureCount =
      (sourceFailureCountsRef.current.get(currentSource.id) || 0) + 1;

    sourceFailureCountsRef.current.set(currentSource.id, failureCount);
    sourceCooldownsRef.current.set(currentSource.id, now + cooldownMs);
    const nextIndex = resolveAutoStreamSourceIndex({
      skipIndex: streamSourceIndex,
      fallbackToCooled: false,
    });

    if (nextIndex == null || nextIndex === streamSourceIndex) {
      publishDiagnostics({
        status: "error",
        lastErrorAt: now,
        lastErrorKind: kind,
        lastErrorDetail: detail || "",
        sourceFailures: serializeBloombergCounterMap(sourceFailureCountsRef.current),
        sourceCooldowns: serializeBloombergCooldowns(sourceCooldownsRef.current),
      });
      return false;
    }

    const nextSource = getBloombergSourceAt(nextIndex);
    watchdogRef.current = createBloombergWatchdogState();
    setPlayerStatus("loading");
    setErrorDetail(
      detail
        ? `${detail} · trying ${nextSource.label}`
        : `Trying ${nextSource.label}.`,
    );
    setAudioBlocked(false);
    setTransportRate(1);
    setStreamSourceMode(BLOOMBERG_SOURCE_MODE_AUTO);
    setStreamSourceIndex(nextIndex);
    setReloadKey((current) => current + 1);
    publishDiagnostics({
      mode: BLOOMBERG_SOURCE_MODE_AUTO,
      status: "loading",
      activeSourceId: nextSource.id,
      activeSourceLabel: nextSource.label,
      activeSourceHost: getBloombergHost(nextSource.url),
      lastErrorAt: now,
      lastErrorKind: kind,
      lastErrorDetail: detail || "",
      failoverCount: (diagnosticsRef.current.failoverCount || 0) + 1,
      sourceFailures: serializeBloombergCounterMap(sourceFailureCountsRef.current),
      sourceCooldowns: serializeBloombergCooldowns(sourceCooldownsRef.current),
    });
    return true;
  }, [resolveAutoStreamSourceIndex, streamSourceIndex]);

  const handleSelectAutoStreamSource = useCallback(() => {
    const sourceIndex = resolveAutoStreamSourceIndex();
    handleReload({
      sourceIndex,
      sourceMode: BLOOMBERG_SOURCE_MODE_AUTO,
    });
  }, [handleReload, resolveAutoStreamSourceIndex]);

  const handleSelectManualStreamSource = useCallback((sourceIndex) => {
    handleReload({
      sourceIndex,
      sourceMode: BLOOMBERG_SOURCE_MODE_MANUAL,
    });
  }, [handleReload]);

  const handleWatchdogRecovery = useCallback((detail, kind = "stall") => {
    const hls = hlsRef.current;
    const watchdog = watchdogRef.current;
    const now = Date.now();

    watchdog.lastAdvancedAt = now;
    watchdog.emptyBufferSince = 0;
    publishDiagnostics({
      status: "loading",
      watchdogRecoveries: (diagnosticsRef.current.watchdogRecoveries || 0) + 1,
      lastErrorAt: now,
      lastErrorKind: kind,
      lastErrorDetail: detail,
    });

    if (hls && watchdog.startLoadAttempts < 1) {
      watchdog.startLoadAttempts += 1;
      setPlayerStatus("loading");
      setErrorDetail(`${detail} · restarting live load`);
      try {
        hls.startLoad(-1);
        return;
      } catch {
        /* fall through to the next recovery tier */
      }
    }

    if (
      hls &&
      watchdog.mediaRecoverAttempts < 1 &&
      typeof hls.recoverMediaError === "function"
    ) {
      watchdog.mediaRecoverAttempts += 1;
      setPlayerStatus("loading");
      setErrorDetail(`${detail} · recovering media`);
      try {
        hls.recoverMediaError();
        return;
      } catch {
        /* fall through to source reload */
      }
    }

    if (watchdog.reloadAttempts < BLOOMBERG_WATCHDOG_RELOAD_LIMIT) {
      watchdog.reloadAttempts += 1;
      setPlayerStatus("loading");
      setErrorDetail(`${detail} · reloading source`);
      handleReload({
        sourceIndex: streamSourceIndex,
        sourceMode: streamSourceMode,
      });
      return;
    }

    if (!handleStreamFailover(detail, kind)) {
      setPlayerStatus("error");
      setErrorDetail(formatBloombergError(kind, detail));
      publishDiagnostics({
        status: "error",
        lastErrorAt: Date.now(),
        lastErrorKind: kind,
        lastErrorDetail: detail,
      });
    }
  }, [
    handleReload,
    handleStreamFailover,
    publishDiagnostics,
    streamSourceIndex,
    streamSourceMode,
  ]);

  const handleOpenBloombergLive = useCallback(() => {
    if (typeof window === "undefined") return;
    window.open(BLOOMBERG_LIVE_URL, "_blank", "noopener,noreferrer");
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setCollapsed(false);
    setMoreMenuOpen(false);
  }, []);

  const handleReopen = useCallback(() => {
    setIsOpen(true);
    setCollapsed(false);
    setPlayerStatus("loading");
    setErrorDetail("");
    setMoreMenuOpen(false);
  }, []);

  const playbackSessionEnabled = isOpen;
  const playbackSampleIntervalMs = !isOpen
    ? null
    : !playbackSessionEnabled
      ? null
      : collapsed
        ? 4_000
      : pageVisible
        ? 1_000
        : 3_000;
  const shouldForceControlsVisible =
    collapsed ||
    moreMenuOpen ||
    audioBlocked ||
    playerStatus !== "live" ||
    playbackState.paused;

  const closeMenus = useCallback(() => {
    setMoreMenuOpen(false);
  }, []);

  const getLiveTargetTime = useCallback((video) => {
    if (!video || !video.buffered.length) {
      return null;
    }

    const bufferedStart = video.buffered.start(0);
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const syncPosition = hlsRef.current?.liveSyncPosition;

    if (Number.isFinite(syncPosition)) {
      return clampNumber(syncPosition, bufferedStart, bufferedEnd);
    }

    return Math.max(
      bufferedStart,
      bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS,
    );
  }, []);

  const seekWithinBuffer = useCallback((deltaSeconds) => {
    const video = videoRef.current;
    if (!video) return;

    let nextTime = (video.currentTime || 0) + deltaSeconds;
    const hasBuffer = video.buffered.length > 0;

    if (hasBuffer) {
      const bufferedStart = video.buffered.start(0);
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const liveTarget =
        getLiveTargetTime(video) ??
        Math.max(bufferedStart, bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS);
      nextTime = Math.max(bufferedStart, nextTime);
      nextTime = Math.min(
        Math.max(bufferedStart, bufferedEnd - 0.25),
        nextTime,
      );
      followLiveEdgeRef.current = liveTarget - nextTime <= 1.25;
    } else {
      nextTime = Math.max(0, nextTime);
      followLiveEdgeRef.current = deltaSeconds >= 0;
    }

    setTransportRate(1);
    video.playbackRate = 1;
    video.currentTime = nextTime;
    syncPlaybackState();
  }, [getLiveTargetTime, syncPlaybackState]);

  const handleScrubToValue = useCallback((nextValue) => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return;

    const ratio = clampNumber(nextValue / BLOOMBERG_SCRUB_STEPS, 0, 1);
    const bufferedStart = video.buffered.start(0);
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const liveTarget =
      getLiveTargetTime(video) ??
      Math.max(bufferedStart, bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS);
    const nextTime = bufferedStart + (bufferedEnd - bufferedStart) * ratio;
    const clampedTime = clampNumber(nextTime, bufferedStart, liveTarget);
    followLiveEdgeRef.current = liveTarget - clampedTime <= 1.25;

    setTransportRate(1);
    video.playbackRate = 1;
    video.currentTime = clampedTime;
    syncPlaybackState();
  }, [getLiveTargetTime, syncPlaybackState]);

  const handleGoLive = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return;
    const bufferedStart = video.buffered.start(0);
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const liveTarget =
      getLiveTargetTime(video) ??
      Math.max(bufferedStart, bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS);
    video.currentTime = liveTarget;
    followLiveEdgeRef.current = true;
    setTransportRate(1);
    video.playbackRate = 1;
    void startPlayback();
    syncPlaybackState();
  }, [getLiveTargetTime, startPlayback, syncPlaybackState]);

  const handleTogglePlay = useCallback(() => {
    if (!playbackSessionEnabled) {
      setCollapsed(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void startPlayback();
    } else {
      video.pause();
    }
    syncPlaybackState();
  }, [playbackSessionEnabled, startPlayback, syncPlaybackState]);

  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !video.muted;
    if (nextMuted) {
      audioPreferenceRef.current = false;
      video.defaultMuted = true;
      video.muted = true;
      setAudioBlocked(false);
      syncAudioGain({ muted: true, volume: volumeRef.current });
      syncPlaybackState();
      return;
    }

    audioPreferenceRef.current = true;
    void startPlayback({ preferAudio: true });
  }, [startPlayback, syncAudioGain, syncPlaybackState]);

  const handleEnableAudio = useCallback(() => {
    audioPreferenceRef.current = true;
    void startPlayback({ preferAudio: true });
  }, [startPlayback]);

  const handleVolumeChange = useCallback((event) => {
    const nextVolume = clampNumber(Number(event.target.value) / 100, 0, 1);
    volumeRef.current = nextVolume;
    setVolume(nextVolume);

    const video = videoRef.current;
    if (!video) return;

    video.volume = nextVolume;
    if (nextVolume <= 0) {
      video.muted = true;
      audioPreferenceRef.current = false;
      setAudioBlocked(false);
    } else if (audioPreferenceRef.current) {
      video.muted = false;
    }

    syncAudioGain({
      muted: video.muted,
      volume: nextVolume,
    });
    syncPlaybackState();
  }, [syncAudioGain, syncPlaybackState]);

  const handleSetPlaybackRate = useCallback((rate) => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = 1;
    setTransportRate(rate);
    followLiveEdgeRef.current = rate <= 1;
    if (video.paused) {
      void startPlayback();
    }
    syncPlaybackState();
  }, [startPlayback, syncPlaybackState]);

  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;

    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      }
      return;
    }

    if (panelRef.current?.requestFullscreen) {
      void panelRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleToggleNativePiP = useCallback(async () => {
    if (typeof document === "undefined") return;

    const video = videoRef.current;
    if (!video) return;

    closeMenus();

    const webkitVideo = video;
    const webkitSupportsPiP =
      typeof webkitVideo.webkitSupportsPresentationMode === "function" &&
      webkitVideo.webkitSupportsPresentationMode("picture-in-picture") &&
      typeof webkitVideo.webkitSetPresentationMode === "function";

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture?.();
        return;
      }

      if (
        document.pictureInPictureEnabled &&
        typeof video.requestPictureInPicture === "function"
      ) {
        await video.requestPictureInPicture();
        return;
      }

      if (webkitSupportsPiP) {
        webkitVideo.webkitSetPresentationMode(
          webkitVideo.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
      }
    } catch {}
  }, [closeMenus]);

  useEffect(() => {
    transportRateRef.current = transportRate;
  }, [transportRate]);

  useEffect(() => {
    volumeRef.current = volume;
    const video = videoRef.current;
    if (!video) return;
    video.volume = clampNumber(volume, 0, 1);
    syncAudioGain({
      muted: video.muted,
      volume,
    });
    syncPlaybackState();
  }, [syncAudioGain, syncPlaybackState, volume]);

  const handleExpandedChromeActivity = useCallback(() => {
    revealControls();
    if (!shouldForceControlsVisible) {
      scheduleControlsHide(1400);
    }
  }, [revealControls, scheduleControlsHide, shouldForceControlsVisible]);
  useRuntimeWorkloadFlag("bloomberg:dock", isOpen, {
    kind: "other",
    label: "Bloomberg dock",
    detail: !playbackSessionEnabled ? "standby" : collapsed ? "collapsed" : "open",
    priority: 9,
  });
  useRuntimeWorkloadFlag(
    "bloomberg:catchup",
    Boolean(playbackSessionEnabled && !collapsed && pageVisible && transportRate > 1),
    {
      kind: "media",
      label: "Bloomberg catch-up",
      detail: "500ms",
      priority: 2,
    },
  );
  useRuntimeWorkloadFlag(
    "bloomberg:sampler",
    Boolean(playbackSessionEnabled && playbackSampleIntervalMs),
    {
      kind: "media",
      label: "Bloomberg sampler",
      detail: `${playbackSampleIntervalMs || 0}ms`,
      priority: 3,
    },
  );

  useEffect(() => {
    if (!isOpen) {
      clearHideControlsTimer();
      return undefined;
    }

    if (shouldForceControlsVisible) {
      revealControls();
      return undefined;
    }

    scheduleControlsHide(1200);
    return clearHideControlsTimer;
  }, [
    clearHideControlsTimer,
    isOpen,
    revealControls,
    scheduleControlsHide,
    shouldForceControlsVisible,
  ]);

  useEffect(() => {
    return () => {
      clearHideControlsTimer();
      try {
        mediaSourceRef.current?.disconnect();
      } catch {}
      try {
        gainNodeRef.current?.disconnect();
      } catch {}
      try {
        void audioContextRef.current?.close();
      } catch {}
      mediaSourceRef.current = null;
      mediaElementRef.current = null;
      gainNodeRef.current = null;
      audioContextRef.current = null;
    };
  }, [clearHideControlsTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof document === "undefined") return undefined;

    const webkitVideo = video;
    const webkitSupportsPiP =
      typeof webkitVideo.webkitSupportsPresentationMode === "function" &&
      webkitVideo.webkitSupportsPresentationMode("picture-in-picture") &&
      typeof webkitVideo.webkitSetPresentationMode === "function";

    setNativePipSupported(
      Boolean(
        (document.pictureInPictureEnabled &&
          typeof video.requestPictureInPicture === "function") ||
          webkitSupportsPiP,
      ),
    );

    const syncPiPState = () => {
      const inNativePiP =
        document.pictureInPictureElement === video ||
        webkitVideo.webkitPresentationMode === "picture-in-picture";
      setNativePipActive(Boolean(inNativePiP));
    };

    syncPiPState();
    video.addEventListener("enterpictureinpicture", syncPiPState);
    video.addEventListener("leavepictureinpicture", syncPiPState);
    video.addEventListener("webkitpresentationmodechanged", syncPiPState);

    return () => {
      video.removeEventListener("enterpictureinpicture", syncPiPState);
      video.removeEventListener("leavepictureinpicture", syncPiPState);
      video.removeEventListener("webkitpresentationmodechanged", syncPiPState);
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!moreMenuOpen || typeof window === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!panelRef.current?.contains(event.target)) {
        closeMenus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closeMenus, moreMenuOpen]);

  useEffect(() => {
    if (
      !playbackSessionEnabled ||
      !audioBlocked ||
      !audioPreferenceRef.current ||
      !playbackState.muted
    ) {
      return undefined;
    }

    let attempted = false;
    const retryAudioOnGesture = () => {
      if (attempted) return;
      attempted = true;
      void startPlayback({ preferAudio: true });
    };

    window.addEventListener("pointerdown", retryAudioOnGesture, true);
    window.addEventListener("keydown", retryAudioOnGesture, true);
    window.addEventListener("touchstart", retryAudioOnGesture, true);

    return () => {
      window.removeEventListener("pointerdown", retryAudioOnGesture, true);
      window.removeEventListener("keydown", retryAudioOnGesture, true);
      window.removeEventListener("touchstart", retryAudioOnGesture, true);
    };
  }, [audioBlocked, playbackSessionEnabled, playbackState.muted, startPlayback]);

  useEffect(() => {
    if (!playbackSessionEnabled) {
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;
    const streamSource =
      BLOOMBERG_HLS_SOURCES[streamSourceIndex] ?? BLOOMBERG_HLS_SOURCES[0];

    let hls = null;
    let disposed = false;
    let startupTimeout = null;
    const startupState = {
      manifestSeen: false,
      playableSeen: false,
      manifestFailures: 0,
      fragmentFailures: 0,
      lastError: "",
    };

    watchdogRef.current = createBloombergWatchdogState();
    recoveryRef.current = {
      fatalRecoveries: 0,
      mediaRecoveries: 0,
      parsingRecoveries: 0,
      networkRecoveries: 0,
      lastRecoveryAt: 0,
    };
    publishDiagnostics({
      mode: streamSourceMode,
      status: "loading",
      activeSourceId: streamSource.id,
      activeSourceLabel: streamSource.label,
      activeSourceHost: getBloombergHost(streamSource.url),
      variantHost: "",
    });

    const markLoading = () => {
      if (disposed) return;
      setPlayerStatus((current) => (current === "error" ? current : "loading"));
    };
    const getStartupTimeoutMs = () => {
      return getConfiguredWindowNumber(
        "__RAYALGO_BLOOMBERG_STARTUP_TIMEOUT_MS__",
        BLOOMBERG_STARTUP_TIMEOUT_MS,
      );
    };
    const clearStartupTimeout = () => {
      if (startupTimeout == null) return;
      window.clearTimeout(startupTimeout);
      startupTimeout = null;
    };
    const markManifestSeen = (manifestUrl = streamSource.url) => {
      startupState.manifestSeen = true;
      publishDiagnostics({
        lastManifestAt: Date.now(),
        activeSourceId: streamSource.id,
        activeSourceLabel: streamSource.label,
        activeSourceHost: getBloombergHost(streamSource.url),
        variantHost: getBloombergHost(manifestUrl || streamSource.url),
      });
    };
    const markPlayableSeen = () => {
      if (startupState.playableSeen) return;
      startupState.playableSeen = true;
      clearStartupTimeout();
      rememberLastGoodBloombergSource(streamSource);
      watchdogRef.current.lastCurrentTime = video.currentTime || 0;
      watchdogRef.current.lastAdvancedAt = Date.now();
      publishDiagnostics({
        status: "live",
        lastPlayableAt: Date.now(),
        lastGoodSourceId: streamSource.id,
        lastErrorKind: "",
        lastErrorDetail: "",
      });
    };
    const markLive = () => {
      if (disposed) return;
      setPlayerStatus("live");
      setErrorDetail("");
      publishDiagnostics({
        status: "live",
        lastErrorKind: "",
        lastErrorDetail: "",
      });
    };
    const markError = (detail, kind = classifyBloombergError(detail)) => {
      if (disposed) return;
      clearStartupTimeout();
      setPlayerStatus("error");
      setErrorDetail(formatBloombergError(kind, detail || "Playback failed"));
      publishDiagnostics({
        status: "error",
        lastErrorAt: Date.now(),
        lastErrorKind: kind,
        lastErrorDetail: detail || "",
        sourceFailures: serializeBloombergCounterMap(sourceFailureCountsRef.current),
        sourceCooldowns: serializeBloombergCooldowns(sourceCooldownsRef.current),
      });
    };
    const markStartupFailed = (detail, data = {}) => {
      const kind = classifyBloombergError(detail, data);
      if (handleStreamFailover(detail, kind)) return;
      markError(detail, kind);
    };
    const handleLoadedData = () => {
      markPlayableSeen();
      video.defaultPlaybackRate = 1;
      video.playbackRate = 1;
      markLive();
      syncPlaybackState();
      void startPlayback();
    };
    const handlePlaying = () => {
      markPlayableSeen();
      video.defaultPlaybackRate = 1;
      video.playbackRate = 1;
      markLive();
      syncPlaybackState();
    };
    const handleWaiting = () => {
      if (disposed) return;
      if (video.seeking || transportRateRef.current > 1) {
        syncPlaybackState();
        return;
      }
      setPlayerStatus((current) => (current === "error" ? current : "loading"));
      syncPlaybackState();
    };
    const handleVideoError = () => {
      const mediaError = video.error;
      const detail =
        mediaError?.message ||
        (mediaError?.code ? `Media error ${mediaError.code}` : "Browser media error.");

      if (detail.includes("DEMUXER_ERROR_COULD_NOT_PARSE")) {
        setTransportRate(1);
        markLoading();
        setErrorDetail(`${detail} · resetting live stream`);
        publishDiagnostics({
          status: "loading",
          lastErrorAt: Date.now(),
          lastErrorKind: "media",
          lastErrorDetail: detail,
        });
        setTimeout(() => {
          if (disposed) return;
          handleReload({
            sourceIndex: streamSourceIndex,
            sourceMode: streamSourceMode,
          });
        }, 250);
        syncPlaybackState();
        return;
      }

      markError(detail, "media");
      syncPlaybackState();
    };
    const noteRecovery = (kind) => {
      const now = Date.now();
      const recovery = recoveryRef.current;
      recovery.lastRecoveryAt = now;
      if (kind === "fatal") recovery.fatalRecoveries += 1;
      if (kind === "media") recovery.mediaRecoveries += 1;
      if (kind === "parsing") recovery.parsingRecoveries += 1;
      if (kind === "network") recovery.networkRecoveries += 1;
      publishDiagnostics({
        hlsRecoveries: {
          fatal: recovery.fatalRecoveries,
          media: recovery.mediaRecoveries,
          network: recovery.networkRecoveries,
          parsing: recovery.parsingRecoveries,
        },
      });
    };
    const maybeReloadAfterRepeatedRecovery = (detail, threshold) => {
      const recovery = recoveryRef.current;
      const totalRecoveries =
        recovery.fatalRecoveries +
        recovery.mediaRecoveries +
        recovery.parsingRecoveries +
        recovery.networkRecoveries;

      if (totalRecoveries < threshold) {
        return false;
      }

      if (Date.now() - recovery.lastRecoveryAt > 20_000) {
        return false;
      }

      if (watchdogRef.current.reloadAttempts < BLOOMBERG_WATCHDOG_RELOAD_LIMIT) {
        watchdogRef.current.reloadAttempts += 1;
        setPlayerStatus("loading");
        setErrorDetail(
          `${detail || "Repeated playback recovery failed"} · reloading source`,
        );
        publishDiagnostics({
          status: "loading",
          sourceReloads: (diagnosticsRef.current.sourceReloads || 0) + 1,
          lastErrorAt: Date.now(),
          lastErrorKind: classifyBloombergError(detail),
          lastErrorDetail: detail || "Repeated playback recovery failed.",
        });
        setTimeout(() => {
          if (disposed) return;
          handleReload({
            sourceIndex: streamSourceIndex,
            sourceMode: streamSourceMode,
          });
        }, 250);
        return true;
      }

      const kind = classifyBloombergError(detail);
      if (handleStreamFailover(detail || "Repeated playback recovery failed.", kind)) {
        return true;
      }
      markError(detail || "Repeated playback recovery failed.", kind);
      return true;
    };
    const handleProgress = () => {
      if (video.readyState >= 2 || video.buffered.length) {
        markPlayableSeen();
      }
      syncPlaybackState();
    };
    const isManifestStartupError = (detail) =>
      !startupState.manifestSeen && String(detail).toLowerCase().includes("manifest");
    const isFragmentStartupError = (detail) =>
      !startupState.playableSeen && String(detail).toLowerCase().includes("frag");

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("error", handleVideoError);
    video.addEventListener("timeupdate", syncPlaybackState);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("ratechange", syncPlaybackState);
    video.addEventListener("play", syncPlaybackState);
    video.addEventListener("pause", syncPlaybackState);
    video.addEventListener("volumechange", syncPlaybackState);
    video.addEventListener("seeked", syncPlaybackState);

    video.defaultMuted = !audioPreferenceRef.current;
    video.muted = !audioPreferenceRef.current;
    video.volume = clampNumber(volumeRef.current, 0, 1);
    video.crossOrigin = "anonymous";
    video.autoplay = true;
    video.playsInline = true;
    video.defaultPlaybackRate = 1;
    video.playbackRate = 1;

    setPlayerStatus("loading");
    setErrorDetail("");
    setTransportRate(1);
    syncPlaybackState();
    startupTimeout = window.setTimeout(() => {
      if (disposed || startupState.playableSeen) return;
      markStartupFailed(
        startupState.lastError
          ? `${startupState.lastError} · unable to reach Bloomberg stream`
          : startupState.manifestSeen
            ? "Timed out waiting for Bloomberg video segments."
            : "Timed out reaching Bloomberg stream.",
      );
    }, getStartupTimeoutMs());

    const userAgent =
      typeof navigator === "undefined" ? "" : navigator.userAgent || "";
    const browserVendor =
      typeof navigator === "undefined" ? "" : navigator.vendor || "";
    const supportsNativeHls =
      Boolean(video.canPlayType("application/vnd.apple.mpegurl")) ||
      Boolean(video.canPlayType("application/x-mpegURL"));
    const prefersNativeHls =
      supportsNativeHls &&
      (/iPhone|iPad|iPod/.test(userAgent) ||
        (browserVendor.includes("Apple") &&
          !/Chrome|Chromium|Edg|OPR|SamsungBrowser|Brave/.test(userAgent)));

    if (prefersNativeHls) {
      video.addEventListener("loadedmetadata", markManifestSeen, { once: true });
      video.src = streamSource.url;
      video.load();
      void startPlayback();
    } else {
      void import("hls.js/light")
        .then(({ default: Hls }) => {
          if (disposed) return;
          if (!Hls.isSupported()) {
            markError("This browser does not support HLS playback.", "media");
            return;
          }

          hls = new Hls({
            lowLatencyMode: true,
            liveSyncDurationCount: BLOOMBERG_HLS_LIVE_SYNC_DURATION_COUNT,
            liveMaxLatencyDurationCount: BLOOMBERG_HLS_LIVE_MAX_LATENCY_DURATION_COUNT,
            maxLiveSyncPlaybackRate: BLOOMBERG_HLS_MAX_SYNC_PLAYBACK_RATE,
            backBufferLength: BLOOMBERG_DVR_BUFFER_SECONDS,
            maxBufferLength: BLOOMBERG_DVR_BUFFER_SECONDS,
            maxMaxBufferLength: BLOOMBERG_DVR_BUFFER_SECONDS,
            maxBufferHole: 1,
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            markManifestSeen(streamSource.url);
            syncPlaybackState();
            void startPlayback();
          });
          hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
            markManifestSeen(data?.details?.url || data?.url || streamSource.url);
            syncPlaybackState();
          });
          hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
            const fragmentUrl = data?.frag?.url;
            if (!fragmentUrl) return;
            publishDiagnostics({
              variantHost: getBloombergHost(fragmentUrl),
            });
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (disposed) return;

            const detail = data.details || data.type || "unknown";
            const kind = classifyBloombergError(detail, data);
            startupState.lastError = detail;
            publishDiagnostics({
              lastErrorAt: Date.now(),
              lastErrorKind: kind,
              lastErrorDetail: detail,
            });

            if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
              markLoading();
              setErrorDetail(detail);
              syncPlaybackState();
              return;
            }

            if (
              data.type === Hls.ErrorTypes.MUX_ERROR ||
              data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR
            ) {
              noteRecovery("parsing");
              if (maybeReloadAfterRepeatedRecovery(detail, 4)) return;
              markLoading();
              setErrorDetail(`${detail} · recovering demuxer`);
              hls?.swapAudioCodec();
              hls?.recoverMediaError();
              return;
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              noteRecovery("media");
              if (maybeReloadAfterRepeatedRecovery(detail, 5)) return;
              markLoading();
              setErrorDetail(`${detail} · recovering media`);
              hls?.recoverMediaError();
              return;
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              noteRecovery("network");
              if (isManifestStartupError(detail)) {
                startupState.manifestFailures += 1;
                if (
                  startupState.manifestFailures >=
                  BLOOMBERG_STARTUP_MANIFEST_FAILURE_LIMIT
                ) {
                  markStartupFailed(`${detail} · unable to reach Bloomberg stream`, data);
                  return;
                }
              }
              if (isFragmentStartupError(detail)) {
                startupState.fragmentFailures += 1;
                if (
                  startupState.fragmentFailures >=
                  BLOOMBERG_STARTUP_FRAGMENT_FAILURE_LIMIT
                ) {
                  markStartupFailed(`${detail} · no playable video segments loaded`, data);
                  return;
                }
              }
              if (maybeReloadAfterRepeatedRecovery(detail, 6)) return;
              markLoading();
              setErrorDetail(`${detail} · retrying network`);
              hls?.startLoad(video.currentTime || -1);
              return;
            }

            if (data.fatal) {
              noteRecovery("fatal");
              if (maybeReloadAfterRepeatedRecovery(detail, 3)) return;
              const fatalKind = classifyBloombergError(detail, data);
              if (handleStreamFailover(detail || "Fatal HLS playback error.", fatalKind)) {
                return;
              }
              markError(detail || "Fatal HLS playback error.", fatalKind);
            }
          });
          hls.loadSource(streamSource.url);
          hls.attachMedia(video);
        })
        .catch(() => {
          markError("Unable to load HLS playback support.", "media");
        });
    }

    return () => {
      disposed = true;
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener("timeupdate", syncPlaybackState);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("ratechange", syncPlaybackState);
      video.removeEventListener("play", syncPlaybackState);
      video.removeEventListener("pause", syncPlaybackState);
      video.removeEventListener("volumechange", syncPlaybackState);
      video.removeEventListener("seeked", syncPlaybackState);
      video.removeEventListener("loadedmetadata", markManifestSeen);
      clearStartupTimeout();
      if (hls) {
        hls.destroy();
      }
      hlsRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [
    handleReload,
    handleStreamFailover,
    playbackSessionEnabled,
    publishDiagnostics,
    reloadKey,
    startPlayback,
    streamSourceIndex,
    streamSourceMode,
    syncPlaybackState,
  ]);

  useEffect(() => {
    if (
      !playbackSessionEnabled ||
      !pageVisible ||
      playerStatus === "error"
    ) {
      return undefined;
    }

    const intervalMs = getConfiguredWindowNumber(
      "__RAYALGO_BLOOMBERG_WATCHDOG_INTERVAL_MS__",
      BLOOMBERG_WATCHDOG_INTERVAL_MS,
    );
    const stallMs = getConfiguredWindowNumber(
      "__RAYALGO_BLOOMBERG_WATCHDOG_STALL_MS__",
      BLOOMBERG_WATCHDOG_STALL_MS,
    );
    const emptyBufferMs = getConfiguredWindowNumber(
      "__RAYALGO_BLOOMBERG_WATCHDOG_EMPTY_BUFFER_MS__",
      BLOOMBERG_WATCHDOG_EMPTY_BUFFER_MS,
    );

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.seeking || transportRateRef.current > 1) {
        watchdogRef.current.lastCurrentTime = video?.currentTime || 0;
        watchdogRef.current.lastAdvancedAt = Date.now();
        watchdogRef.current.emptyBufferSince = 0;
        return;
      }

      if (playerStatus !== "live") {
        return;
      }

      const now = Date.now();
      const watchdog = watchdogRef.current;
      const currentTime = video.currentTime || 0;
      const hasBuffer = video.buffered.length > 0;

      if (!watchdog.lastAdvancedAt) {
        watchdog.lastAdvancedAt = now;
        watchdog.lastCurrentTime = currentTime;
      }

      if (currentTime > watchdog.lastCurrentTime + 0.2) {
        watchdog.lastCurrentTime = currentTime;
        watchdog.lastAdvancedAt = now;
        watchdog.emptyBufferSince = 0;
        return;
      }

      if (!hasBuffer) {
        if (!watchdog.emptyBufferSince) {
          watchdog.emptyBufferSince = now;
          return;
        }
        if (now - watchdog.emptyBufferSince >= emptyBufferMs) {
          handleWatchdogRecovery("Live buffer empty", "segments");
        }
        return;
      }

      watchdog.emptyBufferSince = 0;
      if (now - watchdog.lastAdvancedAt >= stallMs) {
        handleWatchdogRecovery("Live playback stalled", "stall");
      }
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    handleWatchdogRecovery,
    pageVisible,
    playbackSessionEnabled,
    playerStatus,
    reloadKey,
  ]);

  useEffect(() => {
    if (!playbackSessionEnabled) {
      return undefined;
    }
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!pageVisible) {
      // Keep the Bloomberg session alive while hidden; only remember whether
      // the browser should be nudged back into playback when visibility returns.
      wasPlayingBeforeHiddenRef.current = Boolean(
        video && (!video.paused || playerStatus === "loading"),
      );
      return undefined;
    }

    if (hls) {
      try {
        hls.startLoad(-1);
      } catch {
        /* hls already loading */
      }
    }
    if (
      video &&
      wasPlayingBeforeHiddenRef.current &&
      playerStatus !== "error" &&
      (video.readyState >= 2 || video.currentSrc)
    ) {
      wasPlayingBeforeHiddenRef.current = false;
      void startPlayback();
      syncPlaybackState();
    }
    return undefined;
  }, [
    pageVisible,
    playbackSessionEnabled,
    playerStatus,
    reloadKey,
    startPlayback,
    syncPlaybackState,
  ]);

  useEffect(() => {
    if (!playbackSessionEnabled || !playbackSampleIntervalMs) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      syncPlaybackState();
    }, playbackSampleIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [playbackSampleIntervalMs, playbackSessionEnabled, syncPlaybackState]);

  useEffect(() => {
    if (
      !playbackSessionEnabled ||
      collapsed ||
      !pageVisible ||
      transportRate <= 1
    ) {
      return undefined;
    }

    const catchupTimer = window.setInterval(() => {
      const video = videoRef.current;
      if (
        !video ||
        video.paused ||
        video.seeking ||
        video.readyState < 2 ||
        !video.buffered.length
      ) {
        return;
      }

      const bufferedStart = video.buffered.start(0);
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const liveTarget =
        getLiveTargetTime(video) ??
        Math.max(bufferedStart, bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS);
      const lagSeconds = Math.max(0, liveTarget - video.currentTime);

      if (lagSeconds <= 0.15) {
        followLiveEdgeRef.current = true;
        setTransportRate(1);
        syncPlaybackState();
        return;
      }

      const advanceStep = Math.min(lagSeconds, (transportRate - 1) * 0.5);
      if (advanceStep <= 0.01) return;

      video.currentTime = Math.min(liveTarget, video.currentTime + advanceStep);
      syncPlaybackState();
    }, 500);

    return () => {
      window.clearInterval(catchupTimer);
    };
  }, [collapsed, getLiveTargetTime, pageVisible, playbackSessionEnabled, syncPlaybackState, transportRate]);

  useEffect(() => {
    if (!playbackSessionEnabled || !pageVisible || transportRate > 1) {
      return undefined;
    }

    const followTimer = window.setInterval(() => {
      const video = videoRef.current;
      if (
        !video ||
        video.paused ||
        video.seeking ||
        video.readyState < 2 ||
        !video.buffered.length
      ) {
        return;
      }

      const bufferedStart = video.buffered.start(0);
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const liveTarget =
        getLiveTargetTime(video) ??
        Math.max(bufferedStart, bufferedEnd - BLOOMBERG_LIVE_EDGE_SLACK_SECONDS);
      const lagSeconds = Math.max(0, liveTarget - video.currentTime);

      if (!followLiveEdgeRef.current) {
        if (lagSeconds <= 1.1) {
          followLiveEdgeRef.current = true;
        }
        return;
      }

      if (lagSeconds >= BLOOMBERG_AUTO_CATCHUP_HARD_SEEK_SECONDS) {
        video.playbackRate = 1;
        video.currentTime = liveTarget;
        syncPlaybackState();
        return;
      }

      if (lagSeconds >= BLOOMBERG_AUTO_CATCHUP_FAST_LAG_SECONDS) {
        video.playbackRate = BLOOMBERG_AUTO_CATCHUP_FAST_RATE;
        syncPlaybackState();
        return;
      }

      if (lagSeconds >= BLOOMBERG_AUTO_CATCHUP_SOFT_LAG_SECONDS) {
        video.playbackRate = BLOOMBERG_AUTO_CATCHUP_SOFT_RATE;
        syncPlaybackState();
        return;
      }

      if (video.playbackRate !== 1) {
        video.playbackRate = 1;
        syncPlaybackState();
      }
    }, 1500);

    return () => {
      window.clearInterval(followTimer);
    };
  }, [getLiveTargetTime, pageVisible, playbackSessionEnabled, syncPlaybackState, transportRate]);

  const hasBufferedWindow =
    Number.isFinite(playbackState.bufferedStart) &&
    Number.isFinite(playbackState.bufferedEnd);
  const bufferedWindowSeconds = hasBufferedWindow
    ? Math.max(0, playbackState.bufferedEnd - playbackState.bufferedStart)
    : 0;
  const hlsLatency = hlsRef.current?.latency;
  const liveLagSeconds =
    Number.isFinite(hlsLatency)
      ? Math.max(0, hlsLatency)
      : hasBufferedWindow
        ? Math.max(0, playbackState.bufferedEnd - playbackState.currentTime)
        : null;
  const atLiveEdge =
    liveLagSeconds == null
      ? false
      : liveLagSeconds <= BLOOMBERG_LIVE_EDGE_SLACK_SECONDS + 1;
  const canSeekBack = hasBufferedWindow
    ? playbackState.currentTime - playbackState.bufferedStart > 1
    : false;
  const canSeekForward = hasBufferedWindow
    ? playbackState.bufferedEnd - playbackState.currentTime > 0.75
    : false;
  const transportLabel = playbackState.paused
    ? "paused"
    : transportRate > 1
      ? `${transportRate.toFixed(transportRate % 1 === 0 ? 0 : 2)}x catch-up`
      : "1x";
  const volumePercent = Math.round(clampNumber(volume, 0, 1) * 100);
  const showSeekNudge = hasBufferedWindow && !atLiveEdge;
  const topStatusLabel =
    !playbackSessionEnabled
      ? "STANDBY"
      : playerStatus === "error"
        ? "ERROR"
        : playerStatus !== "live"
          ? "LOADING"
          : audioBlocked
            ? "AUDIO"
            : playbackState.paused
              ? "PAUSED"
              : atLiveEdge
                ? "LIVE"
                : liveLagSeconds == null
                  ? "SYNC"
                  : `+${liveLagSeconds.toFixed(liveLagSeconds >= 10 ? 0 : 1)}s`;
  const topStatusColor =
    !playbackSessionEnabled
      ? T.textSec
      : playerStatus === "error"
        ? T.red
        : playerStatus !== "live"
          ? T.amber
          : audioBlocked
            ? T.amber
            : atLiveEdge && !playbackState.paused
              ? T.green
              : T.textSec;
  const topStatusBackground =
    !playbackSessionEnabled
      ? `${T.bg2}f0`
      : playerStatus === "error"
        ? T.redBg
        : playerStatus !== "live"
          ? T.amberBg
          : audioBlocked
            ? T.amberBg
            : atLiveEdge && !playbackState.paused
              ? T.greenBg
              : `${T.bg2}f0`;
  const scrubberValue =
    hasBufferedWindow && bufferedWindowSeconds > 0
      ? clampNumber(
          ((playbackState.currentTime - playbackState.bufferedStart) /
            bufferedWindowSeconds) *
            BLOOMBERG_SCRUB_STEPS,
          0,
          BLOOMBERG_SCRUB_STEPS,
        )
      : BLOOMBERG_SCRUB_STEPS;
  const expandedChromeVisible = controlsVisible || shouldForceControlsVisible;
  const activeStreamSource = getBloombergSourceAt(streamSourceIndex);
  const streamErrorTone =
    streamDiagnostics.lastErrorKind || playerStatus === "error" ? T.red : T.textSec;
  const streamHealthLabel =
    playerStatus === "live"
      ? playbackState.paused
        ? "paused"
        : "live"
      : playerStatus;
  const streamRetryLabel = `${streamDiagnostics.failoverCount || 0}/${
    streamDiagnostics.watchdogRecoveries || 0
  }`;

  if (!isOpen) {
    return (
      <div
        style={{
          position: "fixed",
          right: sp(14),
          bottom: sp(34),
          zIndex: BLOOMBERG_DOCK_Z_INDEX,
        }}
      >
        <button
          type="button"
          onClick={handleReopen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(8),
            padding: sp("8px 12px"),
            border: "none",
            borderRadius: "999px",
            background: "rgba(8, 11, 18, 0.82)",
            boxShadow: "0 18px 44px rgba(0, 0, 0, 0.34)",
            color: "#f8fafc",
            cursor: "pointer",
            backdropFilter: "blur(18px)",
          }}
        >
          <Tv size={dim(14)} />
          <span
            style={{
              padding: sp("2px 6px"),
              borderRadius: "999px",
              background: topStatusBackground,
              color: topStatusColor,
              fontSize: fs(7),
              fontFamily: T.mono,
              fontWeight: 700,
            }}
          >
            {topStatusLabel}
          </span>
          <span
            style={{
              fontSize: fs(8),
              fontFamily: T.display,
              fontWeight: 700,
            }}
          >
            Bloomberg
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        right: sp(14),
        bottom: sp(34),
        zIndex: BLOOMBERG_DOCK_Z_INDEX,
        width: collapsed
          ? `min(${dim(320)}px, calc(100vw - ${dim(18)}px))`
          : `min(${dim(420)}px, calc(100vw - ${dim(18)}px))`,
        maxWidth: "calc(100vw - 16px)",
        display: "flex",
        flexDirection: "column",
        background: "transparent",
        boxShadow: collapsed ? "none" : "0 28px 64px rgba(0, 0, 0, 0.48)",
        overflow: "visible",
      }}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={handleExpandedChromeActivity}
        onMouseMove={handleExpandedChromeActivity}
        onPointerDown={handleExpandedChromeActivity}
        onMouseLeave={() => {
          if (!shouldForceControlsVisible) scheduleControlsHide(220);
        }}
        onFocusCapture={handleExpandedChromeActivity}
        onBlurCapture={() => {
          if (!shouldForceControlsVisible) scheduleControlsHide(220);
        }}
      >
        <div
          style={
            collapsed
              ? {
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  opacity: 0.01,
                  pointerEvents: "none",
                }
              : {
                  position: "relative",
                  background: "#000",
                  aspectRatio: "16 / 9",
                  minHeight: dim(190),
                  borderRadius: dim(18),
                  overflow: "hidden",
                }
          }
        >
          <video
            key={reloadKey}
            ref={videoRef}
            autoPlay
            playsInline
            style={
              collapsed
                ? {
                    width: 1,
                    height: 1,
                    display: "block",
                    background: "#000",
                  }
                : {
                    width: "100%",
                    height: "100%",
                    display: "block",
                    background: "#000",
                  }
            }
          />
          {!collapsed ? (
            <>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: sp(8),
                  padding: sp("8px"),
                  background:
                    "linear-gradient(180deg, rgba(8,11,18,0.88), rgba(8,11,18,0))",
                  opacity: expandedChromeVisible ? 1 : 0,
                  transform: expandedChromeVisible
                    ? "translateY(0)"
                    : `translateY(-${dim(6)}px)`,
                  transition: "opacity 160ms ease, transform 160ms ease",
                  pointerEvents: expandedChromeVisible ? "auto" : "none",
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(6),
                    minWidth: 0,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: sp(6),
                      padding: sp("4px 7px"),
                      border: `1px solid rgba(148, 163, 184, 0.22)`,
                      background: "rgba(8, 11, 18, 0.68)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <Tv size={dim(12)} color="#f8fafc" />
                    <span
                      style={{
                        fontSize: fs(8),
                        fontFamily: T.display,
                        fontWeight: 700,
                        color: "#f8fafc",
                      }}
                    >
                      Bloomberg
                    </span>
                  </div>
                  <span
                    style={{
                      padding: sp("3px 7px"),
                      border: `1px solid ${topStatusColor}`,
                      background: topStatusBackground,
                      color: topStatusColor,
                      fontSize: fs(7),
                      fontFamily: T.mono,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {topStatusLabel}
                  </span>
                  {transportRate > 1 ? (
                    <span
                      style={{
                        padding: sp("3px 6px"),
                        border: `1px solid rgba(16,185,129,0.3)`,
                        background: "rgba(8, 11, 18, 0.62)",
                        color: T.green,
                        fontSize: fs(7),
                        fontFamily: T.mono,
                        backdropFilter: "blur(10px)",
                      }}
                    >
                      {transportLabel}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(6),
                    justifyContent: "flex-end",
                  }}
                >
                  <RoundIconButton
                    onClick={() => {
                      closeMenus();
                      setTransportRate(1);
                      setCollapsed(true);
                    }}
                    title="Collapse Bloomberg player"
                    ariaLabel="Collapse Bloomberg player"
                    icon={Minimize2}
                  />
                  <RoundIconButton
                    onClick={handleClose}
                    title="Close Bloomberg player"
                    ariaLabel="Close Bloomberg player"
                    icon={X}
                  />
                </div>
              </div>
              {expandedChromeVisible ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: sp(12),
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                >
                  {showSeekNudge && !audioBlocked && playerStatus === "live" ? (
                    <div style={{ pointerEvents: "auto" }}>
                      <RoundIconButton
                        onClick={() => seekWithinBuffer(-BLOOMBERG_SEEK_STEP_SECONDS)}
                        disabled={!canSeekBack}
                        title="Seek back 10 seconds"
                        ariaLabel="Seek back 10 seconds"
                        icon={RotateCcw}
                      />
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: sp(8),
                      pointerEvents: "auto",
                    }}
                  >
                    <RoundIconButton
                      onClick={
                        playerStatus === "error"
                          ? handleReload
                          : audioBlocked
                            ? handleEnableAudio
                            : handleTogglePlay
                      }
                      title={
                        playerStatus === "error"
                          ? "Reload Bloomberg stream"
                          : audioBlocked
                            ? "Play Bloomberg stream with audio"
                            : playbackState.paused
                              ? "Play Bloomberg stream"
                              : "Pause Bloomberg stream"
                      }
                      ariaLabel={
                        playerStatus === "error"
                          ? "Reload Bloomberg stream"
                          : audioBlocked
                            ? "Play Bloomberg stream with audio"
                            : playbackState.paused
                              ? "Play Bloomberg stream"
                              : "Pause Bloomberg stream"
                      }
                      icon={
                        playerStatus === "error"
                          ? RotateCw
                          : audioBlocked
                            ? Volume2
                            : playbackState.paused
                              ? Play
                              : Pause
                      }
                      prominent
                      size={64}
                    />
                    {(audioBlocked || playerStatus === "error") ? (
                      <span
                        style={{
                          padding: sp("4px 9px"),
                          borderRadius: "999px",
                          background: "rgba(8, 11, 18, 0.72)",
                          color: audioBlocked ? T.amber : T.red,
                          fontSize: fs(8),
                          fontFamily: T.mono,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          backdropFilter: "blur(16px)",
                        }}
                      >
                        {playerStatus === "error" ? "RELOAD" : "PLAY WITH AUDIO"}
                      </span>
                    ) : null}
                  </div>
                  {showSeekNudge && !audioBlocked && playerStatus === "live" ? (
                    <div style={{ pointerEvents: "auto" }}>
                      <RoundIconButton
                        onClick={() => seekWithinBuffer(BLOOMBERG_SEEK_STEP_SECONDS)}
                        disabled={!canSeekForward}
                        title="Seek forward 10 seconds"
                        ariaLabel="Seek forward 10 seconds"
                        icon={FastForward}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: sp(10),
                  padding: sp("34px 10px 10px"),
                  background:
                    "linear-gradient(180deg, rgba(8,11,18,0), rgba(8,11,18,0.5) 34%, rgba(8,11,18,0.9))",
                  opacity: expandedChromeVisible ? 1 : 0,
                  transform: expandedChromeVisible
                    ? "translateY(0)"
                    : `translateY(${dim(8)}px)`,
                  transition: "opacity 160ms ease, transform 160ms ease",
                  pointerEvents: expandedChromeVisible ? "auto" : "none",
                  zIndex: 4,
                }}
              >
                <input
                  aria-label="Bloomberg stream scrubber"
                  type="range"
                  min={0}
                  max={BLOOMBERG_SCRUB_STEPS}
                  step={1}
                  value={Math.round(scrubberValue)}
                  disabled={!hasBufferedWindow}
                  onChange={(event) => handleScrubToValue(Number(event.target.value))}
                  style={{
                    width: "100%",
                    accentColor: "#f8fafc",
                    cursor: hasBufferedWindow ? "pointer" : "default",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: sp(10),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                    }}
                  >
                    <AudioControlButton
                      muted={playbackState.muted}
                      volumePercent={volumePercent}
                      onToggleMute={handleToggleMute}
                      onVolumeChange={handleVolumeChange}
                    />
                    {playerStatus === "error" && errorDetail ? (
                      <span
                        style={{
                          maxWidth: dim(180),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: fs(7),
                          fontFamily: T.mono,
                          color: T.textDim,
                        }}
                      >
                        {errorDetail}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                      position: "relative",
                    }}
                  >
                    <AppTooltip content="Jump to live edge"><button
                      type="button"
                      onClick={handleGoLive}
                      disabled={!hasBufferedWindow}
                      aria-label="Jump to live edge"
                      style={{
                        padding: sp("6px 10px"),
                        borderRadius: "999px",
                        border: "none",
                        background: atLiveEdge
                          ? "rgba(16, 185, 129, 0.22)"
                          : "rgba(8, 11, 18, 0.62)",
                        color: atLiveEdge ? T.green : "#f8fafc",
                        fontSize: fs(7),
                        fontFamily: T.mono,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        cursor: hasBufferedWindow ? "pointer" : "default",
                        opacity: hasBufferedWindow ? 1 : 0.45,
                        backdropFilter: "blur(18px)",
                        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
                      }}
                    >
                      {atLiveEdge
                        ? "LIVE"
                        : liveLagSeconds == null
                          ? "SYNC"
                          : `+${liveLagSeconds.toFixed(liveLagSeconds >= 10 ? 0 : 1)}s`}
                    </button></AppTooltip>
                    <RoundIconButton
                      onClick={() => setMoreMenuOpen((open) => !open)}
                      active={moreMenuOpen}
                      title="More Bloomberg controls"
                      ariaLabel="More Bloomberg controls"
                      icon={Ellipsis}
                    />
                    {moreMenuOpen ? (
                      <MenuPanel bottom={sp(46)} align="right">
                        <MenuSectionLabel>Playback Speed</MenuSectionLabel>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                            gap: sp(6),
                            padding: sp("0 10px"),
                          }}
                        >
                          {BLOOMBERG_PLAYBACK_RATES.map((rate) => {
                            const active = Math.abs(transportRate - rate) < 0.01;
                            return (
                              <MenuSpeedButton
                                key={rate}
                                onClick={() => {
                                  handleSetPlaybackRate(rate);
                                  setMoreMenuOpen(false);
                                }}
                                active={active}
                                disabled={rate > 1 && !hasBufferedWindow}
                                title={`Set playback speed to ${rate}x`}
                                ariaLabel={`Set playback speed to ${rate}x`}
                              >
                                {rate}x
                              </MenuSpeedButton>
                            );
                          })}
                        </div>
                        <MenuDivider />
                        <MenuSectionLabel>Window</MenuSectionLabel>
                        {nativePipSupported ? (
                          <MenuActionButton
                            onClick={() => {
                              void handleToggleNativePiP();
                              setMoreMenuOpen(false);
                            }}
                            active={nativePipActive}
                            title={
                              nativePipActive
                                ? "Exit picture in picture"
                                : "Open picture in picture"
                            }
                            ariaLabel={
                              nativePipActive
                                ? "Exit picture in picture"
                                : "Open picture in picture"
                            }
                            icon={PictureInPicture2}
                            meta={nativePipActive ? "On" : null}
                            description={
                              nativePipActive
                                ? "Return the video to the app frame"
                                : "Float the video above other windows"
                            }
                          >
                            {nativePipActive ? "Exit PiP" : "Open PiP"}
                          </MenuActionButton>
                        ) : null}
                        <MenuActionButton
                          onClick={() => {
                            handleToggleFullscreen();
                            setMoreMenuOpen(false);
                          }}
                          title="Toggle fullscreen"
                          ariaLabel="Toggle fullscreen"
                          icon={Scan}
                          description="Expand the player to the full screen"
                        >
                          Fullscreen
                        </MenuActionButton>
                        <MenuDivider />
                        <MenuSectionLabel>Stream</MenuSectionLabel>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                            gap: sp(6),
                            padding: sp("0 10px"),
                          }}
                        >
                          <MenuSpeedButton
                            onClick={handleSelectAutoStreamSource}
                            active={streamSourceMode === BLOOMBERG_SOURCE_MODE_AUTO}
                            title="Use automatic Bloomberg source selection"
                            ariaLabel="Use automatic Bloomberg source selection"
                          >
                            AUTO
                          </MenuSpeedButton>
                          {BLOOMBERG_HLS_SOURCES.map((source, index) => (
                            <MenuSpeedButton
                              key={source.id}
                              onClick={() => handleSelectManualStreamSource(index)}
                              active={
                                streamSourceMode === BLOOMBERG_SOURCE_MODE_MANUAL &&
                                activeStreamSource.id === source.id
                              }
                              title={`Select ${source.label} Bloomberg source`}
                              ariaLabel={`Select ${source.label} Bloomberg source`}
                            >
                              {source.label.replace("U.S. ", "")}
                            </MenuSpeedButton>
                          ))}
                        </div>
                        <div style={{ paddingTop: sp(4) }}>
                          <MenuInfoRow
                            label="Source"
                            value={`${activeStreamSource.label} · ${streamSourceMode}`}
                          />
                          <MenuInfoRow
                            label="CDN"
                            value={
                              streamDiagnostics.variantHost ||
                              streamDiagnostics.activeSourceHost
                            }
                          />
                          <MenuInfoRow label="State" value={streamHealthLabel} />
                          <MenuInfoRow label="Retry"
                            value={streamRetryLabel}
                          />
                          {streamDiagnostics.lastErrorKind ? (
                            <MenuInfoRow
                              label="Error"
                              value={streamDiagnostics.lastErrorKind}
                              tone={streamErrorTone}
                            />
                          ) : null}
                        </div>
                        <MenuActionButton
                          onClick={() => {
                            handleReload();
                            setMoreMenuOpen(false);
                          }}
                          title="Reload Bloomberg stream"
                          ariaLabel="Reload Bloomberg stream"
                          icon={RotateCw}
                          description="Reconnect the live video feed"
                        >
                          Reload stream
                        </MenuActionButton>
                        <MenuActionButton
                          onClick={() => {
                            handleOpenBloombergLive();
                            setMoreMenuOpen(false);
                          }}
                          title="Open Bloomberg in a new tab"
                          ariaLabel="Open Bloomberg in a new tab"
                          icon={ExternalLink}
                          accent
                          meta="New tab"
                          description="Open the source stream directly"
                        >
                          Open Bloomberg
                        </MenuActionButton>
                      </MenuPanel>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {!collapsed && playerStatus !== "live" ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: sp(16),
                pointerEvents: "none",
                background:
                  playerStatus === "error"
                    ? "linear-gradient(180deg, rgba(127,29,29,0.25), rgba(8,11,18,0.55))"
                    : "linear-gradient(180deg, rgba(8,11,18,0.16), rgba(8,11,18,0.36))",
              }}
            >
              <div
                style={{
                  padding: sp("8px 10px"),
                  border: `1px solid ${playerStatus === "error" ? T.red : T.border}`,
                  background: `${T.bg1}ee`,
                  color: T.textSec,
                  fontSize: fs(9),
                  fontFamily: T.mono,
                  textAlign: "center",
                  maxWidth: dim(460),
                  pointerEvents: "auto",
                }}
              >
                {playerStatus === "error"
                  ? "Unable to reach Bloomberg stream. Reload or open Bloomberg directly."
                  : audioBlocked
                    ? "Audio autoplay was blocked. Click anywhere in the app or use Play With Audio to restore sound."
                    : "Connecting to Bloomberg live stream..."}
                {errorDetail ? (
                  <div style={{ marginTop: sp(6), color: T.textDim }}>{errorDetail}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {collapsed ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(8),
            padding: sp("8px 12px"),
            borderRadius: "999px",
            background: "rgba(8, 11, 18, 0.82)",
            boxShadow: "0 18px 44px rgba(0, 0, 0, 0.34)",
            backdropFilter: "blur(18px)",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(8),
              flexWrap: "wrap",
              fontSize: fs(8),
              fontFamily: T.mono,
              color: T.textDim,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sp(5),
                color: "#f8fafc",
                fontWeight: 700,
              }}
            >
              <Tv size={dim(12)} />
              Bloomberg
            </span>
            <span
              style={{
                padding: sp("2px 6px"),
                borderRadius: "999px",
                background: topStatusBackground,
                color: topStatusColor,
              }}
            >
              {topStatusLabel}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(6),
              flexWrap: "wrap",
            }}
          >
            {playbackSessionEnabled ? (
              <>
                <RoundIconButton
                  onClick={handleTogglePlay}
                  title={playbackState.paused ? "Play Bloomberg stream" : "Pause Bloomberg stream"}
                  ariaLabel={playbackState.paused ? "Play Bloomberg stream" : "Pause Bloomberg stream"}
                  icon={playbackState.paused ? Play : Pause}
                  size={32}
                />
                <AudioControlButton
                  muted={playbackState.muted}
                  volumePercent={volumePercent}
                  onToggleMute={handleToggleMute}
                  onVolumeChange={handleVolumeChange}
                  size={32}
                  align="right"
                />
              </>
            ) : null}
            <RoundIconButton
              onClick={() => setCollapsed(false)}
              title="Expand Bloomberg player"
              ariaLabel="Expand Bloomberg player"
              icon={Maximize2}
              size={32}
            />
            <RoundIconButton
              onClick={handleClose}
              title="Close Bloomberg player"
              ariaLabel="Close Bloomberg player"
              icon={X}
              size={32}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
