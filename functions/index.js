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
      logger.info("[THUMB_STORAGE_UPLOAD_COMPLETE]", { courseId, quality, target: "course", path });
      return { storageUrl, quality, storagePath: path, contentType };
    } catch (error) {
      lastError = error;
      logger.warn("[THUMB_PIPELINE_FAILED]", {
        courseId,
        quality,
        target: "course",
        stage: "course-fetch-or-upload",
        ...safeErrorDetails(error)
      });
    }
  }
  throw new Error(lastError?.message || "youtube_course_thumbnail_unavailable");
}

function contentCourseId(docId, data) {
  if (data.courseId) return String(data.courseId);
  if (data.playlistId) return `legacy_playlist_${data.playlistId}`;
  return `legacy_single_${docId}`;
}

function existingCourseThumbnail(data, protectedVideoId = "") {
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
    data.imageUrl
  ];
  return candidates.find((candidate) => isPublicThumbnailCandidate(candidate, protectedVideoId)) || "";
}

function needsThumbnailRepair(data, protectedVideoId = "") {
  const thumbnail = data.thumbnailUrl || "";
  return !isFirebaseStorageThumbnailUrl(thumbnail) || thumbnailLeaksVideoId(thumbnail, protectedVideoId);
}

function contentToPublicCourses(items) {
  const groups = {};
  items.forEach((data) => {
    if (data.active === false) return;
    const contentType = data.contentType || (data.type === "playlist" || data.playlistId ? "playlist" : "single");
    const legacyGroupId = data.playlistId ? `legacy_playlist_${data.playlistId}` : `legacy_single_${data.id}`;
    const key = String(data.courseId || legacyGroupId);
    const videoSource = resolveProtectedVideoSource(data, data.id);
    const fullVideoId = videoSource.videoId;
    const generatedThumb = youtubeThumbnailUrl(fullVideoId);
    const courseThumb = publicContentThumbnail(data, fullVideoId) || generatedThumb;
    const lessonThumb = publicLessonThumbnail(data, fullVideoId) || generatedThumb || courseThumb;
    if (!lessonThumb) {
      logger.warn("[IdeaKDC thumbnail] lesson thumbnail unresolved", {
        courseId: key,
        contentId: data.id,
        lessonPosition: Number(data.orderIndex ?? data.sequenceNumber ?? 0) + 1,
        contentType,
        reason: fullVideoId ? "thumbnail-url-not-generated" : "missing-video-id-source"
      });
    }
    const faqs = normalizeFaqs(data);
    const itemIsFree = isContentFree(data);
    const itemPrice = normalizedContentPrice(data);
    if (!groups[key]) {
      groups[key] = {
        id: key,
        courseId: key,
        legacyAccessId: groupIdForContent(data),
        courseType: data.courseType || (contentType === "playlist" ? "playlist" : "single"),
        classNum: data.classNum || "",
        stream: data.stream || "",
        subject: data.subject || "",
        name: data.courseTitle || data.title || `Class ${data.classNum || ""} - ${data.subject || "Course"}`.trim(),
        tag: data.stream ? `Class ${data.classNum || ""}` : `Class ${data.classNum || ""}`,
        desc: data.description || data.desc || "",
        price: itemPrice,
        isFree: itemIsFree,
        free: itemIsFree,
        paymentRequired: !itemIsFree,
        accessType: itemIsFree ? "free" : "paid",
        thumbnailUrl: courseThumb || lessonThumb,
        courseThumbnailUrl: courseThumb || lessonThumb,
        videoCount: Number(data.videoCount || 0),
        contentType,
        faqs,
        videos: []
      };
    }
    if (!groups[key].courseThumbnailUrl && (courseThumb || lessonThumb)) groups[key].courseThumbnailUrl = courseThumb || lessonThumb;
    if (!groups[key].thumbnailUrl && (courseThumb || lessonThumb)) groups[key].thumbnailUrl = courseThumb || lessonThumb;
    if (!groups[key].faqs.length && faqs.length) groups[key].faqs = faqs;
    if (contentType === "playlist") groups[key].contentType = "playlist";
    if (Number(data.videoCount || 0) > groups[key].videoCount) groups[key].videoCount = Number(data.videoCount || 0);
    if (!itemIsFree) {
      groups[key].isFree = false;
      groups[key].free = false;
      groups[key].paymentRequired = true;
      groups[key].accessType = "paid";
      groups[key].price = itemPrice;
    } else if (groups[key].isFree !== false) {
      groups[key].isFree = true;
      groups[key].free = true;
      groups[key].paymentRequired = false;
      groups[key].accessType = "free";
      groups[key].price = 0;
    }
    groups[key].videos.push({
      contentId: data.id,
      lessonId: data.id,
      title: data.title || "",
      desc: data.description || data.desc || "",
      dur: data.dur || data.duration || "",
      durationSeconds: Number(data.durationSeconds || 0),
      thumbnailUrl: lessonThumb || courseThumb,
      thumbnailVideoId: fullVideoId,
      thumbnailSourceField: videoSource.sourceField || "",
      hasProtectedVideo: !!fullVideoId,
      playlistId: "",
      hasProtectedPlaylist: !!data.playlistId,
      playlistTitle: data.playlistTitle || data.playlistName || "",
      playlistDesc: data.playlistDescription || "",
      videoCount: Number(data.videoCount || 0),
      contentType,
      chapter: data.chapter || "",
      topic: data.topic || "",
      isFree: itemIsFree,
      free: itemIsFree,
      price: itemPrice,
      paymentRequired: !itemIsFree,
      accessType: itemIsFree ? "free" : "paid",
      quizMode: normalizeLessonQuizMode(data),
      separateQuizQuestionCount: Number(data.separateQuiz?.questionCount || 0),
      quizConfig: publicQuizConfig(data.quizConfig || {}),
      orderIndex: Number.isFinite(Number(data.orderIndex)) ? Number(data.orderIndex) : 999999,
      sequenceNumber: Number.isFinite(Number(data.sequenceNumber)) ? Number(data.sequenceNumber) : 999999,
      createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0
    });
  });
  return Object.values(groups).map((course) => {
    course.videos.sort((a, b) => {
      if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.createdAtMs - b.createdAtMs;
    });
    if (!course.videoCount) course.videoCount = course.videos.length;
    return course;
  });
}

async function findCourseById(courseId) {
  const normalizedCourseId = normalizeCourseId(courseId);
  if (!normalizedCourseId) {
    throw new HttpsError("invalid-argument", "Valid courseId is required.");
  }

  const courseDoc = await db.collection("courses").doc(normalizedCourseId).get();
  if (courseDoc.exists) {
    const data = courseDoc.data() || {};
    if (data.active === false) {
      throw new HttpsError("failed-precondition", "This course is not active.");
    }
    return {
      courseId: normalizedCourseId,
      title: data.title || data.name || normalizedCourseId,
      amount: normalizedContentPrice(data),
      currency: data.currency || "INR",
      source: "courses"
    };
  }

  // Existing website currently builds course cards by grouping content records.
  // This fallback validates those generated course ids without requiring a data migration.
  const contentSnap = await db.collection("content").get();
  let matched = null;
  contentSnap.forEach((doc) => {
    if (matched) return;
    const data = doc.data() || {};
    const legacyId = data.playlistId ? `legacy_playlist_${data.playlistId}` : `legacy_single_${doc.id}`;
    if (data.courseId === normalizedCourseId || legacyId === normalizedCourseId || groupIdForContent(data) === normalizedCourseId) {
      matched = data;
    }
  });

  if (!matched) {
    throw new HttpsError("not-found", "Course was not found.");
  }

  return {
    courseId: normalizedCourseId,
    title: `Class ${matched.classNum || ""} - ${matched.subject || "Course"}`.trim(),
    amount: normalizedContentPrice(matched),
    currency: "INR",
    source: "content"
  };
}

async function hasCourseAccess(uid, courseId, auth) {
  if (isAdminAuth(auth)) return true;
  if (!uid || !courseId) return false;
  const purchaseSnap = await db
    .collection("users")
    .doc(uid)
    .collection("purchases")
    .doc(courseId)
    .get();
  return purchaseSnap.exists && purchaseSnap.data()?.access === true;
}

async function loadCourseContentDocs(courseId) {
  const normalizedCourseId = normalizeCourseId(courseId);
  if (!normalizedCourseId) return [];
  const directSnap = await db.collection("content").where("courseId", "==", normalizedCourseId).get();
  let docs = directSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (docs.length) return docs;

  // Legacy cards sometimes use class/stream/subject as generated ids.
  const allSnap = await db.collection("content").get();
  docs = [];
  allSnap.forEach((doc) => {
    const data = doc.data() || {};
    const legacyId = data.playlistId ? `legacy_playlist_${data.playlistId}` : `legacy_single_${doc.id}`;
    if (legacyId === normalizedCourseId || groupIdForContent(data) === normalizedCourseId) {
      docs.push({ id: doc.id, ...data });
    }
  });
  return docs;
}

function isCourseFreeFromDocs(docs) {
  if (!docs.length) return false;
  return docs.every((doc) => isContentFree(doc));
}

function lessonPlayableWithoutPurchase(lesson, docs, index) {
  if (isCourseFreeFromDocs(docs)) return true;
  return isContentFree(lesson);
}

function publicQuizConfig(config = {}) {
  const separateEnabled = config?.separateQuiz?.enabled === true;
  const popupEnabled = config?.popupQuiz?.enabled === true;
  return {
    separateQuiz: {
      enabled: separateEnabled,
      questionSetId: separateEnabled ? String(config.separateQuiz.questionSetId || "separate") : ""
    },
    popupQuiz: {
      enabled: popupEnabled,
      questionSetId: popupEnabled ? String(config.popupQuiz.questionSetId || "popup") : "",
      requireAnswer: config?.popupQuiz?.requireAnswer !== false,
      soundEnabled: config?.popupQuiz?.soundEnabled !== false,
      timestamps: Array.isArray(config?.popupQuiz?.timestamps)
        ? config.popupQuiz.timestamps
            .map((item) => ({
              questionId: String(item.questionId || ""),
              timeSeconds: Number(item.timeSeconds)
            }))
            .filter((item) => item.questionId && Number.isFinite(item.timeSeconds) && item.timeSeconds >= 0)
            .sort((a, b) => a.timeSeconds - b.timeSeconds)
        : []
    }
  };
}

function localizedQuizText(value) {
  if (typeof value === "string") return { en: value, hi: "" };
  if (value && typeof value === "object") {
    return {
      en: String(value.en || value.text || value.value || ""),
      hi: String(value.hi || "")
    };
  }
  return { en: "", hi: "" };
}

function visibleQuizText(value) {
  const normalized = localizedQuizText(value);
  return normalized.en || normalized.hi || "";
}

function normalizeLessonQuizMode(lesson = {}) {
  if (["none", "separate", "popup"].includes(lesson.quizMode)) return lesson.quizMode;
  if (lesson.quizConfig?.popupQuiz?.enabled === true && lesson.quizConfig?.popupQuiz?.timestamps?.length) return "popup";
  if (lesson.quizConfig?.separateQuiz?.enabled === true || lesson.separateQuiz || lesson.separateQuizRef) return "separate";
  return "none";
}

