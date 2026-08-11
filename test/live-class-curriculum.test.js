"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const dataSource = fs.readFileSync(path.join(root, "ncert_curriculum_data.js"), "utf8");
const accessSource = fs.readFileSync(path.join(root, "curriculum-access.js"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const publicSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

function loadCurriculum() {
  const context = vm.createContext({ window: {} });
  new vm.Script(dataSource).runInContext(context);
  new vm.Script(accessSource).runInContext(context);
  return context.window.IdeaKDCCurriculum;
}

test("admin and public live-class flows load the same curriculum data source", () => {
  for (const source of [adminSource, publicSource]) {
    const dataIndex = source.indexOf('<script src="ncert_curriculum_data.js"></script>');
    const accessIndex = source.indexOf('<script src="curriculum-access.js"></script>');
    assert.ok(dataIndex >= 0, "curriculum data script is loaded");
    assert.ok(accessIndex > dataIndex, "curriculum access helper loads after its data");
  }

  assert.match(adminSource, /IdeaKDCCurriculum\?\.getSubjects\(c, s\)/);
  assert.match(adminSource, /IdeaKDCCurriculum\?\.getChapters\(c, subjSlug, streamSlug\)/);
  assert.match(publicSource, /IdeaKDCCurriculum\?\.getSubjects\(_navClass, _navStream/);
  assert.match(publicSource, /IdeaKDCCurriculum\?\.getChapters\(_navClass, subjSlug, streamSlug\)/);
});

test("supplied school subject documents are available to live-class planning", () => {
  const curriculum = loadCurriculum();
  assert.deepEqual(
    Array.from(curriculum.getSubjects("10"), item => item.title),
    ["Mathematics", "Science", "English", "Social Science"]
  );
  assert.ok(curriculum.getChapters("6", "mathematics").some(item => item.title.includes("Patterns in Mathematics")));
  assert.ok(curriculum.getChapters("8", "science").some(item => item.title.includes("Light: Mirrors and Lenses")));
  assert.ok(curriculum.getChapters("10", "english").some(item => item.title.includes("Book That Saved the Earth")));
  assert.ok(curriculum.getChapters("10", "social-science").some(item => item.title.includes("Consumer Rights")));
});

test("Classes 11 and 12 resolve distinct stream subjects and chapter lists", () => {
  const curriculum = loadCurriculum();
  assert.deepEqual(
    Array.from(curriculum.getSubjects("11", "science"), item => item.title),
    ["English", "Mathematics", "Physics", "Chemistry"]
  );
  assert.deepEqual(
    Array.from(curriculum.getSubjects("11", "commerce"), item => item.title),
    ["English", "Accountancy", "Economics", "Business Studies"]
  );
  assert.deepEqual(
    Array.from(curriculum.getSubjects("12", "humanities"), item => item.title),
    ["English", "Political Science", "History", "Geography", "Hindi Core"]
  );

  const class11Physics = curriculum.getChapters("11", "physics", "science");
  const class12Physics = curriculum.getChapters("12", "physics", "science");
  assert.equal(class11Physics[0].title, "Ch 1: Units and Measurements");
  assert.equal(class12Physics[0].title, "Ch 1: Electric Charges and Fields");
  assert.equal(class12Physics.at(-1).title, "Ch 14: Semiconductor Electronics: Materials, Devices and Simple Circuits");
  assert.equal(curriculum.getChapters("11", "economics", "commerce").length, 18);
  assert.equal(curriculum.getChapters("12", "geography", "humanities").length, 17);
});

test("planned live sessions stay scoped to the selected class, stream, subject and chapter", () => {
  assert.match(publicSource, /s\.classNum === _navClass/);
  assert.match(publicSource, /s\.subject === _navSubject/);
  assert.match(publicSource, /normalizeLiveStream\(s\.stream\) === normalizeLiveStream/);
  assert.match(publicSource, /!s\.chapter \|\| s\.chapter === chap/);
  assert.doesNotMatch(
    publicSource,
    /\|\| _livePlannedSessions\.find\(s => s\.classNum === _navClass && s\.subject === _navSubject\)/
  );
});

test("Humanities stream aliases and Hindi Core remain backend-compatible", () => {
  const functionsSource = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
  assert.match(functionsSource, /LIVE_CLASS_STREAMS = \['science','commerce','arts','humanities'\]/);
  assert.match(functionsSource, /'11-arts':\s+\[[^\]]*'Hindi Core'/);
  assert.match(functionsSource, /'11-humanities':\s*\[[^\]]*'Hindi Core'/);
  assert.match(functionsSource, /'12-arts':\s+\[[^\]]*'Hindi Core'/);
  assert.match(functionsSource, /'12-humanities':\s*\[[^\]]*'Hindi Core'/);
});

test("admin live-class save preserves the selected hierarchy fields", () => {
  assert.match(adminSource, /const classNum = document\.getElementById\('lc-class'\)\.value/);
  assert.match(adminSource, /const stream = document\.getElementById\('lc-stream'\)\.value/);
  assert.match(adminSource, /const subject = document\.getElementById\('lc-subject'\)\.value/);
  assert.match(adminSource, /const chapter = document\.getElementById\('lc-chapter'\)\?\.value/);
  assert.match(adminSource, /adminSaveLiveClassFn\(\{[\s\S]*?classNum,[\s\S]*?stream:[\s\S]*?subject,[\s\S]*?chapter,/);
});
