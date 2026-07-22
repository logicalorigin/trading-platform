import { memo, useEffect, useState } from "react";
import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import {
  CSS_COLOR,
  dim,
  FONT_WEIGHTS,
  fs,
  sp,
  T,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  formatPreferenceDateTime,
  formatPreferenceTimeZoneLabel,
} from "../preferences/userPreferenceModel";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { HeaderSnapTradeBrokerStatus } from "./HeaderSnapTradeBrokerStatus";
import { HeaderSessionStatus } from "./HeaderSessionStatus";
import { AppTooltip } from "@/components/ui/tooltip";

const ET_CLOCK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const MARKET_CLOCK_LABEL = {
  overnight: "Overnight",
  pre: "Pre-market",
  rth: "Market open",
  after: "After hours",
  closed: "Closed",
};

const formatClockCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const hhmmss = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
};

export const buildMarketClockState = (now = Date.now(), preferences) => {
  const clockDate = new Date(now);
  const marketStatus = resolveUsEquityMarketStatus(clockDate);
  const parts = Object.fromEntries(
    ET_CLOCK_PARTS_FORMATTER.formatToParts(clockDate).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const phase = marketStatus.session.key;
  const countdownTarget = marketStatus.nextCloseAt || marketStatus.nextOpenAt;
  const countdownTargetMs = countdownTarget ? Date.parse(countdownTarget) : now;
  return {
    timeLabel: `${formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: true,
      fallback: `${parts.hour}:${parts.minute}:${parts.second}`,
    })}${
      preferences?.time?.showTimeZoneBadge
        ? ` ${formatPreferenceTimeZoneLabel(preferences, "app")}`
        : ""
    }`,
    dateLabel: formatPreferenceDateTime(clockDate, {
      preferences,
      context: "app",
      includeDate: false,
      includeTime: false,
      weekdayStyle: "short",
      monthStyle: "short",
      dayStyle: "numeric",
      fallback: `${parts.weekday} ${parts.month} ${parts.day}`,
    }),
    phase,
    label: MARKET_CLOCK_LABEL[phase] || marketStatus.session.title,
    action: marketStatus.nextCloseAt ? "Closes" : "Opens",
    timerLabel: formatClockCountdown((countdownTargetMs - now) / 1000),
    color:
      phase === "rth"
        ? CSS_COLOR.green
        : phase === "closed"
          ? CSS_COLOR.textDim
          : CSS_COLOR.amber,
  };
};

const HeaderMarketClock = memo(function HeaderMarketClock({
  compressed,
  surfaceStyle,
}) {
  const { preferences } = useUserPreferences();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const marketClock = buildMarketClockState(nowMs, preferences);
  return (
    <AppTooltip
      content={`${marketClock.dateLabel} · ${marketClock.timeLabel} · ${marketClock.label}`}
    >
      <div
        className="ra-hover-accent-bg"
        style={{
          ...surfaceStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          width: "max-content",
          minWidth: "max-content",
          maxWidth: "none",
          gap: sp(compressed ? 3 : 0),
          overflow: "visible",
          paddingLeft: sp(compressed ? 5 : 8),
          borderLeft: `1px solid ${CSS_COLOR.borderLight}`,
        }}
      >
        <div
          style={{
            fontSize: textSize("body"),
            color: marketClock.color,
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.medium,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "visible",
          }}
        >
          {compressed
            ? `${marketClock.label.replace(/^Market /, "").replace("After hours", "AH")} ${marketClock.timerLabel}`
            : `${marketClock.label} ${marketClock.timerLabel}`}
        </div>
      </div>
    </AppTooltip>
  );
});

export const HeaderStatusCluster = ({
  theme,
  onToggleTheme,
  compact = false,
  dense = false,
  minimal = false,
  mobileSheet = false,
  showThemeToggle = true,
}) => {
  const isDense = dense && !compact;
  const compressed = compact || isDense || minimal;
  const surfaceStyle = {
    display: "flex",
    alignItems: "center",
    gap: sp(compressed ? 3 : 6),
    width: "max-content",
    minWidth: "max-content",
    minHeight: dim(compressed ? 22 : 34),
    padding: sp(compressed ? "0px 4px" : "3px 8px"),
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    borderRadius: 0,
    overflow: "visible",
    flex: "0 0 max-content",
    transition:
      "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
  };

  return (
    <div
      data-testid="platform-header-status"
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
        gap: sp(compressed ? 2 : 4),
        flexWrap: "nowrap",
        alignContent: "center",
        width: "max-content",
        minWidth: "max-content",
        flex: "0 0 max-content",
      }}
    >
      <HeaderSessionStatus
        compressed={compressed}
        compact={compact}
        mobileSheet={mobileSheet}
        surfaceStyle={surfaceStyle}
      />

      <HeaderSnapTradeBrokerStatus
        compressed={compressed}
        compact={compact}
        minimal={minimal}
        mobileSheet={mobileSheet}
        surfaceStyle={surfaceStyle}
        theme={theme}
      />

      {compact ? null : (
        <HeaderMarketClock compressed={compressed} surfaceStyle={surfaceStyle} />
      )}

      {compact || minimal || !showThemeToggle ? null : (
        <AppTooltip
          content={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
        >
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            className="ra-hover-accent-bgfg"
            style={{
              width: dim(compressed ? 22 : 34),
              minHeight: dim(compressed ? 22 : 34),
              padding: 0,
              background: "transparent",
              border: "none",
              borderRadius: 0,
              color: CSS_COLOR.textSec,
              cursor: "pointer",
              fontSize: fs(compressed ? 11 : 13),
              lineHeight: 1,
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.regular,
              transition:
                "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
            }}
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
        </AppTooltip>
      )}
    </div>
  );
};

export const MemoHeaderStatusCluster = memo(HeaderStatusCluster);
