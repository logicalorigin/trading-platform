import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  shouldUseCriticalOnlyAlgoCockpitPayload,
  subscribeAlgoCockpitSnapshots,
  type AlgoCockpitStreamPayload,
} from "./algo-cockpit-streams";

function payload(label: string): AlgoCockpitStreamPayload {
  return {
    stream: "algo-cockpit-live",
    phase: "full",
    mode: "paper",
    deploymentId: null,
    updatedAt: `2026-05-20T20:00:00.000Z:${label}`,
    deployments: { deployments: [] } as never,
    focusedDeployment: null,
    events: { events: [] } as never,
    signalOptionsState: null,
    cockpit: { label } as never,
    performance: null,
    signalMonitorProfile: null,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("algo cockpit stream sheds full derived payloads under API pressure", () => {
  assert.equal(shouldUseCriticalOnlyAlgoCockpitPayload("normal"), false);
  assert.equal(shouldUseCriticalOnlyAlgoCockpitPayload("watch"), false);
  assert.equal(shouldUseCriticalOnlyAlgoCockpitPayload("high"), true);
  assert.equal(shouldUseCriticalOnlyAlgoCockpitPayload("critical"), true);
});

test("algo cockpit stream uses lean first-paint payloads", () => {
  const source = readFileSync(
    new URL("./algo-cockpit-streams.ts", import.meta.url),
    "utf8",
  );
  const criticalPayload = source.match(
    /export async function fetchAlgoCockpitCriticalPayload[\s\S]*?\n}\n\nexport async function fetchAlgoCockpitStreamPayload/,
  )?.[0] ?? "";

  assert.match(criticalPayload, /const criticalEventLimit = Math\.min\(target\.eventLimit, 20\)/);
  assert.match(criticalPayload, /view:\s*"summary"/);
  assert.doesNotMatch(criticalPayload, /getAlgoDeploymentCockpit/);
  assert.match(source, /getAlgoDeploymentCockpit\(\{[\s\S]*view:\s*"summary"/);
});

test("algo cockpit stream coalesces change events while a poll is in flight", async () => {
  let changeHandler: (change: { mode?: "paper" | "live" }) => void = () => {
    throw new Error("Change handler was not registered.");
  };
  let fetchCalls = 0;
  let unsubscribed = false;
  const pendingPolls: Array<(value: AlgoCockpitStreamPayload) => void> = [];
  const scheduledTimeouts: Array<() => void> = [];
  const snapshots: AlgoCockpitStreamPayload[] = [];

  const unsubscribe = subscribeAlgoCockpitSnapshots(
    { mode: "paper" },
    (snapshot) => {
      snapshots.push(snapshot);
    },
    {
      fetchPayload: async () => {
        fetchCalls += 1;
        return new Promise<AlgoCockpitStreamPayload>((resolve) => {
          pendingPolls.push(resolve);
        });
      },
      subscribeChanges: ((handler: typeof changeHandler) => {
        changeHandler = handler;
        return () => {
          unsubscribed = true;
        };
      }) as never,
      setInterval: (() => ({ unref() {} })) as never,
      clearInterval: (() => {}) as never,
      setTimeout: ((callback: () => void) => {
        scheduledTimeouts.push(callback);
        return { unref() {} };
      }) as never,
      clearTimeout: (() => {}) as never,
      coalescedPollDelayMs: 1,
    },
  );

  assert.equal(fetchCalls, 1);

  changeHandler({ mode: "paper" });
  changeHandler({ mode: "paper" });
  changeHandler({ mode: "paper" });

  assert.equal(fetchCalls, 1);
  pendingPolls.shift()?.(payload("first"));
  await flush();

  assert.equal(snapshots.length, 1);
  assert.equal(scheduledTimeouts.length, 1);

  changeHandler({ mode: "paper" });
  assert.equal(scheduledTimeouts.length, 1);

  scheduledTimeouts.shift()?.();
  assert.equal(fetchCalls, 2);

  pendingPolls.shift()?.(payload("second"));
  await flush();

  assert.equal(snapshots.length, 2);
  assert.equal(fetchCalls, 2);

  unsubscribe();
  assert.equal(unsubscribed, true);
});
