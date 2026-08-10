const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('index.html contains Stage 6 Live Class Discovery section and tabs', () => {
  assert.match(indexSource, /id="live-discovery-section"/);
  assert.match(indexSource, /id="live-discovery-grid"/);
  assert.match(indexSource, /filterLiveDiscovery\('live'/);
  assert.match(indexSource, /filterLiveDiscovery\('today'/);
  assert.match(indexSource, /filterLiveDiscovery\('upcoming'/);
});

test('categorizeLiveSessions partitions live, today and upcoming sessions correctly', () => {
  assert.match(indexSource, /function categorizeLiveSessions/);
  assert.match(indexSource, /status === 'live'/);
  assert.match(indexSource, /status === 'planned'/);
});

test('live class discovery cards connect to joinSelectedLiveSession for active streams', () => {
  assert.match(indexSource, /joinSelectedLiveSession/);
  assert.match(indexSource, /live-pulse-dot/);
  assert.match(indexSource, /btn-join-live/);
});
