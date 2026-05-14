import { ChevronDown, ChevronRight } from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import { formatEnumLabel } from "../../lib/formatters";

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
}) => {
  const aggregate = totalCount(rows);
  const showExpanded = expanded;

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
          borderRadius: dim(3),
          background: T.bg2,
          color: healthy ? T.textMuted : color,
          fontFamily: T.sans,
          fontSize: fs(8),
          letterSpacing: "0.04em",
          cursor: "pointer",
        }}
      >
        <ChevronRight size={11} />
        <span>{title.toUpperCase()}</span>
        <span
          style={{
            color: healthy ? T.textMuted : color,
            opacity: 0.85,
          }}
        >
          {healthy ? "ok" : aggregate}
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid={`algo-diag-panel-${title.toLowerCase().replace(/\s+/g, "-")}`}
      data-state="expanded"
      style={{
        border: "none",
        borderRadius: dim(4),
        background: T.bg2,
        padding: sp("7px 9px"),
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="ra-interactive"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: sp(5),
          background: "transparent",
          border: "none",
          padding: 0,
          marginBottom: sp(6),
          cursor: "pointer",
          color,
          fontFamily: T.sans,
          fontSize: fs(7),
          letterSpacing: "0.08em",
          textAlign: "left",
        }}
      >
        <ChevronDown size={11} />
        <span style={{ flex: 1 }}>{String(title).toUpperCase()}</span>
        {!healthy ? <span style={{ color }}>{aggregate}</span> : null}
      </button>
      {rows && rows.length ? (
        <div style={{ display: "grid", gap: sp(5), minWidth: 0 }}>
          {rows.map(([label, count]) => (
            <div
              key={label}
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
                  color: T.textSec,
                  fontFamily: T.sans,
                  fontSize: fs(8),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatEnumLabel(label)}
              </span>
              <span
                style={{
                  color:
                    Number(count) > 0 && !healthy ? color : T.text,
                  fontFamily: T.sans,
                  fontSize: fs(8),
                }}
              >
                {count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: fs(8),
          }}
        >
          none
        </div>
      )}
    </div>
  );
};
