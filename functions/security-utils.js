"use strict";

const crypto = require("crypto");

const APP_CHECK_ENFORCEMENT_ENABLED = false;
const ALLOWED_WEB_ORIGINS = Object.freeze([
  "https://betalaunch.ideakdc.in",
  "https://ideakdc.in",
  "https://ideakdc-24b0b.web.app",
  "https://ideakdc-24b0b.firebaseapp.com"
]);

class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  } catch (error) {
    throw new RequestValidationError("Request payload must be valid JSON.");
  }
}

function validateCallableData(data, {
  allowedKeys = [],
  requiredKeys = [],
  maxBytes = 4096
} = {}) {
  const value = data == null ? {} : data;
  if (!isPlainObject(value)) {
    throw new RequestValidationError("Request payload must be an object.");
  }
  if (jsonByteLength(value) > maxBytes) {
    throw new RequestValidationError(`Request payload exceeds the ${maxBytes}-byte limit.`);
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new RequestValidationError(`Unexpected request field: ${unexpected[0]}.`);
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new RequestValidationError(`Missing required request field: ${key}.`);
    }
  }
  return value;
}

function validateString(value, fieldName, {
  required = false,
  maxLength = 180,
  pattern = null,
  allowedValues = null
} = {}) {
  if (value == null || value === "") {
    if (required) throw new RequestValidationError(`${fieldName} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    throw new RequestValidationError(`${fieldName} must be text.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new RequestValidationError(`${fieldName} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new RequestValidationError(`${fieldName} exceeds ${maxLength} characters.`);
  }
  if (pattern && normalized && !pattern.test(normalized)) {
    throw new RequestValidationError(`${fieldName} has an invalid format.`);
  }
  if (allowedValues && normalized && !allowedValues.includes(normalized)) {
    throw new RequestValidationError(`${fieldName} has an unsupported value.`);
  }
  return normalized;
}

function validateStringArray(value, fieldName, {
  maxItems = 100,
  itemMaxLength = 180,
  pattern = null
} = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be a list.`);
  }
  if (value.length > maxItems) {
    throw new RequestValidationError(`${fieldName} exceeds ${maxItems} items.`);
  }
  return value.map((item, index) => validateString(item, `${fieldName}[${index}]`, {
    required: true,
    maxLength: itemMaxLength,
    pattern
  }));
}

const rateLimitBuckets = new Map();

function rateLimitKey(scope, identity) {
  const digest = crypto.createHash("sha256")
    .update(String(identity || "anonymous"))
    .digest("hex")
    .slice(0, 24);
  return `${scope}:${digest}`;
}

function checkRateLimit({
  scope,
  identity,
  limit,
  windowMs,
  now = Date.now()
}) {
  const key = rateLimitKey(scope, identity);
  const current = rateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (rateLimitBuckets.size > 2000) {
    for (const [storedKey, stored] of rateLimitBuckets) {
      if (stored.resetAt <= now) rateLimitBuckets.delete(storedKey);
    }
  }

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

function resetRateLimitsForTests() {
  rateLimitBuckets.clear();
}

function maskIdentifier(value, label = "id") {
  const text = String(value || "").trim();
  if (!text) return "";
  const digest = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
  return `${label}_${digest}`;
}

function maskEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  const at = text.indexOf("@");
  if (at <= 0) return text ? "[masked-email]" : "";
  return `${text.slice(0, 1)}***@${text.slice(at + 1)}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return `***${digits.slice(-3)}`;
}

function safeErrorDetails(error) {
  return {
    code: String(error?.code || error?.name || "unknown").slice(0, 80),
    status: Number.isFinite(Number(error?.status)) ? Number(error.status) : undefined
  };
}

function minimalCashfreeProviderRecord(providerPayload = {}) {
  const order = providerPayload.orderStatus || {};
  const payment = providerPayload.payment || {};
  return {
    eventType: String(providerPayload.eventType || "").slice(0, 80),
    webhook: providerPayload.webhook === true,
    providerOrderStatus: String(order.order_status || "").slice(0, 40),
    providerPaymentStatus: String(payment.payment_status || "").slice(0, 40),
    paymentMethod: String(
      payment.payment_group ||
      payment.payment_method?.payment_method ||
      ""
    ).slice(0, 40)
  };
}

module.exports = {
  ALLOWED_WEB_ORIGINS,
  APP_CHECK_ENFORCEMENT_ENABLED,
  RequestValidationError,
  checkRateLimit,
  jsonByteLength,
  maskEmail,
  maskIdentifier,
  maskPhone,
  minimalCashfreeProviderRecord,
  resetRateLimitsForTests,
  safeErrorDetails,
  validateCallableData,
  validateString,
  validateStringArray
};
