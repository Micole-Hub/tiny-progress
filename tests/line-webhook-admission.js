// Regression checks for the actual Render webhook route and GAS queue-admission code.
// Read-only mocks: no GAS requests, LINE sends, Render deployments or Sheet writes.
// Run from project root: node tests/line-webhook-admission.js
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const gas = fs.readFileSync(path.join(root, "gas/Code.gs"), "utf8");
const between = (s, start, end) => {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, "missing required source markers");
  return s.slice(a, b);
};
function response() {
  return {
    code: 200,
    body: null,
    headersSent: false,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}
async function checkWebhookAcknowledgement() {
  let handler;
  let mode = "ok", admitRelease;
  const calls = [];
  const owner = "U".padEnd(33, "1");
  const app = { post(route, cb) { assert.equal(route, "/line/webhook"); handler = cb; } };
  const ctx = {
    app, ACCESS: { owner },
    console: { error() {} },
    gasPostWithTimeout(action, body) {
      calls.push({ action, body });
      if (action === "line-admit") {
        if (mode === "reject") return Promise.reject(new Error("GAS unavailable"));
        if (mode === "invalid") return Promise.resolve({});
        if (mode === "deferred") return new Promise(resolve => { admitRelease = resolve; });
        return Promise.resolve({ queueIds: ["line-" + "a".repeat(40)] });
      }
      if (action === "line-process") return Promise.resolve({ processedCount: 1 });
      throw new Error("unexpected GAS action " + action);
    },
  };
  vm.runInNewContext(
    between(server, "const LINE_ADMISSION_TIMEOUT_MS", 'app.get("/core", async'),
    ctx, { timeout: 1000 },
  );
  const event = { source: { type: "user", userId: owner }, type: "message", replyToken: "t", message: { type: "text", text: "清單" } };
  let res = response();
  mode = "deferred";
  const pending = handler({ body: { events: [event] } }, res);
  assert.equal(res.headersSent, false, "must not reply before durable admission");
  admitRelease({ queueIds: ["line-" + "a".repeat(40)] });
  await pending;
  assert.equal(res.code, 200);
  assert.equal(res.body.queued, 1);
  assert(calls.some(c => c.action === "line-process"), "processing should start after admission");

  mode = "reject";
  res = response();
  await handler({ body: { events: [event] } }, res);
  assert.equal(res.code, 503, "must reject when GAS persistence fails");

  mode = "invalid";
  res = response();
  await handler({ body: { events: [event] } }, res);
  assert.equal(res.code, 503, "cannot trust missing admission receipt");

  const count = calls.length;
  res = response();
  await handler({ body: { events: [] } }, res);
  assert.equal(res.code, 200, "LINE webhook verification must still pass");
  assert.equal(calls.length, count, "empty webhook must not access GAS");
  console.log("PASS: webhook verifies durable receipt before 200 and returns 503 on failure");
}
function checkGasDedupeAndPending() {
  const rows = new Map();
  let pendingReads = 0;
  const ctx = {
    withQueueLock(fn) { return fn(); },
    recoverStaleProcessingQueueMessagesUnlocked() {},
    getQueueMessageById(id) { return rows.get(id) || null; },
    buildQueueDedupeMeta(text) { return { key: text }; },
    findDuplicateQueueMessage() { return null; },
    createQueueMessage(input) { rows.set(input.id, input); return input; },
    tpDigest() { return "a".repeat(40); },
    consumeLinePendingText(userId, text) { pendingReads++; return { messageText: text }; },
    prepareLinePendingFromPostback() { pendingReads++; },
    TP_LINE_POSTBACK_PREFIX: "__TP_POSTBACK__:",
    tryImmediateReplyByRender() { throw new Error("should not process on admission"); },
    replyLineMessage() { throw new Error("should not reply on admission"); },
  };
  vm.createContext(ctx);
  vm.runInContext(
    between(gas, "function createQueueMessageForImmediateProcessing(", "function claimQueueMessageForRetry("),
    ctx,
  );
  vm.runInContext(between(gas, "function handleLineWebhookToQueue(", "function tryImmediateReplyByRender("), ctx);
  const event = { type: "message", source: { userId: "U123" }, replyToken: "reply", webhookEventId: "event-1", message: { type: "text", text: "清單" } };
  const body = { events: [event] };
  const one = ctx.handleLineWebhookToQueue(body, { admitOnly: true });
  assert.equal(one.queueIds.length, 1);
  assert.equal(rows.get(one.queueIds[0]).status, "pending");
  assert.equal(pendingReads, 1);
  const again = ctx.handleLineWebhookToQueue(body, { admitOnly: true });
  assert.equal(again.queueIds.length, 0);
  assert.equal(again.results[0].duplicateReason, "same_event");
  assert.equal(pendingReads, 1, "redelivery must not consume pending state again");
  console.log("PASS: GAS persists pending event and deduplicates by webhook event ID");
}
(async () => {
  await checkWebhookAcknowledgement();
  checkGasDedupeAndPending();
  console.log("NOTE: integration with real GAS, LINE redelivery, and Render cold start is still untested.");
})().catch(e => { console.error(e); process.exitCode = 1; });