import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";
import { formatAppTimeForPreferences } from "../../lib/timeZone";
import { motionRowStyle } from "../../lib/motion";

export const AlgoEventsTab = ({
  events,
  focusedDeployment,
  userPreferences,
}) => (
  <div
    style={{
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: dim(RADII.sm),
      padding: sp("10px 12px"),
      flex: "0 1 auto",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: sp(8),
        marginBottom: sp(8),
      }}
    >
      <div>
        <div
          style={{
            fontSize: fs(12),
            fontWeight: FONT_WEIGHTS.regular,
            fontFamily: T.sans,
            color: T.text,
          }}
        >
          Execution Events
        </div>
        <div
          style={{ fontSize: textSize("caption"), color: T.textDim, fontFamily: T.sans }}
        >
          {focusedDeployment
            ? `filtered to ${focusedDeployment.name}`
            : "latest automation events"}
        </div>
      </div>
      <span
        style={{ fontSize: textSize("body"), color: T.textDim, fontFamily: T.sans }}
      >
        {events.length} rows
      </span>
    </div>

    {!events.length ? (
      <div
        style={{
          padding: sp("18px 10px"),
          border: `1px dashed ${T.border}`,
          borderRadius: dim(RADII.sm),
          fontSize: fs(10),
          color: T.textDim,
          fontFamily: T.sans,
          lineHeight: 1.5,
        }}
      >
        No execution events have been recorded yet.
      </div>
    ) : (
      events.map((event, index) => (
        <div
          key={event.id}
          className="ra-row-enter"
          style={{
            ...motionRowStyle(index, 10, 140),
            display: "grid",
            gridTemplateColumns: `${dim(64)}px ${dim(132)}px 1fr ${dim(88)}px`,
            gap: sp(8),
            alignItems: "start",
            padding: sp("8px 0"),
            borderBottom: `1px solid ${T.border}08`,
            fontSize: textSize("caption"),
          }}
        >
          <span style={{ color: T.textDim, fontFamily: T.sans }}>
            {formatAppTimeForPreferences(event.occurredAt, userPreferences)}
          </span>
          <span
            style={{ color: T.accent, fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}
          >
            {formatEnumLabel(event.eventType)}
          </span>
          <span
            style={{
              color: T.textSec,
              fontFamily: T.sans,
              lineHeight: 1.4,
            }}
          >
            {event.summary}
          </span>
          <span
            style={{
              color: event.symbol ? T.text : T.textDim,
              fontFamily: T.sans,
              textAlign: "right",
            }}
          >
            {event.symbol || event.providerAccountId || "system"}
          </span>
        </div>
      ))
    )}
  </div>
);

export default AlgoEventsTab;
