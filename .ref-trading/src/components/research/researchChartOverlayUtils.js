const DEFAULT_OVERLAY_MERGE_TARGET_WIDTH_PX = 6;
const DEFAULT_FONT_MONO = "'IBM Plex Mono','Fira Code',monospace";

export function buildOverlayRectSignature(rects = []) {
  if (!Array.isArray(rects) || !rects.length) {
    return "empty";
  }
  return rects
    .map((rect) => [
      rect?.id || "",
      Math.round(Number(rect?.left) || 0),
      Math.round(Number(rect?.width) || 0),
      String(rect?.background || ""),
    ].join(":"))
    .join("|");
}

export function buildOverlayZoneSignature(rects = []) {
  if (!Array.isArray(rects) || !rects.length) {
    return "empty";
  }
  return rects
    .map((rect) => [
      rect?.id || "",
      Math.round(Number(rect?.left) || 0),
      Math.round(Number(rect?.top) || 0),
      Math.round(Number(rect?.width) || 0),
      Math.round(Number(rect?.height) || 0),
      String(rect?.label || ""),
      String(rect?.borderColor || ""),
    ].join(":"))
    .join("|");
}

export function getOverlayMergeGapBars(visibleBarRange, viewportWidth) {
  const width = Number(viewportWidth);
  if (!visibleBarRange || !Number.isFinite(width) || width <= 0) {
    return 0;
  }
  const visibleSpan = Math.max(1, visibleBarRange.to - visibleBarRange.from + 1);
  const barsPerPixel = visibleSpan / width;
  return Math.max(0, Math.ceil(barsPerPixel * DEFAULT_OVERLAY_MERGE_TARGET_WIDTH_PX) - 1);
}

export function coalesceIndicatorWindows(indicatorWindows = [], mergeGapBars = 0) {
  const orderedWindows = (Array.isArray(indicatorWindows) ? indicatorWindows : [])
    .filter((indicatorWindow) => indicatorWindow?.startBarIndex != null && indicatorWindow?.endBarIndex != null)
    .slice()
    .sort((left, right) => {
      if (left.startBarIndex !== right.startBarIndex) {
        return left.startBarIndex - right.startBarIndex;
      }
      return left.endBarIndex - right.endBarIndex;
    });

  const mergedWindows = [];
  let current = null;

  for (const indicatorWindow of orderedWindows) {
    const nextStartBarIndex = Number(indicatorWindow.startBarIndex);
    const nextEndBarIndex = Math.max(nextStartBarIndex, Number(indicatorWindow.endBarIndex));
    const nextDirection = indicatorWindow.direction === "short" ? "short" : "long";
    const nextConviction = Math.max(0, Number(indicatorWindow?.conviction) || 0);

    if (!current) {
      current = {
        startBarIndex: nextStartBarIndex,
        endBarIndex: nextEndBarIndex,
        direction: nextDirection,
        conviction: nextConviction,
      };
      continue;
    }

    const canMerge = current.direction === nextDirection
      && nextStartBarIndex <= current.endBarIndex + Math.max(0, mergeGapBars);

    if (canMerge) {
      current.endBarIndex = Math.max(current.endBarIndex, nextEndBarIndex);
      current.conviction = Math.max(current.conviction, nextConviction);
      continue;
    }

    mergedWindows.push({
      ...current,
      id: `shade-${current.direction}-${current.startBarIndex}-${current.endBarIndex}`,
    });
    current = {
      startBarIndex: nextStartBarIndex,
      endBarIndex: nextEndBarIndex,
      direction: nextDirection,
      conviction: nextConviction,
    };
  }

  if (current) {
    mergedWindows.push({
      ...current,
      id: `shade-${current.direction}-${current.startBarIndex}-${current.endBarIndex}`,
    });
  }

  return mergedWindows;
}

