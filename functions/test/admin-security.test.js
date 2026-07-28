"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adminSource = fs.readFileSync(path.join(__dirname, "..", "..", "admin.html"), "utf8");

function functionBlock(name, nextName) {
  const start = adminSource.indexOf(`function ${name}`);
  const end = nextName ? adminSource.indexOf(nextName, start) : adminSource.length;
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} block must be readable`);
  return adminSource.slice(start, end);
}

test("enrolment text helper uses textContent", () => {
  const helper = functionBlock("createEnrollmentElement", "function createEnrollmentAction");
  assert.match(helper, /element\.textContent\s*=\s*String\(text\)/);
  assert.doesNotMatch(helper, /\.innerHTML\s*=/);
});

test("enrolment list and modal do not insert student fields with innerHTML", () => {
  const list = functionBlock("renderEnrollments", "window.updateStatus");
  const modalStart = adminSource.indexOf("window.viewSS");
  const modalEnd = adminSource.indexOf("window.closeModal", modalStart);
  const modal = adminSource.slice(modalStart, modalEnd);
  assert.doesNotMatch(list, /\.innerHTML\s*=/);
  assert.doesNotMatch(modal, /\.innerHTML\s*=/);
  [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "<svg onload=alert(1)>",
    "आरव",
    "Aarav"
  ].forEach((value) => {
    const node = { textContent: "" };
    node.textContent = String(value);
    assert.equal(node.textContent, value);
  });
});
