"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const studentSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function functionBlock(name, nextName) {
  const start = studentSource.indexOf(`function ${name}`);
  const end = studentSource.indexOf(nextName, start);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} block must be readable`);
  return studentSource.slice(start, end);
}

test("confirmation is scoped to video navigation and guarded against duplicates", () => {
  const videoStart = studentSource.indexOf('<div class="page" id="page-video">');
  const videoEnd = studentSource.indexOf("<!--", videoStart + 1);
  const videoMarkup = studentSource.slice(videoStart, videoEnd);
  const paymentStart = studentSource.indexOf('<div class="page" id="page-payment">');
  const paymentEnd = studentSource.indexOf('<div class="page" id="page-dashboard">');
  const paymentMarkup = studentSource.slice(paymentStart, paymentEnd);
  const confirmation = functionBlock("showVideoExitConfirmation", "window.requestVideoBackNavigation");
  const popstateStart = studentSource.indexOf("window.addEventListener('popstate'");
  const popstateEnd = studentSource.indexOf("function pushHistory", popstateStart);
  const popstate = studentSource.slice(popstateStart, popstateEnd);

  assert.match(videoMarkup, /onclick="requestVideoBackNavigation\(\)"/);
  assert.match(paymentMarkup, /onclick="goBack\(\)"/);
  assert.match(studentSource, /सच में जा रहे हो\?/);
  assert.match(studentSource, /देख ही लेते हैं/);
  assert.match(studentSource, /नहीं, अभी नहीं देखना/);
  assert.match(confirmation, /if \(videoExitConfirmOpen/);
  assert.match(confirmation, /videoExitDecisionPending/);
  assert.match(popstate, /videoExitGuardRestoring/);
  assert.match(popstate, /showVideoExitConfirmation\(\)/);
});

test("lifecycle helpers pause, resume, stop, and unload YouTube and HTML5 media", () => {
  const calls = [];
  const iframe = {
    contentWindow: { postMessage: (message) => calls.push(JSON.parse(message).func) },
    remove: () => calls.push("iframe-remove"),
    set src(value) { calls.push(`iframe-src:${value}`); }
  };
  const video = {
    pause: () => calls.push("video-pause"),
    play: () => {
      calls.push("video-play");
      return Promise.resolve();
    },
    removeAttribute: (name) => calls.push(`video-remove-${name}`),
    load: () => calls.push("video-load"),
    remove: () => calls.push("video-remove")
  };
  const context = {
    document: {
      querySelector: () => iframe,
      querySelectorAll: (selector) => selector.endsWith(" video") ? [video] : [iframe],
      getElementById: () => ({ classList: { remove: () => calls.push("fullscreen-state-clear") } })
    },
    syncLessonFullscreenButton: () => calls.push("fullscreen-button-sync"),
    window: {
      _activeLessonPlayer: {
        pauseVideo: () => calls.push("yt-pause"),
        playVideo: () => calls.push("yt-play"),
        stopVideo: () => calls.push("yt-stop"),
        destroy: () => calls.push("yt-destroy")
      },
      clearTimeout: () => {},
      clearInterval: () => {}
    }
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock("pauseActiveLessonVideo", "function resumeActiveLessonVideo"),
    functionBlock("resumeActiveLessonVideo", "function stopAndUnloadActiveLessonVideo"),
    functionBlock("stopAndUnloadActiveLessonVideo", "function emitVideoExitParticles")
  ].join("\n"), context);

  context.pauseActiveLessonVideo();
  context.resumeActiveLessonVideo();
  context.stopAndUnloadActiveLessonVideo();

  ["yt-pause", "yt-play", "yt-stop", "yt-destroy", "video-pause", "video-remove-src",
    "video-load", "video-remove", "iframe-src:about:blank", "iframe-remove"].forEach((call) => {
    assert.ok(calls.includes(call), `${call} must occur`);
  });
  assert.equal(context.window._activeLessonPlayer, null);
  assert.match(studentSource, /window\.addEventListener\('pagehide'/);
});
