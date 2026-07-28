"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..", "..");

test("Firebase Hosting has non-breaking baseline security headers", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  const headers = Object.fromEntries(
    config.hosting.headers[0].headers.map(({ key, value }) => [key, value])
  );
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Strict-Transport-Security"], /max-age=31536000/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /script-src|connect-src|img-src/);
});

test("Firestore rules contain field allowlists and no globally open writes", () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  assert.match(rules, /validUserCreate/);
  assert.match(rules, /validEnrollmentCreate/);
  assert.match(rules, /validSeparateQuizCreate/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly/);
  assert.doesNotMatch(rules, /allow\s+(?:read,\s*)?write\s*:\s*if\s+true/);
});

test("deployment workflow runs Functions and Firestore rule verification", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "firebase-hosting-merge.yml"),
    "utf8"
  );
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /emulators:exec --only auth,firestore/);
  assert.match(workflow, /deploy --only firestore:rules/);
});
