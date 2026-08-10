const test = require('node:test');
const assert = require('node:assert/strict');
const qualityRules = require('../academic-quality-rules.js');

test('Stage 15 lintLaTeX detects unclosed math delimiters', () => {
  const cleanMath = 'The equation $E = mc^2$ is fundamental in physics.';
  assert.equal(qualityRules.lintLaTeX(cleanMath).length, 0);

  const brokenMath = 'The equation $E = mc^2 is unclosed.';
  const issues = qualityRules.lintLaTeX(brokenMath);
  assert.ok(issues.length > 0);
  assert.equal(issues[0].ruleId, 'latex-unclosed-inline-math');
});

test('Stage 15 lintScientificAccuracy flags broken formulas and unverified statements', () => {
  const brokenContent = 'Focal length equation [MATH_ERROR] cannot be calculated.';
  const issues = qualityRules.lintScientificAccuracy(brokenContent);
  assert.ok(issues.length > 0);
  assert.equal(issues[0].ruleId, 'accuracy-broken-formula');

  const unverifiedContent = 'This course gives guaranteed 100% marks in board exams.';
  const warnIssues = qualityRules.lintScientificAccuracy(unverifiedContent);
  assert.ok(warnIssues.length > 0);
  assert.equal(warnIssues[0].ruleId, 'accuracy-unverified-citation');
});

test('auditContentQuality returns 100 score for valid clean academic content', () => {
  const cleanItem = {
    question: 'Calculate focal length when $R = 20\\text{ cm}$.',
    explanation: 'Using formula $f = R/2 = 20/2 = 10\\text{ cm}$.'
  };

  const audit = qualityRules.auditContentQuality(cleanItem);
  assert.equal(audit.passed, true);
  assert.equal(audit.score, 100);
  assert.equal(audit.errorCount, 0);
});
