"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionsSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const studentSource = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const adminSource = fs.readFileSync(path.join(__dirname, "..", "..", "admin.html"), "utf8");

function functionBlock(name, nextMarker) {
  const start = functionsSource.indexOf(name);
  const end = functionsSource.indexOf(nextMarker, start + name.length);
  assert.ok(start >= 0 && end > start, `Expected function block ${name}`);
  return functionsSource.slice(start, end);
}

test("verified payment transaction creates an idempotent referral event and commission", () => {
  const block = functionBlock("async function finalizeSuccessfulPayment", "function getHeaderValue");
  assert.match(block, /referralPurchaseEvents/);
  assert.match(block, /referralCommissionDocId\(orderId\)/);
  assert.match(block, /transaction\.create\(referralEventRef/);
  assert.match(block, /transaction\.create\(referralWrites\.commissionRef/);
  assert.match(block, /calculateCommissionPaise/);
});

test("verified refund transaction reverses referral state without deleting audit history", () => {
  const block = functionBlock("async function revokeCourseAccessFromWebhook", "exports.cashfreeWebhook");
  assert.match(block, /status: "reversed"/);
  assert.match(block, /reversedPaise/);
  assert.doesNotMatch(block, /transaction\.delete\(/);
});

test("student UI uses authenticated callables and does not write referral finance records directly", () => {
  assert.match(studentSource, /httpsCallable\(functions, 'joinReferralProgram'\)/);
  assert.match(studentSource, /httpsCallable\(functions, 'getMyReferralDashboard'\)/);
  assert.doesNotMatch(studentSource, /setDoc\([^\n]*referral(?:Members|Commissions|Payouts)/);
});

test("admin UI labels payouts as manual and uses privileged callables", () => {
  assert.match(adminSource, /adminRecordReferralPayout/);
  assert.match(adminSource, /payoutMethod: "manual-record"|Record approved payout/);
  assert.match(adminSource, /See Student Finance Executives/);
});
