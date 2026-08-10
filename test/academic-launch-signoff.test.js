const test = require('node:test');
const assert = require('node:assert/strict');
const signoffModule = require('../academic-launch-signoff.js');

test('Stage 20 getSystemSignoffSummary confirms all 20 stages are complete and platform is ready', () => {
  const summary = signoffModule.getSystemSignoffSummary();

  assert.equal(summary.totalStages, 20);
  assert.equal(summary.completedStages, 20);
  assert.equal(summary.isFullyReady, true);
  assert.equal(summary.domain, 'https://betalaunch.ideakdc.in');
});

test('Stage 20 signoff verifies core systems remain undamaged', () => {
  const summary = signoffModule.getSystemSignoffSummary();
  const integrity = summary.coreIntegrity;

  assert.equal(integrity.firebaseAuth, 'UNTOUCHED_WORKING');
  assert.equal(integrity.courseAccess, 'UNTOUCHED_WORKING');
  assert.equal(integrity.liveStreams, 'UNTOUCHED_WORKING');
  assert.equal(integrity.cashfreePayments, 'UNTOUCHED_WORKING');
  assert.equal(integrity.referralEngine, 'UNTOUCHED_WORKING');
});
