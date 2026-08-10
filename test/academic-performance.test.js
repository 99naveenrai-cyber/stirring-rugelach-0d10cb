const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('index.html includes font preconnect hints and display swap for performance', () => {
  assert.match(indexSource, /rel="preconnect"\s+href="https:\/\/fonts\.googleapis\.com"/i);
  assert.match(indexSource, /rel="preconnect"\s+href="https:\/\/fonts\.gstatic\.com"/i);
  assert.match(indexSource, /display=swap/i);
});

test('academic scripts use deferred or module execution for fast rendering', () => {
  assert.match(indexSource, /script src="academic-performance\.js"/);
});

test('Stage 14 academic-performance.js exposes performance initializers', () => {
  const perfModule = require('../academic-performance.js');
  assert.ok(perfModule);
  assert.equal(typeof perfModule.preconnectOrigin, 'function');
});
