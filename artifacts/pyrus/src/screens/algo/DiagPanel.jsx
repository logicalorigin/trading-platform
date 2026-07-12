import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CSS_COLOR, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";
import {
  FailurePointInlineIcon,
  FailurePointTooltip,
} from "../../components/platform/FailurePointTooltip.jsx";
import { buildDiagRowFailurePoint } from "../../features/platform/failurePointModel.js";

const totalCount = (rows) => {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => {
    const count = Array.isArray(row) ? Number(row[1]) : 0;
    return sum + (Number.isFinite(count) ? count : 0);
  }, 0);
};

export const DiagPanel = ({
  title,
  color,
  rows,
  healthy,
  expanded,
  onToggle,
  readOnly = false,
}) => {
  const aggregate = totalCount(rows);
  const showExpanded = expanded;
  const panelFailurePoint = !healthy
    ? buildDiagRowFailurePoint({ panelTitle: title, label: title, count: aggregate, color })
    : null;

  if (!showExpanded) {
    return (
      <button
        type="button"
        data-testid={`algo-diag-panel-${title.toLowerCase().replace(/\s+/g, "-")}`}
        data-state="collapsed"
        onClick={onToggle}
        className="ra-interactive ra-touch-target"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          padding: sp("3px 8px"),
          border: "none",
          borderRadius: dim(RADII.xs),
          background: CSS_COLOR.bg1,
          color: healthy ? CSS_COLOR.textMuted : color,
          fontFamily: T.sans,
          fontSize: textSize("body"),
          letterSpacing: "0.04em",
          cursor: "pointer",
        }}
      >
        <ChevronRight size={11} />
        <span>{title.toUpperCase()}</span>
        <span
          style={{
            color: healthy ? CSS_COLOR.textMuted : color,
            opacity: 0.85,
          }}
        >
          {healthy ? "ok" : aggregate}
        </span>
        {panelFailurePoint ? (
          <FailurePointInlineIcon
            point={panelFailurePoint}
            side="top"
            size={11}
            focusable={false}
          />
        ) : null}
      </button>
    );
  }

  const headerStyle = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: sp(5),
    background: "transparent",
    border: "none",
    padding: 0,
    marginBottom: sp(6),
    cursor: readOnly ? "default" : "pointer",
    color,
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    letterSpacing: "0.04em",
    textAlign: "left",
  };
  const headerContent = (
    <>
      <ChevronDown size={11} />
      <span style={{ flex: 1 }}>{String(title).toUpperCase()}</span>
      {!healthy ? <span style={{ color }}>{aggregate}</span> : null}
      {panelFailurePoint ? (
        <FailurePointInlineIcon
          point={panelFailurePoint}
          side="top"
          size={11}
          focusable={readOnly}
        />
      ) : null}
    </>
  );

  return (
    <div
      data-testid={`algo-diag-panel-${title.toLowerCase().replace(/\s+/g, "-")}`}
      data-state="expanded"
      style={{
        border: "none",
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg1,
        padding: sp("7px 9px"),
        minWidth: 0,
      }}
    >
      {readOnly ? (
        <div style={headerStyle}>{headerContent}</div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="ra-interactive"
          style={headerStyle}
        >
          {headerContent}
        </button>
      )}
      {rows && rows.length ? (
        <div style={{ display: "grid", gap: sp(5), minWidth: 0 }}>
          {rows.map(([label, count]) => {
            const rowFailurePoint =
              Number(count) > 0
                ? buildDiagRowFailurePoint({ panelTitle: title, label, count, color })
                : null;
            const row = (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: sp(7),
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.textSec,
                    fontFamily: T.sans,
                    fontSize: textSize("body"),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatEnumLabel(label)}
                </span>
                <span
                  className="tnum"
                  style={{
                    color:
                      Number(count) > 0 && !healthy ? color : CSS_COLOR.text,
                    fontFamily: T.data,
                    fontSize: textSize("body"),
                    textAlign: "right",
                  }}
                >
                  {count}
                </span>
              </div>
            );
            return rowFailurePoint ? (
              <FailurePointTooltip
                key={label}
                point={rowFailurePoint}
                side="top"
                align="start"
                compact
              >
                {row}
              </FailurePointTooltip>
            ) : (
              <div key={label}>{row}</div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("body"),
          }}
        >
          none
        </div>
      )}
    </div>
  );
};