function normalizeQuizMatchValue(value = "") {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getQuizOptionId(option = {}, index = 0) {
  const rawId = option.id ?? option.key ?? option.optionId ?? option.value;
  const fallback = ["A", "B", "C", "D"][index] || String(index + 1);
  return String(rawId || fallback).trim();
}

function quizCorrectCandidateValue(value) {
  if (value && typeof value === "object") {
    return value.id ?? value.key ?? value.optionId ?? value.value ?? value.text ?? value.en ?? value.hi ?? "";
  }
  return value;
}

function quizOptionTextValues(option = {}) {
  const pair = localizedQuizText(option);
  return [
    option.id,
    option.key,
    option.optionId,
    option.value,
    option.text,
    option.label,
    option.en,
    option.hi,
    pair.en,
    pair.hi
  ].filter((value) => String(value ?? "").trim());
}

function resolveQuizCorrectOptionId(question = {}) {
  const options = Array.isArray(question.options) ? question.options : [];
  const renderedOptions = options.map((option, index) => ({
    option,
    index,
    optionId: getQuizOptionId(option, index)
  }));
  const candidateFields = [
    ["correctOption", question.correctOption],
    ["correctAnswer", question.correctAnswer],
    ["answer", question.answer],
    ["correct", question.correct],
    ["correct_option", question.correct_option],
    ["correctOptionIndex", question.correctOptionIndex],
    ["correctAnswerIndex", question.correctAnswerIndex],
    ["correctIndex", question.correctIndex]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  for (const [sourceField, sourceValue] of candidateFields) {
    const raw = String(quizCorrectCandidateValue(sourceValue)).trim();
    const normalizedRaw = normalizeQuizMatchValue(raw);
    const exactId = renderedOptions.find((item) => normalizeQuizMatchValue(item.optionId) === normalizedRaw);
    if (exactId) return { optionId: exactId.optionId, sourceField, sourceValue, format: "option-id" };

    const upper = raw.toUpperCase();
    if (/^[A-D]$/.test(upper)) {
      const alphaOption = renderedOptions[upper.charCodeAt(0) - 65];
      if (alphaOption) return { optionId: alphaOption.optionId, sourceField, sourceValue, format: "letter-index" };
    }

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      const shouldPreferZeroBased = sourceField.toLowerCase().includes("index") || numeric === 0;
      const zeroBased = renderedOptions[numeric];
      const oneBased = renderedOptions[numeric - 1];
      if (shouldPreferZeroBased && numeric >= 0 && numeric <= 3 && zeroBased) {
        return { optionId: zeroBased.optionId, sourceField, sourceValue, format: "zero-based-index" };
      }
      if (numeric >= 1 && numeric <= 4 && oneBased) {
        return { optionId: oneBased.optionId, sourceField, sourceValue, format: "one-based-index" };
      }
      if (numeric >= 0 && numeric <= 3 && zeroBased) {
        return { optionId: zeroBased.optionId, sourceField, sourceValue, format: "zero-based-index" };
      }
    }

    const textMatch = renderedOptions.find((item) =>
      quizOptionTextValues(item.option).some((value) => normalizeQuizMatchValue(value) === normalizedRaw)
    );
    if (textMatch) return { optionId: textMatch.optionId, sourceField, sourceValue, format: "option-text" };
  }

  const booleanCorrectOption = renderedOptions.find((item) => item.option?.correct === true || item.option?.isCorrect === true);
  if (booleanCorrectOption) return { optionId: booleanCorrectOption.optionId, sourceField: "option.correct", sourceValue: true, format: "option-flag" };

  logger.warn("Quiz correct option could not be resolved", {
    questionId: question.id || "",
    optionIds: renderedOptions.map((item) => item.optionId),
    correctOption: question.correctOption ?? "",
    correctAnswer: question.correctAnswer ?? "",
    answer: question.answer ?? "",
    correct: question.correct ?? ""
  });
  return { optionId: "", sourceField: "", sourceValue: "", format: "unresolved" };
}

function sanitizeQuizQuestion(question = {}) {
  const normalizedOptions = Array.isArray(question.options)
    ? question.options.map((option, index) => {
        if (typeof option === "string") {
          return { id: String.fromCharCode(65 + index), en: option, hi: "" };
        }
        return {
          id: getQuizOptionId(option, index),
          key: option.key ? String(option.key) : "",
          value: option.value ? String(option.value) : "",
          en: String(option.en || option.text || option.value || ""),
          hi: String(option.hi || "")
        };
      }).filter((option) => option.id && (option.en || option.hi))
    : [];
  const correctResolution = resolveQuizCorrectOptionId({ ...question, options: normalizedOptions });
  return {
    id: String(question.id || ""),
    question: localizedQuizText(question.question || question.q || ""),
    options: normalizedOptions.map(({ id, en, hi }) => ({ id, en, hi })),
    correctOption: correctResolution.optionId,
    feedback: {
      correct: localizedQuizText(question.feedback?.correct || "Correct."),
      incorrect: localizedQuizText(question.feedback?.incorrect || "Please try again.")
    }
  };
}

async function findQuizQuestionSet(lesson = {}, mode = "separate", lessonId = "") {
  const config = publicQuizConfig(lesson.quizConfig || {});
  const setId = mode === "popup"
    ? config.popupQuiz.questionSetId || "popup"
    : config.separateQuiz.questionSetId || "separate";
  const sets = lesson.quizQuestionSets || {};
  if (mode === "separate" && lessonId) {
    const protectedSnap = await db.doc(`content/${lessonId}/quizzes/separate`).get();
    if (protectedSnap.exists) {
      const protectedQuiz = protectedSnap.data() || {};
      if (Array.isArray(protectedQuiz.questions)) {
        return {
          id: setId,
          title: String(protectedQuiz.title || "Lesson Quiz"),
          questions: protectedQuiz.questions
        };
      }
    }
  }
  const legacySeparate = mode === "separate" && Array.isArray(lesson.separateQuiz?.questions)
    ? { title: lesson.separateQuiz.title || "Lesson Quiz", questions: lesson.separateQuiz.questions }
    : null;
  const set = sets[setId] || sets[mode] || legacySeparate || null;
  if (!set || !Array.isArray(set.questions)) return null;
  return { id: setId, title: String(set.title || "Lesson Quiz"), questions: set.questions };
}

function safeQuizAnswerKey(value = "") {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "question";
}

exports.getPublicCourseCatalogue = onCall(callableOptions({
  region: "asia-south1"
}), async (request) => {
  validatedCallableData(request, { allowedKeys: [], maxBytes: 256 });
  enforceCallableRateLimit(request, "public-catalogue", 120, 60 * 1000);
  const snap = await db.collection("content").orderBy("createdAt", "desc").get();
  const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const courses = contentToPublicCourses(items).map((course) => {
    const { courseThumbnailUrl, ...publicCourse } = course;
    return {
      ...publicCourse,
      thumbnailUrl: normalizeImageUrl(course.thumbnailUrl || courseThumbnailUrl || "")
    };
  });
  logger.info("Public sanitized course catalogue served", {
    courseCount: courses.length
  });
  return { courses };
});

function safeDiagnosticUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (isDirectYoutubeThumbnailHost(parsed.hostname) || /youtube\.com$|youtube-nocookie\.com$|youtu\.be$/i.test(parsed.hostname)) {
      return "[direct-youtube-thumbnail-redacted]";
    }
    if (parsed.searchParams.has("token")) parsed.searchParams.set("token", "[redacted]");
    return parsed.toString();
  } catch (error) {
    return raw.length > 160 ? `${raw.slice(0, 80)}...[truncated]` : raw;
  }
}

function hasRawYoutubeThumbnailUrl(data = {}) {
  const fields = [
    data.courseThumbnailUrl,
    data.thumbnailUrl,
    data.thumbnail,
    data.image,
    data.poster,
    data.previewThumbnailUrl,
    data.imageUrl,
    data.youtubeThumbnail,
    data.videoThumbnail,
    data.videoThumb,
    data.thumb
  ];
  return fields.some((value) => {
    try {
      const parsed = new URL(String(value || "").trim());
      return isDirectYoutubeThumbnailHost(parsed.hostname);
    } catch (error) {
      return false;
    }
  });
}

function thumbnailStoragePath(value = "") {
  try {
    const parsed = new URL(String(value || ""));
    const marker = "/o/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return "";
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch (error) {
    return "";
  }
}

function thumbnailDiagnosticFields(item = {}) {
  const source = resolveProtectedVideoSource(item, item.id || "");
  const protectedVideoId = source.videoId;
  const candidates = [
    ["courseThumbnailUrl", item.courseThumbnailUrl],
    ["thumbnailUrl", item.thumbnailUrl],
    ["thumbnail", item.thumbnail],
    ["image", item.image || item.imageUrl],
    ["poster", item.poster],
    ["previewThumbnailUrl", item.previewThumbnailUrl]
  ];
  for (const [field, value] of candidates) {
    const normalized = normalizeImageUrl(value || "");
    if (normalized && !thumbnailLeaksVideoId(normalized, protectedVideoId)) {
      return { resolvedField: field, resolvedUrl: normalized, source };
    }
  }
  return { resolvedField: "", resolvedUrl: "", source };
}

async function testThumbnailUrlServer(url = "") {
  const normalized = normalizeImageUrl(url);
  const storagePath = thumbnailStoragePath(normalized);
  const result = {
    httpStatus: 0,
    contentType: "",
    imageOk: false,
    failureReason: normalized ? "" : "missing-or-unsupported-url",
    storagePath,
    storageRuleExpectedPublic: storagePath.startsWith("course-thumbnails/")
  };
  if (!normalized) return result;
  try {
    const response = await fetch(normalized, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(9000)
    });
    result.httpStatus = response.status;
    result.contentType = String(response.headers.get("content-type") || "");
    result.imageOk = response.ok && result.contentType.toLowerCase().startsWith("image/");
    if (!response.ok) result.failureReason = `http_${response.status}`;
    else if (!result.imageOk) result.failureReason = "non-image-response";
    return result;
  } catch (error) {
    result.failureReason = error?.name === "TimeoutError" ? "timeout" : (error?.message || "fetch-failed");
    return result;
  }
}

exports.diagnoseCourseThumbnails = onCall(callableOptions({
  region: "asia-south1",
  timeoutSeconds: 120,
  memory: "512MiB"
}), async (request) => {
  const auth = requireAdminAuth(request, "Only IdeaKDC admins can diagnose thumbnails.");
  validatedCallableData(request, { allowedKeys: [], maxBytes: 256 });
  enforceCallableRateLimit(request, "admin-thumbnail-diagnose", 10, 10 * 60 * 1000);

  const snap = await db.collection("content").orderBy("createdAt", "desc").get();
  const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const catalogue = contentToPublicCourses(items);
  const catalogueByCourse = new Map(catalogue.map((course) => [course.id, course]));
  const catalogueLessonById = new Map();
  catalogue.forEach((course) => {
    (course.videos || []).forEach((lesson) => {
      if (lesson.contentId) catalogueLessonById.set(lesson.contentId, lesson);
    });
  });

  const rows = [];
  for (const item of items.slice(0, 300)) {
    const courseId = contentCourseId(item.id, item);
    const diagnostic = thumbnailDiagnosticFields(item);
    const source = diagnostic.source || {};
    const test = await testThumbnailUrlServer(diagnostic.resolvedUrl);
    const catalogueCourse = catalogueByCourse.get(courseId) || {};
    const catalogueLesson = catalogueLessonById.get(item.id) || {};
    rows.push({
      path: `content/${item.id}`,
      courseId,
      documentId: item.id,
      lessonId: item.id,
      courseType: item.courseType || item.contentType || "",
      sourceField: source.sourceField || "",
      sourceValue: source.sourceValue || "",
      hasRawYoutubeThumbnail: hasRawYoutubeThumbnailUrl(item),
      youtubeUrl: item.youtubeUrl || "",
      videoUrl: item.videoUrl || "",
      url: item.url || "",
      sourceUrl: item.sourceUrl || "",
      youtubeVideoId: item.youtubeVideoId || "",
      videoId: item.videoId || "",
      playbackUrl: item.playbackUrl || "",
      embedUrl: item.embedUrl || "",
      thumbnailStatus: item.thumbnailStatus || "",
      thumbnailUrl: safeDiagnosticUrl(item.thumbnailUrl || ""),
      courseThumbnailUrl: safeDiagnosticUrl(item.courseThumbnailUrl || ""),
      thumbnail: safeDiagnosticUrl(item.thumbnail || ""),
      image: safeDiagnosticUrl(item.image || item.imageUrl || ""),
      poster: safeDiagnosticUrl(item.poster || ""),
      resolvedField: diagnostic.resolvedField,
      resolvedUrl: safeDiagnosticUrl(diagnostic.resolvedUrl),
      catalogueThumbnailUrl: safeDiagnosticUrl(catalogueCourse.thumbnailUrl || ""),
      catalogueLessonThumbnailUrl: safeDiagnosticUrl(catalogueLesson.thumbnailUrl || ""),
      httpStatus: test.httpStatus,
      contentType: test.contentType,
      imageOk: test.imageOk,
      failureReason: test.failureReason,
      storagePath: test.storagePath,
      storageRuleExpectedPublic: test.storageRuleExpectedPublic
    });
  }

  logger.info("Admin thumbnail diagnosis completed", {
    uid: maskIdentifier(auth.uid, "uid"),
    scanned: rows.length,
    missing: rows.filter((row) => !row.resolvedField).length,
    failed: rows.filter((row) => !row.imageOk).length
  });

  return {
    ok: true,
    diagnosticVersion: "thumbnail-diagnosis-v1",
    scanned: rows.length,
    rows,
    rawYoutubeUrlsRemaining: rows.filter((row) => row.hasRawYoutubeThumbnail).length
  };
});

exports.adminUploadPreflight = onCall(callableOptions({
  region: "asia-south1"
}), async (request) => {
  const auth = requireAdminAuth(request, "Only IdeaKDC admins can upload courses.");
  const data = validatedCallableData(request, {
    allowedKeys: ["expectedProjectId"],
    maxBytes: 512
  });
  enforceCallableRateLimit(request, "admin-upload-preflight", 20, 60 * 1000);

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "ideakdc-24b0b";
  const expectedProjectId = validatedText(data.expectedProjectId, "expectedProjectId", {
    maxLength: 80,
    pattern: /^[A-Za-z0-9_-]+$/
  });
  if (expectedProjectId && expectedProjectId !== projectId) {
    throw new HttpsError("failed-precondition", "Firebase project mismatch.");
  }

  if (!STORAGE_BUCKET) {
    throw new HttpsError("failed-precondition", "Firebase Storage bucket is not configured.");
  }

  // Read-only health check: do not create diagnostic Firestore or Storage resources.
  const contentProbe = await db.collection("content").limit(1).get();
  logger.info("Admin upload preflight passed", {
    uid: maskIdentifier(auth.uid, "uid"),
    email: maskEmail(auth.token?.email),
    projectId,
    storageBucket: STORAGE_BUCKET,
    contentProbeSize: contentProbe.size,
    preflightVersion: "safe-id-v2"
  });

  return {
    ok: true,
    preflightVersion: "safe-id-v2",
    projectId,
    storageBucket: STORAGE_BUCKET,
    functionsRegion: "asia-south1",
    requiredFunctions: {
      adminUploadPreflight: true,
      repairProtectedCourseThumbnails: true
    }
  };
});

