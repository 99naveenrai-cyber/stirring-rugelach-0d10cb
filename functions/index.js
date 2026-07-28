Exit code: 0
Wall time: 0.7 seconds
Total output lines: 2907
Output:
"use strict";

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  ALLOWED_WEB_ORIGINS,
  APP_CHECK_ENFORCEMENT_ENABLED,
  RequestValidationError,
  checkRateLimit,
  maskEmail,
  maskIdentifier,
  minimalCashfreeProviderRecord,
  safeErrorDetails,
  validateCallableData,
  validateString,
  validateStringArray
} = require("./security-utils");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "ideakdc-24b0b.firebasestorage.app";

const CASHFREE_ENV = process.env.CASHFREE_ENV || "TEST";
const CASHFREE_APP_ID = defineSecret("CASHFREE_APP_ID");
const CASHFREE_SECRET_KEY = defineSecret("CASHFREE_SECRET_KEY");
const CASHFREE_API_VERSION = "2025-01-01";
const CASHFREE_TEST_BASE_URL = "https://sandbox.cashfree.com/pg";
const PAYMENT_ORDER_CREATION_LOCK_MS = 90 * 1000;
const PAYMENT_ORDER_DEFAULT_EXPIRY_MS = 15 * 60 * 1000;
const CASHFREE_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SAFE_RESOURCE_ID_PATTERN = /^[^/\\\u0000-\u001F]{1,180}$/;

function callableOptions(options = {}) {
  return {
    ...options,
    cors: ALLOWED_WEB_ORIGINS,
    // Ready for enforcement after the web app is registered with an App Check provider.
    enforceAppCheck: APP_CHECK_ENFORCEMENT_ENABLED
  };
}

function requestIdentity(request) {
  return request.auth?.uid ||
    request.rawRequest?.ip ||
    request.rawRequest?.headers?.["x-forwarded-for"] ||
    "anonymous";
}

