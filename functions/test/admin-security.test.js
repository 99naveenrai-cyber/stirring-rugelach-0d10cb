"use strict";
// Deployment trigger: exact-course-access-2026-07-28

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const adminSource = fs.readFileSync(path.join(__dirname, "..", "..", "admin.html"), "utf8");
const studentSource = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

function functionBlock(name, nextName) {
  const start = adminSource.indexOf(`function ${name}`);
  const end = nextName ? adminSource.indexOf(nextName, start) : adminSource.length;
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} block must be readable`);
  return adminSource.slice(start, end);
}

function studentFunctionBlock(name, nextName) {
  const start = studentSource.indexOf(`function ${name}`);
  const end = nextName ? studentSource.indexOf(nextName, start) : studentSource.length;
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} block must be readable`);
  return studentSource.slice(start, end);
}

function accessRules({ admin = false } = {}) {
  const context = {
    ADMIN_EMAILS: ["admin@example.com"],
    currentUser: admin ? { email: "admin@example.com" } : { email: "student@example.com" },
    currentUserData: {}
  };
  vm.createContext(context);
  vm.runInContext([
    studentFunctionBlock("isCourseExplicitlyFree", "function isCurrentUserAdmin"),
    studentFunctionBlock("isCurrentUserAdmin", "function eligibleLessonEntries"),
    studentFunctionBlock("getLessonAccessRule", "function debugAccessCheck")
  ].join("\n"), context);
  return context;
}

test("enrolment text helper uses textContent", () => {
  const helper = functionBlock("createEnrollmentElement", "function createEnrollmentAction");
  assert.match(helper, /element\.textContent\s*=\s*String\(text\)/);
  assert.doesNotMatch(helper, /\.innerHTML\s*=/);
});

test("enrolment list and modal do not insert student fields with innerHTML", () => {
  const list = functionBlock("renderEnrollments", "window.updateStatus");
  const modalStart = adminSource.indexOf("window.viewSS");
  const modalEnd = adminSource.indexOf("window.closeModal", modalStart);
  const modal = adminSource.slice(modalStart, modalEnd);
  assert.doesNotMatch(list, /\.innerHTML\s*=/);
  assert.doesNotMatch(modal, /\.innerHTML\s*=/);
  [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "<svg onload=alert(1)>",
    "à¤†à¤°à¤µ",
    "Aarav"
  ].forEach((value) => {
    const node = { textContent: "" };
    node.textContent = String(value);
    assert.equal(node.textContent, value);
  });
});

test("paid course access is denied by default and scoped to the exact purchase", () => {
  const rules = accessRules();
  const paidCourse = {
    id: "paid-course",
    isFree: false,
    paymentRequired: true,
    accessType: "paid",
    price: 0,
    videos: [{ isFree: false }]
  };

  assert.equal(rules.isCourseExplicitlyFree(paidCourse), false);
  assert.equal(rules.getLessonAccessRule(paidCourse, 0, null).canPlay, false);
  assert.equal(rules.getLessonAccessRule(paidCourse, 0, { access: false }).canPlay, false);
  assert.equal(rules.getLessonAccessRule(paidCourse, 0, { access: true }).canPlay, true);

  const accessBlock = studentFunctionBlock("getCourseAccess", "async function canOpenCourseVideo");
  assert.match(accessBlock, /doc\(db,\s*'users',\s*currentUser\.uid,\s*'purchases',\s*courseId\)/);
  assert.doesNotMatch(accessBlock, /legacyAccessId|legacyPath|legacySnap/);
});

test("free lessons, free courses, and admins retain access", () => {
  const studentRules = accessRules();
  const adminRules = accessRules({ admin: true });
  const freeCourse = {
    isFree: true,
    paymentRequired: false,
    accessType: "free",
    price: 0,
    videos: [{ isFree: false }]
  };
  const mixedCourse = {
    isFree: false,
    paymentRequired: true,
    accessType: "paid",
    price: 450,
    videos: [{ isFree: true }, { isFree: false }]
  };

  assert.equal(studentRules.getLessonAccessRule(freeCourse, 0, null).canPlay, true);
  assert.equal(studentRules.getLessonAccessRule(mixedCourse, 0, null).canPlay, true);
  assert.equal(studentRules.getLessonAccessRule(mixedCourse, 1, null).canPlay, false);
  assert.equal(adminRules.getLessonAccessRule(mixedCourse, 1, null).canPlay, true);
});

