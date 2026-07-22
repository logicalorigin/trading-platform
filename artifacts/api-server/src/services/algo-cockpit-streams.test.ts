import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  currentDbAdmissionSignal,
  runWithDbAdmissionSignal,
} from "@workspace/db";

import {
  subscribeAlgoCockpitSnapshots,
  type AlgoCockpitStreamInput,
  type AlgoCockpitStreamPayload,
} from "./algo-cockpit-streams";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseEmitCounters,
  serializeSseEventData,
} from "./sse-stream-diagnostics";

const source = readFileSync(
  new URL("./algo-cockpit-streams.ts", import.meta.url),
  "utf8",
);

type TimerHandle = {
  callback: () => void;
  unref: () => void;
};

function createFakeTimers() {
  const intervals = new Set<TimerHandle>();
  const timeouts = new Set<TimerHandle>();
  return {
    intervalCount: () => intervals.size,
    setInterval: ((callback: () => void) => {
      const handle = { callback, unref: () => {} };
      intervals.add(handle);
      return handle as never;
    }) as unknown as typeof setInterval,
    clearInterval: ((handle: TimerHandle) => {
      intervals.delete(handle);
    }) as unknown as typeof clearInterval,
    setTimeout: ((callback: () => void) => {
      const handle = { callback, unref: () => {} };
      timeouts.add(handle);
      return handle as never;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((handle: TimerHandle) => {
      timeouts.delete(handle);
    }) as unknown as typeof clearTimeout,
    fireIntervals: () => {
      for (const handle of [...intervals]) {
        handle.callback();
      }
    },
    fireTimeouts: () => {
      for (const handle of [...timeouts]) {
        timeouts.delete(handle);
        handle.callback();
      }
    },
  };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function streamPayload(
  marker: string,
  input: AlgoCockpitStreamInput,
): AlgoCockpitStreamPayload {
  return {
    stream: "algo-cockpit-live",
    phase: "full",
    mode: input.mode === "live" ? "live" : "shadow",
    deploymentId: input.deploymentId ?? null,
    updatedAt: `2026-07-07T00:00:${marker.padStart(2, "0")}.000Z`,
    deployments: { deployments: [] } as never,
    focusedDeployment: null,
    events: { events: [{ id: `event-${marker}` }] } as never,
    signalOptionsState: null,
    cockpit: null,
    performance: null,
    signalMonitorProfile: null,
  };
}

function eventMarker(payload: AlgoCockpitStreamPayload): string {
  return (
    (payload.events as unknown as { events: Array<{ id: string }> }).events[0]
      ?.id ?? ""
  );
}

function streamTestOptions(
  timers: ReturnType<typeof createFakeTimers>,
  fetchPayload: (
    input: AlgoCockpitStreamInput,
    stream: AlgoCockpitStreamPayload["stream"],
  ) => Promise<AlgoCockpitStreamPayload>,
) {
  return {
    fetchPayload,
    subscribeChanges: () => () => {},
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    coalescedPollDelayMs: 0,
  };
}

test("algo cockpit stream stays full-fidelity under high pressure", () => {
  const start = source.indexOf(
    "export function shouldUsePrimaryOnlyAlgoCockpitPayload",
  );
  assert.notEqual(start, -1, "Missing pressure gate");
  const end = source.indexOf("\nasync function", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  assert.match(body, /return false/);
  assert.doesNotMatch(body, /level === "high"/);
});

test("algo cockpit stream does not use pressure to serve primary-only payloads", () => {
  const start = source.indexOf(
    "export async function fetchAlgoCockpitStreamPayload",
  );
  assert.notEqual(start, -1, "Missing cockpit stream payload builder");
  const end = source.indexOf(
    "\nexport function subscribeAlgoCockpitSnapshots",
    start + 1,
  );
  assert.notEqual(end, -1, "Missing cockpit subscription builder");
  const fallbackEnd = source.indexOf(
    "const target = await resolveAlgoCockpitTarget",
    start,
  );
  const fallback = source.slice(start, fallbackEnd === -1 ? end : fallbackEnd);

  assert.doesNotMatch(fallback, /getApiResourcePressureSnapshot/);
  assert.doesNotMatch(fallback, /shouldUsePrimaryOnlyAlgoCockpitPayload/);
  assert.doesNotMatch(
    fallback,
    /return fetchAlgoCockpitPrimaryPayload\(input, stream\)/,
  );
  assert.doesNotMatch(fallback, /phase: "full"/);
});

test("algo cockpit subscribers with the same key share one poll per cadence tick", async () => {
  const timers = createFakeTimers();
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  let fetchCount = 0;
  const fetchPayload = async (input: AlgoCockpitStreamInput) => {
    fetchCount += 1;
    return streamPayload(String(fetchCount), input);
  };
  const options = streamTestOptions(timers, fetchPayload);
  const unsubscribeA = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    (payload) => {
      receivedA.push(eventMarker(payload));
    },
    options,
  );
  const unsubscribeB = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    (payload) => {
      receivedB.push(eventMarker(payload));
    },
    options,
  );

  try {
    await flushAsyncWork();

    assert.equal(fetchCount, 1);
    assert.equal(timers.intervalCount(), 1);
    assert.deepEqual(receivedA, ["event-1"]);
    assert.deepEqual(receivedB, ["event-1"]);

    timers.fireIntervals();
    await flushAsyncWork();

    assert.equal(fetchCount, 2);
    assert.deepEqual(receivedA, ["event-1", "event-2"]);
    assert.deepEqual(receivedB, ["event-1", "event-2"]);
  } finally {
    unsubscribeA();
    unsubscribeB();
  }
});

test("a late algo cockpit subscriber waits for a fresh shared poll", async () => {
  const timers = createFakeTimers();
  const input = {
    deploymentId: "deployment-fresh-join",
    mode: "shadow" as const,
    eventLimit: 25,
  };
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  let fetchCount = 0;
  const options = streamTestOptions(timers, async () => {
    fetchCount += 1;
    return streamPayload(String(fetchCount), input);
  });
  const unsubscribeA = subscribeAlgoCockpitSnapshots(
    input,
    (payload) => receivedA.push(eventMarker(payload)),
    options,
  );

  await flushAsyncWork();
  assert.deepEqual(receivedA, ["event-1"]);

  const unsubscribeB = subscribeAlgoCockpitSnapshots(
    input,
    (payload) => receivedB.push(eventMarker(payload)),
    options,
  );
  try {
    await flushAsyncWork();

    assert.equal(fetchCount, 2);
    assert.deepEqual(receivedA, ["event-1", "event-2"]);
    assert.deepEqual(receivedB, ["event-2"]);
  } finally {
    unsubscribeA();
    unsubscribeB();
  }
});

test("shared algo cockpit polls outlive the first subscriber request signal", async () => {
  const timers = createFakeTimers();
  const input = {
    deploymentId: "deployment-request-signal",
    mode: "shadow" as const,
    eventLimit: 25,
  };
  const firstRequest = new AbortController();
  const secondRequest = new AbortController();
  const fetchSignals: Array<AbortSignal | undefined> = [];
  const subscriberSignals: Array<AbortSignal | undefined> = [];
  let fetchCount = 0;
  const options = streamTestOptions(timers, async () => {
    fetchSignals.push(currentDbAdmissionSignal());
    fetchCount += 1;
    return streamPayload(String(fetchCount), input);
  });
  const unsubscribeFirst = runWithDbAdmissionSignal(
    firstRequest.signal,
    () => subscribeAlgoCockpitSnapshots(input, () => {}, options),
  );
  const unsubscribeSecond = runWithDbAdmissionSignal(
    secondRequest.signal,
    () =>
      subscribeAlgoCockpitSnapshots(
        input,
        () => subscriberSignals.push(currentDbAdmissionSignal()),
        options,
      ),
  );

  try {
    await flushAsyncWork();
    assert.equal(fetchCount, 1);
    fetchSignals.length = 0;
    subscriberSignals.length = 0;

    firstRequest.abort();
    unsubscribeFirst();
    runWithDbAdmissionSignal(firstRequest.signal, timers.fireIntervals);
    await flushAsyncWork();

    assert.equal(fetchSignals.length, 1);
    assert.notEqual(fetchSignals[0], firstRequest.signal);
    assert.equal(fetchSignals[0]?.aborted, false);
    assert.equal(subscriberSignals.length, 1);
    assert.notEqual(subscriberSignals[0], firstRequest.signal);
    assert.equal(subscriberSignals[0]?.aborted, false);

    const pollSignal = fetchSignals[0];
    unsubscribeSecond();
    assert.equal(pollSignal?.aborted, true);
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
});

test("algo cockpit subscribers with different keys use separate pollers", async () => {
  const timers = createFakeTimers();
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  let fetchCount = 0;
  const fetchPayload = async (input: AlgoCockpitStreamInput) => {
    fetchCount += 1;
    return streamPayload(
      `${input.deploymentId ?? "none"}-${fetchCount}`,
      input,
    );
  };
  const options = streamTestOptions(timers, fetchPayload);
  const unsubscribeA = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-a", mode: "shadow", eventLimit: 25 },
    (payload) => {
      receivedA.push(eventMarker(payload));
    },
    options,
  );
  const unsubscribeB = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-b", mode: "shadow", eventLimit: 25 },
    (payload) => {
      receivedB.push(eventMarker(payload));
    },
    options,
  );

  try {
    await flushAsyncWork();

    assert.equal(fetchCount, 2);
    assert.equal(timers.intervalCount(), 2);
    assert.deepEqual(receivedA, ["event-deployment-a-1"]);
    assert.deepEqual(receivedB, ["event-deployment-b-2"]);

    timers.fireIntervals();
    await flushAsyncWork();

    assert.equal(fetchCount, 4);
    assert.deepEqual(receivedA, [
      "event-deployment-a-1",
      "event-deployment-a-3",
    ]);
    assert.deepEqual(receivedB, [
      "event-deployment-b-2",
      "event-deployment-b-4",
    ]);
  } finally {
    unsubscribeA();
    unsubscribeB();
  }
});

test("algo cockpit shared poller stops after the last unsubscribe", async () => {
  const timers = createFakeTimers();
  let fetchCount = 0;
  const fetchPayload = async (input: AlgoCockpitStreamInput) => {
    fetchCount += 1;
    return streamPayload(String(fetchCount), input);
  };
  const options = streamTestOptions(timers, fetchPayload);
  const unsubscribeA = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    () => {},
    options,
  );
  const unsubscribeB = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    () => {},
    options,
  );

  await flushAsyncWork();
  assert.equal(fetchCount, 1);
  assert.equal(timers.intervalCount(), 1);

  unsubscribeA();
  timers.fireIntervals();
  await flushAsyncWork();
  assert.equal(fetchCount, 2);
  assert.equal(timers.intervalCount(), 1);

  unsubscribeB();
  assert.equal(timers.intervalCount(), 0);
  timers.fireIntervals();
  await flushAsyncWork();
  assert.equal(fetchCount, 2);
});