function enforceCallableRateLimit(request, scope, limit, windowMs) {
  const result = checkRateLimit({
    scope,
    identity: requestIdentity(request),
    limit,
    windowMs
  });
  if (!result.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Too many requests. Please retry in ${result.retryAfterSeconds} seconds.`
    );
  }
}

function enforceHttpRateLimit(req, scope, identity, limit, windowMs) {
  const result = checkRateLimit({
    scope,
    identity: identity || req.ip || req.headers["x-forwarded-for"] || "anonymous",
    limit,
    windowMs
  });
  return result;
}

function validatedCallableData(request, config) {
  try {
    return validateCallableData(request.data, config);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}

function validatedResourceId(value, fieldName, required = true) {
  return validatedText(value, fieldName, {
    required,
    maxLength: 180,
    pattern: SAFE_RESOURCE_ID_PATTERN
  });
}

function validatedText(value, fieldName, options = {}) {
  try {
    return validateString(value, fieldName, options);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Login is required before creating a payment order.");
  }
  return request.auth;
}

function normalizeCourseId(courseId) {
  if (typeof courseId !== "string") return "";
  return courseId.trim().slice(0, 180);
}

function groupIdForContent(item) {
  return `${item.classNum || ""}__${item.stream || ""}__${item.subject || ""}`;
}

function adminEmails() {
  return ["99naveenrai@gmail.com"];
}

function isAdminAuth(auth) {
  const email = String(auth?.token?.email || "").toLowerCase();
  return adminEmails().includes(email);
}

function requireAdminAuth(request, message = "Only IdeaKDC admins can perform this action.") {
  const auth = requireAuth(request);
  if (!isAdminAuth(auth)) {
    throw new HttpsError("permission-denied", message);
  }
  return auth;
}

function extractYouTubeVideoId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (YOUTUBE_ID_PATTERN.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID_PATTERN.test(v)) return v;
    if (host === "youtu.be" && parts[0] && YOUTUBE_ID_PATTERN.test(parts[0])) return parts[0];
    if (
      ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host) &&
      ["embed", "shorts", "live"].includes(parts[0]) &&
      parts[1] &&
      YOUTUBE_ID_PATTERN.test(parts[1])
    ) {
      return parts[1];
    }
  } catch (error) {}
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    /youtube-nocookie\.com\/embed\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function detectVideoSourceType(value) {
  const source = String(value || "").trim();
  if (extractYouTubeVideoId(source)) return "youtube";
  if (/^https:\/\/.+\.(mp4|webm)(?:[?#].*)?$/i.test(source)) return "native";
  return "unsupported";
}

function normalizeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (isMissingThumbnailValue(url)) return "";
  if (/^(blob:|data:|file:)/i.test(url)) return "";
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("\\\\")) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (!isDirectYoutubeThumbnailHost(parsed.hostname) && /youtube\.com$|youtube-nocookie\.com$|youtu\.be$/i.test(parsed.hostname)) return "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function isMissingThumbnailValue(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "-" || text === "pending-repair" || text === "pending" || text === "null" || text === "undefined";
}

function isDirectYoutubeThumbnailHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return host === "img.youtube.com" ||
    host.endsWith(".img.youtube.com") ||
    host === "i.ytimg.com" ||
    host.endsWith(".i.ytimg.com") ||
    host === "ytimg.com" ||
    host.endsWith(".ytimg.com");
}

function normalizeFaqs(data) {
  const raw = Array.isArray(data?.faqs) ? data.faqs :
    Array.isArray(data?.questions) ? data.questions :
      Array.isArray(data?.qa) ? data.qa :
        Array.isArray(data?.faq) ? data.faq : [];
  return raw.map((item) => {
    if (Array.isArray(item)) return { question: item[0], answer: item[1] };
    return {
      question: item?.question || item?.q || item?.title || item?.prompt || "",
      answer: item?.answer || item?.a || item?.text || item?.response || ""
    };
  }).map((item) => ({
    question: String(item.question || "").replace(/\s+/g, " ").trim(),
    answer: String(item.answer || "").replace(/\s+/g, " ").trim()
  })).filter((item) => item.question && item.answer).slice(0, 8);
}

function coursePriceFrom(value) {
  return value === 0 || value ? Number(value) : 450;
}

function hasExplicitFreeFlag(data = {}) {
  return data.isFree === true ||
    data.free === true ||
    data.paymentRequired === false ||
    String(data.accessType || "").toLowerCase() === "free";
}

function hasExplicitPaidFlag(data = {}) {
  return data.paymentRequired === true ||
    String(data.accessType || "").toLowerCase() === "paid";
}

function isContentFree(data = {}) {
  if (hasExplicitFreeFlag(data)) return true;
  if (hasExplicitPaidFlag(data)) return false;
  return ["price", "amount", "coursePrice"].some((field) => {
    const value = data[field];
    return value !== undefined && value !== null && value !== "" && Number(value) === 0;
  });
}

function normalizedContentPrice(data = {}) {
  if (isContentFree(data)) return 0;
  return coursePriceFrom(data.price ?? data.amount ?? data.coursePrice);
}

function needsFreePricingRepair(data = {}) {
  if (!hasExplicitFreeFlag(data)) return false;
  const numericFields = [data.price, data.amount, data.coursePrice]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => Number(value));
  return numericFields.some((value) => Number.isFinite(value) && value > 0) ||
    data.paymentRequired !== false ||
    String(data.accessType || "").toLowerCase() !== "free" ||
    data.isFree !== true;
}

async function repairConflictingFreePricingDocs(docs = []) {
  const repairs = [];
  docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!needsFreePricingRepair(data)) return;
    repairs.push(doc.ref.set({
      isFree: true,
      free: true,
      price: 0,
      amount: 0,
      coursePrice: 0,
      paymentRequired: false,
      accessType: "free",
      pricingRepairedAt: FieldValue.serverTimestamp()
    }, { merge: true }));
  });
  if (!repairs.length) return 0;
  await Promise.all(repairs);
  return repairs.length;
}

function firstSafeThumbnail(candidates, protectedVideoId) {
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate || "");
    if (normalized) return normalized;
  }
  return "";
}

function publicContentThumbnail(data, protectedVideoId = "") {
  return firstSafeThumbnail([
    data.courseThumbnailUrl || data.courseThumbnail || data.courseImage || data.coursePoster ||
    data.courseImageUrl || data.coverImage || data.coverUrl || data.bannerUrl || "",
    data.thumbnailUrl,
    data.thumbnail,
    data.image,
    data.poster,
    data.previewThumbnailUrl,
    data.imageUrl
  ], protectedVideoId);
}

function publicLessonThumbnail(data, protectedVideoId = "") {
  const normalized = normalizeImageUrl(
    data.thumbnailUrl || data.thumbnail || data.imageUrl || data.image || data.poster ||
    data.youtubeThumbnail || data.videoThumbnail || data.videoThumb || data.thumb || ""
  );
  return normalized;
}

function youtubeThumbnailUrl(videoId, quality = "maxresdefault") {
  const id = extractYouTubeVideoId(videoId);
  return id ? `https://img.youtube.com/vi/${id}/${quality}.jpg` : "";
}

function protectedVideoIdFromContent(data) {
  return resolveProtectedVideoSource(data).videoId;
}

function isStandaloneContent(data = {}) {
  const courseType = String(data.courseType || data.contentType || data.type || "").toLowerCase();
  if (courseType === "single" || courseType === "video") return !data.playlistId;
  return !data.playlistId;
}

function resolveProtectedVideoSource(data = {}, docId = "") {
  const candidates = [
    ["youtubeVideoId", data.youtubeVideoId, "id"],
    ["videoId", data.videoId, "id"],
    ["vid", data.vid, "id"],
    ["firstVideoId", data.firstVideoId, "id"],
    ["protectedVideoId", data.protectedVideoId, "id"],
    ["fullVideoId", data.fullVideoId, "id"],
    ["sourceVideoId", data.sourceVideoId, "id"],
    ["youtubeUrl", data.youtubeUrl, "url"],
    ["videoUrl", data.videoUrl, "url"],
    ["sourceUrl", data.sourceUrl, "url"],
    ["playbackUrl", data.playbackUrl, "url"],
    ["embedUrl", data.embedUrl, "url"],
    ["url", data.url, "url"]
  ];
  if (isStandaloneContent(data)) {
    candidates.push(["lessonId", data.lessonId, "strict-id"]);
    candidates.push(["contentId", data.contentId, "strict-id"]);
    candidates.push(["document.id", docId || data.id, "strict-id"]);
  }

  for (const [sourceField, sourceValue, kind] of candidates) {
    const value = String(sourceValue || "").trim();
    if (!value) continue;
    const videoId = kind === "strict-id"
      ? (YOUTUBE_ID_PATTERN.test(value) ? value : "")
      : extractYouTubeVideoId(value);
    if (videoId) return { videoId, sourceField, sourceValue: value };
  }

  return { videoId: "", sourceField: "", sourceValue: "" };
}

function thumbnailLeaksVideoId(url, videoId) {
  if (!url || !videoId) return false;
  return String(url).includes(`/vi/${videoId}/`) || String(url).includes(encodeURIComponent(videoId));
}

function isFirebaseStorageThumbnailUrl(url) {
  const value = normalizeImageUrl(url);
  return Boolean(value) &&
    value.includes("firebasestorage.googleapis.com") &&
    value.includes("/course-thumbnails%2F");
}

function isDisplayThumbnailUrl(url) {
  return Boolean(normalizeImageUrl(url));
}

function shouldReplaceThumbnail(url) {
  return !isDisplayThumbnailUrl(url);
}

function isPublicThumbnailCandidate(url, protectedVideoId = "") {
  const value = normalizeImageUrl(url);
  if (!value) return false;
  if (thumbnailLeaksVideoId(value, protectedVideoId)) return false;
  try {
    const parsed = new URL(value);
    if (isDirectYoutubeThumbnailHost(parsed.hostname) || /youtube\.com$|youtube-nocookie\.com$|youtu\.be$/i.test(parsed.hostname)) {
      return false;
    }
  } catch (error) {
    return false;
  }
  return true;
}

function serverCopySourceThumbnail(data = {}, protectedVideoId = "") {
  const candidates = [
    data.courseThumbnailUrl,
    data.thumbnailUrl,
    data.thumbnail,
    data.image,
    data.poster,
    data.courseThumbnail,
    data.courseImage,
    data.coursePoster,
    data.courseImageUrl,
    data.coverImage,
    data.coverUrl,
    data.bannerUrl,
    data.previewThumbnailUrl,
    data.imageUrl,
    data.youtubeThumbnail,
    data.videoThumbnail,
    data.videoThumb,
    data.thumb
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value || /^(blob:|data:|file:)/i.test(value)) continue;
    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") continue;
      const directYoutube = isDirectYoutubeThumbnailHost(parsed.hostname);
      if (!directYoutube && /youtube\.com$|youtube-nocookie\.com$|youtu\.be$/i.test(parsed.hostname)) continue;
      return { url: parsed.toString(), directYoutube };
    } catch (error) {}
  }
  return { url: "", directYoutube: false };
}

