import assert from "node:assert/strict";
import test from "node:test";

import { db } from "@workspace/db";
import {
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  usersTable,
} from "@workspace/db/schema";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import {
  assertTaxPreflightForOrderSubmission,
  createTaxOrderPreflight,
  getControlledIbkrOrderLifecycle,
  getAccountTaxOverview,
  listAccountTaxEvents,
  listAccountTaxLots,
  listAccountWashWindows,
  claimTaxPreflightIbkrReply,
  claimSubmittedIbkrOrderCancellation,
  loadSubmittedIbkrPreparedOrderIntent,
  recordTaxPreflightIbkrReplyRequired,
  recordTaxPreflightOrderSubmitted,
  recordSubmittedIbkrOrderCancellation,
  recordSubmittedIbkrOrderReconciliationRequired,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";
import { fingerprintIbkrOrderBody } from "./ibkr-order-intent";

async function createUser(email: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "member",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user.id;
}

const baseOrder = (overrides: Partial<TaxOrderLike> = {}): TaxOrderLike => ({
  accountId: "U1234567",
  mode: "live",
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 10,
  limitPrice: 210,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
  route: "ibkr",
  intent: null,
  ...overrides,
});

test("tax preflight token validates the exact provider-account order", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-valid@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder();
      const preflight = await createTaxOrderPreflight({ order });

      assert.equal(preflight.action, "allow");
      assert.ok(typeof preflight.preflightToken === "string");

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("tax preflight rejects a token when the submitted order changes", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-mismatch@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder();
      const preflight = await createTaxOrderPreflight({ order });

      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order: baseOrder({ quantity: 11 }),
          taxPreflightToken: preflight.preflightToken,
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "tax_preflight_order_mismatch");
          return true;
        },
      );
    });
  });
});

test("tax preflight accepts the same order facts across broker route labels", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-broker-agnostic@example.com");
    await runAsAppUser(appUserId, async () => {
      const preflight = await createTaxOrderPreflight({
        order: baseOrder({ route: "ibkr" }),
      });

      const accepted = await assertTaxPreflightForOrderSubmission({
        order: baseOrder({ route: "schwab" }),
        taxPreflightToken: preflight.preflightToken,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("tax preflight requires returned acknowledgements for sell orders", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ack@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ side: "sell" });
      const preflight = await createTaxOrderPreflight({ order });

      assert.equal(preflight.action, "warn_ack_required");
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: preflight.preflightToken,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "tax_preflight_acknowledgement_required",
          );
          return true;
        },
      );

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        taxAcknowledgements: preflight.requiredAcknowledgements,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("tax preflight binds and atomically claims the prepared IBKR order", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ibkr-intent@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "intent-123",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const orderFingerprint = fingerprintIbkrOrderBody(orderBody);
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "intent-123",
            orderFingerprint,
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: {
              error: null,
              warnings: ["Review broker estimate."],
            },
            gatewaySnapshot: {
              appUserId,
              baseUrl: "https://localhost:5050",
              hosted: false,
              loginCompletions: 1,
              startedAt: 1_752_364_800_000,
            },
          },
        },
      );

      assert.ok(
        preflight.requiredAcknowledgements.includes(
          "ibkr_what_if_warning_reviewed",
        ),
      );
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
          requireIbkrPreparedIntent: true,
          expectedClientOrderId: "different-intent",
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_intent_mismatch",
          );
          return true;
        },
      );

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        taxAcknowledgements: preflight.requiredAcknowledgements,
        requireIbkrPreparedIntent: true,
        expectedClientOrderId: "intent-123",
        expectedOrderFingerprint: orderFingerprint,
      });
      assert.equal(accepted?.ibkrPreparedIntent?.clientOrderId, "intent-123");
      assert.deepEqual(accepted?.ibkrPreparedIntent?.orderBody, orderBody);
      assert.deepEqual(accepted?.ibkrPreparedIntent?.gatewaySnapshot, {
        appUserId,
        baseUrl: "https://localhost:5050",
        hosted: false,
        loginCompletions: 1,
        startedAt: 1_752_364_800_000,
      });

      const challenge = await recordTaxPreflightIbkrReplyRequired({
        preflightToken: preflight.preflightToken,
        replyId: "raw-broker-reply-id",
        messages: ["Review broker warning."],
        requestEpoch: 17,
      });
      assert.notEqual(challenge.challengeId, "raw-broker-reply-id");
      assert.deepEqual(challenge.messages, ["Review broker warning."]);

      const claims = await Promise.allSettled([
        claimTaxPreflightIbkrReply({
          preflightToken: preflight.preflightToken,
          challengeId: challenge.challengeId,
        }),
        claimTaxPreflightIbkrReply({
          preflightToken: preflight.preflightToken,
          challengeId: challenge.challengeId,
        }),
      ]);
      assert.equal(
        claims.filter((claim) => claim.status === "fulfilled").length,
        1,
      );
      assert.equal(
        claims.filter((claim) => claim.status === "rejected").length,
        1,
      );
      const claimed = claims.find(
        (claim): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof claimTaxPreflightIbkrReply>>> =>
          claim.status === "fulfilled",
      );
      assert.equal(claimed?.value.replyId, "raw-broker-reply-id");
      assert.equal(claimed?.value.requestEpoch, 17);
    });
  });
});

