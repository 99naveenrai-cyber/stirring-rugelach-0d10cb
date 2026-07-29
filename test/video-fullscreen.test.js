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
  assert.match(source, /document\.addEventListener\('fullscreenchange', syncLessonFullscreenControls\)/);
  assert.match(source, /document\.addEventListener\('webkitfullscreenchange', syncLessonFullscreenControls\)/);
  assert.match(source, /exitLessonFullscreen\(\);\s*stopAndUnloadActiveLessonVideo\(\)/);
});

test("landscape Separate Quiz can fullscreen the complete split workspace", () => {
  assert.match(source, /id="separate-quiz-fullscreen-btn"/);
  assert.match(source, /onclick="toggleSeparateQuizFullscreen\(\)"/);
  assert.match(source, /workspace\.requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(source, /workspace\.webkitRequestFullscreen\(\)/);
  assert.match(source, /\.separate-quiz-workspace:fullscreen/);
  assert.match(source, /orientation:landscape[\s\S]*separate-quiz-fullscreen-btn\{display:inline-flex/);
  assert.match(source, /button\.textContent = active \? '✕ Exit full page' : '⛶ Full page'/);
});

test("quiz confetti is mounted inside the active fullscreen tree", () => {
  assert.match(source, /const fullscreenHost = lessonFullscreenElement\(\)/);
  assert.match(source, /const layerHost = fullscreenHost\?\.appendChild \? fullscreenHost : document\.body/);
  assert.match(source, /layerHost\.appendChild\(layer\)/);
});
