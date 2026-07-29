"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("Cashfree checkout SDK is loaded on demand instead of blocking startup", () => {
  assert.doesNotMatch(source, /<script[^>]+sdk\.cashfree\.com\/js\/v3\/cashfree\.js/i);
  assert.match(source, /function loadCashfreeSdk\(\)/);
  assert.match(source, /script\.src = 'https:\/\/sdk\.cashfree\.com\/js\/v3\/cashfree\.js'/);
  assert.match(source, /const cashfree = await getCashfreeCheckout\(\)/);
  assert.match(source, /Cashfree\(\{ mode: 'sandbox' \}\)/);
});

test("authenticated startup releases the loader before waiting for profile and catalogue", () => {
  const start = source.indexOf("onAuthStateChanged(auth");
  const end = source.indexOf("function clearAccessState", start);
  const authBlock = source.slice(start, end);
  const hideIndex = authBlock.indexOf("hideLoader()");
  const waitIndex = authBlock.indexOf("await Promise.all([profilePromise, loadCourses()])");

  assert.ok(hideIndex >= 0, "loader release must exist");
  assert.ok(waitIndex > hideIndex, "loader must release before network startup work finishes");
  assert.match(authBlock, /profilePromise = getDoc/);
  assert.match(authBlock, /await Promise\.all\(\[profilePromise, loadCourses\(\)\]\)/);
});