test("prepared IBKR replacement is bound to its predecessor and cannot be placed", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ibkr-replace@example.com");
    await runAsAppUser(appUserId, async () => {
      const brokerOrderId = "1234567890";
      const originalOrder = baseOrder({ quantity: 1, limitPrice: 100 });
      const originalBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "replace-intent-123",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const originalFingerprint = fingerprintIbkrOrderBody(originalBody);
      const originalPreflight = await createTaxOrderPreflight(
        { order: originalOrder },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "replace-intent-123",
            orderFingerprint: originalFingerprint,
            orderBody: originalBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order: originalOrder,
        taxPreflightToken: originalPreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: originalPreflight.preflightToken,
        submittedOrderId: brokerOrderId,
      });

      const acknowledged = await loadSubmittedIbkrPreparedOrderIntent({
        accountId: "U1234567",
        submittedOrderId: brokerOrderId,
      });
      assert.equal(acknowledged.kind, "place");
      assert.equal(acknowledged.orderFingerprint, originalFingerprint);

      const replacementOrder = baseOrder({ quantity: 1, limitPrice: 99 });
      const replacementBody = structuredClone(originalBody);
      replacementBody.orders[0].price = 99;
      const replacementFingerprint = fingerprintIbkrOrderBody(replacementBody);
      const replacementPreflight = await createTaxOrderPreflight(
        { order: replacementOrder },
        {
          ibkrPreparedIntent: {
            version: 2,
            kind: "replace",
            orderId: brokerOrderId,
            previousOrderFingerprint: originalFingerprint,
            accountId: "U1234567",
            clientOrderId: "replace-intent-123",
            orderFingerprint: replacementFingerprint,
            orderBody: replacementBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );

      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order: replacementOrder,
          taxPreflightToken: replacementPreflight.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "place",
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "ibkr_order_intent_mismatch");
          return true;
        },
      );
      const replacement = await assertTaxPreflightForOrderSubmission({
        order: replacementOrder,
        taxPreflightToken: replacementPreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "replace",
        expectedBrokerOrderId: brokerOrderId,
      });
      assert.equal(replacement?.ibkrPreparedIntent?.kind, "replace");
      assert.equal(
        replacement?.ibkrPreparedIntent?.previousOrderFingerprint,
        originalFingerprint,
      );

      await assert.rejects(
        claimSubmittedIbkrOrderCancellation({
          accountId: "U1234567",
          submittedOrderId: brokerOrderId,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_mutation_in_progress",
          );
          return true;
        },
      );

      const challenge = await recordTaxPreflightIbkrReplyRequired({
        preflightToken: replacementPreflight.preflightToken,
        replyId: "replacement-reply-id",
        messages: ["Review replacement warning."],
        requestEpoch: 21,
      });
      await assert.rejects(
        claimSubmittedIbkrOrderCancellation({
          accountId: "U1234567",
          submittedOrderId: brokerOrderId,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_mutation_in_progress",
          );
          return true;
        },
      );
      await claimTaxPreflightIbkrReply({
        preflightToken: replacementPreflight.preflightToken,
        challengeId: challenge.challengeId,
      });

      await assert.rejects(
        claimSubmittedIbkrOrderCancellation({
          accountId: "U1234567",
          submittedOrderId: brokerOrderId,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_mutation_in_progress",
          );
          return true;
        },
      );
    });
  });
});

