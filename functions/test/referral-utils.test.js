"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  REFERRAL_CODE_PATTERN,
  UPI_ID_PATTERN,
  calculateCommissionPaise,
  generateReferralCode,
  inrToPaise,
  maskUpiId,
  normalizeEmail,
  normalizePhone,
  normalizeReferralCode,
  normalizeSpaces,
  normalizeUpiId
} = require("../referral-utils");

test("referral identity fields normalize without damaging Hindi names", () => {
  assert.equal(normalizeSpaces("  नवीन   राय  "), "नवीन राय");
  assert.equal(normalizeEmail(" STUDENT@Example.COM "), "student@example.com");
  assert.equal(normalizePhone("+91 98765-43210"), "919876543210");
  assert.equal(normalizeUpiId(" Student.Name@OKSBI "), "student.name@oksbi");
  assert.equal(normalizeReferralCode(" abcd234567 "), "ABCD234567");
  assert.match("student@example.com", EMAIL_PATTERN);
  assert.match("919876543210", PHONE_PATTERN);
  assert.match("student.name@oksbi", UPI_ID_PATTERN);
});

test("random referral codes use the safe non-sequential alphabet", () => {
  const codes = new Set(Array.from({ length: 250 }, generateReferralCode));
  assert.equal(codes.size, 250);
  for (const code of codes) assert.match(code, REFERRAL_CODE_PATTERN);
});

test("UPI masking preserves provider but not the full handle", () => {
  assert.equal(maskUpiId("student.name@oksbi"), "st********@oksbi");
  assert.equal(maskUpiId("a@upi"), "a***@upi");
});

test("percentage commission uses integer paise and safe rounding", () => {
  assert.equal(inrToPaise(499.99), 49999);
  assert.equal(calculateCommissionPaise(49999, {
    enabled: true,
    commissionType: "percentage",
    percentageBps: 1250
  }), 6249);
});

test("fixed commission cannot exceed verified payment amount", () => {
  assert.equal(calculateCommissionPaise(20000, {
    enabled: true,
    commissionType: "fixed",
    fixedAmountPaise: 30000
  }), 20000);
});

test("disabled or unsupported policy produces no commission", () => {
  assert.equal(calculateCommissionPaise(50000, {
    enabled: false,
    commissionType: "percentage",
    percentageBps: 1000
  }), 0);
  assert.equal(calculateCommissionPaise(50000, { enabled: true, commissionType: "unknown" }), 0);
});
