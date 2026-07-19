"use strict";

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "ideakdc-24b0b.firebasestorage.app";

const CASHFREE_ENV = process.env.CASHFREE_ENV || "TEST";
const CASHFREE_APP_ID = defineSecret("CASHFREE_APP_ID");
const CASHFREE_SECRET_KEY = defineSecret("CASHFREE_SECRET_KEY");
const CASHFREE_API_VERSION = "2025-01-01";
const CASHFREE_TEST_BASE_URL = "https://sandbox.cashfree.com/pg";
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

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

function firstSafeThumbnail(candidates, protectedVideoId) {
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate || "");
    if (normalized && !thumbnailLeaksVideoId(normalized, protectedVideoId)) return normalized;
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
  return thumbnailLeaksVideoId(normalized, protectedVideoId) ? "" : normalized;
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
      logger.warn("[THUMB_PIPELINE_FAILED]", { courseId, contentId, quality, stage: "lesson-fetch-or-upload", reason: error.message });
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
      logger.warn("[THUMB_PIPELINE_FAILED]", { courseId, quality, target: "course", stage: "course-fetch-or-upload", reason: error.message });
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
    const fullVideoId = protectedVideoIdFromContent(data);
    const generatedThumb = youtubeThumbnailUrl(fullVideoId);
    const courseThumb = publicContentThumbnail(data, fullVideoId) || generatedThumb;
    const lessonThumb = publicLessonThumbnail(data, fullVideoId) || generatedThumb || courseThumb;
    const faqs = normalizeFaqs(data);
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
        price: coursePriceFrom(data.price),
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
    groups[key].videos.push({
      contentId: data.id,
      lessonId: data.id,
      title: data.title || "",
      desc: data.description || data.desc || "",
      dur: data.dur || data.duration || "",
      durationSeconds: Number(data.durationSeconds || 0),
      thumbnailUrl: lessonThumb || courseThumb,
      hasProtectedVideo: !!fullVideoId,
      playlistId: "",
      hasProtectedPlaylist: !!data.playlistId,
      playlistTitle: data.playlistTitle || data.playlistName || "",
      playlistDesc: data.playlistDescription || "",
      videoCount: Number(data.videoCount || 0),
      contentType,
      chapter: data.chapter || "",
      topic: data.topic || "",
      isFree: data.isFree === true,
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
      amount: Number(data.price || 0),
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
    amount: Number(matched.price || 0),
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
  return docs.some((doc) => doc.isFree === true || Number(doc.price || 0) <= 0);
}

function lessonPlayableWithoutPurchase(lesson, docs, index) {
  if (isCourseFreeFromDocs(docs)) return true;
  return lesson.isFree === true;
}

exports.getPublicCourseCatalogue = onCall({
  region: "asia-south1"
}, async () => {
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

exports.diagnoseCourseThumbnails = onCall({
  region: "asia-south1",
  timeoutSeconds: 120,
  memory: "512MiB"
}, async (request) => {
  const auth = requireAuth(request);
  if (!isAdminAuth(auth)) {
    throw new HttpsError("permission-denied", "Only IdeaKDC admins can diagnose thumbnails.");
  }

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
    uid: auth.uid,
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

exports.adminUploadPreflight = onCall({
  region: "asia-south1"
}, async (request) => {
  const auth = requireAuth(request);
  if (!isAdminAuth(auth)) {
    throw new HttpsError("permission-denied", "Only IdeaKDC admins can upload courses.");
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "ideakdc-24b0b";
  const expectedProjectId = String(request.data?.expectedProjectId || "").trim();
  if (expectedProjectId && expectedProjectId !== projectId) {
    throw new HttpsError("failed-precondition", "Firebase project mismatch.");
  }

  if (!STORAGE_BUCKET) {
    throw new HttpsError("failed-precondition", "Firebase Storage bucket is not configured.");
  }

  // Read-only health check: do not create diagnostic Firestore or Storage resources.
  const contentProbe = await db.collection("content").limit(1).get();
  logger.info("Admin upload preflight passed", {
    uid: auth.uid,
    email: auth.token?.email || "",
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

exports.repairProtectedCourseThumbnails = onCall({
  region: "asia-south1",
  timeoutSeconds: 540,
  memory: "1GiB"
}, async (request) => {
  const auth = requireAuth(request);
  if (!isAdminAuth(auth)) {
    throw new HttpsError("permission-denied", "Only IdeaKDC admins can repair course thumbnails.");
  }

  const retryIds = Array.isArray(request.data?.contentIds)
    ? request.data.contentIds.map((id) => normalizeCourseId(String(id || ""))).filter(Boolean)
    : [];
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
      sourceValue: source.sourceValue
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
    uid: auth.uid,
    totalScanned: stats.totalScanned,
    repaired: stats.repaired,
    alreadyValid: stats.alreadyValid,
    failed: stats.failed,
    needsManualUpload: stats.needsManualUpload
  });
  return stats;
});

exports.getAuthorizedLessonVideo = onCall({
  region: "asia-south1"
}, async (request) => {
  const courseId = normalizeCourseId(request.data?.courseId || "");
  const lessonId = normalizeCourseId(request.data?.lessonId || "");
  if (!courseId || !lessonId) {
    throw new HttpsError("invalid-argument", "courseId and lessonId are required.");
  }

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
  const fullVideoId = extractYouTubeVideoId(lesson.videoId || lesson.vid || lesson.youtubeVideoId || lesson.videoUrl || lesson.youtubeUrl || "");

  if (access || canUsePublicLesson) {
    if (!fullVideoId) {
      throw new HttpsError("failed-precondition", "Playable video is not configured for this lesson.");
    }
    logger.info("Authorized full lesson video resolved", {
      uid: uid || "anonymous",
      courseId,
      lessonId,
      access,
      freePreviewLesson: canUsePublicLesson
    });
    return {
      mode: access ? "full" : "free",
      videoId: fullVideoId,
      title: lesson.title || "",
      allowFullPlayback: access || canUsePublicLesson
    };
  }

  throw new HttpsError("permission-denied", "This lesson is locked. Purchase is required.");
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
  const origin = request.rawRequest && request.rawRequest.headers.origin;
  if (typeof origin === "string" && /^https?:\/\//.test(origin)) return origin;
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
    body: JSON.stringify(body)
  });

  const payload = await readJsonResponse(response, "create-order");

  if (!response.ok) {
    logger.error("Cashfree create order failed", {
      orderId,
      status: response.status,
      code: payload.code,
      message: payload.message
    });
    throw new HttpsError("internal", "Payment order failed. Please try again.");
  }

  if (!payload.order_id || !payload.payment_session_id) {
    logger.error("Cashfree create order response missing checkout data", { orderId });
    throw new HttpsError("internal", "Payment order failed. Please try again.");
  }

  return payload;
}

async function callCashfreeGetOrder(orderId) {
  const response = await fetch(`${CASHFREE_TEST_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: cashfreeHeaders(orderId)
  });
  const payload = await readJsonResponse(response, "get-order");
  if (!response.ok) {
    logger.error("Cashfree order status check failed", {
      orderId,
      status: response.status,
      code: payload.code,
      message: payload.message
    });
    throw new HttpsError("internal", "Payment verification failed. Please try again.");
  }
  return payload;
}

async function callCashfreeOrderPayments(orderId) {
  const response = await fetch(`${CASHFREE_TEST_BASE_URL}/orders/${encodeURIComponent(orderId)}/payments`, {
    method: "GET",
    headers: cashfreeHeaders(orderId)
  });
  const payload = await readJsonResponse(response, "order-payments");
  if (!response.ok) {
    logger.error("Cashfree order payments check failed", {
      orderId,
      status: response.status,
      code: payload.code,
      message: payload.message
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

function purchaseDocId(uid, courseId) {
  return crypto.createHash("sha256").update(`${uid}:${courseId}`).digest("hex").slice(0, 32);
}

function enrollmentDocId(uid, courseId) {
  return `cashfree_${purchaseDocId(uid, courseId)}`;
}

async function createOrderRecord({ uid, email, course, amount, orderId, cashfreeOrder }) {
  const orderRef = db.collection("paymentOrders").doc(orderId);
  const now = FieldValue.serverTimestamp();

  await orderRef.set({
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
    checkoutSessionId: cashfreeOrder.payment_session_id || "",
    orderExpiryTime: cashfreeOrder.order_expiry_time || "",
    rawOrderStatus: cashfreeOrder.order_status || "",
    createdAt: now,
    updatedAt: now
  });

  return orderRef;
}

exports.createCashfreeOrder = onCall({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}, async (request) => {
  const auth = requireAuth(request);
  const courseId = normalizeCourseId(request.data && request.data.courseId);
  const course = await findCourseById(courseId);

  const amount = Number(course.amount || 0);
  if (!amount || amount < 1) {
    throw new HttpsError("failed-precondition", "Course amount is not valid for payment.");
  }

  assertCashfreeEnvironmentConfigured();
  const orderId = buildInternalOrderId();
  const cashfreeOrder = await callCashfreeCreateOrder({
    request,
    auth,
    course,
    amount,
    orderId
  });

  const orderRef = await createOrderRecord({
    uid: auth.uid,
    email: auth.token && auth.token.email,
    course,
    amount,
    orderId,
    cashfreeOrder
  });

  logger.info("Cashfree TEST order created", {
    orderId: orderRef.id,
    uid: auth.uid,
    courseId: course.courseId,
    cashfreeEnv: CASHFREE_ENV
  });

  return {
    order_id: cashfreeOrder.order_id,
    payment_session_id: cashfreeOrder.payment_session_id,
    courseId: course.courseId
  };
});

exports.verifyCashfreePayment = onCall({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}, async (request) => {
  const auth = requireAuth(request);
  const orderId = typeof request.data?.orderId === "string" ? request.data.orderId.trim() : "";
  if (!orderId) {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

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
      orderId,
      purchaseId,
      uid: auth.uid,
      courseId: order.courseId,
      paymentId
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
  logger.info("Cashfree TEST payment not complete", {
    orderId,
    uid: auth.uid,
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
  const purchaseRef = db.collection("purchases").doc(purchaseId);
  const userPurchaseRef = db
    .collection("users")
    .doc(order.userId)
    .collection("purchases")
    .doc(order.courseId);
  const enrollmentRef = db.collection("enrollments").doc(enrollmentDocId(order.userId, order.courseId));

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
    providerPayload: providerPayload || {},
    createdAt: now,
    verifiedAt: now,
    paidAt: now,
    updatedAt: now
  };

  await db.runTransaction(async (transaction) => {
    const orderDocRef = db.collection("paymentOrders").doc(orderId);
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

function verifyCashfreeWebhookSignature(req) {
  const signature = getHeaderValue(req, [
    "x-webhook-signature",
    "x-cf-signature",
    "x-cashfree-signature"
  ]);
  const timestamp = getHeaderValue(req, [
    "x-webhook-timestamp",
    "x-cf-timestamp",
    "x-cashfree-timestamp"
  ]);

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

  if (
    eventType.includes("SUCCESS") ||
    eventType.includes("PAID") ||
    paymentStatus === "SUCCESS" ||
    orderStatus === "PAID"
  ) {
    return "paid";
  }
  if (eventType.includes("REFUND") || paymentStatus.includes("REFUND")) return "refunded";
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
  return String(order.order_id || payment.order_id || payload.order_id || "").trim();
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
}

exports.cashfreeWebhook = onRequest({
  region: "asia-south1",
  secrets: [CASHFREE_APP_ID, CASHFREE_SECRET_KEY]
}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const requestId = crypto.randomUUID();
  try {
    assertCashfreeEnvironmentConfigured();

    if (!verifyCashfreeWebhookSignature(req)) {
      logger.warn("Cashfree webhook rejected because signature verification failed", { requestId });
      res.status(401).json({ received: false, requestId, error: "invalid_signature" });
      return;
    }

    const payload = parseWebhookPayload(req);
    const orderId = getWebhookOrderId(payload);
    if (!orderId) {
      logger.warn("Cashfree webhook missing order id", {
        requestId,
        eventType: getWebhookEventType(payload)
      });
      res.status(400).json({ received: false, requestId, error: "missing_order_id" });
      return;
    }

    const orderRef = db.collection("paymentOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      logger.warn("Cashfree webhook received for unknown order", { requestId, orderId });
      res.status(404).json({ received: false, requestId, orderId, error: "unknown_order" });
      return;
    }

    const order = orderSnap.data() || {};
    if (order.cashfreeEnv !== "TEST" || CASHFREE_ENV !== "TEST") {
      logger.warn("Cashfree webhook rejected because environment is not TEST", { requestId, orderId });
      res.status(409).json({ received: false, requestId, orderId, error: "environment_mismatch" });
      return;
    }

    const webhookCourseId = getWebhookCourseId(payload);
    if (webhookCourseId && webhookCourseId !== order.courseId) {
      logger.error("Cashfree webhook course mismatch", { requestId, orderId, courseId: order.courseId });
      res.status(409).json({ received: false, requestId, orderId, error: "course_mismatch" });
      return;
    }

    const webhookUid = getWebhookUid(payload);
    if (webhookUid && webhookUid !== order.userId) {
      logger.error("Cashfree webhook uid mismatch", { requestId, orderId, uid: order.userId });
      res.status(409).json({ received: false, requestId, orderId, error: "uid_mismatch" });
      return;
    }

    const webhookAmount = getWebhookAmount(payload);
    if (webhookAmount && !numbersMatch(webhookAmount, order.amount)) {
      logger.error("Cashfree webhook amount mismatch", { requestId, orderId, amount: order.amount });
      res.status(409).json({ received: false, requestId, orderId, error: "amount_mismatch" });
      return;
    }

    const webhookCurrency = getWebhookCurrency(payload, order.currency);
    if (webhookCurrency !== order.currency) {
      logger.error("Cashfree webhook currency mismatch", { requestId, orderId, currency: order.currency });
      res.status(409).json({ received: false, requestId, orderId, error: "currency_mismatch" });
      return;
    }

    const course = await findCourseById(order.courseId);
    if (course.courseId !== order.courseId || !numbersMatch(course.amount, order.amount)) {
      logger.error("Cashfree webhook rejected because stored course validation failed", {
        requestId,
        orderId,
        courseId: order.courseId
      });
      res.status(409).json({ received: false, requestId, orderId, error: "stored_course_mismatch" });
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
      logger.info("Cashfree webhook confirmed TEST payment", {
        requestId,
        orderId,
        purchaseId,
        uid: order.userId,
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
    logger.info("Cashfree webhook recorded non-successful TEST payment state", {
      requestId,
      orderId,
      uid: order.userId,
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
    logger.error("Cashfree webhook processing failed", {
      requestId,
      message: error.message
    });
    res.status(500).json({ received: false, requestId, error: "webhook_processing_failed" });
  }
});