exports.repairProtectedCourseThumbnails = onCall(callableOptions({
  region: "asia-south1",
  timeoutSeconds: 540,
  memory: "1GiB"
}), async (request) => {
  const auth = requireAdminAuth(request, "Only IdeaKDC admins can repair course thumbnails.");
  const data = validatedCallableData(request, {
    allowedKeys: ["contentIds"],
    maxBytes: 20 * 1024
  });
  enforceCallableRateLimit(request, "admin-thumbnail-repair", 6, 10 * 60 * 1000);

  let retryIds;
  try {
    retryIds = validateStringArray(data.contentIds, "contentIds", {
      maxItems: 100,
      itemMaxLength: 180,
      pattern: SAFE_RESOURCE_ID_PATTERN
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
  const retrySet = new Set(retryIds);
  const snap = await db.collection("content").get();
  const docs = snap.docs
    .map((doc) => ({ doc, id: doc.id, data: doc.data() || {} }))
    .filter((item) => !retrySet.size || retrySet.has(item.id));

  const stats = {
    totalScanned: docs.length,
    repaired: 0,
    alreadyValid: 0,
    failed: 0,
    needsManualUpload: 0,
    repairable: 0,
    failedRecords: []
  };

  for (const item of docs) {
    const data = item.data;
    const courseId = contentCourseId(item.id, data);
    const source = resolveProtectedVideoSource(data, item.id);
    const protectedId = source.videoId;
    logger.info("[THUMB_SOURCE_CANDIDATES]", {
      courseId,
      contentId: item.id,
      contentType: data.courseType || data.contentType || data.type || "",
      hasYoutubeVideoId: Boolean(data.youtubeVideoId),
      hasVideoId: Boolean(data.videoId),
      hasYoutubeUrl: Boolean(data.youtubeUrl),
      hasVideoUrl: Boolean(data.videoUrl),
      hasSourceUrl: Boolean(data.sourceUrl),
      hasPlaybackUrl: Boolean(data.playbackUrl),
      hasEmbedUrl: Boolean(data.embedUrl),
      hasUrl: Boolean(data.url),
      lessonIdLooksLikeYoutubeId: YOUTUBE_ID_PATTERN.test(String(data.lessonId || "")),
      documentIdLooksLikeYoutubeId: YOUTUBE_ID_PATTERN.test(String(item.id || ""))
    });

    const current = normalizeImageUrl(data.thumbnailUrl || "");
    const currentCourse = normalizeImageUrl(data.courseThumbnailUrl || "");
    if (current && currentCourse) {
      stats.alreadyValid++;
      continue;
    }

    if (!protectedId) {
      stats.needsManualUpload++;
      stats.failedRecords.push({ contentId: item.id, courseId, reason: "missing_youtube_video_id" });
      continue;
    }

    logger.info("[THUMB_SOURCE_RESOLVED]", {
      courseId,
      contentId: item.id,
      sourceField: source.sourceField,
      sourceValue: maskIdentifier(source.sourceValue, "video")
    });

    const generatedThumbnail = youtubeThumbnailUrl(protectedId);
    if (!generatedThumbnail) {
      stats.failed++;
      stats.failedRecords.push({ contentId: item.id, courseId, reason: "youtube_thumbnail_url_failed" });
      continue;
    }

    const updates = {
      thumbnailRepairedAt: FieldValue.serverTimestamp(),
      thumbnailRepairSource: "youtube-direct-url",
      thumbnailStatus: "ready"
    };
    if (shouldReplaceThumbnail(data.thumbnailUrl)) updates.thumbnailUrl = generatedThumbnail;
    if (shouldReplaceThumbnail(data.courseThumbnailUrl)) updates.courseThumbnailUrl = generatedThumbnail;

    await item.doc.ref.set(updates, { merge: true });
    logger.info("[THUMB_FIRESTORE_WRITE_COMPLETE]", {
      courseId,
      contentId: item.id,
      sourceField: source.sourceField,
      thumbnailStatus: "ready"
    });
    stats.repaired++;
    stats.repairable++;
  }

  const courseUpdates = new Map();
  for (const item of docs) {
    const data = item.data;
    const courseId = contentCourseId(item.id, data);
    if (courseUpdates.has(courseId)) continue;
    const source = resolveProtectedVideoSource(data, item.id);
    const thumbnail = normalizeImageUrl(data.courseThumbnailUrl || data.thumbnailUrl || "") || youtubeThumbnailUrl(source.videoId);
    if (thumbnail) courseUpdates.set(courseId, thumbnail);
  }
  for (const [courseId, thumbnail] of courseUpdates.entries()) {
    const courseRef = db.collection("courses").doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) continue;
    const courseData = courseSnap.data() || {};
    if (!normalizeImageUrl(courseData.thumbnailUrl || "")) {
      await courseRef.set({
        thumbnailUrl: thumbnail,
        courseThumbnailUrl: courseData.courseThumbnailUrl || thumbnail,
        thumbnailRepairedAt: FieldValue.serverTimestamp(),
        thumbnailRepairSource: "youtube-direct-url",
        thumbnailStatus: "ready"
      }, { merge: true });
    }
  }

  logger.info("Protected course thumbnail repair completed", {
    uid: maskIdentifier(auth.uid, "uid"),
    totalScanned: stats.totalScanned,
    repaired: stats.repaired,
    alreadyValid: stats.alreadyValid,
    failed: stats.failed,
    needsManualUpload: stats.needsManualUpload
  });
  return stats;
});

exports.getAuthorizedLessonVideo = onCall(callableOptions({
  region: "asia-south1"
}), async (request) => {
  const data = validatedCallableData(request, {
    allowedKeys: ["courseId", "lessonId"],
    requiredKeys: ["courseId", "lessonId"],
    maxBytes: 1024
  });
  enforceCallableRateLimit(request, "authorized-lesson-video", 120, 60 * 1000);
  const courseId = validatedResourceId(data.courseId, "courseId");
  const lessonId = validatedResourceId(data.lessonId, "lessonId");

  const docs = await loadCourseContentDocs(courseId);
  if (!docs.length) {
    throw new HttpsError("not-found", "Course was not found.");
  }
  docs.sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.sequenceNumber)) ? Number(a.sequenceNumber) : Number(a.orderIndex || 999999);
    const bOrder = Number.isFinite(Number(b.sequenceNumber)) ? Number(b.sequenceNumber) : Number(b.orderIndex || 999999);
    return aOrder - bOrder;
  });
  const lessonIndex = docs.findIndex((doc) => doc.id === lessonId || doc.lessonId === lessonId || doc.contentId === lessonId);
  const lesson = lessonIndex >= 0 ? docs[lessonIndex] : null;
  if (!lesson) {
    throw new HttpsError("not-found", "Lesson was not found.");
  }

  const uid = request.auth?.uid || "";
  const access = await hasCourseAccess(uid, courseId, request.auth);
  const canUsePublicLesson = lessonPlayableWithoutPurchase(lesson, docs, lessonIndex);
  const sourceValue = lesson.videoUrl || lesson.videoId || lesson.vid || lesson.youtubeVideoId || lesson.youtubeUrl || "";
  const sourceType = detectVideoSourceType(sourceValue);
  const fullVideoId = sourceType === "youtube" ? extractYouTubeVideoId(sourceValue) : "";
  const nativeVideoUrl = sourceType === "native" ? String(sourceValue).trim() : "";

  if (access || canUsePublicLesson) {
    if (!fullVideoId && !nativeVideoUrl) {
      throw new HttpsError("failed-precondition", "Playable video is not configured for this lesson.");
    }
    logger.info("Authorized full lesson video resolved", {
      uid: uid ? maskIdentifier(uid, "uid") : "anonymous",
      courseId,
      lessonId,
      access,
      freePreviewLesson: canUsePublicLesson
    });
    return {
      mode: access ? "full" : "free",
      sourceType,
      videoId: fullVideoId,
      videoUrl: nativeVideoUrl,
      title: lesson.title || "",
      allowFullPlayback: access || canUsePublicLesson
    };
  }

  throw new HttpsError("permission-denied", "This lesson is locked. Purchase is required.");
});

exports.getAuthorizedLessonQuiz = onCall(callableOptions({
  region: "asia-south1"
}), async (request) => {
  const data = validatedCallableData(request, {
    allowedKeys: ["courseId", "lessonId", "mode"],
    requiredKeys: ["courseId", "lessonId"],
    maxBytes: 1024
  });
  enforceCallableRateLimit(request, "authorized-lesson-quiz", 120, 60 * 1000);
  const courseId = validatedResourceId(data.courseId, "courseId");
  const lessonId = validatedResourceId(data.lessonId, "lessonId");
  const mode = validatedText(data.mode || "separate", "mode", {
    required: true,
    maxLength: 20,
    allowedValues: ["separate", "popup"]
  });

  const docs = await loadCourseContentDocs(courseId);
  const lessonIndex = docs.findIndex((doc) => doc.id === lessonId || doc.lessonId === lessonId || doc.contentId === lessonId);
  const lesson = lessonIndex >= 0 ? docs[lessonIndex] : null;
  if (!lesson) throw new HttpsError("not-found", "Lesson was not found.");

  const uid = request.auth?.uid || "";
  const access = await hasCourseAccess(uid, courseId, request.auth);
  const canUsePublicLesson = lessonPlayableWithoutPurchase(lesson, docs, lessonIndex);
  if (!access && !canUsePublicLesson) throw new HttpsError("permission-denied", "This lesson is locked.");

  const config = publicQuizConfig(lesson.quizConfig || {});
  const modeConfig = mode === "popup" ? config.popupQuiz : config.separateQuiz;
  if (!modeConfig.enabled && normalizeLessonQuizMode(lesson) !== mode) {
    throw new HttpsError("not-found", "Quiz is not enabled for this lesson.");
  }
  const questionSet = await findQuizQuestionSet(lesson, mode, lessonId);
  if (!questionSet) throw new HttpsError("failed-precondition", "Quiz question set is missing.");
  const questions = questionSet.questions
    .map(sanitizeQuizQuestion)
    .filter((question) => question.id && visibleQuizText(question.question) && question.options.length >= 2);
  return {
    courseId,
    lessonId,
    mode,
    title: questionSet.title,
    questions,
    popupQuiz: mode === "popup" ? config.popupQuiz : null
  };
});