test("different prepared IBKR tokens cannot enter broker mutation concurrently", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ibkr-serialized@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const prepare = async (clientOrderId: string) => {
        const orderBody = {
          orders: [
            {
              acctId: "U1234567",
              conid: 265598,
              cOID: clientOrderId,
              orderType: "LMT",
              outsideRTH: false,
              side: "BUY",
              tif: "DAY",
              quantity: 1,
              price: 100,
            },
          ],
        };
        return createTaxOrderPreflight(
          { order },
          {
            ibkrPreparedIntent: {
              version: 1,
              accountId: "U1234567",
              clientOrderId,
              orderFingerprint: fingerprintIbkrOrderBody(orderBody),
              orderBody,
              preparedAt: new Date().toISOString(),
              whatIf: { error: null, warnings: [] },
            },
          },
        );
      };
      const [left, right] = await Promise.all([
        prepare("serialized-left"),
        prepare("serialized-right"),
      ]);

      const claims = await Promise.allSettled([
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: left.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "place",
        }),
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: right.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "place",
        }),
      ]);
      assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
      const rejected = claims.find(
        (claim): claim is PromiseRejectedResult => claim.status === "rejected",
      );
      assert.equal(rejected?.reason?.code, "ibkr_order_mutation_in_progress");
    });
  });
});

test("a submitted controlled IBKR order blocks a second live placement", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-active-order@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const prepare = async (clientOrderId: string) => {
        const orderBody = {
          orders: [
            {
              acctId: "U1234567",
              conid: 265598,
              cOID: clientOrderId,
              orderType: "LMT",
              outsideRTH: false,
              side: "BUY",
              tif: "DAY",
              quantity: 1,
              price: 100,
            },
          ],
        };
        return createTaxOrderPreflight(
          { order },
          {
            ibkrPreparedIntent: {
              version: 1,
              accountId: "U1234567",
              clientOrderId,
              orderFingerprint: fingerprintIbkrOrderBody(orderBody),
              orderBody,
              preparedAt: new Date().toISOString(),
              whatIf: { error: null, warnings: [] },
            },
          },
        );
      };
      const first = await prepare("active-first");
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: first.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: first.preflightToken,
        submittedOrderId: "1234567890",
      });

      const second = await prepare("active-second");
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: second.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "place",
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_mutation_in_progress",
          );
          return true;
        },
      );
    });
  });
});