function unsafeThumbnailFieldValue(value = "", protectedVideoId = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^(blob:|data:|file:)/i.test(raw)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) return true;
  if (thumbnailLeaksVideoId(raw, protectedVideoId)) return true;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return true;
    return isDirectYoutubeThumbnailHost(parsed.hostname);
  } catch (error) {
    return true;
  }
}

function unsafeThumbnailCleanup(data = {}, protectedVideoId = "") {
  const cleanup = {};
  ["thumbnail", "image", "poster", "previewThumbnailUrl", "imageUrl", "youtubeThumbnail", "videoThumbnail", "videoThumb", "thumb"].forEach((field) => {
    if (unsafeThumbnailFieldValue(data[field], protectedVideoId)) cleanup[field] = "";
  });
  return cleanup;
}

function safeStorageName(value = "thumbnail") {
  return String(value || "thumbnail")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function firebaseStorageDownloadUrl(path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function uploadThumbnailBytesToStorage(path, buffer, contentType = "image/jpeg") {
  const token = crypto.randomUUID();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const file = bucket.file(path);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "public,max-age=31536000,immutable",
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    }
  });
  return firebaseStorageDownloadUrl(path, token);
}

async function fetchImageBytes(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "IdeaKDC-thumbnail-repair/1.0" }
  });
  if (!response.ok) {
    throw new Error(`http_${response.status}`);
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("not_image");
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length < 1024) {
    throw new Error("image_too_small");
  }
  return { buffer, contentType: contentType.split(";")[0] || "image/jpeg" };
}

