import { useMemo, useState } from "react";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";
import { sp } from "../../lib/uiTokens.jsx";
import {
  InlineError,
  Panel,
  SkeletonRows,
  ToggleGroup,
} from "./accountUtils";
import {
  PositionOptionQuoteStreams,
  useLiveOptionPositionRows,
} from "./PositionsPanel";
import { PositionTreemapContent } from "./PositionTreemapPanel";
import { IntradayPnlContent } from "./IntradayPnlPanel";

const TABS = [
  { value: "heatmap", label: "Heatmap" },
  { value: "intraday", label: "Intraday" },
];

export const TodaySnapshotPanel = ({
  positionsQuery,
  intradayQuery,
  currency,
  maskValues = false,
  emptyHeatmapBody,
  liveOptionQuotesEnabled = true,
  streamLiveOptionQuotes = true,
}) => {
  const [tab, setTab] = useState("heatmap");
  const openPositionRows = useMemo(
    () => getOpenPositionRows(positionsQuery?.data?.positions || []),
    [positionsQuery?.data?.positions],
  );
  const {
    rows: livePositionRows,
    optionQuoteGroups,
  } = useLiveOptionPositionRows({
    rows: openPositionRows,
    enabled: liveOptionQuotesEnabled,
    totals: positionsQuery?.data?.totals,
  });
  return (
    <Panel
      title="Today"
      subtitle={
        tab === "heatmap"
          ? "Position heat by day % move — area is market value"
          : "Intraday P&L curve · session-to-now"
      }
      action={<ToggleGroup options={TABS} value={tab} onChange={setTab} />}
      minHeight={300}
    >
      <div style={{ display: "grid", gap: sp(4) }}>
        {tab === "heatmap" ? (
          positionsQuery?.isLoading ? (
            <SkeletonRows rows={4} />
          ) : positionsQuery?.error ? (
            <InlineError error={positionsQuery.error} onRetry={positionsQuery.refetch} />
          ) : (
            <>
              {streamLiveOptionQuotes ? (
                <PositionOptionQuoteStreams
                  groups={optionQuoteGroups}
                  enabled={liveOptionQuotesEnabled}
                />
              ) : null}
              <PositionTreemapContent
                positions={livePositionRows}
                currency={currency}
                maskValues={maskValues}
                emptyBody={emptyHeatmapBody}
              />
            </>
          )
        ) : intradayQuery?.isLoading ? (
          <SkeletonRows rows={3} />
        ) : intradayQuery?.error ? (
          <InlineError error={intradayQuery.error} onRetry={intradayQuery.refetch} />
        ) : (
          <IntradayPnlContent
            query={intradayQuery}
            currency={currency}
            maskValues={maskValues}
          />
        )}
      </div>
    </Panel>
  );
};

export default TodaySnapshotPanel;