test("a broker order permits at most one submitted IBKR replacement", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-one-replace@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const brokerOrderId = "1234567890";
      const originalOrder = baseOrder({ quantity: 1, limitPrice: 100 });
      const originalBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "one-replace-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const originalFingerprint = fingerprintIbkrOrderBody(originalBody);
      const original = await createTaxOrderPreflight(
        { order: originalOrder },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "one-replace-intent",
            orderFingerprint: originalFingerprint,
            orderBody: originalBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order: originalOrder,
        taxPreflightToken: original.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: original.preflightToken,
        submittedOrderId: brokerOrderId,
      });

      const prepareReplacement = async (limitPrice: number) => {
        const order = baseOrder({ quantity: 1, limitPrice });
        const orderBody = structuredClone(originalBody);
        orderBody.orders[0].price = limitPrice;
        return {
          order,
          preflight: await createTaxOrderPreflight(
            { order },
            {
              ibkrPreparedIntent: {
                version: 2,
                kind: "replace",
                orderId: brokerOrderId,
                previousOrderFingerprint: originalFingerprint,
                accountId: "U1234567",
                clientOrderId: "one-replace-intent",
                orderFingerprint: fingerprintIbkrOrderBody(orderBody),
                orderBody,
                preparedAt: new Date().toISOString(),
                whatIf: { error: null, warnings: [] },
              },
            },
          ),
        };
      };
      const first = await prepareReplacement(99);
      const second = await prepareReplacement(98);
      await assertTaxPreflightForOrderSubmission({
        order: first.order,
        taxPreflightToken: first.preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "replace",
        expectedBrokerOrderId: brokerOrderId,
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: first.preflight.preflightToken,
        submittedOrderId: brokerOrderId,
      });

      assert.deepEqual(await getControlledIbkrOrderLifecycle(), {
        status: "active",
        accountId: "U1234567",
        orderId: brokerOrderId,
        symbol: "AAPL",
        side: "buy",
        quantity: 1,
        limitPrice: 99,
        replacementUsed: true,
        cancelAttempted: false,
        reason: null,
      });

      const originalAfterReplacement =
        await loadSubmittedIbkrPreparedOrderIntent({
          accountId: "U1234567",
          submittedOrderId: brokerOrderId,
        });
      assert.equal(originalAfterReplacement.kind ?? "place", "place");
      await assert.rejects(prepareReplacement(97), (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_replace_already_used",
        );
        return true;
      });
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order: second.order,
          taxPreflightToken: second.preflight.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "replace",
          expectedBrokerOrderId: brokerOrderId,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_replace_already_used",
          );
          return true;
        },
      );
    });
  });
});

test("controlled IBKR lifecycle recovers active state and resolves after terminal cancel", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-lifecycle@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "lifecycle-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "lifecycle-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: preflight.preflightToken,
        submittedOrderId: "1234567890",
      });

      assert.deepEqual(await getControlledIbkrOrderLifecycle(), {
        status: "active",
        accountId: "U1234567",
        orderId: "1234567890",
        symbol: "AAPL",
        side: "buy",
        quantity: 1,
        limitPrice: 100,
        replacementUsed: false,
        cancelAttempted: false,
        reason: null,
      });

      await claimSubmittedIbkrOrderCancellation({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
      });
      await recordSubmittedIbkrOrderCancellation({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        cancelConfirmed: true,
        status: "canceled",
        filledQuantity: 0,
      });
      assert.deepEqual(await getControlledIbkrOrderLifecycle(), {
        status: "none",
        accountId: null,
        orderId: null,
        symbol: null,
        side: null,
        quantity: null,
        limitPrice: null,
        replacementUsed: false,
        cancelAttempted: false,
        reason: null,
      });
      await assert.rejects(
        loadSubmittedIbkrPreparedOrderIntent({
          accountId: "U1234567",
          submittedOrderId: "1234567890",
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_submitted_order_intent_unavailable",
          );
          return true;
        },
      );

      const nextBody = structuredClone(orderBody);
      nextBody.orders[0].cOID = "lifecycle-next";
      const next = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "lifecycle-next",
            orderFingerprint: fingerprintIbkrOrderBody(nextBody),
            orderBody: nextBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: next.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      assert.equal(
        accepted?.ibkrPreparedIntent?.clientOrderId,
        "lifecycle-next",
      );
    });
  });
});

test("submitted IBKR reconciliation preserves the broker order and blocks new placement", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-submitted-reconciliation@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "submitted-reconciliation-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "submitted-reconciliation-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: preflight.preflightToken,
        submittedOrderId: "1234567890",
      });

      await recordSubmittedIbkrOrderReconciliationRequired({
        accountId: "U1234567",
        submittedOrderId: "9999999999",
        reason: "replacement_preview_target_unknown",
      });

      assert.deepEqual(await getControlledIbkrOrderLifecycle(), {
        status: "reconciliation_required",
        accountId: "U1234567",
        orderId: "1234567890",
        symbol: "AAPL",
        side: "buy",
        quantity: 1,
        limitPrice: 100,
        replacementUsed: false,
        cancelAttempted: false,
        reason: "replacement_preview_target_unknown",
      });

      const nextBody = structuredClone(orderBody);
      nextBody.orders[0].cOID = "submitted-reconciliation-next";
      const next = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "submitted-reconciliation-next",
            orderFingerprint: fingerprintIbkrOrderBody(nextBody),
            orderBody: nextBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: next.preflightToken,
          requireIbkrPreparedIntent: true,
          expectedIbkrIntentKind: "place",
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_mutation_in_progress",
          );
          return true;
        },
      );
    });
  });
});