exports.submitLessonQuizAnswer = onCall(callableOptions({
  region: "asia-south1"
}), async (request) => {
  const auth = requireAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["courseId", "lessonId", "mode", "questionId", "selectedOption", "responseId"],
    requiredKeys: ["courseId", "lessonId", "questionId", "selectedOption"],
    maxBytes: 4096
  });
  enforceCallableRateLimit(request, "submit-lesson-quiz-answer", 120, 60 * 1000);
  const courseId = validatedResourceId(data.courseId, "courseId");
  const lessonId = validatedResourceId(data.lessonId, "lessonId");
  const mode = validatedText(data.mode || "separate", "mode", {
    required: true,
    maxLength: 20,
    allowedValues: ["separate", "popup"]
  });
  const questionId = validatedText(data.questionId, "questionId", { required: true, maxLength: 180 });
  const selectedOption = validatedText(data.selectedOption, "selectedOption", { required: true, maxLength: 500 });
  const responseId = validatedText(
    data.responseId || `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    "responseId",
    { required: true, maxLength: 180 }
  );

  const docs = await loadCourseContentDocs(courseId);
  const lessonIndex = docs.findIndex((doc) => doc.id === lessonId || doc.lessonId === lessonId || doc.contentId === lessonId);
  const lesson = lessonIndex >= 0 ? docs[lessonIndex] : null;
  if (!lesson) throw new HttpsError("not-found", "Lesson was not found.");

  const access = await hasCourseAccess(auth.uid, courseId, request.auth);
  const canUsePublicLesson = lessonPlayableWithoutPurchase(lesson, docs, lessonIndex);
  if (!access && !canUsePublicLesson) throw new HttpsError("permission-denied", "This lesson is locked.");

  const questionSet = await findQuizQuestionSet(lesson, mode, lessonId);
  const question = questionSet?.questions?.find((item) => String(item.id) === questionId);
  if (!question) throw new HttpsError("not-found", "Question was not found.");

  const correctResolution = resolveQuizCorrectOptionId(question);
  if (!correctResolution.optionId) {
    logger.warn("Quiz answer submitted with unresolved correct option", {
      uid: maskIdentifier(auth.uid, "uid"),
      courseId,
      lessonId,
      mode,
      questionId,
      selectedOption: maskIdentifier(selectedOption, "option"),
      optionIds: Array.isArray(question.options)
        ? question.options.map((option, index) => getQuizOptionId(option, index))
        : []
    });
  }
  const correct = !!correctResolution.optionId && String(correctResolution.optionId) === selectedOption;
  const feedback = correct
    ? localizedQuizText(question.feedback?.correct || "Correct.")
    : localizedQuizText(question.feedback?.incorrect || "Please try again.");
  const progressId = `${courseId}__${lessonId}`;
  const progressRef = db
    .collection("users")
    .doc(auth.uid)
    .collection("quizProgress")
    .doc(progressId);
  let remoteSaved = true;
  try {
    const answerKey = safeQuizAnswerKey(questionId);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(progressRef);
      const previous = snap.exists ? snap.get(`${mode}.answered.${answerKey}`) : null;
      const alreadyAttempted = !!previous;
      const alreadyCorrect = previous?.correct === true;
      const payload = {
        uid: auth.uid,
        courseId,
        lessonId,
        updatedAt: FieldValue.serverTimestamp(),
        [`${mode}.started`]: true,
        [`${mode}.lastAttemptedAt`]: FieldValue.serverTimestamp(),
        [`${mode}.answered.${answerKey}`]: {
          questionId,
          responseId,
          selectedOption,
          correct,
          answeredAt: FieldValue.serverTimestamp()
        }
      };
      if (!alreadyAttempted) {
        payload[`${mode}.questionsAnswered`] = FieldValue.increment(1);
      }
      if (correct && !alreadyCorrect) payload[`${mode}.correctAnswers`] = FieldValue.increment(1);
      transaction.set(progressRef, payload, { merge: true });
    });
  } catch (error) {
    remoteSaved = false;
    logger.warn("[IdeaKDC quiz progress] remote save skipped", {
      uid: maskIdentifier(auth.uid, "uid"),
      courseId,
      lessonId,
      mode,
      questionId,
      ...safeErrorDetails(error)
    });
  }

  return {
    correct,
    feedback,
    correctOption: correct ? selectedOption : "",
    resolvedCorrectOptionId: correct ? selectedOption : "",
    questionId,
    responseId,
    remoteSaved
  };
});

function assertCashfreeEnvironmentConfigured() {
  if (CASHFREE_ENV !== "TEST") {
    throw new HttpsError("failed-precondition", "Cashfree is locked to TEST mode in this phase.");
  }
  if (!CASHFREE_APP_ID.value() || !CASHFREE_SECRET_KEY.value()) {
    throw new HttpsError(
      "failed-precondition",
      "Cashfree TEST secrets are not configured on Firebase Functions."
    );
  }
}

function buildInternalOrderId() {
  return `IKDC_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function getCustomerPhone(auth) {
  const phone = auth.token && auth.token.phone_number;
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "9999999999";
}

function getSiteOrigin(request) {
  const origin = String(request.rawRequest?.headers?.origin || "").trim();
  if (ALLOWED_WEB_ORIGINS.includes(origin)) return origin;
  return "https://ideakdc.in";
}

function cashfreeHeaders(orderId) {
  return {
    "Accept": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": CASHFREE_APP_ID.value(),
    "x-client-secret": CASHFREE_SECRET_KEY.value(),
    "x-request-id": crypto.randomUUID(),
    "x-idempotency-key": orderId
  };
}

async function readJsonResponse(response, context) {
  const responseText = await response.text();
  try {
    return responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    logger.warn("Cashfree returned non-JSON response", {
      context,
      status: response.status
    });
    return {};
  }
}

async function callCashfreeCreateOrder({ request, auth, course, amount, orderId }) {
  const endpoint = `${CASHFREE_TEST_BASE_URL}/orders`;
  const origin = getSiteOrigin(request);
  const body = {
    order_id: orderId,
    order_amount: Number(amount.toFixed(2)),
    order_currency: course.currency || "INR",
    customer_details: {
      customer_id: auth.uid,
      customer_email: (auth.token && auth.token.email) || "",
      customer_phone: getCustomerPhone(auth),
      customer_name: (auth.token && auth.token.name) || ""
    },
    order_meta: {
      return_url: `${origin}/?cashfree_order_id={order_id}`
    },
    order_note: `IdeaKDC ${course.title}`.slice(0, 200),
    order_tags: {
      courseId: course.courseId,
      source: course.source
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...cashfreeHeaders(orderId)
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  }).catch((err) => {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HttpsError("deadline-exceeded", "Payment service did not respond in time. Please try again.");
    }
    throw new HttpsError("unavailable", "Could not connect to payment service. Check your connection and try again.");
  });

  const payload = await readJsonResponse(response, "create-order");

  if (!response.ok) {
    logger.error("Cashfree create order failed", {
      orderId: maskIdentifier(orderId, "order"),
      status: response.status,
      code: String(payload.code || "").slice(0, 80)
    });
    throw new HttpsError("internal", "Payment order failed. Please try again.");
  }

  if (!payload.order_id || !payload.payment_session_id) {
    logger.error("Cashfree create order response missing checkout data", {
      orderId: maskIdentifier(orderId, "order")
    });
    throw new HttpsError("internal", "Payment order failed. Please try again.");
  }

  return payload;
}

async function callCashfreeGetOrder(orderId) {
  const response = await fetch(`${CASHFREE_TEST_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: cashfreeHeaders(orderId),
    signal: AbortSignal.timeout(15000)
  }).catch((err) => {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HttpsError("deadline-exceeded", "Payment verification timed out. Do not pay again — your payment status will be checked automatically.");
    }
    throw new HttpsError("unavailable", "Payment verification is temporarily unavailable. Do not pay again.");
  });
  const payload = await readJsonResponse(response, "get-order");
  if (!response.ok) {
    logger.error("Cashfree order status check failed", {
      orderId: maskIdentifier(orderId, "order"),
      status: response.status,
      code: String(payload.code || "").slice(0, 80)
    });
    throw new HttpsError("internal", "Payment verification failed. Please try again.");
  }
  return payload;
}

async function callCashfreeOrderPayments(orderId) {
  const response = await fetch(`${CASHFREE_TEST_BASE_URL}/orders/${encodeURIComponent(orderId)}/payments`, {
    method: "GET",
    headers: cashfreeHeaders(orderId),
    signal: AbortSignal.timeout(15000)
  }).catch((err) => {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HttpsError("deadline-exceeded", "Payment verification timed out. Do not pay again — your payment status will be checked automatically.");
    }
    throw new HttpsError("unavailable", "Payment verification is temporarily unavailable. Do not pay again.");
  });
  const payload = await readJsonResponse(response, "order-payments");
  if (!response.ok) {
    logger.error("Cashfree order payments check failed", {
      orderId: maskIdentifier(orderId, "order"),
      status: response.status,
      code: String(payload.code || "").slice(0, 80)
    });
    throw new HttpsError("internal", "Payment verification failed. Please try again.");
  }
  return Array.isArray(payload) ? payload : [];
}

function findSuccessfulPayment(payments) {
  return payments.find((payment) => String(payment.payment_status || "").toUpperCase() === "SUCCESS") || null;
}

function getBestPayment(orderStatus, payments) {
  return findSuccessfulPayment(payments) || payments[0] || {
    payment_status: orderStatus.order_status || "UNKNOWN"
  };
}

function normalizePaymentStatus(orderStatus, payment) {
  const paymentStatus = String(payment.payment_status || "").toUpperCase();
  const orderState = String(orderStatus.order_status || "").toUpperCase();
  if (paymentStatus === "SUCCESS" || orderState === "PAID") return "paid";
  if (paymentStatus === "FAILED" || paymentStatus === "CANCELLED" || orderState === "EXPIRED") return "failed";
  return "pending";
}

function numbersMatch(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.01;
}

function validatedTextArray(value, fieldName, options = {}) {
  try {
    return validateStringArray(value, fieldName, options);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }
}

function requireReferralAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Login is required for Student Finance Support.");
  }
  return request.auth;
}

function referralCommissionDocId(orderId) {
  return crypto.createHash("sha256").update(`referral:${orderId}`).digest("hex").slice(0, 40);
}

function safeRecentItems(value, limit = 12) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function prependRecentItem(existing, item, limit = 12) {
  return [item, ...safeRecentItems(existing, limit - 1)];
}

function referralMemberResponse(member = {}) {
  return {
    joined: true,
    name: String(member.name || ""),
    maskedUpiId: maskUpiId(member.upiId),
    upiVerificationStatus: String(member.upiVerificationStatus || "pending"),
    verifiedName: String(member.upiVerifiedName || ""),
    referralCode: String(member.referralCode || ""),
    referralCodeStatus: String(member.referralCodeStatus || "active"),
    linkedCourseId: String(member.linkedCourseId || ""),
    status: String(member.status || "active"),
    referralCount: Number(member.referralCount || 0),
    successfulBuyerCount: Number(member.successfulBuyerCount || 0),
    pendingPaise: Number(member.pendingPaise || 0),
    approvedPaise: Number(member.approvedPaise || 0),
    paidPaise: Number(member.paidPaise || 0),
    reversedPaise: Number(member.reversedPaise || 0),
    recentActivity: safeRecentItems(member.recentActivity),
    recentPayouts: safeRecentItems(member.recentPayouts)
  };
}

function buildUpiVerificationId(uid) {
  const subject = crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 12);
  return `IKDC_UPI_${subject}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

async function verifyUpiWithCashfree({ uid, upiId, name }) {
  assertCashfreeEnvironmentConfigured();
  const verificationId = buildUpiVerificationId(uid);
  const response = await fetch(`${CASHFREE_TEST_VERIFICATION_BASE_URL}/upi/penny-drop`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-api-version": CASHFREE_VERIFICATION_API_VERSION,
      "x-client-id": CASHFREE_APP_ID.value(),
      "x-client-secret": CASHFREE_SECRET_KEY.value()
    },
    body: JSON.stringify({
      verification_id: verificationId,
      vpa: upiId,
      name,
      user_consent: {
        obtained: true,
        type: "EXPLICIT",
        timestamp: new Date().toISOString(),
        purpose: "Verify UPI ID for IdeaKDC Student Partner Program payout"
      }
    }),
    signal: AbortSignal.timeout(20000)
  }).catch((err) => {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HttpsError("deadline-exceeded", "UPI verification service did not respond in time. Please try again in a few minutes.");
    }
    throw new HttpsError("unavailable", "Could not connect to UPI verification service. Check your connection and try again.");
  });
  const payload = await readJsonResponse(response, "verify-referral-upi");
  const status = String(payload.status || "").toUpperCase();
  if (!response.ok || status !== "SUCCESS") {
    logger.warn("Cashfree UPI verification was not successful", {
      uid: maskIdentifier(uid, "uid"),
      status: response.status,
      providerStatus: status.slice(0, 24)
    });
    throw new HttpsError(
      "failed-precondition",
      CASHFREE_ENV === "TEST"
        ? "UPI verification failed in Cashfree TEST mode. Use a supported sandbox UPI ID."
        : "UPI ID could not be verified. Check it and try again."
    );
  }
  const verifiedUpi = normalizeUpiId(payload.vpa || "");
  const nameAtBank = normalizeSpaces(payload.name_at_bank || "");
  if (verifiedUpi !== upiId || !nameAtBank) {
    throw new HttpsError("failed-precondition", "Cashfree did not return matching verified UPI details.");
  }
  return {
    verificationId,
    referenceId: String(payload.reference_id || "").slice(0, 80),
    nameAtBank: nameAtBank.slice(0, 160),
    nameMatchResult: String(payload.name_match_result || "").slice(0, 40),
    nameMatchScore: String(payload.name_match_score || "").slice(0, 12)
  };
}

