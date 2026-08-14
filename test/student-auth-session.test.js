"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const publicSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${startMarker} block must be readable`);
  return source.slice(start, end);
}

test("new students can create a five-digit PIN without breaking existing passwords", () => {
  const pinBlock = sourceBlock(publicSource, "function studentPinPassword", "function studentAccountEmail");
  const loginBlock = sourceBlock(publicSource, "window.doLogin = async", "window.doLogout = async");
  assert.match(pinBlock, /\^\\d\{5\}\$/);
  assert.match(pinBlock, /return \/\^.*\? `K\$\{pin\}` : pin/);
  assert.match(loginBlock, /signInWithEmailAndPassword\(auth, email, studentPinPassword\(pwd\)\)/);
  assert.match(publicSource, /linkWithCredential\(currentUser, EmailAuthProvider\.credential\(email, authPassword\)\)/);
  assert.match(publicSource, /sendPasswordResetEmail\(auth, email/);
  assert.match(publicSource, /Dashboard में Edit Profile खोलकर अपना email जोड़ें/);
});

test("student profile supports email before PIN creation", () => {
  assert.match(publicSource, /id="student-profile-email"/);
  assert.match(publicSource, /\{ name, email, gender, whatsapp, avatarId:/);
  assert.match(publicSource, /Create \/ Change 5-digit PIN/);
  assert.match(publicSource, /Forgot password \/ PIN/);
});

test("one active browser session is claimed, refreshed, and released", () => {
  assert.match(publicSource, /claimStudentSessionFn\(\{ deviceId, sessionToken \}\)/);
  assert.match(publicSource, /4 \* 60 \* 1000/);
  assert.match(publicSource, /releaseStudentSessionFn\(\{ sessionToken: token \}\)/);
  assert.match(functionsSource, /STUDENT_SESSION_LEASE_MS = 12 \* 60 \* 1000/);
  assert.match(functionsSource, /existingLeaseActive && !sameSession/);
  assert.match(functionsSource, /This account is already open on another device or browser/);
  assert.match(functionsSource, /tokenHash === studentSessionHash\(sessionToken, "session"\)/);
  assert.doesNotMatch(functionsSource, /tokenHash:\s*sessionToken|deviceHash:\s*deviceId/);
});

test("paid lesson video and quiz delivery require the active session token", () => {
  assert.match(publicSource, /callProtectedLessonFunction\(getAuthorizedLessonVideoFn/);
  assert.match(publicSource, /callProtectedLessonFunction\(getAuthorizedLessonQuizFn/);
  assert.match(functionsSource, /allowedKeys: \["courseId", "lessonId", "sessionToken"\]/);
  assert.match(functionsSource, /allowedKeys: \["courseId", "lessonId", "mode", "sessionToken"\]/);
  assert.equal((functionsSource.match(/if \(access && !canUsePublicLesson && !isAdminAuth\(request\.auth\)\)/g) || []).length, 2);
  assert.match(functionsSource, /if \(access \|\| canUsePublicLesson\)/);
});