test("IBKR warning challenge expires after thirty seconds without exposing reply id", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-warning-expiry@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const now = new Date();
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "warning-expiry-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "warning-expiry-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: now.toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      const challenge = await recordTaxPreflightIbkrReplyRequired({
        preflightToken: preflight.preflightToken,
        replyId: "raw-warning-reply-id",
        messages: ["Review broker warning."],
        requestEpoch: 25,
        now,
      });
      assert.equal(
        challenge.expiresAt,
        new Date(now.getTime() + 30_000).toISOString(),
      );
      assert.equal(
        JSON.stringify(challenge).includes("raw-warning-reply-id"),
        false,
      );
      await assert.rejects(
        claimTaxPreflightIbkrReply({
          preflightToken: preflight.preflightToken,
          challengeId: challenge.challengeId,
          now: new Date(now.getTime() + 31_000),
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_reply_expired",
          );
          return true;
        },
      );
      const lifecycle = await getControlledIbkrOrderLifecycle();
      assert.equal(lifecycle.status, "reconciliation_required");
      assert.equal(lifecycle.reason, "broker_warning_response_pending");
      assert.equal(
        JSON.stringify(lifecycle).includes("raw-warning-reply-id"),
        false,
      );
    });
  });
});

test("submitted IBKR cancellation is claimed once and records terminal outcome", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ibkr-cancel-once@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "cancel-once-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const orderBodyFingerprint = fingerprintIbkrOrderBody(orderBody);
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "cancel-once-intent",
            orderFingerprint: orderBodyFingerprint,
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: preflight.preflightToken,
        submittedOrderId: "1234567890",
      });

      const replacementOrder = baseOrder({ quantity: 1, limitPrice: 99 });
      const replacementBody = structuredClone(orderBody);
      replacementBody.orders[0].price = 99;
      const replacementPreflight = await createTaxOrderPreflight(
        { order: replacementOrder },
        {
          ibkrPreparedIntent: {
            version: 2,
            kind: "replace",
            orderId: "1234567890",
            previousOrderFingerprint: orderBodyFingerprint,
            accountId: "U1234567",
            clientOrderId: "cancel-once-intent",
            orderFingerprint: fingerprintIbkrOrderBody(replacementBody),
            orderBody: replacementBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order: replacementOrder,
        taxPreflightToken: replacementPreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "replace",
        expectedBrokerOrderId: "1234567890",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: replacementPreflight.preflightToken,
        submittedOrderId: "1234567890",
      });

      const claims = await Promise.allSettled([
        claimSubmittedIbkrOrderCancellation({
          accountId: "U1234567",
          submittedOrderId: "1234567890",
        }),
        claimSubmittedIbkrOrderCancellation({
          accountId: "U1234567",
          submittedOrderId: "1234567890",
        }),
      ]);
      assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
      const fulfilled = claims.find(
        (
          claim,
        ): claim is PromiseFulfilledResult<
          Awaited<ReturnType<typeof claimSubmittedIbkrOrderCancellation>>
        > => claim.status === "fulfilled",
      );
      assert.equal(fulfilled?.value.kind, "replace");
      const claimedOrders = fulfilled?.value.orderBody["orders"];
      assert.ok(Array.isArray(claimedOrders));
      assert.equal(
        (claimedOrders[0] as Record<string, unknown>)["price"],
        99,
      );
      const rejected = claims.find(
        (claim): claim is PromiseRejectedResult => claim.status === "rejected",
      );
      assert.equal(rejected?.reason?.code, "ibkr_cancel_already_requested");

      await recordSubmittedIbkrOrderCancellation({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        cancelConfirmed: true,
        status: "canceled",
        filledQuantity: 0,
      });
    });
  });
});

