"use strict";
// Deployment synchronization: security-hardening-2026-07-28-retry-1

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
  normalizeUpiId,
  upiFingerprint
} = require("./referral-utils");
const {
  QUIZ_SCORE_MODES,
  rankRows,
  scoreAttemptDelta,
  scorePeriodIds
} = require("./score-utils");

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
const CASHFREE_TEST_VERIFICATION_BASE_URL = "https://sandbox.cashfree.com/verification";
const CASHFREE_VERIFICATION_API_VERSION = "2024-12-01";
const PAYMENT_ORDER_CREATION_LOCK_MS = 90 * 1000;
const PAYMENT_ORDER_DEFAULT_EXPIRY_MS = 15 * 60 * 1000;
const CASHFREE_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SAFE_RESOURCE_ID_PATTERN = /^[^/\\\u0000-\u001F]{1,180}$/;
const REFERRAL_MEMBER_STATUSES = Object.freeze(["active", "banned", "closed"]);
const QUIZ_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,180}$/;

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
  if (hasExplicitPaidFlag(data)) return false;
  if (hasExplicitFreeFlag(data)) return true;
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
  const id = ex…38022 tokens truncated…aterials,
    classDescription,
    features: {
      liveQuiz: features.liveQuiz === true,
      examOrientation: features.examOrientation === true,
      confidenceBuilding: features.confidenceBuilding === true
    },
    price
  };
}

// Admin: create or update a live session (no YouTube URL at planning time)
exports.adminSaveLiveClass = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const { sessionId } = request.data || {};
  const v = validateLiveSession(request.data);
  const now = FieldValue.serverTimestamp();
  const payload = {
    classNum: v.classNum,
    stream:   v.stream,
    subject:  v.subject,
    chapter:  v.chapter,
    date:     v.date,
    time:     v.time,
    teacherName: v.teacherName,
    durationMinutes: v.durationMinutes,
    studyMaterials: v.studyMaterials,
    classDescription: v.classDescription,
    features: v.features,
    pricePaise: v.price,
    updatedAt: now,
  };
  if (sessionId) {
    await db.collection('liveClasses').doc(String(sessionId)).set(payload, { merge: true });
    return { sessionId };
  }
  payload.status    = 'planned';
  payload.questions = [];
  payload.createdAt = now;
  const ref = await db.collection('liveClasses').add(payload);
  return { sessionId: ref.id };
});

// Admin: upload JSON questions to a session
exports.adminUploadLiveQuestions = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  const questions = request.data?.questions;
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  if (!Array.isArray(questions) || questions.length === 0)
    throw new HttpsError('invalid-argument', 'questions must be a non-empty array.');
  if (questions.length > 200) throw new HttpsError('invalid-argument', 'Max 200 questions per session.');
  // Validate each question (Supports MCQ, True/False, Match Pairs, correct/correctIndex)
  for (const q of questions) {
    if (!q.text) throw new HttpsError('invalid-argument', 'Each question must have a "text" field.');
    const c = (typeof q.correct === 'number') ? q.correct : (typeof q.correctIndex === 'number' ? q.correctIndex : 0);
    q.correct = c;
    q.correctIndex = c;
    if (!q.position) q.position = 'center';
  }
  await db.collection('liveClasses').doc(sessionId).update({ questions, updatedAt: FieldValue.serverTimestamp() });
  return { count: questions.length };
});

// Admin: go live — set YouTube video ID and flip status to live
exports.adminGoLive = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  const rawUrl    = String(request.data?.youtubeUrl || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  const youtubeVideoId = extractYouTubeVideoId(rawUrl);
  if (!youtubeVideoId) throw new HttpsError('invalid-argument', 'Invalid YouTube URL or video ID.');
  await db.collection('liveClasses').doc(sessionId).update({
    status: 'live',
    youtubeVideoId,
    liveStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, youtubeVideoId };
});

