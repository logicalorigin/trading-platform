import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionButton } from "./ActionButton.jsx";
import { Button } from "./Button.jsx";
import { ConnectionStatusPill } from "./ConnectionStatusPill.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { BrokerActionConfirmDialog } from "../../features/trade/BrokerActionConfirmDialog.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (...segments) =>
  readFileSync(join(here, "..", "..", ...segments), "utf8");
const readUi = (file) => readFileSync(join(here, file), "utf8");

test("ActionButton renders pending, retry, and cooldown affordances", () => {
  const pendingMarkup = renderToStaticMarkup(
    React.createElement(
      ActionButton,
      { pending: true, pendingLabel: "Scanning..." },
      "Run scan",
    ),
  );
  assert.match(pendingMarkup, /Scanning\.\.\./);
  assert.match(pendingMarkup, /aria-label="Loading"/);

  const errorMarkup = renderToStaticMarkup(
    React.createElement(
      ActionButton,
      { error: "Request failed" },
      "Reconnect",
    ),
  );
  assert.match(errorMarkup, /data-testid="action-button-retry"/);
  assert.match(errorMarkup, /Retry/);

  const cooldownMarkup = renderToStaticMarkup(
    React.createElement(
      ActionButton,
      { cooldownUntil: new Date(Date.now() + 5_000) },
      "Retry",
    ),
  );
  assert.match(cooldownMarkup, /data-testid="action-button-cooldown"/);
});

test("ConnectionStatusPill maps status and renders update metadata", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ConnectionStatusPill, {
      status: "connected",
      lastSyncAt: new Date(Date.now() - 60_000),
    }),
  );

  assert.match(markup, /data-testid="connection-status-pill"/);
  assert.match(markup, /data-status="connected"/);
  assert.match(markup, /Connected/);
  assert.match(markup, /Updated/);
});

test("Button accepts rendered icon nodes as well as icon component types", () => {
  const IconComponent = ({ size }) =>
    React.createElement("span", { "data-size": size, "data-testid": "component-icon" });
  const markup = renderToStaticMarkup(
    React.createElement(
      Button,
      {
        leftIcon: React.createElement("span", { "data-testid": "node-icon" }),
        rightIcon: IconComponent,
      },
      "Filters",
    ),
  );

  assert.match(markup, /data-testid="node-icon"/);
  assert.match(markup, /data-testid="component-icon"/);
  assert.match(markup, /data-size="14"/);
});

test("ConfirmDialog renders shared modal controls and cancel affordances", () => {
  const source = readUi("ConfirmDialog.jsx");
  assert.match(source, /window\.addEventListener\("keydown"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.target === event\.currentTarget/);
  assert.match(source, /<Button[\s\S]*variant="secondary"/);
  assert.match(source, /variant=\{destructive \? "danger" : "primary"\}/);

  const markup = renderToStaticMarkup(
    React.createElement(ConfirmDialog, {
      open: true,
      title: "Confirm action",
      detail: "Review before continuing.",
      lines: [{ label: "Account", value: "DU123" }],
      error: "Rejected",
      note: "Review the live action.",
      destructive: true,
    }),
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Confirm action/);
  assert.match(markup, /Review the live action/);
  assert.match(markup, /data-testid="confirm-dialog-error"/);
});

test("BrokerActionConfirmDialog delegates to ConfirmDialog without losing broker IDs", () => {
  const source = readSrc("features", "trade", "BrokerActionConfirmDialog.jsx");
  assert.match(source, /<ConfirmDialog/);
  assert.match(source, /dialogTestId="broker-action-confirm-dialog"/);
  assert.match(source, /errorTestId="broker-action-confirm-error"/);

  const markup = renderToStaticMarkup(
    React.createElement(BrokerActionConfirmDialog, {
      open: true,
      title: "Submit live order",
      detail: "Send this order.",
      error: "Timed out",
    }),
  );
  assert.match(markup, /data-testid="broker-action-confirm-dialog"/);
  assert.match(markup, /data-testid="broker-action-confirm-error"/);
  assert.match(markup, /Live IBKR Confirmation/);
});

test("connection-action migration removes duplicate platform Button and uses ActionButton in AlgoStatusBar", () => {
  const primitives = readSrc("components", "platform", "primitives.jsx");
  const tablePagination = readSrc("components", "platform", "TablePagination.jsx");
  const algoStatusBar = readSrc("screens", "algo", "AlgoStatusBar.jsx");

  assert.doesNotMatch(primitives, /export const Button =/);
  assert.match(tablePagination, /import \{ Button \} from "\.\.\/ui\/Button\.jsx"/);
  assert.match(algoStatusBar, /import \{ ActionButton \}/);
  assert.doesNotMatch(algoStatusBar, /const compactButton =/);
  assert.match(algoStatusBar, /pendingLabel="Scanning\.\.\."/);
  assert.match(algoStatusBar, /"Disable"/);
  assert.match(algoStatusBar, /"Run scan"/);
});
