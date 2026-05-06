import { useMemo } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAccountMoney, mutedLabelStyle } from "./accountUtils";

const TRADING_DAYS_FORWARD = 45;

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const isThirdFriday = (date) => {
  if (date.getDay() !== 5) return false;
  const dom = date.getDate();
  return dom >= 15 && dom <= 21;
};

const startOfDayUtc = (input) => {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

const isoDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const buildForwardCalendar = (positions) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const notionalByDay = new Map();
  (positions || []).forEach((position) => {
    const contract = position?.optionContract;
    if (!contract?.expirationDate) return;
    const expiry = startOfDayUtc(contract.expirationDate);
    if (!expiry) return;
    if (expiry.getTime() < start.getTime()) return;
    const mv = Number(position.marketValue);
    if (!Number.isFinite(mv) || mv === 0) return;
    const key = isoDay(expiry);
    notionalByDay.set(key, (notionalByDay.get(key) || 0) + Math.abs(mv));
  });

  const days = [];
  const cursor = new Date(start);
  let added = 0;
  while (added < TRADING_DAYS_FORWARD) {
    if (!isWeekend(cursor)) {
      const iso = isoDay(cursor);
      days.push({
        date: new Date(cursor),
        iso,
        notional: notionalByDay.get(iso) || 0,
        isFri: cursor.getDay() === 5,
        isThirdFri: isThirdFriday(cursor),
      });
      added += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const groupIntoWeeks = (days) => {
  const weeks = [];
  let current = null;
  days.forEach((day) => {
    const dayOfWeek = (day.date.getDay() + 6) % 7;
    if (!current || dayOfWeek === 0 || current.days[dayOfWeek] != null) {
      const monday = new Date(day.date);
      monday.setDate(day.date.getDate() - dayOfWeek);
      current = { key: isoDay(monday), monday, days: [null, null, null, null, null] };
      weeks.push(current);
    }
    if (dayOfWeek < 5) {
      current.days[dayOfWeek] = day;
    }
  });
  return weeks;
};

export const ExpiryCalendarHeatmap = ({ positions, currency = "USD", maskValues = false }) => {
  const days = useMemo(() => buildForwardCalendar(positions), [positions]);
  const weeks = useMemo(() => groupIntoWeeks(days), [days]);

  const max = days.reduce((m, d) => (d.notional > m ? d.notional : m), 0) || 1;
  const total = days.reduce((s, d) => s + d.notional, 0);
  const activeCount = days.filter((d) => d.notional > 0).length;
  const peak = days
    .filter((d) => d.notional > 0)
    .sort((a, b) => b.notional - a.notional)[0];

  const monthLabels = weeks.map((w, i) => {
    const prev = i > 0 ? weeks[i - 1].monday.getMonth() : -1;
    if (prev === w.monday.getMonth()) return "";
    return w.monday.toLocaleString("en", { month: "short" });
  });

  return (
    <div
      style={{
        padding: sp(8),
        background: T.bg2,
        border: `1px solid ${T.border}`,
        borderRadius: dim(4),
        display: "grid",
        gap: sp(4),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: sp(8) }}>
        <span style={mutedLabelStyle}>Options Expiry · Next 45 Trading Days</span>
        <span style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}>
          {activeCount} expiry day{activeCount === 1 ? "" : "s"} ·{" "}
          <span style={{ color: T.text, fontWeight: 700 }}>
            {formatAccountMoney(total, currency, true, maskValues)}
          </span>{" "}
          notional
        </span>
      </div>
      {activeCount === 0 ? (
        <div style={{ color: T.textMuted, fontSize: fs(10), padding: sp(6) }}>
          No option positions in book.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 3 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingRight: 4,
              paddingTop: 14,
            }}
          >
            {["M", "T", "W", "T", "F"].map((label, idx) => (
              <div
                key={`${label}-${idx}`}
                style={{
                  fontSize: fs(8),
                  color: T.textMuted,
                  fontFamily: T.mono,
                  fontWeight: 700,
                  height: dim(14),
                  lineHeight: `${dim(14)}px`,
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 2, flex: 1, minWidth: 0 }}>
            {weeks.map((week, wi) => (
              <div
                key={week.key}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: fs(7),
                    color: T.textDim,
                    fontFamily: T.mono,
                    height: dim(10),
                    lineHeight: `${dim(10)}px`,
                    letterSpacing: "0.04em",
                  }}
                >
                  {monthLabels[wi]}
                </div>
                {week.days.map((day, di) => {
                  if (!day) {
                    return (
                      <div
                        key={di}
                        style={{
                          height: dim(14),
                          background: T.bg3,
                          borderRadius: 2,
                          opacity: 0.25,
                        }}
                      />
                    );
                  }
                  const intensity = day.notional / max;
                  const baseColor = day.isThirdFri ? T.red : day.isFri ? T.amber : T.accent;
                  const opacity = day.notional > 0 ? 0.3 + intensity * 0.7 : 0.3;
                  return (
                    <div
                      key={di}
                      title={
                        day.notional > 0
                          ? `${day.iso} · ${formatAccountMoney(
                              day.notional,
                              currency,
                              true,
                              maskValues,
                            )} notional${
                              day.isThirdFri
                                ? " · monthly exp"
                                : day.isFri
                                  ? " · weekly Fri"
                                  : ""
                            }`
                          : `${day.iso} · no expiry`
                      }
                      style={{
                        height: dim(14),
                        borderRadius: 2,
                        background: day.notional > 0 ? baseColor : T.bg3,
                        opacity,
                        border: day.isThirdFri ? `1px solid ${T.red}` : "none",
                        boxSizing: "border-box",
                        cursor: day.notional > 0 ? "pointer" : "default",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: fs(9),
          fontFamily: T.mono,
          color: T.textDim,
          gap: sp(8),
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: T.accent,
                borderRadius: 1,
                marginRight: 4,
                verticalAlign: "middle",
                opacity: 0.7,
              }}
            />
            daily
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: T.amber,
                borderRadius: 1,
                marginRight: 4,
                verticalAlign: "middle",
                opacity: 0.9,
              }}
            />
            weekly Fri
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: T.red,
                borderRadius: 1,
                marginRight: 4,
                verticalAlign: "middle",
                border: `1px solid ${T.red}`,
              }}
            />
            monthly (3rd Fri)
          </span>
        </span>
        {peak ? (
          <span>
            next peak:{" "}
            <span style={{ color: T.text, fontWeight: 700 }}>{peak.iso}</span> ·{" "}
            <span style={{ color: T.amber, fontWeight: 700 }}>
              {formatAccountMoney(peak.notional, currency, true, maskValues)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default ExpiryCalendarHeatmap;