export function resolveDominantIndicatorWindows(indicatorWindows = [], visibleBarRange = null, mergeGapBars = 0) {
  const orderedWindows = (Array.isArray(indicatorWindows) ? indicatorWindows : [])
    .filter((indicatorWindow) => indicatorWindow?.startBarIndex != null && indicatorWindow?.endBarIndex != null)
    .slice()
    .sort((left, right) => {
      if (left.startBarIndex !== right.startBarIndex) {
        return left.startBarIndex - right.startBarIndex;
      }
      if (left.endBarIndex !== right.endBarIndex) {
        return left.endBarIndex - right.endBarIndex;
      }
      return (Number(right?.conviction) || 0) - (Number(left?.conviction) || 0);
    });

  if (!orderedWindows.length) {
    return [];
  }

  const fallbackFrom = orderedWindows.reduce((minimum, indicatorWindow) => (
    Math.min(minimum, Math.max(0, Number(indicatorWindow?.startBarIndex) || 0))
  ), Number.POSITIVE_INFINITY);
  const fallbackTo = orderedWindows.reduce((maximum, indicatorWindow) => (
    Math.max(maximum, Math.max(0, Number(indicatorWindow?.endBarIndex) || 0))
  ), 0);
  const from = visibleBarRange
    ? Math.max(0, Math.floor(Number(visibleBarRange.from) || 0))
    : fallbackFrom;
  const to = visibleBarRange
    ? Math.max(from, Math.ceil(Number(visibleBarRange.to) || from))
    : Math.max(from, fallbackTo);

  const barStates = Array.from({ length: Math.max(0, to - from + 1) }, () => ({
    longScore: 0,
    shortScore: 0,
    longConviction: 0,
    shortConviction: 0,
    longRecency: 0,
    shortRecency: 0,
  }));

  for (const indicatorWindow of orderedWindows) {
    const direction = indicatorWindow?.direction === "short" ? "short" : "long";
    const startBarIndex = Math.max(from, Number(indicatorWindow?.startBarIndex) || 0);
    const endBarIndex = Math.min(to, Math.max(startBarIndex, Number(indicatorWindow?.endBarIndex) || startBarIndex));
    const conviction = Math.max(0.25, Number(indicatorWindow?.conviction) || 0);
    const recency = Math.max(0, Number(indicatorWindow?.endBarIndex) || 0);
    const scoreKey = direction === "short" ? "shortScore" : "longScore";
    const convictionKey = direction === "short" ? "shortConviction" : "longConviction";
    const recencyKey = direction === "short" ? "shortRecency" : "longRecency";

    for (let barIndex = startBarIndex; barIndex <= endBarIndex; barIndex += 1) {
      const barState = barStates[barIndex - from];
      if (!barState) {
        continue;
      }
      barState[scoreKey] += conviction;
      barState[convictionKey] = Math.max(barState[convictionKey], conviction);
      barState[recencyKey] = Math.max(barState[recencyKey], recency);
    }
  }

  const dominantWindows = [];
  let currentWindow = null;

  const flushWindow = () => {
    if (!currentWindow) {
      return;
    }
    dominantWindows.push({
      ...currentWindow,
      id: `dominant-shade-${currentWindow.direction}-${currentWindow.startBarIndex}-${currentWindow.endBarIndex}`,
    });
    currentWindow = null;
  };

  for (let barIndex = from; barIndex <= to; barIndex += 1) {
    const barState = barStates[barIndex - from] || null;
    const longScore = Number(barState?.longScore) || 0;
    const shortScore = Number(barState?.shortScore) || 0;
    let direction = null;
    let conviction = 0;

    if (longScore > 0 || shortScore > 0) {
      if (longScore > shortScore) {
        direction = "long";
      } else if (shortScore > longScore) {
        direction = "short";
      } else if ((Number(barState?.longConviction) || 0) > (Number(barState?.shortConviction) || 0)) {
        direction = "long";
      } else if ((Number(barState?.shortConviction) || 0) > (Number(barState?.longConviction) || 0)) {
        direction = "short";
      } else {
        direction = (Number(barState?.longRecency) || 0) >= (Number(barState?.shortRecency) || 0)
          ? "long"
          : "short";
      }
      conviction = direction === "short"
        ? (Number(barState?.shortConviction) || 0)
        : (Number(barState?.longConviction) || 0);
    }

    if (!direction) {
      flushWindow();
      continue;
    }

    if (!currentWindow || currentWindow.direction !== direction || barIndex !== currentWindow.endBarIndex + 1) {
      flushWindow();
      currentWindow = {
        direction,
        startBarIndex: barIndex,
        endBarIndex: barIndex,
        conviction,
      };
      continue;
    }

    currentWindow.endBarIndex = barIndex;
    currentWindow.conviction = Math.max(currentWindow.conviction, conviction);
  }

  flushWindow();

  return mergeGapBars > 0
    ? coalesceIndicatorWindows(dominantWindows, mergeGapBars)
    : dominantWindows;
}

