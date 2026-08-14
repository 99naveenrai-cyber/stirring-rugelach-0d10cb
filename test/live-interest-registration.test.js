"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const publicSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("unregistered live interest opens the existing two-method registration", () => {
  const handler = publicSource.match(/window\.registerUnplannedInterest = async \(chap\) => \{[\s\S]*?\n\};/);
  assert.ok(handler, "live interest handler exists");
  assert.match(handler[0], /savePendingLiveInterest\(pending\)/);
  assert.match(handler[0], /window\.closeLiveModal\(\)/);
  assert.match(handler[0], /window\.startConvoReg\(null\)/);
  assert.doesNotMatch(handler[0], /runtime\?\.showLogin\(\)/);
  assert.match(publicSource, /chooseStudentRegistration\('google'\)/);
  assert.match(publicSource, /chooseStudentRegistration\('details'\)/);
});

test("live interest context survives registration and restores the same selection", () => {
  assert.match(publicSource, /const PENDING_LIVE_INTEREST_KEY = 'ideakdcPendingLiveInterest'/);
  assert.match(publicSource, /classNum: String\(_navClass \|\| ''\)\.trim\(\)/);
  assert.match(publicSource, /subject: String\(_navSubject \|\| ''\)\.trim\(\)/);
  assert.match(publicSource, /chapter: String\(chapter \|\| _navChapter \|\| ''\)\.trim\(\)/);
  assert.match(publicSource, /window\.restoreUnplannedLiveInterestContext = async \(payload, result = \{\}\)/);
  assert.match(publicSource, /checkSessionAndShowCard\(_navChapter\)/);
});

test("completed registration submits interest before showing registered status", () => {
  const resume = publicSource.match(/async function resumePendingLiveInterestAfterRegistration\(\) \{[\s\S]*?\n\}/);
  assert.ok(resume, "post-registration live interest resume exists");
  assert.match(resume[0], /registerUnplannedLiveClassInterestFn\(\{/);
  assert.match(resume[0], /safeSessionRemove\('ideakdcPendingLiveInterest'\)/);
  assert.match(resume[0], /restoreUnplannedLiveInterestContext\?\.\(payload, \{ registered: true \}\)/);
  assert.match(publicSource, /if \(await resumePendingLiveInterestAfterRegistration\(\)\) return;\s*if \(await resumePendingCourseAfterLogin\(\)\) return;/);
  assert.match(publicSource, /statusEl\.textContent = 'Interest Registered'/);
});

test("public module remains syntactically valid", () => {
  const moduleMatch = publicSource.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(moduleMatch, "public Firebase module script is present");
  new vm.SourceTextModule(moduleMatch[1]);
});
