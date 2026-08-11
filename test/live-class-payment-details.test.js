"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const adminSource = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const publicSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");

test("admin live-class planning captures and saves teaching details", () => {
  for (const id of [
    "lc-teacher-name",
    "lc-duration",
    "lc-study-materials",
    "lc-description",
    "lc-feature-quiz",
    "lc-feature-exam",
    "lc-feature-confidence"
  ]) {
    assert.match(adminSource, new RegExp(`id=["']${id}["']`));
  }
  assert.match(adminSource, /adminSaveLiveClassFn\(\{[\s\S]*teacherName,[\s\S]*durationMinutes,[\s\S]*studyMaterials,[\s\S]*classDescription,[\s\S]*features,/);
});

test("planned live sessions populate public discovery during startup", () => {
  assert.match(publicSource, /async function loadPublicLiveSessions\(\)/);
  assert.match(publicSource, /window\._livePlannedSessions = sessions/);
  assert.match(publicSource, /Promise\.all\(\[profilePromise, loadCourses\(\)\]\);\s*void loadPublicLiveSessions\(\)/);
  assert.match(publicSource, /openPlannedLiveSession\('\$\{safeSessionId\}'\)/);
});

test("public live details appear before the payment action", () => {
  const detailsStart = publicSource.indexOf("function renderLiveSessionDetails");
  const joinButton = publicSource.indexOf('onclick="joinSelectedLiveSession()"', detailsStart);
  assert.ok(detailsStart >= 0 && joinButton > detailsStart);
  const detailsMarkup = publicSource.slice(detailsStart, joinButton);
  assert.match(detailsMarkup, /Teacher:/);
  assert.match(detailsMarkup, /Duration:/);
  assert.match(detailsMarkup, /Books \/ Study Material:/);
  assert.match(detailsMarkup, /Live mind-twisting quiz/);
  assert.match(detailsMarkup, /Exam-oriented learning/);
  assert.match(detailsMarkup, /Confidence building through concepts/);
});

test("paid live checkout uses an exact server-priced session order", () => {
  assert.match(publicSource, /createLiveClassCashfreeOrderFn\(\{ sessionId: sess\.sessionId \}\)/);
  assert.doesNotMatch(publicSource, /customPricePaise/);
  assert.match(functionsSource, /exports\.createLiveClassCashfreeOrder/);
  assert.match(functionsSource, /findLiveClassPaymentOffering\(sessionId\)/);
  assert.match(functionsSource, /pricePaise \/ 100/);
  assert.match(functionsSource, /paymentTargetType: "live-class"/);
});

test("verified live payment grants only the exact session registration", () => {
  assert.match(functionsSource, /async function finalizeLiveClassPayment/);
  assert.match(functionsSource, /collection\("liveRegistrations"\)\.doc\(sessionId\)/);
  assert.match(functionsSource, /isLiveClassPaymentOrder\(order\)/);
  assert.match(functionsSource, /order\.liveSessionId !== sessionId/);
  assert.match(functionsSource, /registrationActive = regSnap\.exists && regSnap\.data\(\)\?\.access !== false/);
  assert.match(publicSource, /if \(data\.liveSessionId\) \{[\s\S]*confirmLiveClassRegistrationFn\([\s\S]*openPlannedLiveSession/);
});

