"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const publicHtml = read("index.html");
const adminHtml = read("admin.html");
const pwaScript = read("pwa-install-share.js");
const serviceWorker = read("service-worker.js");

test("public and admin pages expose installable manifests and visible install controls", () => {
  assert.match(publicHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(adminHtml, /rel="manifest" href="\/admin-manifest\.webmanifest"/);
  assert.match(publicHtml, /data-pwa-install/);
  assert.match(adminHtml, /data-pwa-install/);
  assert.match(publicHtml, /pwa-install-share\.js/);
  assert.match(adminHtml, /pwa-install-share\.js/);
});

test("both manifests are valid standalone apps with IdeaKDC icons", () => {
  for (const file of ["manifest.webmanifest", "admin-manifest.webmanifest"]) {
    const manifest = JSON.parse(read(file));
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.scope, "/");
    assert.ok(manifest.start_url.startsWith("/"));
    assert.ok(manifest.icons.some(icon => icon.src === "/assets/ideakdc-app-icon.svg"));
  }
});

test("service worker provides a network-first navigation fallback", () => {
  assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
  assert.match(serviceWorker, /fetch\(event\.request\)\.catch/);
  assert.match(serviceWorker, /caches\.match\('\/index\.html'\)/);
  new vm.Script(serviceWorker);
});

test("shared links use stable content identifiers without playback or payment data", () => {
  assert.match(pwaScript, /searchParams\.set\('courseId'/);
  assert.match(pwaScript, /searchParams\.set\('lessonId'/);
  assert.match(pwaScript, /searchParams\.set\('liveSessionId'/);
  assert.doesNotMatch(pwaScript, /youtubeVideoId|payment_session_id|cashfree_order_id|idToken/);
  assert.match(publicHtml, /function renderShareButton/);
  assert.match(publicHtml, />Share<\/button>/);
  assert.match(publicHtml, /background:linear-gradient\(135deg,#dc2626,#b91c1c\)/);
  assert.match(publicHtml, /kind: 'course'/);
  assert.match(publicHtml, /kind: 'lesson'/);
  assert.match(publicHtml, /kind: 'live'/);
});

test("shared live and lesson routes return to existing access-controlled flows", () => {
  assert.match(publicHtml, /async function handleSharedViewRoute/);
  assert.match(publicHtml, /await window\.openPlannedLiveSession\(liveSessionId\)/);
  assert.match(publicHtml, /await openCourseById\(courseId, \{ fromUrl: true \}\)/);
  assert.match(publicHtml, /const access = await getCourseAccess\(normalizedCourseId, course\)/);
  assert.match(publicHtml, /const desiredRule = getLessonAccessRule\(course, desiredIdx, access\)/);
});

test("install and sharing runtime remains syntactically valid", () => {
  new vm.Script(pwaScript);
  for (const html of [publicHtml, adminHtml]) {
    const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(moduleMatch);
    new vm.SourceTextModule(moduleMatch[1]);
  }
});
