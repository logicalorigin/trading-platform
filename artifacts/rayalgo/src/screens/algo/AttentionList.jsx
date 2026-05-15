import { RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

const severityWeight = (severity) => {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
};

const severityIcon = (severity) => {
  if (severity === "critical") return "!";
  if (severity === "warning") return "⚠";
  return "·";
};

const severityColor = (severity) => {
  if (severity === "critical") return T.red;
  if (severity === "warning") return T.amber;
  return T.cyan;
};

export const AttentionList = ({ items, emptyMessage }) => {
  const ranked = [...(Array.isArray(items) ? items : [])].sort(
    (a, b) => severityWeight(a?.severity) - severityWeight(b?.severity),
  );

  if (!ranked.length) {
    return (
      <div
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: fs(9),
          lineHeight: 1.45,
          padding: sp("8px 4px"),
        }}
      >
        {emptyMessage || "No active blockers or drift detected."}
      </div>
    );
  }

  return (
    <div
      data-testid="algo-attention-list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(4),
        minWidth: 0,
      }}
    >
      {ranked.map((item, index) => {
        const tone = severityColor(item?.severity);
        return (
          <div
            key={item?.id || `${item?.kind || "item"}-${index}`}
            style={{
              display: "grid",
              gridTemplateColumns: `${dim(14)}px minmax(0, 1fr)`,
              alignItems: "start",
              gap: sp(6),
              padding: sp("8px 10px"),
              border: "none",
              borderRadius: dim(RADII.md),
              background: `${tone}10`,
              minWidth: 0,
            }}
          >
            <span
              style={{
                color: tone,
                fontFamily: T.sans,
                fontSize: fs(10),
                lineHeight: 1.1,
              }}
            >
              {severityIcon(item?.severity)}
            </span>
            <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: sp(5),
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: tone,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                    letterSpacing: "0.04em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item?.title || item?.symbol || "—"}
                </span>
                {item?.kindLabel ? (
                  <span
                    style={{
                      color: T.textMuted,
                      fontFamily: T.sans,
                      fontSize: fs(7),
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.kindLabel}
                  </span>
                ) : null}
              </div>
              {item?.summary ? (
                <div
                  style={{
                    color: T.textDim,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                    lineHeight: 1.35,
                  }}
                >
                  {item.summary}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};
