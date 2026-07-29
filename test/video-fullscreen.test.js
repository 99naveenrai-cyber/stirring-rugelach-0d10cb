"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("active video stage exposes a responsive fullscreen control", () => {
  assert.match(source, /id="player-fullscreen-btn"/);
  assert.match(source, /onclick="toggleLessonFullscreen\(\)"/);
  assert.match(source, /navigationUI: 'hide'/);
  assert.match(source, /\.lesson-player-stage\.has-active-video \.player-fullscreen-btn\{display:grid\}/);
  assert.match(source, /\.lesson-player-stage:fullscreen/);
  assert.match(source, /classList\.toggle\('has-active-video', !!\(embedSrc \|\| nativeVideoUrl\)\)/);
});

test("fullscreen implementation supports standard, WebKit, and exit paths", () => {
  assert.match(source, /stage\.requestFullscreen/);
  assert.match(source, /stage\.webkitRequestFullscreen/);
  assert.match(source, /nativeVideo\?\.webkitEnterFullscreen/);
  assert.match(source, /document\.exitFullscreen/);
  assert.match(source, /document\.webkitExitFullscreen/);
  assert.match(source, /document\.addEventListener\('fullscreenchange'/);
  assert.match(source, /document\.addEventListener\('webkitfullscreenchange'/);
  assert.match(source, /exitLessonFullscreen\(\);\s*stopAndUnloadActiveLessonVideo\(\)/);
});
