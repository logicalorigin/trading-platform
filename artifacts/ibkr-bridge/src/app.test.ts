import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createRequestAbortSignal } from "./app";

function mockRequest(input: { aborted?: boolean } = {}): Request {
  const req = new EventEmitter() as EventEmitter & { aborted: boolean };
  req.aborted = Boolean(input.aborted);
  return req as unknown as Request;
}

function mockResponse(input: { writableEnded?: boolean } = {}): Response {
  const res = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  res.writableEnded = Boolean(input.writableEnded);
  return res as unknown as Response;
}

test("request abort signal ignores normal request close and waits for unfinished response close", () => {
  const req = mockRequest();
  const res = mockResponse({ writableEnded: true });
  const signal = createRequestAbortSignal(req, res);

  req.emit("close");

  assert.equal(signal.aborted, false);
});

test("request abort signal aborts when the response closes before finishing", () => {
  const req = mockRequest();
  const res = mockResponse({ writableEnded: false });
  const signal = createRequestAbortSignal(req, res);

  res.emit("close");

  assert.equal(signal.aborted, true);
});

test("request abort signal aborts immediately for already aborted requests", () => {
  const signal = createRequestAbortSignal(
    mockRequest({ aborted: true }),
    mockResponse(),
  );

  assert.equal(signal.aborted, true);
});