async function copyPublicImageToStorage(sourceUrl, courseId, contentId, label = "custom") {
  const { buffer, contentType } = await fetchImageBytes(sourceUrl);
  const path = `course-thumbnails/${safeStorageName(courseId)}/${safeStorageName(contentId)}-${label}.jpg`;
  return uploadThumbnailBytesToStorage(path, buffer, contentType);
}

async function copyYoutubeThumbnailToStorage(videoId, courseId, contentId) {
  const id = extractYouTubeVideoId(videoId);
  if (!id) throw new Error("missing_video_id");
  const qualities = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"];
  let lastError = null;
  for (const quality of qualities) {
    try {
      logger.info("[THUMB_FETCH_ATTEMPT]", { courseId, contentId, quality });
      const url = `https://img.youtube.com/vi/${id}/${quality}.jpg`;
      const { buffer, contentType } = await fetchImageBytes(url);
      logger.info("[THUMB_FETCH_RESULT]", { courseId, contentId, quality, contentType, bytes: buffer.length });
      const path = `course-thumbnails/${safeStorageName(courseId)}/${safeStorageName(contentId)}-${quality}.jpg`;
      logger.info("[THUMB_STORAGE_UPLOAD_STARTED]", { courseId, contentId, quality, path });
      const storageUrl = await uploadThumbnailBytesToStorage(path, buffer, contentType);
      logger.info("[THUMB_STORAGE_UPLOAD_COMPLETE]", { courseId, contentId, quality, path });
      return { storageUrl, quality, storagePath: path, contentType };
    } catch (error) {
      lastError = error;
      logger.warn("[THUMB_PIPELINE_FAILED]", {
        courseId,
        contentId,
        quality,
        stage: "lesson-fetch-or-upload",
        ...safeErrorDetails(error)
      });
    }
  }
  throw new Error(lastError?.message || "youtube_thumbnail_unavailable");
}