exports.verifyReferralUpi = onCall(callableOptions({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}), async (request) => {
  const auth = requireReferralAuth(request);
  enforceCallableRateLimit(request, "referral-upi-verification", 5, 10 * 60 * 1000);
  const data = validatedCallableData(request, {
    allowedKeys: ["upiId", "name", "userConsent"],
    requiredKeys: ["userConsent"],
    maxBytes: 2048
  });
  if (data.userConsent !== true) {
    throw new HttpsError("invalid-argument", "Explicit consent is required to verify the UPI ID.");
  }
  const memberRef = db.collection("referralMembers").doc(auth.uid);
  const memberSnap = await memberRef.get();
  const member = memberSnap.exists ? memberSnap.data() || {} : null;
  const upiId = member
    ? normalizeUpiId(member.upiId)
    : normalizeUpiId(validatedText(data.upiId, "upiId", {
      required: true,
      maxLength: 193,
      pattern: UPI_ID_PATTERN
    }));
  const name = member
    ? normalizeSpaces(member.name)
    : normalizeSpaces(validatedText(data.name, "name", { required: true, maxLength: 120 }));
  if (!UPI_ID_PATTERN.test(upiId) || !name) {
    throw new HttpsError("invalid-argument", "A valid name and UPI ID are required.");
  }
  const fingerprint = upiFingerprint(upiId);
  const verificationRef = db.collection("referralUpiVerifications").doc(auth.uid);
  const cachedVerificationSnap = await verificationRef.get();
  const cachedVerification = cachedVerificationSnap.exists ? cachedVerificationSnap.data() || {} : {};
  if (cachedVerification.status === "verified" && cachedVerification.upiFingerprint === fingerprint) {
    return {
      verified: true,
      status: "verified",
      verifiedName: String(cachedVerification.verifiedName || ""),
      maskedUpiId: maskUpiId(upiId),
      environment: String(cachedVerification.environment || CASHFREE_ENV),
      cached: true
    };
  }
  const verified = await verifyUpiWithCashfree({ uid: auth.uid, upiId, name });
  const verificationRecord = {
    uid: auth.uid,
    status: "verified",
    upiFingerprint: fingerprint,
    verifiedName: verified.nameAtBank,
    providerReference: verified.referenceId,
    providerVerificationId: verified.verificationId,
    nameMatchResult: verified.nameMatchResult,
    nameMatchScore: verified.nameMatchScore,
    environment: CASHFREE_ENV,
    verifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
  const batch = db.batch();
  batch.set(verificationRef, verificationRecord, { merge: true });
  if (member) {
    batch.update(memberRef, {
      upiVerificationStatus: "verified",
      upiFingerprint: fingerprint,
      upiVerifiedName: verified.nameAtBank,
      upiVerificationReference: verified.referenceId,
      upiVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  return {
    verified: true,
    status: "verified",
    verifiedName: verified.nameAtBank,
    maskedUpiId: maskUpiId(upiId),
    environment: CASHFREE_ENV
  };
});

async function referralSettings() {
  const snap = await db.collection("systemConfig").doc("referrals").get();
  return snap.exists ? snap.data() || {} : {
    enabled: false,
    commissionType: "percentage",
    percentageBps: 1000,
    fixedAmountPaise: 0,
    minimumPayoutPaise: 10000
  };
}

exports.joinReferralProgram = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireReferralAuth(request);
  enforceCallableRateLimit(request, "referral-join", 4, 10 * 60 * 1000);
  const data = validatedCallableData(request, {
    allowedKeys: ["name", "upiId", "state", "city", "email", "whatsapp"],
    requiredKeys: ["name", "upiId", "state", "city", "email", "whatsapp"],
    maxBytes: 4096
  });
  const name = normalizeSpaces(validatedText(data.name, "name", { required: true, maxLength: 120 }));
  const upiId = normalizeUpiId(validatedText(data.upiId, "upiId", {
    required: true,
    maxLength: 193,
    pattern: UPI_ID_PATTERN
  }));
  const state = normalizeSpaces(validatedText(data.state, "state", { required: true, maxLength: 100 }));
  const city = normalizeSpaces(validatedText(data.city, "city", { required: true, maxLength: 100 }));
  const email = normalizeEmail(validatedText(data.email, "email", {
    required: true,
    maxLength: 254,
    pattern: EMAIL_PATTERN
  }));
  const whatsapp = normalizePhone(data.whatsapp);
  if (!PHONE_PATTERN.test(whatsapp)) {
    throw new HttpsError("invalid-argument", "WhatsApp number must contain 10 to 15 digits.");
  }
  const authenticatedEmail = normalizeEmail(auth.token?.email || "");
  if (authenticatedEmail && authenticatedEmail !== email) {
    throw new HttpsError("invalid-argument", "Use the email connected to your logged-in account.");
  }

  const memberRef = db.collection("referralMembers").doc(auth.uid);
  const verificationRef = db.collection("referralUpiVerifications").doc(auth.uid);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const referralCode = generateReferralCode();
    const codeRef = db.collection("referralCodes").doc(referralCode);
    try {
      const member = await db.runTransaction(async (transaction) => {
        const [memberSnap, codeSnap, verificationSnap] = await Promise.all([
          transaction.get(memberRef),
          transaction.get(codeRef),
          transaction.get(verificationRef)
        ]);
        if (memberSnap.exists) {
          throw new HttpsError("already-exists", "You are already a Student Finance Support member.");
        }
        if (codeSnap.exists) throw new Error("referral-code-collision");
        const now = FieldValue.serverTimestamp();
        const verification = verificationSnap.exists ? verificationSnap.data() || {} : {};
        const verificationMatches = verification.status === "verified" &&
          verification.upiFingerprint === upiFingerprint(upiId);
        const record = {
          uid: auth.uid,
          name,
          upiId,
          upiVerificationStatus: verificationMatches ? "verified" : "pending",
          upiFingerprint: verificationMatches ? verification.upiFingerprint : "",
          upiVerifiedName: verificationMatches ? String(verification.verifiedName || "") : "",
          upiVerificationReference: verificationMatches ? String(verification.providerReference || "") : "",
          upiVerifiedAt: verificationMatches ? verification.verifiedAt || now : null,
          email,
          whatsapp,
          state,
          city,
          referralCode,
          referralCodeStatus: "active",
          status: "active",
          referralCount: 0,
          successfulBuyerCount: 0,
          pendingPaise: 0,
          approvedPaise: 0,
          paidPaise: 0,
          reversedPaise: 0,
          recentActivity: [],
          recentPayouts: [],
          createdAt: now,
          updatedAt: now
        };
        transaction.create(memberRef, record);
        transaction.create(codeRef, {
          ownerUid: auth.uid,
          status: "active",
          createdAt: now,
          updatedAt: now
        });
        return { ...record, createdAt: null, updatedAt: null };
      });
      logger.info("Referral membership created", {
        uid: maskIdentifier(auth.uid, "uid"),
        referralCode: maskIdentifier(referralCode, "referral")
      });
      return referralMemberResponse(member);
    } catch (error) {
      if (error.message === "referral-code-collision") continue;
      throw error;
    }
  }
  throw new HttpsError("aborted", "A unique referral code could not be allocated. Please retry.");
});

exports.claimReferralAttribution = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireReferralAuth(request);
  enforceCallableRateLimit(request, "referral-claim", 8, 10 * 60 * 1000);
  const data = validatedCallableData(request, {
    allowedKeys: ["referralCode", "source", "courseId"],
    requiredKeys: ["referralCode"],
    maxBytes: 1024
  });
  const referralCode = normalizeReferralCode(data.referralCode);
  if (!REFERRAL_CODE_PATTERN.test(referralCode)) {
    throw new HttpsError("invalid-argument", "Referral code is invalid.");
  }
  const source = validatedText(data.source || "link", "source", { maxLength: 40 }) || "link";
  const linkedCourseId = data.courseId
    ? validatedResourceId(data.courseId, "courseId", false)
    : "";
  const settings = await referralSettings();
  if (settings.enabled !== true) {
    throw new HttpsError("failed-precondition", "New referrals are currently paused.");
  }
  const existingPurchases = await db.collection("users")
    .doc(auth.uid)
    .collection("purchases")
    .where("access", "==", true)
    .limit(1)
    .get();
  if (!existingPurchases.empty) {
    throw new HttpsError("failed-precondition", "Referral attribution must be completed before a paid purchase.");
  }

  const attributionRef = db.collection("referralAttributions").doc(auth.uid);
  const codeRef = db.collection("referralCodes").doc(referralCode);
  const result = await db.runTransaction(async (transaction) => {
    const [attributionSnap, codeSnap] = await Promise.all([
      transaction.get(attributionRef),
      transaction.get(codeRef)
    ]);
    if (attributionSnap.exists) {
      const existing = attributionSnap.data() || {};
      if (existing.referralCode !== referralCode) {
        throw new HttpsError("already-exists", "Your first referral attribution is already fixed.");
      }
      return { attributed: true, existing: true };
    }
    if (!codeSnap.exists || codeSnap.data()?.status !== "active") {
      throw new HttpsError("not-found", "Referral code is unavailable.");
    }
    const referrerUid = codeSnap.data().ownerUid;
    if (!referrerUid || referrerUid === auth.uid) {
      throw new HttpsError("failed-precondition", "Self-referral is not allowed.");
    }
    const memberRef = db.collection("referralMembers").doc(referrerUid);
    const memberSnap = await transaction.get(memberRef);
    if (!memberSnap.exists || memberSnap.data()?.status !== "active") {
      throw new HttpsError("failed-precondition", "This referral member is not active.");
    }
    const now = FieldValue.serverTimestamp();
    const activity = {
      type: "referred",
      referredUidHash: maskIdentifier(auth.uid, "student"),
      createdAtMillis: Date.now()
    };
    transaction.create(attributionRef, {
      referredUid: auth.uid,
      referrerUid,
      referralCode,
      source,
      linkedCourseId: linkedCourseId || "",
      status: "active",
      attributedAt: now,
      updatedAt: now
    });
    transaction.update(memberRef, {
      referralCount: FieldValue.increment(1),
      recentActivity: prependRecentItem(memberSnap.data()?.recentActivity, activity),
      lastActivityAt: now,
      updatedAt: now
    });
    return { attributed: true, existing: false };
  });
  return result;
});

exports.getMyReferralDashboard = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireReferralAuth(request);
  validatedCallableData(request, { allowedKeys: [], maxBytes: 128 });
  enforceCallableRateLimit(request, "referral-dashboard", 30, 60 * 1000);
  const snap = await db.collection("referralMembers").doc(auth.uid).get();
  if (!snap.exists) return { joined: false };
  return referralMemberResponse(snap.data());
});

exports.adminListReferralMembers = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["search", "status"],
    maxBytes: 1024
  });
  enforceCallableRateLimit(request, "admin-referral-list", 30, 60 * 1000);
  const search = normalizeSpaces(data.search || "").toLowerCase();
  const status = validatedText(data.status || "", "status", {
    maxLength: 20,
    allowedValues: ["", ...REFERRAL_MEMBER_STATUSES]
  });
  const snap = await db.collection("referralMembers").limit(250).get();
  const members = snap.docs.map((docSnap) => {
    const item = docSnap.data() || {};
    return {
      uid: docSnap.id,
      name: String(item.name || ""),
      referralCode: String(item.referralCode || ""),
      state: String(item.state || ""),
      city: String(item.city || ""),
      status: String(item.status || "active"),
      upiVerificationStatus: String(item.upiVerificationStatus || "pending"),
      upiVerifiedName: String(item.upiVerifiedName || ""),
      linkedCourseId: String(item.linkedCourseId || ""),
      referralCount: Number(item.referralCount || 0),
      successfulBuyerCount: Number(item.successfulBuyerCount || 0),
      pendingPaise: Number(item.pendingPaise || 0),
      paidPaise: Number(item.paidPaise || 0)
    };
  }).filter((item) => {
    if (status && item.status !== status) return false;
    if (!search) return true;
    return `${item.name} ${item.referralCode} ${item.state} ${item.city}`.toLowerCase().includes(search);
  });
  return { members };
});

exports.adminGetReferralMember = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["uid"],
    requiredKeys: ["uid"],
    maxBytes: 512
  });
  enforceCallableRateLimit(request, "admin-referral-detail", 40, 60 * 1000);
  const uid = validatedResourceId(data.uid, "uid");
  const [memberSnap, commissionSnap, payoutSnap] = await Promise.all([
    db.collection("referralMembers").doc(uid).get(),
    db.collection("referralCommissions").where("referrerUid", "==", uid).limit(200).get(),
    db.collection("referralPayouts").where("referrerUid", "==", uid).limit(100).get()
  ]);
  if (!memberSnap.exists) throw new HttpsError("not-found", "Referral member was not found.");
  const member = memberSnap.data() || {};
  const commissions = commissionSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const payouts = payoutSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  return {
    member: { uid, ...member },
    commissions,
    payouts
  };
});

exports.setReferralLinkCourse = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireReferralAuth(request);
  enforceCallableRateLimit(request, "referral-set-link-course", 10, 60 * 1000);
  const data = validatedCallableData(request, {
    allowedKeys: ["courseId"],
    maxBytes: 512
  });
  // Empty string or omitted courseId clears the course link (general link).
  const courseId = data.courseId
    ? validatedResourceId(data.courseId, "courseId", false)
    : "";
  const memberRef = db.collection("referralMembers").doc(auth.uid);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "You are not yet a Student Partner Program member.");
  }
  if (memberSnap.data()?.status !== "active") {
    throw new HttpsError("failed-precondition", "Your membership is not active.");
  }
  if (courseId) {
    // Validate the course exists so members can't set arbitrary IDs.
    await findCourseById(courseId).catch(() => {
      throw new HttpsError("not-found", "The selected course was not found.");
    });
  }
  await memberRef.update({
    linkedCourseId: courseId,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { linkedCourseId: courseId };
});

exports.adminSaveReferralSettings = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["enabled", "commissionType", "percentage", "fixedAmountInr", "minimumPayoutInr", "effectiveAt"],
    requiredKeys: ["enabled", "commissionType", "percentage", "fixedAmountInr", "minimumPayoutInr"],
    maxBytes: 2048
  });
  enforceCallableRateLimit(request, "admin-referral-settings", 10, 60 * 1000);
  if (typeof data.enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled must be true or false.");
  const commissionType = validatedText(data.commissionType, "commissionType", {
    required: true,
    allowedValues: ["percentage", "fixed"]
  });
  const percentage = Number(data.percentage || 0);
  const fixedAmountPaise = inrToPaise(data.fixedAmountInr);
  const minimumPayoutPaise = inrToPaise(data.minimumPayoutInr);
  if (commissionType === "percentage" && (!Number.isFinite(percentage) || percentage < 1 || percentage > 50)) {
    throw new HttpsError("invalid-argument", "Percentage must be between 1 and 50.");
  }
  if (commissionType === "fixed" && (fixedAmountPaise < 100 || fixedAmountPaise > 10000000)) {
    throw new HttpsError("invalid-argument", "Fixed commission must be between ₹1 and ₹100,000.");
  }
  if (minimumPayoutPaise < 0 || minimumPayoutPaise > 100000000) {
    throw new HttpsError("invalid-argument", "Minimum payout is outside the supported range.");
  }
  const effectiveAtMillis = data.effectiveAt ? Date.parse(String(data.effectiveAt)) : Date.now();
  if (!Number.isFinite(effectiveAtMillis)) throw new HttpsError("invalid-argument", "Effective date is invalid.");
  const settings = {
    enabled: data.enabled,
    commissionType,
    percentageBps: commissionType === "percentage" ? Math.round(percentage * 100) : 0,
    fixedAmountPaise: commissionType === "fixed" ? fixedAmountPaise : 0,
    minimumPayoutPaise,
    effectiveAt: Timestamp.fromMillis(effectiveAtMillis),
    updatedBy: auth.uid,
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("systemConfig").doc("referrals").set(settings, { merge: true });
  await db.collection("referralAuditLogs").add({
    action: "settings-updated",
    actorUid: auth.uid,
    targetUid: "",
    safeMetadata: { enabled: settings.enabled, commissionType },
    createdAt: FieldValue.serverTimestamp()
  });
  return { saved: true, settings: { ...settings, effectiveAt: effectiveAtMillis, updatedAt: null } };
});

