"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LiveEventSyncManager,
  LiveStreamClock,
  targetStreamTime
} = require("../live-event-sync.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value)
  };
}

function fakePlayer(currentTime = 0, state = 1, duration = 620) {
  return {
    time: currentTime,
    state,
    duration,
    getCurrentTime() { return this.time; },
    getPlayerState() { return this.state; },
    getDuration() { return this.duration; }
  };
}

function managerFor(player, options = {}) {
  const displayed = [];
  const states = [];
  const manager = new LiveEventSyncManager({
    sessionId: options.sessionId || "session-1",
    clock: new LiveStreamClock(player),
    storage: options.storage || memoryStorage(),
    missThresholdSeconds: 5,
    onDisplay: (event, timing) => displayed.push({ event, timing }),
    onStateChange: (entry) => states.push(entry)
  });
  return { manager, displayed, states };
}

test("offset is applied on the stream media timeline", () => {
  assert.equal(targetStreamTime({ streamTime: 602.4, offsetMs: 500 }), 602.9);
  assert.equal(targetStreamTime({ streamTime: 602.4, offsetMs: 0 }), 602.4);
});

test("students with different latency display at the same media position", () => {
  const event = { eventId: "q1", streamTime: 602.4, offsetMs: 500, payload: { text: "Q" } };
  const studentA = fakePlayer(600.9);
  const studentB = fakePlayer(597.0);
  const a = managerFor(studentA);
  const b = managerFor(studentB);
  a.manager.ingest(event);
  b.manager.ingest(event);

  a.manager.tick();
  b.manager.tick();
  assert.equal(a.displayed.length, 0);
  assert.equal(b.displayed.length, 0);

  studentA.time = 602.94;
  a.manager.tick();
  assert.equal(a.displayed.length, 1);
  assert.ok(Math.abs(a.displayed[0].timing.syncErrorMs) <= 50);
  assert.equal(b.displayed.length, 0);

  studentB.time = 602.93;
  b.manager.tick();
  assert.equal(b.displayed.length, 1);
  assert.ok(Math.abs(b.displayed[0].timing.syncErrorMs) <= 50);
});

test("buffering and paused players do not display queued events", () => {
  const player = fakePlayer(603, 3);
  const { manager, displayed } = managerFor(player);
  manager.ingest({ eventId: "q-buffer", streamTime: 602.5, offsetMs: 0 });
  manager.tick();
  assert.equal(displayed.length, 0);
  player.state = 2;
  manager.tick();
  assert.equal(displayed.length, 0);
  player.state = 1;
  manager.tick();
  assert.equal(displayed.length, 1);
});

test("late joiners mark historical events missed", () => {
  const player = fakePlayer(620, 1);
  const { manager, displayed, states } = managerFor(player);
  manager.ingest({ eventId: "old-q", streamTime: 600, offsetMs: 0 });
  manager.tick();
  assert.equal(displayed.length, 0);
  assert.equal(manager.eventState("old-q").status, "missed");
  assert.ok(states.some((entry) => entry.status === "missed"));
});

test("events received before the YouTube player is ready are still checked as late", () => {
  const player = fakePlayer(0, -1);
  const { manager, displayed } = managerFor(player);
  manager.ingest({ eventId: "pre-ready-old-q", streamTime: 600, offsetMs: 0 });
  player.time = 620;
  player.state = 1;
  manager.tick();
  assert.equal(displayed.length, 0);
  assert.equal(manager.eventState("pre-ready-old-q").status, "missed");
});

test("refresh does not display an already displayed event twice", () => {
  const storage = memoryStorage();
  const player = fakePlayer(602.6, 1);
  const first = managerFor(player, { storage });
  const event = { eventId: "stable-q", streamTime: 602.5, offsetMs: 0 };
  first.manager.ingest(event);
  first.manager.tick();
  assert.equal(first.displayed.length, 1);

  const refreshed = managerFor(player, { storage });
  assert.equal(refreshed.manager.ingest(event), false);
  refreshed.manager.tick();
  assert.equal(refreshed.displayed.length, 0);
});

test("close questions remain ordered and never stack", () => {
  const player = fakePlayer(600, 1);
  const { manager, displayed } = managerFor(player);
  manager.ingest({ eventId: "q2", streamTime: 602.2, offsetMs: 0 });
  manager.ingest({ eventId: "q1", streamTime: 602.0, offsetMs: 0 });
  player.time = 602.3;
  manager.tick();
  assert.deepEqual(displayed.map((item) => item.event.eventId), ["q1"]);
  manager.tick();
  assert.deepEqual(displayed.map((item) => item.event.eventId), ["q1"]);
  manager.completeCurrent();
  manager.tick();
  assert.deepEqual(displayed.map((item) => item.event.eventId), ["q1", "q2"]);
});

test("admin, backend and student are wired to stream-timestamp events", () => {
  const admin = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  const student = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const functions = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
  assert.match(admin, /Question Sync Offset:/);
  assert.match(admin, /streamTime:[\s\S]*timingSource:[\s\S]*offsetMs:/);
  assert.match(student, /new window\.IdeaKDCLiveSync\.LiveEventSyncManager/);
  assert.match(student, /liveQuizState', sessionId, 'events'/);
  assert.doesNotMatch(student, /data && data\.active && data\.question\)[\s\S]{0,80}showLiveQuizOverlay\(data\.question\)/);
  assert.match(functions, /targetStreamTime/);
  assert.match(functions, /quizPlaybackMode: 'continue-live'/);
  assert.match(functions, /exports\.recordLiveQuizSync/);
});