test("partial-fill cancellation remains reconciliation-required", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-partial-cancel@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ quantity: 1, limitPrice: 100 });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "partial-cancel-intent",
            orderType: "LMT",
            outsideRTH: false,
            side: "BUY",
            tif: "DAY",
            quantity: 1,
            price: 100,
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "partial-cancel-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: preflight.preflightToken,
        submittedOrderId: "1234567890",
      });
      await claimSubmittedIbkrOrderCancellation({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
      });

      await recordSubmittedIbkrOrderCancellation({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        cancelConfirmed: true,
        status: "canceled",
        filledQuantity: 0.5,
      });

      const lifecycle = await getControlledIbkrOrderLifecycle();
      assert.equal(lifecycle.status, "reconciliation_required");
      assert.equal(lifecycle.orderId, "1234567890");
      assert.equal(lifecycle.reason, "cancel_outcome_unknown");
      assert.equal(lifecycle.cancelAttempted, true);
    });
  });
});

test("shadow account tax view summarizes simulated trading history", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-shadow-history@example.com");
    const shadowAccountId = "shadow-tax-history";
    await db.insert(shadowAccountsTable).values({
      id: shadowAccountId,
      appUserId,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25100",
      realizedPnl: "95",
      fees: "2",
      status: "active",
    });
    const [gainOrder] = await db
      .insert(shadowOrdersTable)
      .values({
        accountId: shadowAccountId,
        source: "manual",
        symbol: "AAPL",
        assetClass: "equity",
        side: "sell",
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: "5",
        filledQuantity: "5",
        averageFillPrice: "210",
        fees: "1",
        placedAt: new Date("2026-07-02T14:30:00.000Z"),
        filledAt: new Date("2026-07-02T14:30:00.000Z"),
      })
      .returning({ id: shadowOrdersTable.id });
    const [lossOrder] = await db
      .insert(shadowOrdersTable)
      .values({
        accountId: shadowAccountId,
        source: "manual",
        symbol: "MSFT",
        assetClass: "equity",
        side: "sell",
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: "2",
        filledQuantity: "2",
        averageFillPrice: "300",
        fees: "1",
        placedAt: new Date("2026-07-03T14:30:00.000Z"),
        filledAt: new Date("2026-07-03T14:30:00.000Z"),
      })
      .returning({ id: shadowOrdersTable.id });
    assert.ok(gainOrder);
    assert.ok(lossOrder);
    await db.insert(shadowFillsTable).values([
      {
        accountId: shadowAccountId,
        orderId: gainOrder.id,
        symbol: "AAPL",
        assetClass: "equity",
        side: "sell",
        quantity: "5",
        price: "210",
        grossAmount: "1050",
        fees: "1",
        realizedPnl: "125",
        cashDelta: "1049",
        occurredAt: new Date("2026-07-02T14:30:00.000Z"),
      },
      {
        accountId: shadowAccountId,
        orderId: lossOrder.id,
        symbol: "MSFT",
        assetClass: "equity",
        side: "sell",
        quantity: "2",
        price: "300",
        grossAmount: "600",
        fees: "1",
        realizedPnl: "-30",
        cashDelta: "599",
        occurredAt: new Date("2026-07-03T14:30:00.000Z"),
      },
    ]);

    await runAsAppUser(appUserId, async () => {
      const overview = await getAccountTaxOverview("shadow");
      assert.equal(overview.accountScope, "shadow_simulation");
      assert.equal(overview.shadowExcluded, false);
      assert.equal(overview.scope.shadowIncluded, true);
      assert.equal(overview.estimates.shadow.eventCount, 2);
      assert.equal(overview.estimates.shadow.realizedPnl, 95);
      assert.equal(overview.washSales.status, "unknown");

      const events = await listAccountTaxEvents("shadow");
      assert.equal(events.events.length, 2);
      assert.equal(events.events[0]?.sourceType, "shadow_ledger");
      assert.equal(events.events[0]?.amount, 125);

      const lots = await listAccountTaxLots("shadow");
      assert.equal(lots.lots.length, 2);
      assert.equal(lots.basisConfidence, "shadow_simulation");

      const wash = await listAccountWashWindows("shadow");
      assert.equal(wash.washWindows.length, 1);
      assert.equal(wash.riskSummary.status, "unknown");
    });
  });
});