function getIndicatorZonePaintOrder(zone) {
  const zoneType = String(zone?.zoneType || "").trim().toLowerCase();
  return zoneType === "fair_value_gap" ? 0 : 1;
}

function computeNumericRangeOverlapRatio(startA, endA, startB, endB) {
  const minA = Math.min(startA, endA);
  const maxA = Math.max(startA, endA);
  const minB = Math.min(startB, endB);
  const maxB = Math.max(startB, endB);
  const overlap = Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
  const spanA = Math.max(1, maxA - minA);
  const spanB = Math.max(1, maxB - minB);
  return overlap / Math.max(1, Math.min(spanA, spanB));
}

function shouldHideOverlappingIndicatorZone(candidateZone, keptZone) {
  if (!candidateZone || !keptZone) {
    return false;
  }
  const candidateDirection = candidateZone?.direction === "short" ? "short" : "long";
  const keptDirection = keptZone?.direction === "short" ? "short" : "long";
  if (candidateDirection !== keptDirection) {
    return false;
  }
  const candidateType = String(candidateZone?.zoneType || "").trim().toLowerCase();
  const keptType = String(keptZone?.zoneType || "").trim().toLowerCase();
  if (!candidateType || candidateType !== keptType) {
    return false;
  }

  const timeOverlapRatio = computeNumericRangeOverlapRatio(
    Number(candidateZone?.startBarIndex) || 0,
    Number(candidateZone?.endBarIndex) || 0,
    Number(keptZone?.startBarIndex) || 0,
    Number(keptZone?.endBarIndex) || 0,
  );
  const candidateTop = Math.max(Number(candidateZone?.top) || 0, Number(candidateZone?.bottom) || 0);
  const candidateBottom = Math.min(Number(candidateZone?.top) || 0, Number(candidateZone?.bottom) || 0);
  const keptTop = Math.max(Number(keptZone?.top) || 0, Number(keptZone?.bottom) || 0);
  const keptBottom = Math.min(Number(keptZone?.top) || 0, Number(keptZone?.bottom) || 0);
  const priceOverlapRatio = computeNumericRangeOverlapRatio(candidateBottom, candidateTop, keptBottom, keptTop);

  return timeOverlapRatio >= 0.58 && priceOverlapRatio >= 0.58;
}

export function reduceIndicatorZoneOverlaps(indicatorZones = []) {
  const orderedZones = (Array.isArray(indicatorZones) ? indicatorZones : [])
    .filter((indicatorZone) => indicatorZone?.startBarIndex != null && indicatorZone?.endBarIndex != null)
    .slice()
    .sort((left, right) => {
      if (left.endBarIndex !== right.endBarIndex) {
        return right.endBarIndex - left.endBarIndex;
      }
      if (left.startBarIndex !== right.startBarIndex) {
        return right.startBarIndex - left.startBarIndex;
      }
      return getIndicatorZonePaintOrder(right) - getIndicatorZonePaintOrder(left);
    });

  const keptZones = [];
  for (const indicatorZone of orderedZones) {
    if (keptZones.some((keptZone) => shouldHideOverlappingIndicatorZone(indicatorZone, keptZone))) {
      continue;
    }
    keptZones.push(indicatorZone);
  }

  return keptZones.sort((left, right) => {
    if (left.startBarIndex !== right.startBarIndex) {
      return left.startBarIndex - right.startBarIndex;
    }
    const leftPaintOrder = getIndicatorZonePaintOrder(left);
    const rightPaintOrder = getIndicatorZonePaintOrder(right);
    if (leftPaintOrder !== rightPaintOrder) {
      return leftPaintOrder - rightPaintOrder;
    }
    return left.endBarIndex - right.endBarIndex;
  });
}

