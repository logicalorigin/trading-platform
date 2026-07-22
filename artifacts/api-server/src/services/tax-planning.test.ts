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
  recordTaxPreflightIbkrOrderFilled,
  recordTaxPreflightIbkrReconciliationRequired,
  recordTaxPreflightIbkrReplyRequired,
  recordTaxPreflightOrderSubmitted,
  recordSubmittedIbkrOrderCancellation,
  recordSubmittedIbkrExecutionFilled,
  recordSubmittedIbkrOrderFilled,
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

test("tax preflight accepts an explicit owner for background automation", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-background-owner@example.com");
    const order = baseOrder();

    await assert.rejects(
      createTaxOrderPreflight({ order }),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 401);
        assert.equal((error as { code?: string }).code, "auth_required");
        return true;
      },
    );

    const preflight = await createTaxOrderPreflight(
      { order },
      { appUserId },
    );

    assert.equal(preflight.action, "allow");
    assert.ok(typeof preflight.preflightToken === "string");
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

test("prepared IBKR option semantics survive the tax-preflight round trip", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ibkr-option@example.com");
    await runAsAppUser(appUserId, async () => {
      const optionContract = {
        ticker: "AAPL260821C00200000",
        underlying: "AAPL",
        expirationDate: "2026-08-21T00:00:00.000Z",
        strike: 200,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "700001",
      };
      const order = baseOrder({
        assetClass: "option",
        quantity: 2,
        limitPrice: 4.5,
        optionContract,
        intent: "long_option",
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 700001,
            cOID: "option-intent-1",
            manualIndicator: true,
            orderType: "LMT",
            outsideRTH: false,
            price: 4.5,
            quantity: 2,
            secType: "700001:OPT",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "option-intent-1",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
            optionContract,
            optionAction: "buy_to_open",
            positionEffect: "open",
            strategyIntent: "long_option",
          },
        },
      );

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
      });

      assert.deepEqual(
        accepted?.ibkrPreparedIntent?.optionContract,
        optionContract,
      );
      assert.equal(accepted?.ibkrPreparedIntent?.optionAction, "buy_to_open");
      assert.equal(accepted?.ibkrPreparedIntent?.positionEffect, "open");
      assert.equal(accepted?.ibkrPreparedIntent?.strategyIntent, "long_option");
    });
  });
});

test("prepared IBKR option bodies require explicit option semantics", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-option-semantics-required@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        assetClass: "option",
        quantity: 2,
        limitPrice: 4.5,
        optionContract: {
          ticker: "AAPL260821C00200000",
          underlying: "AAPL",
          expirationDate: "2026-08-21T00:00:00.000Z",
          strike: 200,
          right: "call",
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: "700001",
        },
        intent: "long_option",
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 700001,
            cOID: "option-intent-without-semantics",
            manualIndicator: true,
            orderType: "LMT",
            outsideRTH: false,
            price: 4.5,
            quantity: 2,
            secType: "700001:OPT",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      await assert.rejects(
        createTaxOrderPreflight(
          { order },
          {
            ibkrPreparedIntent: {
              version: 1,
              accountId: "U1234567",
              clientOrderId: "option-intent-without-semantics",
              orderFingerprint: fingerprintIbkrOrderBody(orderBody),
              orderBody,
              preparedAt: new Date().toISOString(),
              whatIf: { error: null, warnings: [] },
            },
          },
        ),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_order_intent_invalid",
          );
          return true;
        },
      );
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

test("a confirmed IBKR market fill resolves the controlled lifecycle", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-market-filled@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        type: "market",
        quantity: 1,
        limitPrice: null,
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "market-filled-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 1,
            secType: "265598:STK",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-filled-intent",
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
      await recordTaxPreflightIbkrOrderFilled({
        preflightToken: preflight.preflightToken,
        submittedOrderId: "1234567890",
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
    });
  });
});

test("a delayed IBKR market fill resolves the submitted controlled lifecycle", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-market-delayed-fill@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        type: "market",
        quantity: 1,
        limitPrice: null,
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "market-delayed-fill-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 1,
            secType: "265598:STK",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-delayed-fill-intent",
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

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "active");
      await recordSubmittedIbkrOrderFilled({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        status: "filled",
        quantity: 1,
        filledQuantity: 0,
      });
      assert.equal((await getControlledIbkrOrderLifecycle()).status, "active");
      await recordSubmittedIbkrOrderFilled({
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        status: "filled",
        quantity: 1,
        filledQuantity: 1,
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");
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
    });
  });
});

test("an exact delayed market fill resolves a placement reconciliation marker", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-market-reconciled-fill@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        type: "market",
        quantity: 1,
        limitPrice: null,
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "market-reconciled-fill-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 1,
            secType: "265598:STK",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-reconciled-fill-intent",
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
      await recordTaxPreflightIbkrReconciliationRequired({
        preflightToken: preflight.preflightToken,
        reason: "place_post_ack_verification_incomplete",
      });

      assert.equal(
        (await getControlledIbkrOrderLifecycle()).status,
        "reconciliation_required",
      );
      const fillEvidence = {
        accountId: "U1234567",
        submittedOrderId: "1234567890",
        status: "filled",
        quantity: 1,
        filledQuantity: 1,
        clientOrderId: "wrong-intent",
        providerContractId: "265598",
        symbol: "AAPL",
        side: "buy",
        orderType: "market",
        timeInForce: "day",
      };
      await recordSubmittedIbkrOrderFilled(fillEvidence);
      assert.equal(
        (await getControlledIbkrOrderLifecycle()).status,
        "reconciliation_required",
      );
      await recordSubmittedIbkrOrderFilled({
        ...fillEvidence,
        clientOrderId: "market-reconciled-fill-intent",
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");

      const reusedPreflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-reconciled-fill-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: reusedPreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightIbkrReconciliationRequired({
        preflightToken: reusedPreflight.preflightToken,
        reason: "place_post_ack_verification_incomplete",
      });
      await recordSubmittedIbkrOrderFilled({
        ...fillEvidence,
        clientOrderId: "market-reconciled-fill-intent",
      });
      assert.equal(
        (await getControlledIbkrOrderLifecycle()).status,
        "reconciliation_required",
      );
    });
  });
});