test("algo cockpit shared poller keeps other subscribers flowing after one subscriber throws", async () => {
  const timers = createFakeTimers();
  const received: string[] = [];
  let fetchCount = 0;
  const fetchPayload = async (input: AlgoCockpitStreamInput) => {
    fetchCount += 1;
    return streamPayload(String(fetchCount), input);
  };
  const options = streamTestOptions(timers, fetchPayload);
  const unsubscribeA = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    () => {
      throw new Error("subscriber write failed");
    },
    options,
  );
  const unsubscribeB = subscribeAlgoCockpitSnapshots(
    { deploymentId: "deployment-1", mode: "shadow", eventLimit: 25 },
    (payload) => {
      received.push(eventMarker(payload));
    },
    options,
  );

  try {
    await flushAsyncWork();
    timers.fireIntervals();
    await flushAsyncWork();

    assert.equal(fetchCount, 2);
    assert.deepEqual(received, ["event-1", "event-2"]);
  } finally {
    unsubscribeA();
    unsubscribeB();
  }
});

test("algo cockpit ignores volatile rebuild stamps but emits one semantic change", async () => {
  __resetSseStreamDiagnosticsForTests();
  const timers = createFakeTimers();
  const input = {
    deploymentId: "deployment-volatile-stamps",
    mode: "shadow" as const,
    eventLimit: 25,
  };
  const payloads = [
    { stamp: "01", event: "same" },
    { stamp: "02", event: "same" },
    { stamp: "03", event: "changed" },
  ].map(({ stamp, event }) => ({
    ...streamPayload(event, input),
    updatedAt: `2026-07-07T00:00:${stamp}.000Z`,
    cockpit: { generatedAt: `2026-07-07T00:00:${stamp}.000Z` } as never,
    performance: { generatedAt: `2026-07-07T00:00:${stamp}.000Z` } as never,
  }));
  const changed: boolean[] = [];
  let fetchCount = 0;
  const unsubscribe = subscribeAlgoCockpitSnapshots(
    input,
    (payload) => {
      serializeSseEventData(payload);
    },
    {
      ...streamTestOptions(timers, async () => payloads[fetchCount++]!),
      onPollSuccess: (result) => {
        changed.push(result.changed);
      },
    },
  );

  try {
    await flushAsyncWork();
    assert.deepEqual(changed, [true]);
    assert.equal(getSseEmitCounters().events, 1);

    timers.fireIntervals();
    await flushAsyncWork();
    assert.deepEqual(changed, [true, false]);
    assert.equal(getSseEmitCounters().events, 1);

    timers.fireIntervals();
    await flushAsyncWork();
    assert.deepEqual(changed, [true, false, true]);
    assert.equal(getSseEmitCounters().events, 2);
  } finally {
    unsubscribe();
    __resetSseStreamDiagnosticsForTests();
  }
});
