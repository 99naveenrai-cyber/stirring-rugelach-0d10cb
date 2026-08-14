"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const adminSource = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const publicSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");

test("admin exposes organized registered, interest, and live-now tabs", () => {
  for (const id of [
    "live-audience-tab-registered",
    "live-audience-tab-interests",
    "live-audience-tab-now",
    "live-audience-session-filter",
    "live-audience-view-all",
    "live-audience-view-selected",
    "live-audience-content"
  ]) assert.match(adminSource, new RegExp(`id=["']${id}["']`));
  assert.match(adminSource, /const adminListLiveAudienceFn = httpsCallable\(functions, 'adminListLiveAudience'\)/);
});

test("admin audience data is fetched only through an admin-authorized callable", () => {
  const callable = functionsSource.match(/exports\.adminListLiveAudience = onCall\([\s\S]*?\n\}\);/);
  assert.ok(callable, "admin audience callable exists");
  assert.match(callable[0], /requireAdminAuth\(request\)/);
  assert.match(callable[0], /collection\('liveRegistrations'\)/);
  assert.match(callable[0], /collection\('liveClassRequests'\)/);
  assert.match(callable[0], /collection\('livePresence'\)/);
  assert.match(callable[0], /activeWindowMs = 150 \* 1000/);
});

test("student presence requires exact live registration and cannot grant access", () => {
  const callable = functionsSource.match(/exports\.updateLiveClassPresence = onCall\([\s\S]*?\n\}\);/);
  assert.ok(callable, "student presence callable exists");
  assert.match(callable[0], /requireAuth\(request\)/);
  assert.match(callable[0], /collection\('liveRegistrations'\)\.doc\(sessionId\)\.collection\('students'\)\.doc\(auth\.uid\)/);
  assert.match(callable[0], /registrationSnap\.data\(\)\?\.access === false/);
  assert.match(callable[0], /sessionSnap\.data\(\)\?\.status !== 'live'/);
  assert.doesNotMatch(callable[0], /access:\s*true/);
});

test("admin student-controlled values use textContent rendering", () => {
  const rendererStart = adminSource.indexOf("function createAudienceTable");
  const rendererEnd = adminSource.indexOf("window.onLiveSyncOffsetChange", rendererStart);
  const renderer = adminSource.slice(rendererStart, rendererEnd);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart);
  assert.match(renderer, /td\.textContent = liveAudienceText\(value\)/);
  assert.match(renderer, /name\.textContent = liveAudienceText\(row\.name/);
  assert.match(renderer, /email\.textContent = liveAudienceText\(row\.email\)/);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
});

test("live screen supports all and persisted selected students", () => {
  assert.match(adminSource, /liveAudienceView === 'selected' \? rows\.filter/);
  assert.match(adminSource, /localStorage\.setItem\(liveAudienceSelectionKey\(\), JSON\.stringify\(\[\.\.\.selected\]\)\)/);
  assert.match(adminSource, /checkbox\.addEventListener\('change'/);
});

test("live player starts and stops attendance presence without changing playback access", () => {
  assert.match(publicSource, /startLiveClassPresence\(sessionId\)/);
  assert.match(publicSource, /setInterval\(\(\) => \{[\s\S]*?sendLiveClassPresence[\s\S]*?45000\)/);
  assert.match(publicSource, /function exitLiveStream\(\)[\s\S]*?stopLiveClassPresence\(\)/);
  assert.match(publicSource, /window\.addEventListener\('pagehide',[\s\S]*?stopLiveClassPresence\(\)/);
  assert.match(publicSource, /updatePresence: \(payload\) => updateLiveClassPresenceFn\(payload\)/);
  assert.match(publicSource, /getPlayerAccess: \(payload\) => getPlayerAccessFn\(payload\)/);
});

test("public and admin Firebase modules remain syntactically valid", () => {
  for (const source of [publicSource, adminSource]) {
    const moduleMatch = source.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(moduleMatch);
    new vm.SourceTextModule(moduleMatch[1]);
  }
});