test("exact execution fills resolve reconciliation and active lifecycle markers", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-market-execution-fill@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        type: "market",
        quantity: 1,
        limitPrice: null,
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "market-execution-fill-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 1,
            secType: "265598:STK",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-execution-fill-intent",
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
      await recordTaxPreflightIbkrReconciliationRequired({
        preflightToken: preflight.preflightToken,
        reason: "place_post_ack_verification_incomplete",
      });

      const fillEvidence = {
        accountId: "U1234567",
        clientOrderId: "wrong-intent",
        providerContractId: "265598",
        symbol: "AAPL",
        side: "buy",
        quantity: 1,
      };
      await recordSubmittedIbkrExecutionFilled(fillEvidence);
      assert.equal(
        (await getControlledIbkrOrderLifecycle()).status,
        "reconciliation_required",
      );
      await recordSubmittedIbkrExecutionFilled({
        ...fillEvidence,
        clientOrderId: "market-execution-fill-intent",
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");

      const activeOrderBody = {
        orders: [
          {
            ...orderBody.orders[0],
            cOID: "market-active-execution-fill-intent",
          },
        ],
      };
      const activePreflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-active-execution-fill-intent",
            orderFingerprint: fingerprintIbkrOrderBody(activeOrderBody),
            orderBody: activeOrderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: activePreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: activePreflight.preflightToken,
        submittedOrderId: "active-broker-order-id",
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "active");
      await recordSubmittedIbkrExecutionFilled({
        ...fillEvidence,
        clientOrderId: "market-active-execution-fill-intent",
      });
      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");

      const reusedPreflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "market-active-execution-fill-intent",
            orderFingerprint: fingerprintIbkrOrderBody(activeOrderBody),
            orderBody: activeOrderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: reusedPreflight.preflightToken,
        requireIbkrPreparedIntent: true,
        expectedIbkrIntentKind: "place",
      });
      await recordTaxPreflightOrderSubmitted({
        preflightToken: reusedPreflight.preflightToken,
        submittedOrderId: "reused-client-id-broker-order",
      });
      await recordSubmittedIbkrExecutionFilled({
        ...fillEvidence,
        clientOrderId: "market-active-execution-fill-intent",
      });
      assert.equal((await getControlledIbkrOrderLifecycle()).status, "active");
    });
  });
});

test("exact multi-share equity sell executions resolve reconciliation", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-equity-sell-execution-fill@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({
        type: "market",
        side: "sell",
        quantity: 2,
        limitPrice: null,
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 265598,
            cOID: "equity-sell-execution-fill-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 2,
            secType: "265598:STK",
            side: "SELL",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "equity-sell-execution-fill-intent",
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
        taxAcknowledgements: preflight.requiredAcknowledgements,
        requireIbkrPreparedIntent: true,
      });
      await recordTaxPreflightIbkrReconciliationRequired({
        preflightToken: preflight.preflightToken,
        reason: "place_post_ack_verification_incomplete",
      });

      await recordSubmittedIbkrExecutionFilled({
        accountId: "U1234567",
        clientOrderId: "equity-sell-execution-fill-intent",
        providerContractId: "265598",
        symbol: "AAPL",
        side: "sell",
        quantity: 2,
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");
    });
  });
});

test("exact option executions resolve reconciliation", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser(
      "tax-preflight-ibkr-option-execution-fill@example.com",
    );
    await runAsAppUser(appUserId, async () => {
      const optionContract = {
        ticker: "AAPL260821C00200000",
        underlying: "AAPL",
        expirationDate: "2026-08-21T00:00:00.000Z",
        strike: 200,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "700001",
      };
      const order = baseOrder({
        assetClass: "option",
        type: "market",
        quantity: 2,
        limitPrice: null,
        optionContract,
        intent: "long_option",
      });
      const orderBody = {
        orders: [
          {
            acctId: "U1234567",
            conid: 700001,
            cOID: "option-execution-fill-intent",
            manualIndicator: true,
            orderType: "MKT",
            outsideRTH: false,
            quantity: 2,
            secType: "700001:OPT",
            side: "BUY",
            ticker: "AAPL",
            tif: "DAY",
          },
        ],
      };
      const preflight = await createTaxOrderPreflight(
        { order },
        {
          ibkrPreparedIntent: {
            version: 1,
            accountId: "U1234567",
            clientOrderId: "option-execution-fill-intent",
            orderFingerprint: fingerprintIbkrOrderBody(orderBody),
            orderBody,
            preparedAt: new Date().toISOString(),
            whatIf: { error: null, warnings: [] },
            optionContract,
            optionAction: "buy_to_open",
            positionEffect: "open",
            strategyIntent: "long_option",
          },
        },
      );
      await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        requireIbkrPreparedIntent: true,
      });
      await recordTaxPreflightIbkrReconciliationRequired({
        preflightToken: preflight.preflightToken,
        reason: "place_post_ack_verification_incomplete",
      });

      await recordSubmittedIbkrExecutionFilled({
        accountId: "U1234567",
        clientOrderId: "option-execution-fill-intent",
        providerContractId: "700001",
        symbol: "AAPL",
        side: "buy",
        quantity: 2,
      });

      assert.equal((await getControlledIbkrOrderLifecycle()).status, "none");
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