exports.adminGetReferralSettings = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  requireAdminAuth(request);
  validatedCallableData(request, { allowedKeys: [], maxBytes: 128 });
  const settings = await referralSettings();
  return {
    enabled: settings.enabled === true,
    commissionType: settings.commissionType || "percentage",
    percentage: Number(settings.percentageBps || 0) / 100,
    fixedAmountInr: Number(settings.fixedAmountPaise || 0) / 100,
    minimumPayoutInr: Number(settings.minimumPayoutPaise || 0) / 100,
    effectiveAt: timestampMillis(settings.effectiveAt) || Date.now()
  };
});

exports.adminSetReferralMemberStatus = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["uid", "status", "reason"],
    requiredKeys: ["uid", "status"],
    maxBytes: 2048
  });
  enforceCallableRateLimit(request, "admin-referral-status", 20, 60 * 1000);
  const uid = validatedResourceId(data.uid, "uid");
  const status = validatedText(data.status, "status", { required: true, allowedValues: REFERRAL_MEMBER_STATUSES });
  const reason = validatedText(data.reason || "", "reason", { maxLength: 300 });
  const memberRef = db.collection("referralMembers").doc(uid);
  await db.runTransaction(async (transaction) => {
    const memberSnap = await transaction.get(memberRef);
    if (!memberSnap.exists) throw new HttpsError("not-found", "Referral member was not found.");
    const code = memberSnap.data()?.referralCode;
    const codeRef = code ? db.collection("referralCodes").doc(code) : null;
    if (codeRef) await transaction.get(codeRef);
    const now = FieldValue.serverTimestamp();
    transaction.update(memberRef, {
      status,
      statusReason: reason,
      referralCodeStatus: status === "active" ? "active" : "revoked",
      updatedAt: now
    });
    if (codeRef) transaction.set(codeRef, {
      status: status === "active" ? "active" : "revoked",
      updatedAt: now,
      revokedAt: status === "active" ? null : now
    }, { merge: true });
  });
  await db.collection("referralAuditLogs").add({
    action: `member-${status}`,
    actorUid: auth.uid,
    targetUid: uid,
    safeMetadata: { reason },
    createdAt: FieldValue.serverTimestamp()
  });
  return { updated: true, status };
});

exports.adminRevokeReferralCode = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["uid", "reason"],
    requiredKeys: ["uid"],
    maxBytes: 2048
  });
  enforceCallableRateLimit(request, "admin-referral-revoke-code", 20, 60 * 1000);
  const uid = validatedResourceId(data.uid, "uid");
  const reason = validatedText(data.reason || "", "reason", { maxLength: 300 });
  const memberRef = db.collection("referralMembers").doc(uid);
  await db.runTransaction(async (transaction) => {
    const memberSnap = await transaction.get(memberRef);
    if (!memberSnap.exists) throw new HttpsError("not-found", "Referral member was not found.");
    const referralCode = memberSnap.data()?.referralCode;
    if (!referralCode) throw new HttpsError("failed-precondition", "Referral code is missing.");
    const codeRef = db.collection("referralCodes").doc(referralCode);
    await transaction.get(codeRef);
    const now = FieldValue.serverTimestamp();
    transaction.set(codeRef, { status: "revoked", revokedAt: now, updatedAt: now }, { merge: true });
    transaction.update(memberRef, { referralCodeStatus: "revoked", updatedAt: now });
  });
  await db.collection("referralAuditLogs").add({
    action: "referral-code-revoked",
    actorUid: auth.uid,
    targetUid: uid,
    safeMetadata: { reason },
    createdAt: FieldValue.serverTimestamp()
  });
  return { revoked: true };
});

exports.adminSetReferralCommissionStatus = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["commissionId", "status", "reason"],
    requiredKeys: ["commissionId", "status"],
    maxBytes: 2048
  });
  enforceCallableRateLimit(request, "admin-referral-commission", 30, 60 * 1000);
  const commissionId = validatedResourceId(data.commissionId, "commissionId");
  const status = validatedText(data.status, "status", { required: true, allowedValues: ["approved", "rejected"] });
  const reason = validatedText(data.reason || "", "reason", { maxLength: 300 });
  if (status === "rejected" && !reason) throw new HttpsError("invalid-argument", "A rejection reason is required.");
  const commissionRef = db.collection("referralCommissions").doc(commissionId);
  let targetUid = "";
  await db.runTransaction(async (transaction) => {
    const commissionSnap = await transaction.get(commissionRef);
    if (!commissionSnap.exists) throw new HttpsError("not-found", "Commission was not found.");
    const commission = commissionSnap.data() || {};
    targetUid = commission.referrerUid;
    if (commission.status === status) return;
    if (commission.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only a pending commission can be approved or rejected.");
    }
    const memberRef = db.collection("referralMembers").doc(targetUid);
    const memberSnap = await transaction.get(memberRef);
    if (!memberSnap.exists) throw new HttpsError("not-found", "Referral member was not found.");
    const amount = Number(commission.commissionAmountPaise || 0);
    const now = FieldValue.serverTimestamp();
    transaction.update(commissionRef, {
      status,
      decisionReason: reason,
      approvedAt: status === "approved" ? now : null,
      rejectedAt: status === "rejected" ? now : null,
      decidedBy: auth.uid,
      updatedAt: now
    });
    transaction.update(memberRef, {
      pendingPaise: FieldValue.increment(-amount),
      approvedPaise: status === "approved" ? FieldValue.increment(amount) : FieldValue.increment(0),
      updatedAt: now
    });
  });
  await db.collection("referralAuditLogs").add({
    action: `commission-${status}`,
    actorUid: auth.uid,
    targetUid,
    safeMetadata: { commissionId: maskIdentifier(commissionId, "commission"), reason },
    createdAt: FieldValue.serverTimestamp()
  });
  return { updated: true, status };
});

exports.adminRecordReferralPayout = onCall(callableOptions({ region: "asia-south1" }), async (request) => {
  const auth = requireAdminAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["referrerUid", "commissionIds", "safeTransactionReference"],
    requiredKeys: ["referrerUid", "commissionIds", "safeTransactionReference"],
    maxBytes: 8192
  });
  enforceCallableRateLimit(request, "admin-referral-payout", 10, 60 * 1000);
  const referrerUid = validatedResourceId(data.referrerUid, "referrerUid");
  const commissionIds = validatedTextArray(data.commissionIds, "commissionIds", {
    maxItems: 100,
    itemMaxLength: 180,
    pattern: SAFE_RESOURCE_ID_PATTERN
  });
  if (!commissionIds.length || new Set(commissionIds).size !== commissionIds.length) {
    throw new HttpsError("invalid-argument", "Select one or more unique approved commissions.");
  }
  const safeTransactionReference = validatedText(data.safeTransactionReference, "safeTransactionReference", {
    required: true,
    maxLength: 120,
    pattern: /^[A-Za-z0-9._\-/ ]+$/
  });
  const memberRef = db.collection("referralMembers").doc(referrerUid);
  const settingsRef = db.collection("systemConfig").doc("referrals");
  const payoutRef = db.collection("referralPayouts").doc();
  let payoutAmountPaise = 0;
  await db.runTransaction(async (transaction) => {
    const [memberSnap, settingsSnap] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(settingsRef)
    ]);
    if (!memberSnap.exists) throw new HttpsError("not-found", "Referral member was not found.");
    const member = memberSnap.data() || {};
    if (member.upiVerificationStatus !== "verified" ||
        member.upiFingerprint !== upiFingerprint(member.upiId)) {
      throw new HttpsError("failed-precondition", "Verify this member's current UPI ID before recording a payout.");
    }
    const commissionRefs = commissionIds.map((id) => db.collection("referralCommissions").doc(id));
    const commissionSnaps = [];
    for (const ref of commissionRefs) commissionSnaps.push(await transaction.get(ref));
    const commissions = commissionSnaps.map((snap) => {
      if (!snap.exists) throw new HttpsError("not-found", "A selected commission was not found.");
      return snap.data() || {};
    });
    for (const commission of commissions) {
      if (commission.referrerUid !== referrerUid || commission.status !== "approved") {
        throw new HttpsError("failed-precondition", "Every selected commission must be approved for this member.");
      }
      payoutAmountPaise += Number(commission.commissionAmountPaise || 0);
    }
    if (payoutAmountPaise <= 0) throw new HttpsError("failed-precondition", "Payout amount is not valid.");
    const minimumPayoutPaise = Number(settingsSnap.data()?.minimumPayoutPaise || 0);
    if (minimumPayoutPaise > 0 && payoutAmountPaise < minimumPayoutPaise) {
      throw new HttpsError("failed-precondition", "Approved balance is below the configured minimum payout.");
    }
    const now = FieldValue.serverTimestamp();
    const payoutSummary = {
      payoutId: payoutRef.id,
      amountPaise: payoutAmountPaise,
      status: "paid",
      createdAtMillis: Date.now()
    };
    transaction.create(payoutRef, {
      referrerUid,
      amountPaise: payoutAmountPaise,
      currency: "INR",
      status: "paid",
      commissionIds,
      safeTransactionReference,
      payoutMethod: "manual-record",
      createdAt: now,
      processedAt: now,
      processedBy: auth.uid
    });
    commissionRefs.forEach((ref) => transaction.update(ref, {
      status: "paid",
      payoutId: payoutRef.id,
      paidAt: now,
      updatedAt: now
    }));
    transaction.update(memberRef, {
      approvedPaise: FieldValue.increment(-payoutAmountPaise),
      paidPaise: FieldValue.increment(payoutAmountPaise),
      recentPayouts: prependRecentItem(member.recentPayouts, payoutSummary),
      updatedAt: now
    });
  });
  await db.collection("referralAuditLogs").add({
    action: "payout-recorded",
    actorUid: auth.uid,
    targetUid: referrerUid,
    safeMetadata: { payoutId: maskIdentifier(payoutRef.id, "payout"), amountPaise: payoutAmountPaise },
    createdAt: FieldValue.serverTimestamp()
  });
  return { recorded: true, payoutId: payoutRef.id, amountPaise: payoutAmountPaise };
});

function purchaseDocId(uid, courseId) {
  return crypto.createHash("sha256").update(`${uid}:${courseId}`).digest("hex").slice(0, 32);
}

function enrollmentDocId(uid, courseId) {
  return `cashfree_${purchaseDocId(uid, courseId)}`;
}

function paymentOrderLockRef(uid, courseId) {
  return db.collection("paymentOrders").doc(`active_${purchaseDocId(uid, courseId)}`);
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function cashfreeOrderExpiryMillis(cashfreeOrder, now = Date.now()) {
  const parsed = timestampMillis(cashfreeOrder?.order_expiry_time);
  return parsed > now ? parsed : now + PAYMENT_ORDER_DEFAULT_EXPIRY_MS;
}

function reusablePaymentOrder(lock, now = Date.now()) {
  if (!lock || lock.recordType !== "active-course-order") return null;
  const expiresAt = timestampMillis(lock.expiresAt);
  if (
    lock.status === "active" &&
    lock.activeOrderId &&
    lock.paymentSessionId &&
    expiresAt > now
  ) {
    return {
      orderId: lock.activeOrderId,
      paymentSessionId: lock.paymentSessionId
    };
  }
  return null;
}

async function reservePaymentOrderCreation(uid, courseId, orderId) {
  const lockRef = paymentOrderLockRef(uid, courseId);
  const purchaseRef = db.collection("users").doc(uid).collection("purchases").doc(courseId);
  const nowMs = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const [purchaseSnap, lockSnap] = await Promise.all([
      transaction.get(purchaseRef),
      transaction.get(lockRef)
    ]);

    if (purchaseSnap.exists && purchaseSnap.data()?.access === true) {
      throw new HttpsError("already-exists", "This course is already unlocked.");
    }

    const lock = lockSnap.exists ? lockSnap.data() || {} : {};
    const reusable = reusablePaymentOrder(lock, nowMs);
    if (reusable) {
      return {
        action: "reuse",
        lockRef,
        ...reusable
      };
    }

    if (lock.status === "creating" && timestampMillis(lock.creationLeaseExpiresAt) > nowMs) {
      throw new HttpsError(
        "aborted",
        "A payment order is already being created. Please try again in a moment."
      );
    }

    transaction.set(lockRef, {
      recordType: "active-course-order",
      userId: uid,
      courseId,
      activeOrderId: orderId,
      paymentSessionId: "",
      status: "creating",
      creationLeaseExpiresAt: Timestamp.fromMillis(nowMs + PAYMENT_ORDER_CREATION_LOCK_MS),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      action: "create",
      lockRef
    };
  });

  return result;
}

