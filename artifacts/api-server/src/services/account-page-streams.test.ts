import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as ts from "typescript";

const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "account-page-streams.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function findFunctionDeclaration(name: string): ts.FunctionDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name
    ) {
      return statement;
    }
  }
  throw new Error(`Missing ${name}`);
}

function getAccountPositionLiveQuoteFlags(functionName: string): string[] {
  const target = findFunctionDeclaration(functionName);
  const flags: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "getAccountPositions"
    ) {
      const [input] = node.arguments;
      if (input && ts.isObjectLiteralExpression(input)) {
        for (const property of input.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            propertyNameText(property.name) === "liveQuotes"
          ) {
            flags.push(property.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(target);
  return flags;
}

test("shadow account-page position fetches request live quote hydration", () => {
  for (const functionName of [
    "fetchAccountPageLivePayload",
    "fetchAccountPagePrimaryPayload",
  ]) {
    const flags = getAccountPositionLiveQuoteFlags(functionName);
    assert.ok(
      flags.includes("true"),
      `${functionName} must request liveQuotes:true for shadow account positions`,
    );
    assert.ok(
      !flags.includes("false"),
      `${functionName} must not disable live quotes for account-page positions`,
    );
  }
});
