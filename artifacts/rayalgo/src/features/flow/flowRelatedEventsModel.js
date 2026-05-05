import {
  normalizeFlowOptionExpirationIso,
  normalizeFlowOptionRight,
  normalizeFlowOptionStrike,
} from "../platform/flowOptionChartIdentity";
import { getFlowEventTicker } from "../platform/flowActionModel";

const eventTimestampMs = (event) => {
  const raw =
    event?.occurredAt ||
    event?.timestamp ||
    event?.timeIso ||
    event?.updatedAt ||
    event?.time;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : 0;
};

const sameOptionContract = (left, right) => {
  const leftExpiration = normalizeFlowOptionExpirationIso(
    left?.expirationDate || left?.exp,
  );
  const rightExpiration = normalizeFlowOptionExpirationIso(
    right?.expirationDate || right?.exp,
  );
  const leftRight = normalizeFlowOptionRight(left?.right, left?.cp);
  const rightRight = normalizeFlowOptionRight(right?.right, right?.cp);
  const leftStrike = normalizeFlowOptionStrike(left?.strike);
  const rightStrike = normalizeFlowOptionStrike(right?.strike);
  return Boolean(
    leftExpiration &&
      leftExpiration === rightExpiration &&
      leftRight &&
      leftRight === rightRight &&
      leftStrike != null &&
      rightStrike != null &&
      Math.abs(leftStrike - rightStrike) < 0.000001,
  );
};

export const buildRelatedFlowEvents = ({
  event = null,
  events = [],
  limit = 6,
} = {}) => {
  const selectedTicker = getFlowEventTicker(event);
  if (!event || !selectedTicker || !Array.isArray(events) || limit <= 0) {
    return [];
  }

  return events
    .filter((candidate) => {
      if (!candidate || candidate === event) return false;
      if (event.id && candidate.id === event.id) return false;
      return getFlowEventTicker(candidate) === selectedTicker;
    })
    .map((candidate) => {
      const relationship = sameOptionContract(event, candidate)
        ? "same_contract"
        : "same_underlying";
      return {
        ...candidate,
        relationship,
        relatedSortTimeMs: eventTimestampMs(candidate),
      };
    })
    .sort((left, right) => {
      if (left.relationship !== right.relationship) {
        return left.relationship === "same_contract" ? -1 : 1;
      }
      return right.relatedSortTimeMs - left.relatedSortTimeMs;
    })
    .slice(0, limit);
};