async function copyYoutubeCourseThumbnailToStorage(videoId, courseId) {
  const id = extractYouTubeVideoId(videoId);
  if (!id) throw new Error("missing_video_id");
  const qualities = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"];
  let lastError = null;
  for (const quality of qualities) {
    try {
      logger.info("[THUMB_FETCH_ATTEMPT]", { courseId, quality, target: "course" });
      const url = `https://img.youtube.com/vi/${id}/${quality}.jpg`;
      const { buffer, contentType } = await fetchImageBytes(url);
      logger.info("[THUMB_FETCH_RESULT]", { courseId, quality, target: "course", contentType, bytes: buffer.length });
      const path = `course-thumbnails/${safeStorageName(courseId)}/course.jpg`;
      logger.info("[THUMB_STORAGE_UPLOAD_STARTED]", { courseId, quality, target: "course", path });
      const storageUrl = await uploadThumbnailBytesToStorage(path, buffer, contentType);
      logger.info("[THUMB_STORAGE_UPLOAD_COMPLETE]", { courseId, quality, …16117 tokens truncated… {
  return payload?.data?.order || payload?.order || {};
}

function getWebhookPayment(payload) {
  return payload?.data?.payment || payload?.payment || {};
}

function getWebhookCustomer(payload) {
  return payload?.data?.customer_details ||
    payload?.data?.customer ||
    payload?.customer_details ||
    {};
}

function getWebhookEventType(payload) {
  return String(payload?.type || payload?.event || payload?.event_type || "").toUpperCase();
}

function normalizeWebhookStatus(payload) {
  const eventType = getWebhookEventType(payload);
  const order = getWebhookOrder(payload);
  const payment = getWebhookPayment(payload);
  const paymentStatus = String(payment.payment_status || payment.status || "").toUpperCase();
  const orderStatus = String(order.order_status || order.status || "").toUpperCase();

  if (eventType.includes("REFUND") || paymentStatus.includes("REFUND")) return "refunded";
  if (eventType.includes("CHARGEBACK") || eventType.includes("DISPUTE")) return "chargeback";
  if (
    eventType.includes("SUCCESS") ||
    eventType.includes("PAID") ||
    paymentStatus === "SUCCESS" ||
    orderStatus === "PAID"
  ) {
    return "paid";
  }
  if (
    eventType.includes("FAILED") ||
    eventType.includes("CANCELLED") ||
    eventType.includes("USER_DROPPED") ||
    paymentStatus === "FAILED" ||
    paymentStatus === "CANCELLED" ||
    orderStatus === "EXPIRED"
  ) {
    return "failed";
  }
  return "pending";
}

function getWebhookOrderId(payload) {
  const order = getWebhookOrder(payload);
  const payment = getWebhookPayment(payload);
  const refund = payload?.data?.refund || payload?.refund || {};
  const chargeback = payload?.data?.chargeback ||
    payload?.data?.dispute ||
    payload?.chargeback ||
    payload?.dispute ||
    {};
  return String(
    order.order_id ||
    payment.order_id ||
    refund.order_id ||
    chargeback.order_id ||
    payload.order_id ||
    ""
  ).trim();
}

function getWebhookAmount(payload) {
  const order = getWebhookOrder(payload);
  const payment = getWebhookPayment(payload);
  return Number(payment.payment_amount || order.order_amount || payload.order_amount || 0);
}

function getWebhookCurrency(payload, fallbackCurrency) {
  const order = getWebhookOrder(payload);
  const payment = getWebhookPayment(payload);
  return payment.payment_currency || order.order_currency || payload.order_currency || fallbackCurrency || "INR";
}

function getWebhookCourseId(payload) {
  const order = getWebhookOrder(payload);
  return order.order_tags?.courseId || payload?.data?.order_tags?.courseId || payload?.order_tags?.courseId || "";
}

function getWebhookUid(payload) {
  const order = getWebhookOrder(payload);
  const customer = getWebhookCustomer(payload);
  return String(
    customer.customer_id ||
    order.customer_details?.customer_id ||
    payload.customer_id ||
    ""
  );
}

function getWebhookPaymentId(payload) {
  const payment = getWebhookPayment(payload);
  return String(payment.cf_payment_id || payment.payment_id || "");
}

function getWebhookRefund(payload) {
  return payload?.data?.refund || payload?.refund || {};
}

function getWebhookChargeback(payload) {
  return payload?.data?.chargeback ||
    payload?.data?.dispute ||
    payload?.chargeback ||
    payload?.dispute ||
    {};
}

function getConfirmedAccessRevocation(payload, order) {
  const eventType = getWebhookEventType(payload);
  const refund = getWebhookRefund(payload);
  const refundStatus = String(refund.refund_status || refund.status || "").toUpperCase();
  const refundAmount = Number(refund.refund_amount || refund.amount || 0);
  const confirmedRefundStatuses = new Set(["SUCCESS", "PROCESSED", "COMPLETED"]);

  if (
    eventType.includes("REFUND") &&
    confirmedRefundStatuses.has(refundStatus) &&
    refundAmount > 0 &&
    (numbersMatch(refundAmount, order.amount) || refundAmount > Number(order.amount || 0))
  ) {
    return {
      status: "refunded",
      reason: "full_refund",
      amount: refundAmount,
      referenceId: String(refund.cf_refund_id || refund.refund_id || "")
    };
  }

  const chargeback = getWebhookChargeback(payload);
  const chargebackStatus = String(
    chargeback.chargeback_status ||
    chargeback.dispute_status ||
    chargeback.status ||
    ""
  ).toUpperCase();
  const chargebackAmount = Number(
    chargeback.chargeback_amount ||
    chargeback.dispute_amount ||
    chargeback.amount ||
    0
  );
  const confirmedChargebackStatuses = new Set([
    "CHARGEBACK",
    "CHARGEBACK_ACCEPTED",
    "CONFIRMED",
    "SUCCESS",
    "LOST",
    "CLOSED",
    "RESOLVED_AGAINST_MERCHANT"
  ]);
  const fullChargeback = !chargebackAmount ||
    numbersMatch(chargebackAmount, order.amount) ||
    chargebackAmount > Number(order.amount || 0);

  if (
    (eventType.includes("CHARGEBACK") || eventType.includes("DISPUTE")) &&
    confirmedChargebackStatuses.has(chargebackStatus) &&
    fullChargeback
  ) {
    return {
      status: "chargeback",
      reason: "confirmed_chargeback",
      amount: chargebackAmount || Number(order.amount || 0),
      referenceId: String(
        chargeback.cf_chargeback_id ||
        chargeback.chargeback_id ||
        chargeback.dispute_id ||
        ""
      )
    };
  }

  return null;
}

function webhookReplayId(req, payload, orderId) {
  const refund = getWebhookRefund(payload);
  const chargeback = getWebhookChargeback(payload);
  const eventType = getWebhookEventType(payload);
  const providerEventId = String(
    payload?.event_id ||
    payload?.data?.event_id ||
    payload?.webhook_id ||
    ""
  );
  const providerReference = providerEventId ||
    String(refund.cf_refund_id || refund.refund_id || "") ||
    String(
      chargeback.cf_chargeback_id ||
      chargeback.chargeback_id ||
      chargeback.dispute_id ||
      ""
    ) ||
    getWebhookPaymentId(payload);
  const providerStatus = String(
    refund.refund_status ||
    refund.status ||
    chargeback.chargeback_status ||
    chargeback.dispute_status ||
    chargeback.status ||
    getWebhookPayment(payload).payment_status ||
    getWebhookOrder(payload).order_status ||
    ""
  ).toUpperCase();
  const fallbackBodyHash = crypto.createHash("sha256").update(getRawWebhookBody(req)).digest("hex");
  const material = providerReference
    ? `${eventType}:${orderId}:${providerReference}:${providerStatus}`
    : `${eventType}:${orderId}:${fallbackBodyHash}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

async function claimWebhookEvent(eventId, orderId, payload) {
  const eventRef = db.collection("paymentWebhookEvents").doc(eventId);
  const nowMs = Date.now();
  const claimed = await db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (eventSnap.exists) {
      const event = eventSnap.data() || {};
      if (event.status === "processed") return false;
      if (
        event.status === "processing" &&
        timestampMillis(event.processingLeaseExpiresAt) > nowMs
      ) {
        return false;
      }
    }

    transaction.set(eventRef, {
      orderId,
      eventType: getWebhookEventType(payload),
      status: "processing",
      attempts: FieldValue.increment(1),
      processingLeaseExpiresAt: Timestamp.fromMillis(nowMs + WEBHOOK_PROCESSING_LEASE_MS),
      receivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
  return { claimed, eventRef };
}

async function finishWebhookEvent(eventRef, status, errorCode = "") {
  if (!eventRef) return;
  await eventRef.set({
    status,
    errorCode,
    processingLeaseExpiresAt: Timestamp.fromMillis(0),
    processedAt: status === "processed" ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function updateOrderFromIncompleteWebhook(orderId, order, payload, normalizedStatus) {
  const payment = getWebhookPayment(payload);
  const webhookPaymentId = getWebhookPaymentId(payload);
  await db.collection("paymentOrders").doc(orderId).update({
    status: order.verified === true && order.status === "paid" ? "paid" : normalizedStatus,
    verified: order.verified === true ? true : false,
    paymentId: webhookPaymentId || order.paymentId || "",
    lastWebhookEvent: getWebhookEventType(payload),
    lastWebhookStatus: normalizedStatus,
    rawPaymentStatus: payment.payment_status || "",
    rawOrderStatus: getWebhookOrder(payload).order_status || "",
    webhookReceivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  if (normalizedStatus === "failed") {
    await updatePaymentOrderLockStatus(order, "failed", orderId);
  }
}

async function revokeCourseAccessFromWebhook(orderId, order, payload, revocation) {
  const purchaseId = purchaseDocId(order.userId, order.courseId);
  const purchaseRef = db.collection("purchases").doc(purchaseId);
  const userPurchaseRef = db
    .collection("users")
    .doc(order.userId)
    .collection("purchases")
    .doc(order.courseId);
  const enrollmentRef = db.collection("enrollments").doc(enrollmentDocId(order.userId, order.courseId));
  const orderRef = db.collection("paymentOrders").doc(orderId);
  const lockRef = paymentOrderLockRef(order.userId, order.courseId);
  const now = FieldValue.serverTimestamp();
  const auditEntry = {
    type: revocation.status,
    reason: revocation.reason,
    amount: Number(revocation.amount || 0),
    referenceId: revocation.referenceId || "",
    eventType: getWebhookEventType(payload),
    recordedAt: Timestamp.now()
  };

  await db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error("Payment order disappeared during access revocation.");
    }
    const currentOrder = orderSnap.data() || {};
    if (
      currentOrder.status === revocation.status &&
      currentOrder.lastRevocationReferenceId === revocation.referenceId
    ) {
      return;
    }

    const sharedUpdate = {
      status: revocation.status,
      accessGranted: false,
      accessRevokedAt: now,
      accessRevocationReason: revocation.reason,
      lastWebhookEvent: getWebhookEventType(payload),
      lastWebhookStatus: revocation.status,
      lastRevocationReferenceId: revocation.referenceId || "",
      revocationHistory: FieldValue.arrayUnion(auditEntry),
      updatedAt: now
    };
    transaction.set(purchaseRef, sharedUpdate, { merge: true });
    transaction.set(userPurchaseRef, {
      ...sharedUpdate,
      access: false
    }, { merge: true });
    transaction.set(enrollmentRef, {
      status: "rejected",
      accessRevoked: true,
      accessRevokedAt: now,
      accessRevocationReason: revocation.reason,
      lastRevocationReferenceId: revocation.referenceId || "",
      updatedAt: now
    }, { merge: true });
    transaction.update(orderRef, {
      ...sharedUpdate,
      verified: true,
      webhookReceivedAt: now
    });
    transaction.set(lockRef, {
      recordType: "active-course-order",
      userId: order.userId,
      courseId: order.courseId,
      activeOrderId: orderId,
      status: revocation.status,
      updatedAt: now
    }, { merge: true });
  });
}

exports.cashfreeWebhook = onRequest({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY],
  cors: false
}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const requestId = crypto.randomUUID();
  let webhookEventRef = null;
  try {
    const rawBodyBytes = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.length
      : Buffer.byteLength(String(req.rawBody || ""), "utf8");
    if (rawBodyBytes <= 0 || rawBodyBytes > WEBHOOK_MAX_BODY_BYTES) {
      res.status(413).json({ received: false, requestId, error: "invalid_payload_size" });
      return;
    }
    const sourceLimit = enforceHttpRateLimit(req, "cashfree-webhook-source", "", 120, 60 * 1000);
    if (!sourceLimit.allowed) {
      res.set("Retry-After", String(sourceLimit.retryAfterSeconds));
      res.status(429).json({ received: false, requestId, error: "rate_limited" });
      return;
    }
    assertCashfreeEnvironmentConfigured();

    if (!verifyCashfreeWebhookSignature(req)) {
      logger.warn("Cashfree webhook rejected because signature verification failed", { requestId });
      res.status(401).json({ received: false, requestId, error: "invalid_signature" });
      return;
    }

    if (!isCashfreeWebhookTimestampFresh(req)) {
      logger.warn("Cashfree webhook rejected because signed timestamp is stale", { requestId });
      res.status(401).json({ received: false, requestId, error: "stale_timestamp" });
      return;
    }

    const payload = parseWebhookPayload(req);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      res.status(400).json({ received: false, requestId, error: "invalid_payload" });
      return;
    }
    const orderId = getWebhookOrderId(payload);
    if (!orderId) {
      logger.warn("Cashfree webhook missing order id", {
        requestId,
        eventType: getWebhookEventType(payload)
      });
      res.status(400).json({ received: false, requestId, error: "missing_order_id" });
      return;
    }
    const orderLimit = enforceHttpRateLimit(
      req,
      "cashfree-webhook-order",
      orderId,
      30,
      60 * 1000
    );
    if (!orderLimit.allowed) {
      res.set("Retry-After", String(orderLimit.retryAfterSeconds));
      res.status(429).json({ received: false, requestId, error: "rate_limited" });
      return;
    }

    const orderRef = db.collection("paymentOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      logger.warn("Cashfree webhook received for unknown order", {
        requestId,
        orderId: maskIdentifier(orderId, "order")
      });
      res.status(404).json({ received: false, requestId, orderId, error: "unknown_order" });
      return;
    }

    const order = orderSnap.data() || {};
    if (order.cashfreeEnv !== "TEST" || CASHFREE_ENV !== "TEST") {
      logger.warn("Cashfree webhook rejected because environment is not TEST", {
        requestId,
        orderId: maskIdentifier(orderId, "order")
      });
      res.status(409).json({ received: false, requestId, orderId, error: "environment_mismatch" });
      return;
    }

    const webhookCourseId = getWebhookCourseId(payload);
    if (webhookCourseId && webhookCourseId !== order.courseId) {
      logger.error("Cashfree webhook course mismatch", {
        requestId,
        orderId: maskIdentifier(orderId, "order"),
        courseId: order.courseId
      });
      res.status(409).json({ received: false, requestId, orderId, error: "course_mismatch" });
      return;
    }

    const webhookUid = getWebhookUid(payload);
    if (webhookUid && webhookUid !== order.userId) {
      logger.error("Cashfree webhook uid mismatch", {
        requestId,
        orderId: maskIdentifier(orderId, "order"),
        uid: maskIdentifier(order.userId, "uid")
      });
      res.status(409).json({ received: false, requestId, orderId, error: "uid_mismatch" });
      return;
    }

    const webhookAmount = getWebhookAmount(payload);
    if (webhookAmount && !numbersMatch(webhookAmount, order.amount)) {
      logger.error("Cashfree webhook amount mismatch", {
        requestId,
        orderId: maskIdentifier(orderId, "order")
      });
      res.status(409).json({ received: false, requestId, orderId, error: "amount_mismatch" });
      return;
    }

    const webhookCurrency = getWebhookCurrency(payload, order.currency);
    if (webhookCurrency !== order.currency) {
      logger.error("Cashfree webhook currency mismatch", {
        requestId,
        orderId: maskIdentifier(orderId, "order")
      });
      res.status(409).json({ received: false, requestId, orderId, error: "currency_mismatch" });
      return;
    }

    const revocation = getConfirmedAccessRevocation(payload, order);
    if (!revocation) {
      const course = await findCourseById(order.courseId);
      if (course.courseId !== order.courseId || !numbersMatch(course.amount, order.amount)) {
        logger.error("Cashfree webhook rejected because stored course validation failed", {
          requestId,
          orderId: maskIdentifier(orderId, "order"),
          courseId: order.courseId
        });
        res.status(409).json({ received: false, requestId, orderId, error: "stored_course_mismatch" });
        return;
      }
    }

    const replay = await claimWebhookEvent(webhookReplayId(req, payload, orderId), orderId, payload);
    webhookEventRef = replay.eventRef;
    if (!replay.claimed) {
      logger.info("Cashfree webhook duplicate ignored", {
        requestId,
        orderId: maskIdentifier(orderId, "order"),
        eventType: getWebhookEventType(payload)
      });
      res.status(200).json({
        received: true,
        processed: false,
        duplicate: true,
        requestId,
        orderId
      });
      return;
    }

    if (revocation) {
      await revokeCourseAccessFromWebhook(orderId, order, payload, revocation);
      await finishWebhookEvent(webhookEventRef, "processed");
      logger.info("Cashfree webhook revoked course access", {
        requestId,
        orderId: maskIdentifier(orderId, "order"),
        uid: maskIdentifier(order.userId, "uid"),
        courseId: order.courseId,
        status: revocation.status
      });
      res.status(200).json({
        received: true,
        processed: true,
        requestId,
        orderId,
        status: revocation.status,
        accessRevoked: true
      });
      return;
    }

    const normalizedStatus = normalizeWebhookStatus(payload);
    if (normalizedStatus === "paid") {
      const purchaseId = await finalizeSuccessfulPayment(orderId, order, {
        webhook: true,
        eventType: getWebhookEventType(payload),
        orderStatus: getWebhookOrder(payload),
        payment: getWebhookPayment(payload)
      });
      await orderRef.set({
        lastWebhookEvent: getWebhookEventType(payload),
        lastWebhookStatus: normalizedStatus,
        webhookReceivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await finishWebhookEvent(webhookEventRef, "processed");
      logger.info("Cashfree webhook confirmed TEST payment", {
        requestId,
        orderId: maskIdentifier(orderId, "order"),
        purchaseId: maskIdentifier(purchaseId, "purchase"),
        uid: maskIdentifier(order.userId, "uid"),
        courseId: order.courseId
      });
      res.status(200).json({
        received: true,
        processed: true,
        requestId,
        orderId,
        status: "paid",
        purchaseId
      });
      return;
    }

    await updateOrderFromIncompleteWebhook(orderId, order, payload, normalizedStatus);
    await finishWebhookEvent(webhookEventRef, "processed");
    logger.info("Cashfree webhook recorded non-successful TEST payment state", {
      requestId,
      orderId: maskIdentifier(orderId, "order"),
      uid: maskIdentifier(order.userId, "uid"),
      courseId: order.courseId,
      status: normalizedStatus
    });
    res.status(200).json({
      received: true,
      processed: true,
      requestId,
      orderId,
      status: normalizedStatus
    });
  } catch (error) {
    await finishWebhookEvent(
      webhookEventRef,
      "failed",
      String(error.code || "processing_failed").slice(0, 80)
    ).catch(() => {});
    logger.error("Cashfree webhook processing failed", {
      requestId,
      ...safeErrorDetails(error)
    });
    res.status(500).json({ received: false, requestId, error: "webhook_processing_failed" });
  }
});