// Admin: end a live session
exports.adminEndLiveClass = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  await db.collection('liveClasses').doc(sessionId).update({
    status: 'ended',
    liveEndedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Clear any active quiz
  await db.collection('liveQuizState').doc(sessionId).set({ active: false, clearedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

// Admin: delete a planned session
exports.adminDeleteLiveClass = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  await db.collection('liveClasses').doc(sessionId).delete();
  await db.collection('liveQuizState').doc(sessionId).delete().catch(() => {});
  return { ok: true };
});

// Admin: publish a quiz question to students in real-time
exports.adminPublishLiveQuiz = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId    = String(request.data?.sessionId || '').trim();
  const questionText = String(request.data?.question  || '').trim();
  const qType        = String(request.data?.type      || 'mcq').trim().toLowerCase();
  const options      = request.data?.options;
  const correctIndex = Number(request.data?.correctIndex ?? request.data?.correct ?? -1);
  const pairs        = request.data?.pairs;
  const timeLimit    = Number(request.data?.timeLimit) || 30;
  const position     = String(request.data?.position  || 'center').trim().toLowerCase();
  const streamTimeInput = request.data?.streamTime;
  const requestedStreamTime = streamTimeInput === null || streamTimeInput === undefined || streamTimeInput === ''
    ? Number.NaN
    : Number(streamTimeInput);
  const requestedOffsetMs = Number(request.data?.offsetMs ?? 500);
  const requestedTimingSource = String(request.data?.timingSource || '').trim();

  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  if (!questionText) throw new HttpsError('invalid-argument', 'question text required.');
  if (!Number.isFinite(requestedOffsetMs) || requestedOffsetMs < 0 || requestedOffsetMs > 10000)
    throw new HttpsError('invalid-argument', 'offsetMs must be between 0 and 10000.');

  const allowed = [5,10,20,30,60,90,120];
  if (!allowed.includes(timeLimit)) throw new HttpsError('invalid-argument', 'Invalid timeLimit.');

  let qObj = { text: questionText, type: qType, timeLimit, position };

  if (qType === 'mcq') {
    if (!Array.isArray(options) || options.length < 2 || options.length > 4)
      throw new HttpsError('invalid-argument', 'MCQ options must be an array of 2-4 items.');
    if (correctIndex < 0 || correctIndex >= options.length)
      throw new HttpsError('invalid-argument', 'correctIndex out of range.');
    qObj.options = options.map(o => String(o));
    qObj.correctIndex = correctIndex;
  } else if (qType === 'tf') {
    qObj.options = ['TRUE (सही)', 'FALSE (गलत)'];
    qObj.correctIndex = (correctIndex === 0) ? 0 : 1;
  } else if (qType === 'match') {
    if (!Array.isArray(pairs) || pairs.length < 2)
      throw new HttpsError('invalid-argument', 'Matching pairs must have at least 2 items.');
    qObj.pairs = pairs;
  }

  const sessionRef = db.collection('liveClasses').doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Live session not found.');
  const session = sessionSnap.data();
  if (session.status !== 'live') throw new HttpsError('failed-precondition', 'The selected session is not live.');

  const serverNowMs = Date.now();
  const liveStartedMs = session.liveStartedAt?.toMillis?.();
  const serverElapsed = Number.isFinite(liveStartedMs) ? Math.max(0, (serverNowMs - liveStartedMs) / 1000) : null;
  const hasPlayerStreamTime = Number.isFinite(requestedStreamTime) && requestedStreamTime >= 0;
  const streamTime = hasPlayerStreamTime ? requestedStreamTime : serverElapsed;
  if (!Number.isFinite(streamTime)) {
    throw new HttpsError('failed-precondition', 'Live media clock is not ready. Please retry in a moment.');
  }
  const timingSource = hasPlayerStreamTime
    ? (['youtube-live-duration', 'youtube-player-current-time'].includes(requestedTimingSource) ? requestedTimingSource : 'youtube-player')
    : 'server-live-start-fallback';
  const targetStreamTime = streamTime + requestedOffsetMs / 1000;
  const stateRef = db.collection('liveQuizState').doc(sessionId);
  const eventRef = stateRef.collection('events').doc();
  const event = {
    eventId: eventRef.id,
    sessionId,
    type: 'quiz',
    payload: qObj,
    question: qObj,
    streamTime,
    offsetMs: requestedOffsetMs,
    targetStreamTime,
    timingSource,
    quizPlaybackMode: 'continue-live',
    status: 'published',
    createdAt: FieldValue.serverTimestamp(),
    version: 1,
  };
  const batch = db.batch();
  batch.set(eventRef, event);
  batch.set(stateRef, {
    active: true,
    activeEventId: eventRef.id,
    question: qObj,
    streamTime,
    offsetMs: requestedOffsetMs,
    targetStreamTime,
    timingSource,
    publishedAt: FieldValue.serverTimestamp(),
    sessionId,
    version: 1,
  }, { merge: true });
  await batch.commit();
  return { ok: true, eventId: eventRef.id, streamTime, offsetMs: requestedOffsetMs, targetStreamTime, timingSource };
});

