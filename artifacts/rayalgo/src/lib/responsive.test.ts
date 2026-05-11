import assert from "node:assert/strict";
import test from "node:test";
import {
  BREAKPOINTS,
  responsiveFlags,
  viewportBelow,
} from "./responsive";

test("responsiveFlags keeps existing phone tablet desktop boundaries", () => {
  assert.deepEqual(responsiveFlags(0), {
    isPhone: false,
    isTablet: false,
    isNarrow: false,
    isDesktop: false,
  });
  assert.deepEqual(responsiveFlags(390), {
    isPhone: true,
    isTablet: false,
    isNarrow: true,
    isDesktop: false,
  });
  assert.deepEqual(responsiveFlags(768), {
    isPhone: false,
    isTablet: true,
    isNarrow: true,
    isDesktop: false,
  });
  assert.deepEqual(responsiveFlags(1024), {
    isPhone: false,
    isTablet: false,
    isNarrow: false,
    isDesktop: true,
  });
});

test("viewportBelow accepts named and numeric breakpoints", () => {
  assert.equal(BREAKPOINTS.phone, 768);
  assert.equal(BREAKPOINTS.desktop, 1024);
  assert.equal(viewportBelow(390, "phone"), true);
  assert.equal(viewportBelow(768, "phone"), false);
  assert.equal(viewportBelow(900, "desktop"), true);
  assert.equal(viewportBelow(1100, 1200), true);
  assert.equal(viewportBelow(0, "desktop"), false);
});
