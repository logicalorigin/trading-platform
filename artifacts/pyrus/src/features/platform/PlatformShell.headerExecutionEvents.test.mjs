import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getListExecutionEventsQueryKey,
  getListExecutionEventsUrl,
} from "@workspace/api-client-react";
import ts from "typescript";

const shellSource = readFileSync(
  new URL("./PlatformShell.jsx", import.meta.url),
  "utf8",
);
const shellAst = ts.createSourceFile(
  "PlatformShell.jsx",
  shellSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JSX,
);

const findHeaderQueryIdentifier = () => {
  let queryIdentifier = null;

  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(shellAst) === "AppHeader"
    ) {
      const queryAttribute = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(shellAst) === "algoEventsQuery",
      );
      const expression = queryAttribute?.initializer?.expression;
      if (expression && ts.isIdentifier(expression)) {
        queryIdentifier = expression.text;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(shellAst);
  return queryIdentifier;
};

const readLiteral = (node) => {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  throw new Error(`Unsupported header query literal: ${node.getText(shellAst)}`);
};

const findQueryCall = (queryIdentifier) => {
  let queryCall = null;

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === queryIdentifier &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(shellAst) ===
        "useListExecutionEvents"
    ) {
      const argument = node.initializer.arguments[0];
      assert.ok(
        argument && ts.isObjectLiteralExpression(argument),
        "the AppHeader execution-event query must use literal params",
      );
      const params = Object.fromEntries(
        argument.properties.map((property) => {
          assert.ok(
            ts.isPropertyAssignment(property),
            "the AppHeader execution-event query must use explicit properties",
          );
          return [
            property.name.getText(shellAst),
            readLiteral(property.initializer),
          ];
        }),
      );
      const optionsArgument = node.initializer.arguments[1];
      assert.ok(
        optionsArgument && ts.isIdentifier(optionsArgument),
        "the AppHeader execution-event query must use named query options",
      );
      queryCall = { params, optionsIdentifier: optionsArgument.text };
    }
    ts.forEachChild(node, visit);
  };

  visit(shellAst);
  return queryCall;
};

const findVariableInitializer = (identifier) => {
  let initializer = null;

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };

  visit(shellAst);
  return initializer;
};

const findObjectProperty = (object, propertyName) => {
  assert.ok(
    object && ts.isObjectLiteralExpression(object),
    `${propertyName} must be declared in an object literal`,
  );
  const property = object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      candidate.name.getText(shellAst) === propertyName,
  );
  assert.ok(property, `missing ${propertyName} query option`);
  return property.initializer;
};

const findRefetchIntervalExpression = (optionsIdentifier) => {
  const options = findVariableInitializer(optionsIdentifier);
  const query = findObjectProperty(options, "query");
  return findObjectProperty(query, "refetchInterval");
};

const evaluatePolicyExpression = (expression, policy) => {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.expression.getText(shellAst) === "algoEventFeedPolicy" &&
    expression.name.text === "refetchInterval"
  ) {
    return policy.refetchInterval;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return (
      evaluatePolicyExpression(expression.left, policy) ||
      evaluatePolicyExpression(expression.right, policy)
    );
  }
  throw new Error(
    `Unsupported header refetch expression: ${expression.getText(shellAst)}`,
  );
};

test("the AppHeader requests a bounded payload-bearing execution-event feed", () => {
  const queryIdentifier = findHeaderQueryIdentifier();
  assert.ok(queryIdentifier, "AppHeader must receive an execution-event query");

  const { params } = findQueryCall(queryIdentifier);
  assert.deepEqual(params, { limit: 20, includePayload: true });
  assert.equal(
    getListExecutionEventsUrl(params),
    "/api/algo/events?limit=20&includePayload=true",
  );
  assert.deepEqual(getListExecutionEventsQueryKey(params), [
    "/api/algo/events",
    params,
  ]);
  assert.notDeepEqual(
    getListExecutionEventsQueryKey(params),
    getListExecutionEventsQueryKey({ limit: 20 }),
    "the summary SSE cache cannot refresh the payload-bearing query key",
  );
});

test("both global event feeds retain REST catch-up without a shell-owned SSE", () => {
  assert.doesNotMatch(shellSource, /useAlgoCockpitStream/);
  const headerQueryIdentifier = findHeaderQueryIdentifier();
  const headerQuery = findQueryCall(headerQueryIdentifier);
  const headerRefetchInterval = findRefetchIntervalExpression(
    headerQuery.optionsIdentifier,
  );
  const summaryQuery = findQueryCall("algoEventsQuery");
  const summaryRefetchInterval = findRefetchIntervalExpression(
    summaryQuery.optionsIdentifier,
  );

  assert.equal(
    evaluatePolicyExpression(summaryRefetchInterval, {
      refetchInterval: 30_000,
    }),
    30_000,
    "the summary feed must retain bounded all-deployment REST catch-up",
  );
  assert.equal(
    evaluatePolicyExpression(headerRefetchInterval, {
      refetchInterval: false,
    }),
    30_000,
    "the distinct payload key needs a bounded catch-up poll",
  );
  assert.equal(
    evaluatePolicyExpression(headerRefetchInterval, {
      refetchInterval: 5_000,
    }),
    5_000,
    "notification polling remains the faster policy when enabled",
  );
});