// Admin: clear the active quiz
exports.adminClearLiveQuiz = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  const stateRef = db.collection('liveQuizState').doc(sessionId);
  const stateSnap = await stateRef.get();
  const activeEventId = String(stateSnap.data()?.activeEventId || '').trim();
  const batch = db.batch();
  batch.set(stateRef, { active: false, activeEventId: null, clearedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (activeEventId && SAFE_RESOURCE_ID_PATTERN.test(activeEventId)) {
    batch.set(stateRef.collection('events').doc(activeEventId), {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return { ok: true };
});

// Student: record safe synchronization diagnostics after access has already been verified.
exports.recordLiveQuizSync = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  enforceCallableRateLimit(request, 'record-live-quiz-sync', 120, 60 * 1000);
  const sessionId = validatedResourceId(request.data?.sessionId, 'sessionId');
  const eventId = validatedResourceId(request.data?.eventId, 'eventId');
  const state = validatedText(request.data?.state, 'state', {
    required: true,
    maxLength: 20,
    pattern: /^(displayed|answered|completed|missed)$/
  });
  const eventRef = db.collection('liveQuizState').doc(sessionId).collection('events').doc(eventId);
  const registrationRef = db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid);
  const [eventSnap, registrationSnap] = await Promise.all([eventRef.get(), registrationRef.get()]);
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Live quiz event not found.');
  if (!isAdminAuth(auth) && !registrationSnap.exists) throw new HttpsError('permission-denied', 'Live session access is required.');

  const finiteOrNull = (value, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const diagnostic = {
    eventId,
    sessionId,
    uid: auth.uid,
    state,
    receivedAtMs: finiteOrNull(request.data?.receivedAtMs, 0, Number.MAX_SAFE_INTEGER),
    receivedPlaybackTime: finiteOrNull(request.data?.receivedPlaybackTime, 0, 864000),
    actualDisplayStreamTime: finiteOrNull(request.data?.actualDisplayStreamTime, 0, 864000),
    estimatedLiveLatency: finiteOrNull(request.data?.estimatedLiveLatency, 0, 86400),
    syncErrorMs: finiteOrNull(request.data?.syncErrorMs, -600000, 600000),
    playerState: finiteOrNull(request.data?.playerState, -1, 10),
    buffering: request.data?.buffering === true,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('liveQuizDiagnostics').doc(sessionId)
    .collection('students').doc(auth.uid)
    .collection('events').doc(eventId)
    .set(diagnostic, { merge: true });
  return { ok: true };
});

// Admin: list all sessions
exports.adminListLiveSessions = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const snap = await db.collection('liveClasses').get();
  const sessions = snap.docs.map(d => ({
    sessionId: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null,
    liveStartedAt: d.data().liveStartedAt?.toDate?.()?.toISOString() || null
  })).sort((a,b) => String(b.date || '' + b.time || '').localeCompare(String(a.date || '' + a.time || '')));
  return { sessions };
});

// Public: list planned + live sessions for students (no youtubeVideoId exposed)
exports.getPlannedLiveSessions = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const snap = await db.collection('liveClasses').where('status', 'in', ['planned','live']).get();
  const sessions = snap.docs.map(d => {
    const data = d.data();
    return {
      sessionId:  d.id,
      classNum:   data.classNum,
      stream:     data.stream || '',
      subject:    data.subject,
      chapter:    data.chapter || '',
      date:       data.date,
      time:       data.time,
      teacherName: data.teacherName || '',
      durationMinutes: Number(data.durationMinutes || 0),
      studyMaterials: data.studyMaterials || '',
      classDescription: data.classDescription || '',
      features: {
        liveQuiz: data.features?.liveQuiz === true,
        examOrientation: data.features?.examOrientation === true,
        confidenceBuilding: data.features?.confidenceBuilding === true
      },
      pricePaise: data.pricePaise || 0,
      status:     data.status,
    };
  }).sort((a,b) => String(a.date || '' + a.time || '').localeCompare(String(b.date || '' + b.time || '')));
  return { sessions };
});

