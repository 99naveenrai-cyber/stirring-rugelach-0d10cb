"use strict";

const crypto = require("crypto");

const REFERRAL_CODE_PATTERN = /^[A-Z2-9]{10}$/;
const UPI_ID_PATTERN = /^[a-z0-9._-]{2,128}@[a-z0-9.-]{2,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d{10,15}$/;

function normalizeSpaces(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return normalizeSpaces(value).toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeUpiId(value) {
  return normalizeSpaces(value).toLowerCase();
}

function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase();
}

function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  let code = "";
  for (let index = 0; index < 10; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }
  return code;
}

function maskUpiId(value) {
  const upi = normalizeUpiId(value);
  const separator = upi.indexOf("@");
  if (separator < 1) return upi ? "***" : "";
  const handle = upi.slice(0, separator);
  const provider = upi.slice(separator + 1);
  return `${handle.slice(0, 2)}${"*".repeat(Math.max(3, Math.min(8, handle.length - 2)))}@${provider}`;
}

function inrToPaise(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function calculateCommissionPaise(paymentAmountPaise, policy = {}) {
  const payment = Math.max(0, Math.trunc(Number(paymentAmountPaise) || 0));
  if (!payment || policy.enabled !== true) return 0;
  if (policy.commissionType === "percentage") {
    const basisPoints = Math.max(0, Math.min(5000, Math.trunc(Number(policy.percentageBps) || 0)));
    return Math.min(payment, Math.floor((payment * basisPoints) / 10000));
  }
  if (policy.commissionType === "fixed") {
    return Math.min(payment, Math.max(0, Math.trunc(Number(policy.fixedAmountPaise) || 0)));
  }
  return 0;
}

module.exports = {
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
};
