"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ALLOWED_WEB_ORIGINS,
  APP_CHECK_ENFORCEMENT_ENABLED,
  RequestValidationError,
  checkRateLimit,
  maskEmail,
  maskIdentifier,
  maskPhone,
  minimalCashfreeProviderRecord,
  resetRateLimitsForTests,
  validateCallableData,
  validateStringArray
} = require("../security-utils");

test.beforeEach(() => {
  resetRateLimitsForTests();
});

test("App Check enforcement remains disabled-ready", () => {
  assert.equal(APP_CHECK_ENFORCEMENT_ENABLED, false);
  assert.deepEqual(ALLOWED_WEB_ORIGINS, [
    "https://betalaunch.ideakdc.in",
    "https://ideakdc.in",
    "https://ideakdc-24b0b.web.app",
    "https://ideakdc-24b0b.firebaseapp.com"
  ]);
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const callableDefinitions = source.match(/exports\.[A-Za-z0-9_]+\s*=\s*onCall\(/g) || [];
  const securedCallableDefinitions = source.match(/exports\.[A-Za-z0-9_]+\s*=\s*onCall\(callableOptions\(/g) || [];
  assert.equal(callableDefinitions.length, securedCallableDefinitions.length);
});

test("request validation rejects unexpected fields and oversized payloads", () => {
  assert.throws(
    () => validateCallableData({ courseId: "course-1", uid: "other-user" }, {
      allowedKeys: ["courseId"],
      maxBytes: 512
    }),
    RequestValidationError
  );
  assert.throws(
    () => validateCallableData({ value: "x".repeat(600) }, {
      allowedKeys: ["value"],
      maxBytes: 128
    }),
    /exceeds/
  );
});

test("bounded string arrays reject excess items and invalid identifiers", () => {
  assert.deepEqual(
    validateStringArray(["lesson_1", "lesson-2"], "contentIds", {
      maxItems: 2,
      itemMaxLength: 20,
      pattern: /^[A-Za-z0-9_-]+$/
    }),
    ["lesson_1", "lesson-2"]
  );
  assert.throws(
    () => validateStringArray(["ok", "../bad"], "contentIds", {
      maxItems: 2,
      itemMaxLength: 20,
      pattern: /^[A-Za-z0-9_-]+$/
    }),
    RequestValidationError
  );
});

test("rate limits allow normal use and reject bursts by identity", () => {
  const first = checkRateLimit({
    scope: "payment",
    identity: "user-a",
    limit: 2,
    windowMs: 60000,
    now: 1000
  });
  const second = checkRateLimit({
    scope: "payment",
    identity: "user-a",
    limit: 2,
    windowMs: 60000,
    now: 1001
  });
  const third = checkRateLimit({
    scope: "payment",
    identity: "user-a",
    limit: 2,
    windowMs: 60000,
    now: 1002
  });
  const otherUser = checkRateLimit({
    scope: "payment",
    identity: "user-b",
    limit: 2,
    windowMs: 60000,
    now: 1002
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(otherUser.allowed, true);
});

test("log masking never returns raw identifiers, email, or phone", () => {
  const identifier = "order_123456789";
  const email = "student@example.com";
  const phone = "+91 98765 43210";
  assert.notEqual(maskIdentifier(identifier, "order"), identifier);
  assert.equal(maskIdentifier(identifier, "order").includes(identifier), false);
  assert.equal(maskEmail(email), "s***@example.com");
  assert.equal(maskPhone(phone), "***210");
});

test("Cashfree records retain only an allowlisted provider summary", () => {
  const result = minimalCashfreeProviderRecord({
    webhook: true,
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    token: "must-not-survive",
    orderStatus: {
      order_status: "PAID",
      payment_session_id: "must-not-survive"
    },
    payment: {
      payment_status: "SUCCESS",
      payment_group: "upi",
      bank_reference: "must-not-survive"
    }
  });
  assert.deepEqual(result, {
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    webhook: true,
    providerOrderStatus: "PAID",
    providerPaymentStatus: "SUCCESS",
    paymentMethod: "upi"
  });
});
