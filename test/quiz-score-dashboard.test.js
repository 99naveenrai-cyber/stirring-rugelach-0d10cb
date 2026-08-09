"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

test("all quiz modes submit through server-verified score sessions", () => {
  assert.match(html, /createQuizSessionId\('separate'\)/);
  assert.match(html, /createQuizSessionId\('popup'\)/);
  assert.match(html, /createQuizSessionId\?\.\('live'\)/);
  assert.match(html, /quizSessionId:\s*pendingItem\.quizSessionId/);
  assert.match(html, /submitVerifiedLiveQuizAnswer/);
  assert.match(functionsSource, /exports\.submitLiveQuizAnswer/);
  assert.match(functionsSource, /applyVerifiedQuizScoreWrites/);
});

test("student dashboard provides integrated ranks, profile editing and scorecard download", () => {
  assert.match(html, />Scores & Rank</);
  assert.match(html, /scoreScopeCard\('Integrated'/);
  assert.match(html, /scoreScopeCard\('Live'/);
  assert.match(html, /scoreScopeCard\('Popup'/);
  assert.match(html, /scoreScopeCard\('Separate'/);
  assert.match(html, /showStudentProfileEditor/);
  assert.match(html, /downloadLatestQuizScorecard/);
});

test("score collections remain backend-only in Firestore rules", () => {
  assert.doesNotMatch(rules, /match \/quizScoreSessions\/.*allow (read|write)/s);
  assert.doesNotMatch(rules, /match \/quizRankingPeriods\/.*allow (read|write)/s);
  assert.match(functionsSource, /exports\.getMyQuizScoreDashboard/);
});
