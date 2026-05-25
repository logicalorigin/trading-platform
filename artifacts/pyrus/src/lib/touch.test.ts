import assert from "node:assert/strict";
import test from "node:test";
import {
  createLongPressController,
  pointerDistance,
} from "./touch";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("pointerDistance measures pointer movement", () => {
  assert.equal(
    pointerDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }),
    5,
  );
});

test("createLongPressController fires after the configured delay", async () => {
  let fired = 0;
  const controller = createLongPressController(() => {
    fired += 1;
  }, { ms: 15 });

  controller.start({ clientX: 10, clientY: 10 });
  assert.equal(controller.isPending(), true);
  await wait(25);
  assert.equal(fired, 1);
  assert.equal(controller.isPending(), false);
});

test("createLongPressController cancels when movement exceeds tolerance", async () => {
  let fired = 0;
  const controller = createLongPressController(() => {
    fired += 1;
  }, { ms: 15, moveTolerance: 4 });

  controller.start({ clientX: 10, clientY: 10 });
  controller.move({ clientX: 18, clientY: 10 });
  await wait(25);
  assert.equal(fired, 0);
  assert.equal(controller.isPending(), false);
});

test("createLongPressController cancels on pointer release", async () => {
  let fired = 0;
  const controller = createLongPressController(() => {
    fired += 1;
  }, { ms: 15 });

  controller.start({ clientX: 10, clientY: 10 });
  controller.cancel();
  await wait(25);
  assert.equal(fired, 0);
});
