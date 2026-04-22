import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEquivolumeLayout,
  buildVolumeBarGeometry,
  buildVolumeCandleGeometry,
  computeVolumeWidths,
  resolveDisplayVolumeWidthPx,
  resolveVolumeWickWidthPx,
} from "./researchVolumeCandleUtils.js";

test("computeVolumeWidths allocates more width to higher-volume bars and fits the available width", () => {
  const widths = computeVolumeWidths([100, 300, 600], {
    availableWidth: 120,
    gapPx: 1,
    minWidthPx: 2,
  });

  assert.equal(widths.length, 3);
  assert(widths[0] < widths[1]);
  assert(widths[1] < widths[2]);
  const totalWidth = widths.reduce((sum, value) => sum + value, 0);
  assert(Math.abs(totalWidth - 118) < 0.000001);
});

test("buildEquivolumeLayout shifts x positions cumulatively instead of keeping fixed slots", () => {
  const layout = buildEquivolumeLayout(
    [{ time: 1 }, { time: 2 }, { time: 3 }],
    {
      volumes: [100, 300, 600],
      left: 10,
      right: 130,
      gapPx: 1,
      minWidthPx: 2,
    },
  );

  assert.equal(layout.length, 3);
  assert.equal(layout[0].x, 10);
  assert(layout[1].x > layout[0].x + layout[0].width);
  assert(layout[2].x > layout[1].x + layout[1].width);
  assert(layout[2].width > layout[0].width);
});

test("buildVolumeCandleGeometry preserves left-edge bodies and scales wick width with candle width", () => {
  const geometry = buildVolumeCandleGeometry({
    x: 20,
    openY: 50,
    highY: 40,
    lowY: 90,
    closeY: 80,
    widthPx: 10,
  });

  assert.equal(geometry.bodyLeft, 20);
  assert.equal(geometry.bodyWidth, 10);
  assert.equal(geometry.wickX, 25);
  assert.equal(geometry.wickWidth, resolveVolumeWickWidthPx(10));
});

test("buildVolumeBarGeometry reuses candle width for the lower pane", () => {
  const geometry = buildVolumeBarGeometry({
    x: 14,
    widthPx: 9,
    volumeY: 18,
    paneBottomY: 40,
  });

  assert.deepEqual(geometry, {
    left: 14,
    top: 18,
    width: 9,
    height: 22,
  });
});

test("resolveDisplayVolumeWidthPx keeps dense equivolume bars visually readable", () => {
  assert.equal(resolveDisplayVolumeWidthPx(0.2), 2);
  assert.equal(resolveDisplayVolumeWidthPx(1.5), 2);
  assert.equal(resolveDisplayVolumeWidthPx(4), 4);
});