// Student: register (free) or get payment order (paid)
exports.registerForLiveClass = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  const sessionSnap = await db.collection('liveClasses').doc(sessionId).get();
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
  const session = sessionSnap.data();
  if (!['planned','live'].includes(session.status))
    throw new HttpsError('failed-precondition', 'This session has ended.');
  // Check if already registered
  const regRef = db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid);
  const existing = await regRef.get();
  if (existing.exists && existing.data()?.access !== false) {
    return { registered: true, alreadyRegistered: true };
  }
  if ((session.pricePaise || 0) === 0) {
    // Free — register immediately
    await regRef.set({ uid: auth.uid, email: auth.token?.email || '', access: true, joinedAt: FieldValue.serverTimestamp(), paidPaise: 0 });
    return { registered: true, free: true };
  }
  // Paid — return session info for Cashfree order (frontend calls createCashfreeOrder with liveSessionId)
  return { registered: false, requiresPayment: true, pricePaise: session.pricePaise, sessionId };
});

// Confirm live class registration after payment
exports.confirmLiveClassRegistration = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ['sessionId', 'orderId'],
    requiredKeys: ['sessionId', 'orderId'],
    maxBytes: 512
  });
  const sessionId = validatedResourceId(data.sessionId, 'sessionId');
  const orderId = validatedResourceId(data.orderId, 'orderId');
  // Verify payment order is paid via existing payments collection
  const orderSnap = await db.collection('paymentOrders').doc(orderId).get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Payment order not found.');
  const order = orderSnap.data();
  if (order.status !== 'paid') throw new HttpsError('failed-precondition', 'Payment not confirmed.');
  if (order.userId !== auth.uid) throw new HttpsError('permission-denied', 'Order does not belong to this user.');
  if (!isLiveClassPaymentOrder(order) || order.liveSessionId !== sessionId) {
    throw new HttpsError('failed-precondition', 'Payment does not belong to this live class.');
  }
  const regRef = db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid);
  await regRef.set({
    uid: auth.uid,
    email: auth.token?.email || '',
    sessionId,
    orderId,
    access: true,
    paymentStatus: 'paid',
    paidPaise: Number(order.liveClassPricePaise || Math.round(Number(order.amount || 0) * 100)),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { registered: true };
});

// Student: get YouTube video ID — only if registered
exports.getPlayerAccess = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  
  const userEmail = (auth.token?.email || '').toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(userEmail);

  const [sessionSnap, regSnap] = await Promise.all([
    db.collection('liveClasses').doc(sessionId).get(),
    db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid).get(),
  ]);
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
  const session = sessionSnap.data();
  const registrationActive = regSnap.exists && regSnap.data()?.access !== false;
  if (!isAdmin && !registrationActive) throw new HttpsError('permission-denied', 'You are not registered for this session.');
  if (session.status === 'ended' && !isAdmin) throw new HttpsError('failed-precondition', 'This session has ended.');
  if (!session.youtubeVideoId) throw new HttpsError('failed-precondition', 'Stream not started yet. Please try again in a moment.');
  return { youtubeVideoId: session.youtubeVideoId, status: session.status, isAdmin };
});

// Student: Register interest / request an unplanned live class chapter
exports.registerUnplannedLiveClassInterest = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const classNum = String(request.data?.classNum || '').trim();
  const stream   = String(request.data?.stream   || '').trim();
  const subject  = String(request.data?.subject  || '').trim();
  const chapter  = String(request.data?.chapter  || '').trim();
  const email    = String(request.data?.email    || auth.token?.email || '').trim();
  const name     = String(request.data?.name     || auth.token?.name  || '').trim();

  if (!classNum || !subject || !chapter) {
    throw new HttpsError('invalid-argument', 'classNum, subject, and chapter are required.');
  }

  const requestId = `${auth.uid}_${classNum}_${subject}_${chapter}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  await db.collection('liveClassRequests').doc(requestId).set({
    uid: auth.uid,
    email,
    name,
    classNum,
    stream,
    subject,
    chapter,
    requestedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Unplanned Live Class Interest Registered", { uid: auth.uid, email, classNum, subject, chapter });
  return { registered: true, requestId };
});