async function releasePaymentOrderCreation(lockRef, orderId) {
  await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    if (!lockSnap.exists || lockSnap.data()?.activeOrderId !== orderId) return;
    transaction.set(lockRef, {
      status: "failed",
      paymentSessionId: "",
      creationLeaseExpiresAt: Timestamp.fromMillis(0),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function updatePaymentOrderLockStatus(order, status, orderId) {
  if (!order?.userId || !order?.courseId) return;
  const lockRef = paymentOrderLockRef(order.userId, order.courseId);
  await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    if (!lockSnap.exists || lockSnap.data()?.activeOrderId !== orderId) return;
    transaction.set(lockRef, {
      status,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function createOrderRecord({ uid, email, course, amount, orderId, cashfreeOrder, lockRef }) {
  const orderRef = db.collection("paymentOrders").doc(orderId);
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(orderRef, {
    userId: uid,
    userEmail: email || "",
    courseId: course.courseId,
    courseTitle: course.title,
    amount,
    currency: course.currency || "INR",
    provider: "cashfree",
    providerOrderId: cashfreeOrder.cf_order_id || "",
    orderId: cashfreeOrder.order_id || orderId,
    status: cashfreeOrder.order_status || "ACTIVE",
    cashfreeEnv: CASHFREE_ENV,
    gatewayConnected: true,
    orderExpiryTime: cashfreeOrder.order_expiry_time || "",
    rawOrderStatus: cashfreeOrder.order_status || "",
    createdAt: now,
    updatedAt: now
  });
  batch.set(lockRef, {
    recordType: "active-course-order",
    userId: uid,
    courseId: course.courseId,
    activeOrderId: cashfreeOrder.order_id || orderId,
    paymentSessionId: cashfreeOrder.payment_session_id || "",
    status: "active",
    expiresAt: Timestamp.fromMillis(cashfreeOrderExpiryMillis(cashfreeOrder)),
    creationLeaseExpiresAt: Timestamp.fromMillis(0),
    updatedAt: now
  }, { merge: true });
  await batch.commit();

  return orderRef;
}

exports.createCashfreeOrder = onCall(callableOptions({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}), async (request) => {
  const auth = requireAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["courseId"],
    requiredKeys: ["courseId"],
    maxBytes: 512
  });
  enforceCallableRateLimit(request, "cashfree-create-order", 6, 60 * 1000);
  const courseId = validatedResourceId(data.courseId, "courseId");
  const course = await findCourseById(courseId);

  const amount = Number(course.amount || 0);
  if (!amount || amount < 1) {
    throw new HttpsError("failed-precondition", "Course amount is not valid for payment.");
  }

  assertCashfreeEnvironmentConfigured();
  const orderId = buildInternalOrderId();
  const reservation = await reservePaymentOrderCreation(auth.uid, course.courseId, orderId);
  if (reservation.action === "reuse") {
    logger.info("Cashfree TEST active order reused", {
      orderId: maskIdentifier(reservation.orderId, "order"),
      uid: maskIdentifier(auth.uid, "uid"),
      courseId: course.courseId,
      cashfreeEnv: CASHFREE_ENV
    });
    return {
      order_id: reservation.orderId,
      payment_session_id: reservation.paymentSessionId,
      courseId: course.courseId
    };
  }

  let cashfreeOrder;
  try {
    cashfreeOrder = await callCashfreeCreateOrder({
      request,
      auth,
      course,
      amount,
      orderId
    });
  } catch (error) {
    await releasePaymentOrderCreation(reservation.lockRef, orderId).catch(() => {});
    throw error;
  }

  const orderRef = await createOrderRecord({
    uid: auth.uid,
    email: auth.token && auth.token.email,
    course,
    amount,
    orderId,
    cashfreeOrder,
    lockRef: reservation.lockRef
  });

  logger.info("Cashfree TEST order created", {
    orderId: maskIdentifier(orderRef.id, "order"),
    uid: maskIdentifier(auth.uid, "uid"),
    courseId: course.courseId,
    cashfreeEnv: CASHFREE_ENV
  });

  return {
    order_id: cashfreeOrder.order_id,
    payment_session_id: cashfreeOrder.payment_session_id,
    courseId: course.courseId
  };
});

exports.verifyCashfreePayment = onCall(callableOptions({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}), async (request) => {
  const auth = requireAuth(request);
  const data = validatedCallableData(request, {
    allowedKeys: ["orderId"],
    requiredKeys: ["orderId"],
    maxBytes: 512
  });
  enforceCallableRateLimit(request, "cashfree-verify-payment", 20, 60 * 1000);
  const orderId = validatedResourceId(data.orderId, "orderId");

  const orderRef = db.collection("paymentOrders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError("not-found", "Payment order was not found.");
  }

  const order = orderSnap.data() || {};
  if (order.userId !== auth.uid) {
    throw new HttpsError("permission-denied", "This payment order belongs to another user.");
  }
  if (order.cashfreeEnv !== "TEST" || CASHFREE_ENV !== "TEST") {
    throw new HttpsError("failed-precondition", "Cashfree verification is locked to TEST mode.");
  }

  assertCashfreeEnvironmentConfigured();
  const course = await findCourseById(order.courseId);
  if (course.courseId !== order.courseId) {
    throw new HttpsError("failed-precondition", "Payment course mismatch.");
  }
  if (!numbersMatch(course.amount, order.amount)) {
    throw new HttpsError("failed-precondition", "Payment amount no longer matches the course price.");
  }

  const orderStatus = await callCashfreeGetOrder(orderId);
  const payments = await callCashfreeOrderPayments(orderId);
  const payment = getBestPayment(orderStatus, payments);
  const normalizedStatus = normalizePaymentStatus(orderStatus, payment);
  const cashfreeOrderId = orderStatus.order_id || payment.order_id || "";
  const cashfreeAmount = Number(payment.payment_amount || orderStatus.order_amount || 0);
  const cashfreeCurrency = payment.payment_currency || orderStatus.order_currency || order.currency || "INR";
  const paymentId = payment.cf_payment_id || payment.payment_id || "";
  const cashfreeCourseId = orderStatus.order_tags?.courseId || payment.order_tags?.courseId || order.courseId;

  if (cashfreeOrderId && cashfreeOrderId !== orderId) {
    throw new HttpsError("failed-precondition", "Payment order mismatch.");
  }
  if (cashfreeCourseId && cashfreeCourseId !== order.courseId) {
    throw new HttpsError("failed-precondition", "Payment course mismatch.");
  }
  if (!numbersMatch(cashfreeAmount, order.amount)) {
    throw new HttpsError("failed-precondition", "Payment amount mismatch.");
  }
  if (cashfreeCurrency !== order.currency) {
    throw new HttpsError("failed-precondition", "Payment currency mismatch.");
  }

  if (normalizedStatus === "paid") {
    const purchaseId = await finalizeSuccessfulPayment(orderId, order, {
      orderStatus,
      payment
    });
    logger.info("Cashfree TEST payment verified", {
      orderId: maskIdentifier(orderId, "order"),
      purchaseId: maskIdentifier(purchaseId, "purchase"),
      uid: maskIdentifier(auth.uid, "uid"),
      courseId: order.courseId,
      paymentId: maskIdentifier(paymentId, "payment")
    });
    return {
      orderId,
      courseId: order.courseId,
      status: "paid",
      verified: true,
      paymentId,
      purchaseId,
      message: "Payment successful. Course access is unlocked."
    };
  }

  await orderRef.update({
    status: normalizedStatus,
    verified: false,
    paymentId,
    lastVerificationAttemptAt: FieldValue.serverTimestamp(),
    rawOrderStatus: orderStatus.order_status || "",
    rawPaymentStatus: payment.payment_status || "",
    updatedAt: FieldValue.serverTimestamp()
  });
  if (normalizedStatus === "failed") {
    await updatePaymentOrderLockStatus(order, "failed", orderId);
  }
  logger.info("Cashfree TEST payment not complete", {
    orderId: maskIdentifier(orderId, "order"),
    uid: maskIdentifier(auth.uid, "uid"),
    courseId: order.courseId,
    status: normalizedStatus
  });
  return {
    orderId,
    courseId: order.courseId,
    status: normalizedStatus,
    verified: false,
    paymentId,
    message: normalizedStatus === "pending"
      ? "Payment is pending. Please check again after a few moments."
      : "Payment failed or was cancelled. Course access was not unlocked."
  };
});

async function finalizeSuccessfulPayment(orderId, order, providerPayload) {
  const purchaseId = purchaseDocId(order.userId, order.courseId);
  const referralRecordId = referralCommissionDocId(orderId);
  const purchaseRef = db.collection("purchases").doc(purchaseId);
  const userPurchaseRef = db
    .collection("users")
    .doc(order.userId)
    .collection("purchases")
    .doc(order.courseId);
  const enrollmentRef = db.collection("enrollments").doc(enrollmentDocId(order.userId, order.courseId));
  const orderLockRef = paymentOrderLockRef(order.userId, order.courseId);
  const orderDocRef = db.collection("paymentOrders").doc(orderId);
  const attributionRef = db.collection("referralAttributions").doc(order.userId);
  const referralEventRef = db.collection("referralPurchaseEvents").doc(referralRecordId);
  const referralSettingsRef = db.collection("systemConfig").doc("referrals");

  const now = FieldValue.serverTimestamp();
  const payment = providerPayload?.payment || {};
  const paymentId = payment.cf_payment_id || payment.payment_id || "";
  const purchase = {
    userId: order.userId,
    userEmail: order.userEmail || "",
    courseId: order.courseId,
    courseTitle: order.courseTitle || "",
    orderId,
    paymentProvider: "cashfree",
    providerOrderId: order.providerOrderId || "",
    amount: Number(order.amount || 0),
    currency: order.currency || "INR",
    status: "paid",
    verified: true,
    accessGranted: true,
    paymentId,
    providerSummary: minimalCashfreeProviderRecord(providerPayload),
    createdAt: now,
    verifiedAt: now,
    paidAt: now,
    updatedAt: now
  };

  await db.runTransaction(async (transaction) => {
    const [currentOrderSnap, attributionSnap, referralEventSnap, settingsSnap] = await Promise.all([
      transaction.get(orderDocRef),
      transaction.get(attributionRef),
      transaction.get(referralEventRef),
      transaction.get(referralSettingsRef)
    ]);
    const currentOrderStatus = currentOrderSnap.exists
      ? String(currentOrderSnap.data()?.status || "").toLowerCase()
      : "";
    if (currentOrderStatus === "refunded" || currentOrderStatus === "chargeback") {
      throw new HttpsError(
        "failed-precondition",
        "Course access was revoked after a refund or chargeback."
      );
    }

    let referralWrites = null;
    const attribution = attributionSnap.exists ? attributionSnap.data() || {} : {};
    // Strict course gate: if the attribution was for a specific course, only
    // credit commission when the buyer purchases exactly that course.
    const attributionCourseGatePass = !attribution.linkedCourseId ||
      attribution.linkedCourseId === order.courseId;
    if (
      !referralEventSnap.exists &&
      attribution.status === "active" &&
      attribution.referrerUid &&
      attribution.referrerUid !== order.userId &&
      attributionCourseGatePass
    ) {
      const memberRef = db.collection("referralMembers").doc(attribution.referrerUid);
      const buyerStateRef = db.collection("referralBuyerStates")
        .doc(`${attribution.referrerUid}_${order.userId}`);
      const commissionRef = db.collection("referralCommissions").doc(referralRecordId);
      const [memberSnap, buyerStateSnap, commissionSnap] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(buyerStateRef),
        transaction.get(commissionRef)
      ]);
      if (memberSnap.exists) {
        const member = memberSnap.data() || {};
        const buyerState = buyerStateSnap.exists ? buyerStateSnap.data() || {} : {};
        const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
        const effectiveAt = timestampMillis(settings.effectiveAt);
        const settingsEffective = !effectiveAt || effectiveAt <= Date.now();
        const paymentAmountPaise = inrToPaise(order.amount);
        const commissionAmountPaise = member.status === "active" && settingsEffective
          ? calculateCommissionPaise(paymentAmountPaise, settings)
          : 0;
        referralWrites = {
          memberRef,
          member,
          buyerStateRef,
          buyerState,
          commissionRef,
          commissionExists: commissionSnap.exists,
          settings,
          paymentAmountPaise,
          commissionAmountPaise,
          referrerUid: attribution.referrerUid,
          firstActivePurchase: Number(buyerState.activePurchaseCount || 0) === 0
        };
      }
    }

    transaction.set(purchaseRef, purchase, { merge: true });
    transaction.set(userPurchaseRef, {
      ...purchase,
      access: true
    }, { merge: true });
    transaction.set(enrollmentRef, {
      userId: order.userId,
      userName: "",
      userEmail: order.userEmail || "",
      userPhone: "",
      courseId: order.courseId,
      courseName: order.courseTitle || "",
      courseEmoji: "📚",
      originalPrice: Number(order.amount || 0),
      coursePrice: Number(order.amount || 0),
      couponCode: "",
      paymentMode: "cashfree_test",
      screenshotBase64: "",
      status: "approved",
      cashfreeOrderId: orderId,
      purchaseId,
      reviewedAt: now,
      submittedAt: order.createdAt || now,
      updatedAt: now
    }, { merge: true });
    transaction.update(orderDocRef, {
      status: "paid",
      verified: true,
      verifiedAt: now,
      paymentId,
      purchaseId,
      accessGranted: true,
      paidAt: now,
      updatedAt: now
    });
    transaction.set(orderLockRef, {
      recordType: "active-course-order",
      userId: order.userId,
      courseId: order.courseId,
      activeOrderId: orderId,
      status: "paid",
      updatedAt: now
    }, { merge: true });

    if (referralWrites) {
      const activity = {
        type: "purchase",
        courseId: order.courseId,
        amountPaise: referralWrites.paymentAmountPaise,
        commissionPaise: referralWrites.commissionAmountPaise,
        createdAtMillis: Date.now()
      };
      transaction.create(referralEventRef, {
        referrerUid: referralWrites.referrerUid,
        referredUid: order.userId,
        courseId: order.courseId,
        orderId,
        purchaseId,
        commissionId: referralWrites.commissionAmountPaise > 0 ? referralRecordId : "",
        status: "active",
        createdAt: now,
        updatedAt: now
      });
      transaction.set(referralWrites.buyerStateRef, {
        referrerUid: referralWrites.referrerUid,
        referredUid: order.userId,
        activePurchaseCount: Number(referralWrites.buyerState.activePurchaseCount || 0) + 1,
        updatedAt: now
      }, { merge: true });
      const memberUpdate = {
        recentActivity: prependRecentItem(referralWrites.member.recentActivity, activity),
        lastActivityAt: now,
        updatedAt: now
      };
      if (referralWrites.firstActivePurchase) {
        memberUpdate.successfulBuyerCount = FieldValue.increment(1);
      }
      if (referralWrites.commissionAmountPaise > 0 && !referralWrites.commissionExists) {
        memberUpdate.pendingPaise = FieldValue.increment(referralWrites.commissionAmountPaise);
        transaction.create(referralWrites.commissionRef, {
          referrerUid: referralWrites.referrerUid,
          referredUid: order.userId,
          courseId: order.courseId,
          orderId,
          purchaseId,
          paymentAmountPaise: referralWrites.paymentAmountPaise,
          commissionType: referralWrites.settings.commissionType,
          commissionRateSnapshot: referralWrites.settings.commissionType === "percentage"
            ? { percentageBps: Number(referralWrites.settings.percentageBps || 0) }
            : { fixedAmountPaise: Number(referralWrites.settings.fixedAmountPaise || 0) },
          commissionAmountPaise: referralWrites.commissionAmountPaise,
          currency: order.currency || "INR",
          status: "pending",
          createdAt: now,
          updatedAt: now
        });
      }
      transaction.update(referralWrites.memberRef, memberUpdate);
    }
  });

  return purchaseId;
}

function getHeaderValue(req, names) {
  for (const name of names) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value) && value.length) return String(value[0]);
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getRawWebhookBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  if (req.body && Object.keys(req.body).length) return Buffer.from(JSON.stringify(req.body), "utf8");
  return Buffer.alloc(0);
}

