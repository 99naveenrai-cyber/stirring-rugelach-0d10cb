const test = require('node:test');
const assert = require('node:assert/strict');
const auditSuite = require('../academic-audit-suite.js');

test('Stage 19 runPlatformAudit verifies complete architectural health across 6 core checks', () => {
  const report = auditSuite.runPlatformAudit();

  assert.equal(report.passed, true);
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 6);

  report.checks.forEach(check => {
    assert.equal(check.passed, true, `Check failed: ${check.name} - ${check.details}`);
  });
});