export function syncOverlayRectNodes(container, nodeMap, rects) {
  if (!container) {
    return;
  }
  const nextIds = new Set();
  for (const rect of rects) {
    nextIds.add(rect.id);
    let node = nodeMap.get(rect.id) || null;
    if (!node) {
      node = document.createElement("div");
      node.dataset.rectId = rect.id;
      node.style.position = "absolute";
      node.style.top = "0";
      node.style.height = "100%";
      nodeMap.set(rect.id, node);
      container.appendChild(node);
    }
    node.style.left = `${rect.left}px`;
    node.style.width = `${rect.width}px`;
    node.style.background = rect.background;
    node.style.boxShadow = `inset 1px 0 0 ${rect.edge}, inset -1px 0 0 ${rect.edge}`;
  }

  for (const [rectId, node] of nodeMap.entries()) {
    if (nextIds.has(rectId)) {
      continue;
    }
    node.remove();
    nodeMap.delete(rectId);
  }
}

export function syncOverlayZoneNodes(container, nodeMap, rects, fontFamily = DEFAULT_FONT_MONO) {
  if (!container) {
    return;
  }
  const nextIds = new Set();
  for (const rect of Array.isArray(rects) ? rects : []) {
    nextIds.add(rect.id);
    let refs = nodeMap.get(rect.id) || null;
    if (!refs) {
      const node = document.createElement("div");
      node.style.position = "absolute";
      node.style.pointerEvents = "none";
      node.style.overflow = "hidden";
      node.style.borderWidth = "1px";
      node.style.borderStyle = "solid";
      node.style.borderRadius = "8px";
      node.style.boxSizing = "border-box";

      const label = document.createElement("div");
      label.style.position = "absolute";
      label.style.top = "4px";
      label.style.left = "6px";
      label.style.padding = "1px 4px";
      label.style.borderRadius = "999px";
      label.style.border = "1px solid transparent";
      label.style.fontSize = "9px";
      label.style.fontFamily = fontFamily;
      label.style.fontWeight = "800";
      label.style.letterSpacing = "0.01em";
      label.style.lineHeight = "1.2";
      label.style.textTransform = "uppercase";
      node.appendChild(label);

      refs = { node, label };
      nodeMap.set(rect.id, refs);
      container.appendChild(node);
    }
    refs.node.style.left = `${rect.left}px`;
    refs.node.style.top = `${rect.top}px`;
    refs.node.style.width = `${rect.width}px`;
    refs.node.style.height = `${rect.height}px`;
    refs.node.style.background = rect.background;
    refs.node.style.borderWidth = `${Math.max(1, Number(rect.borderWidth) || 1)}px`;
    refs.node.style.borderColor = rect.borderColor;
    refs.node.style.boxShadow = `inset 0 0 0 1px ${rect.innerBorder}`;
    refs.node.style.borderStyle = rect.borderStyle || "solid";
    refs.label.textContent = rect.label || "";
    refs.label.style.color = rect.labelColor;
    refs.label.style.background = rect.labelBackground;
    refs.label.style.borderColor = rect.labelBorder || "transparent";
  }

  for (const [rectId, refs] of nodeMap.entries()) {
    if (nextIds.has(rectId)) {
      continue;
    }
    refs?.node?.remove();
    nodeMap.delete(rectId);
  }
}