function getCashfreeWebhookTimestamp(req) {
  return getHeaderValue(req, [
    "x-webhook-timestamp",
    "x-cf-timestamp",
    "x-cashfree-timestamp"
  ]);
}

function verifyCashfreeWebhookSignature(req) {
  const signature = getHeaderValue(req, [
    "x-webhook-signature",
    "x-cf-signature",
    "x-cashfree-signature"
  ]);
  const timestamp = getCashfreeWebhookTimestamp(req);

  if (!signature || !timestamp) return false;

  const rawBody = getRawWebhookBody(req);
  if (!rawBody.length) return false;

  // Cashfree signs webhook payloads with HMAC SHA256 over timestamp + raw body.
  const signedPayload = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
  const expectedBase64 = crypto
    .createHmac("sha256", CASHFREE_SECRET_KEY.value())
    .update(signedPayload)
    .digest("base64");

  return timingSafeEqualText(signature, expectedBase64);
}

function cashfreeWebhookTimestampMillis(value) {
  const numeric = Number(String(value || "").trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function isCashfreeWebhookTimestampFresh(req, now = Date.now()) {
  const timestampMs = cashfreeWebhookTimestampMillis(getCashfreeWebhookTimestamp(req));
  return timestampMs > 0 && Math.abs(now - timestampMs) <= CASHFREE_WEBHOOK_MAX_AGE_MS;
}

function parseWebhookPayload(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    return req.body;
  }
  const rawBody = getRawWebhookBody(req).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function getWebhookOrder(payload) {
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
  const referralRecordId = referralCommissionDocId(orderId);
  const purchaseRef = db.collection("purchases").doc(purchaseId);
  const userPurchaseRef = db
    .collection("users")
    .doc(order.userId)
    .collection("purchases")
    .doc(order.courseId);
  const enrollmentRef = db.collection("enrollments").doc(enrollmentDocId(order.userId, order.courseId));
  const orderRef = db.collection("paymentOrders").doc(orderId);
  const lockRef = paymentOrderLockRef(order.userId, order.courseId);
  const referralEventRef = db.collection("referralPurchaseEvents").doc(referralRecordId);
  const commissionRef = db.collection("referralCommissions").doc(referralRecordId);
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
    const [orderSnap, referralEventSnap, commissionSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(referralEventRef),
      transaction.get(commissionRef)
    ]);
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

    let referralReversal = null;
    const referralEvent = referralEventSnap.exists ? referralEventSnap.data() || {} : {};
    if (referralEventSnap.exists && referralEvent.status === "active" && referralEvent.referrerUid) {
      const memberRef = db.collection("referralMembers").doc(referralEvent.referrerUid);
      const buyerStateRef = db.collection("referralBuyerStates")
        .doc(`${referralEvent.referrerUid}_${order.userId}`);
      const [memberSnap, buyerStateSnap] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(buyerStateRef)
      ]);
      referralReversal = {
        memberRef,
        member: memberSnap.exists ? memberSnap.data() || {} : null,
        buyerStateRef,
        buyerState: buyerStateSnap.exists ? buyerStateSnap.data() || {} : {},
        commission: commissionSnap.exists ? commissionSnap.data() || {} : null
      };
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

    if (referralReversal) {
      const previousPurchaseCount = Number(referralReversal.buyerState.activePurchaseCount || 0);
      const nextPurchaseCount = Math.max(0, previousPurchaseCount - 1);
      transaction.update(referralEventRef, {
        status: "reversed",
        reversalReason: revocation.reason,
        reversedAt: now,
        updatedAt: now
      });
      transaction.set(referralReversal.buyerStateRef, {
        activePurchaseCount: nextPurchaseCount,
        updatedAt: now
      }, { merge: true });
      if (referralReversal.member) {
        const memberUpdate = {
          recentActivity: prependRecentItem(referralReversal.member.recentActivity, {
            type: "reversal",
            courseId: order.courseId,
            createdAtMillis: Date.now()
          }),
          updatedAt: now
        };
        if (previousPurchaseCount === 1) {
          memberUpdate.successfulBuyerCount = FieldValue.increment(-1);
        }
        const commission = referralReversal.commission;
        if (commission && commission.status !== "reversed") {
          const amount = Number(commission.commissionAmountPaise || 0);
          if (["pending", "approved", "paid"].includes(commission.status)) {
            memberUpdate.reversedPaise = FieldValue.increment(amount);
          }
          if (commission.status === "pending") memberUpdate.pendingPaise = FieldValue.increment(-amount);
          if (commission.status === "approved") memberUpdate.approvedPaise = FieldValue.increment(-amount);
          transaction.update(commissionRef, {
            previousStatus: commission.status,
            status: "reversed",
            reversalReason: revocation.reason,
            reversedAt: now,
            updatedAt: now
          });
        }
        transaction.update(referralReversal.memberRef, memberUpdate);
      }
    }
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


// ══════════════════════════════════════════════
// LIVE CLASSES
// ══════════════════════════════════════════════

const LIVE_CLASS_NUMBERS = ['6','7','8','9','10','11','12'];
const LIVE_CLASS_STREAMS = ['science','commerce','arts'];
const LIVE_CLASS_SUBJECTS = {
  '6':  ['Mathematics','Science','English','Hindi','Social Science','Sanskrit'],
  '7':  ['Mathematics','Science','English','Hindi','Social Science','Sanskrit'],
  '8':  ['Mathematics','Science','English','Hindi','Social Science','Sanskrit'],
  '9':  ['Mathematics','Science','English','Hindi','Social Science','Sanskrit'],
  '10': ['Mathematics','Science','English','Hindi','Social Science','Sanskrit'],
  '11-science':  ['Physics','Chemistry','Mathematics','Biology','Computer Science','English'],
  '11-commerce': ['Accountancy','Business Studies','Economics','Mathematics','English'],
  '11-arts':     ['History','Geography','Political Science','Economics','Psychology','English','Hindi'],
  '12-science':  ['Physics','Chemistry','Mathematics','Biology','Computer Science','English'],
  '12-commerce': ['Accountancy','Business Studies','Economics','Mathematics','English'],
  '12-arts':     ['History','Geography','Political Science','Economics','Psychology','English','Hindi'],
};

function liveSubjectKey(classNum, stream) {
  const c = String(classNum || '');
  if (c === '11' || c === '12') return `${c}-${stream || 'science'}`;
  return c;
}

function validateLiveSession(data) {
  const classNum = String(data.classNum || '').trim();
  const stream   = String(data.stream   || '').trim().toLowerCase();
  const subject  = String(data.subject  || '').trim();
  const date     = String(data.date     || '').trim();
  const time     = String(data.time     || '').trim();
  const price    = Number(data.price) || 0;
  if (!LIVE_CLASS_NUMBERS.includes(classNum))
    throw new HttpsError('invalid-argument', 'Invalid class number.');
  if ((classNum === '11' || classNum === '12') && !LIVE_CLASS_STREAMS.includes(stream))
    throw new HttpsError('invalid-argument', 'Stream required for Class 11/12.');
  const key = liveSubjectKey(classNum, stream);
  if (!LIVE_CLASS_SUBJECTS[key] || !LIVE_CLASS_SUBJECTS[key].includes(subject))
    throw new HttpsError('invalid-argument', `Invalid subject for Class ${classNum}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new HttpsError('invalid-argument', 'Date must be YYYY-MM-DD.');
  if (!/^\d{2}:\d{2}$/.test(time))
    throw new HttpsError('invalid-argument', 'Time must be HH:MM.');
  if (price < 0 || price > 100000000)
    throw new HttpsError('invalid-argument', 'Invalid price.');
  return { classNum, stream, subject, date, time, price };
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
    date:     v.date,
    time:     v.time,
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
  // Validate each question
  for (const q of questions) {
    if (!q.text || !Array.isArray(q.options) || q.options.length < 2 || typeof q.correct !== 'number')
      throw new HttpsError('invalid-argument', 'Each question needs text, options array, and correct index.');
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
  const options      = request.data?.options;
  const correctIndex = Number(request.data?.correctIndex ?? -1);
  const timeLimit    = Number(request.data?.timeLimit) || 30;
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  if (!questionText) throw new HttpsError('invalid-argument', 'question text required.');
  if (!Array.isArray(options) || options.length < 2 || options.length > 4)
    throw new HttpsError('invalid-argument', 'options must be array of 2-4 strings.');
  if (correctIndex < 0 || correctIndex >= options.length)
    throw new HttpsError('invalid-argument', 'correctIndex out of range.');
  const allowed = [5,10,20,30,60,90,120];
  if (!allowed.includes(timeLimit)) throw new HttpsError('invalid-argument', 'Invalid timeLimit.');
  await db.collection('liveQuizState').doc(sessionId).set({
    active:       true,
    question:     { text: questionText, options: options.map(o => String(o)), correctIndex, timeLimit },
    publishedAt:  FieldValue.serverTimestamp(),
    sessionId,
  });
  return { ok: true };
});

// Admin: clear the active quiz
exports.adminClearLiveQuiz = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  requireAdminAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  await db.collection('liveQuizState').doc(sessionId).set({ active: false, clearedAt: FieldValue.serverTimestamp() }, { merge: true });
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
    updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null
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
  if (existing.exists) return { registered: true, alreadyRegistered: true };
  if ((session.pricePaise || 0) === 0) {
    // Free — register immediately
    await regRef.set({ uid: auth.uid, email: auth.token?.email || '', joinedAt: FieldValue.serverTimestamp(), paidPaise: 0 });
    return { registered: true, free: true };
  }
  // Paid — return session info for Cashfree order (frontend calls createCashfreeOrder with liveSessionId)
  return { registered: false, requiresPayment: true, pricePaise: session.pricePaise, sessionId };
});

// Confirm live class registration after payment
exports.confirmLiveClassRegistration = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  const orderId   = String(request.data?.orderId   || '').trim();
  if (!sessionId || !orderId) throw new HttpsError('invalid-argument', 'sessionId and orderId required.');
  // Verify payment order is paid via existing payments collection
  const orderSnap = await db.collection('paymentOrders').doc(orderId).get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Payment order not found.');
  const order = orderSnap.data();
  if (order.status !== 'paid') throw new HttpsError('failed-precondition', 'Payment not confirmed.');
  if (order.uid !== auth.uid)  throw new HttpsError('permission-denied', 'Order does not belong to this user.');
  const regRef = db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid);
  await regRef.set({ uid: auth.uid, email: auth.token?.email || '', joinedAt: FieldValue.serverTimestamp(), paidPaise: order.amountPaise || 0 }, { merge: true });
  return { registered: true };
});

// Student: get YouTube video ID — only if registered
exports.getPlayerAccess = onCall(callableOptions({ region: 'asia-south1' }), async (request) => {
  const auth = requireAuth(request);
  const sessionId = String(request.data?.sessionId || '').trim();
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.');
  const [sessionSnap, regSnap] = await Promise.all([
    db.collection('liveClasses').doc(sessionId).get(),
    db.collection('liveRegistrations').doc(sessionId).collection('students').doc(auth.uid).get(),
  ]);
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.');
  const session = sessionSnap.data();
  if (!regSnap.exists) throw new HttpsError('permission-denied', 'You are not registered for this session.');
  if (session.status === 'ended') throw new HttpsError('failed-precondition', 'This session has ended.');
  if (!session.youtubeVideoId) throw new HttpsError('failed-precondition', 'Stream not started yet. Please try again in a moment.');
  return { youtubeVideoId: session.youtubeVideoId, status: session.status };
});
