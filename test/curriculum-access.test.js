"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "curriculum-access.js"), "utf8");

function apiFor(data) {
  const context = vm.createContext({ window: { NCERT_CURRICULUM_2026_27: data } });
  new vm.Script(helperSource).runInContext(context);
  return context.window.IdeaKDCCurriculum;
}

test("admin module parses and each login button has one dispatch path", () => {
  const source = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  const moduleMatch = source.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(moduleMatch, "admin module script is present");
  new vm.SourceTextModule(moduleMatch[1]);
  assert.equal((source.match(/function updateLcSubjectOptions\(/g) || []).length, 1);
  assert.equal((source.match(/onclick="doLogin\(\)"/g) || []).length, 1);
  assert.equal((source.match(/addEventListener\('click', doLoginHandler\)/g) || []).length, 0);
  assert.equal((source.match(/onclick="doGoogleLogin\(\)"/g) || []).length, 1);
  assert.equal((source.match(/addEventListener\('click', doGoogleLoginHandler\)/g) || []).length, 0);
});

test("flat curriculum resolves class, stream subjects and chapters", () => {
  const api = apiFor({
    "6": { mathematics: ["Ch 1: Patterns"] },
    "11": { english: ["The Portrait"], "science-physics": ["Units and Measurements"] }
  });
  assert.deepEqual(Array.from(api.getSubjects("6"), item => item.title), ["Mathematics"]);
  assert.deepEqual(Array.from(api.getChapters("6", "mathematics"), item => item.title), ["Ch 1: Patterns"]);
  assert.deepEqual(Array.from(api.getSubjects("11", "science"), item => item.title), ["English", "Physics"]);
  assert.deepEqual(Array.from(api.getChapters("11", "physics", "science"), item => item.title), ["Units and Measurements"]);
});

test("structured curriculum resolves common subjects, streams and sections", () => {
  const api = apiFor({ classes: {
    "11": {
      commonSubjects: { english: { chapters: [{ id: "eng-1", title: "Reading" }] } },
      streams: { science: { subjects: {
        physics: { sections: [{ id: "mechanics", title: "Mechanics", chapters: [{ id: "motion", title: "Motion" }] }] }
      } } }
    }
  } });
  assert.deepEqual(Array.from(api.getStreams("11"), item => item.id), ["science"]);
  assert.deepEqual(Array.from(api.getSubjects("11", "science"), item => item.title), ["English", "Physics"]);
  assert.deepEqual(Array.from(api.getSections("11", "physics", "science"), item => item.title), ["Mechanics"]);
  assert.deepEqual(Array.from(api.getChapters("11", "physics", "science", "mechanics"), item => item.title), ["Motion"]);
  assert.equal(api.findChapterById("11", "physics", "motion", "science", "mechanics").title, "Motion");
});

test("missing curriculum levels return empty arrays", () => {
  const api = apiFor({});
  assert.deepEqual(Array.from(api.getStreams("12")), []);
  assert.deepEqual(Array.from(api.getSubjects("12", "commerce")), []);
  assert.deepEqual(Array.from(api.getSections("12", "economics", "commerce")), []);
  assert.deepEqual(Array.from(api.getChapters("12", "economics", "commerce")), []);
});
