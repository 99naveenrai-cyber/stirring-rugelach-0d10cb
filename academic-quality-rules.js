(function academicQualityRulesModule(global) {
  'use strict';

  function lintLaTeX(text) {
    const issues = [];
    const str = String(text || '');

    // 1. Check unclosed inline math $ ... $
    const dollarMatches = str.match(/\$/g);
    if (dollarMatches && dollarMatches.length % 2 !== 0) {
      issues.push({
        severity: 'error',
        ruleId: 'latex-unclosed-inline-math',
        message: 'Unclosed inline math delimiter ($) found.'
      });
    }

    // 2. Check unclosed LaTeX display math \[ ... \]
    const openDisplay = (str.match(/\\\[/g) || []).length;
    const closeDisplay = (str.match(/\\\]/g) || []).length;
    if (openDisplay !== closeDisplay) {
      issues.push({
        severity: 'error',
        ruleId: 'latex-unclosed-display-math',
        message: 'Mismatch between open \\[ and close \\] LaTeX display delimiters.'
      });
    }

    return issues;
  }

  function lintScientificAccuracy(text) {
    const issues = [];
    const str = String(text || '');

    // 1. Flag unverified/hallucinated source citations
    if (/(?:according to a study in 20\d\d|researchers at MIT found that 100%|guaranteed 100% marks)/i.test(str)) {
      issues.push({
        severity: 'warning',
        ruleId: 'accuracy-unverified-citation',
        message: 'Unverified citation or promotional guarantee statement detected.'
      });
    }

    // 2. Check broken LaTeX math placeholders like [MATH_ERROR]
    if (/\[MATH_ERROR\]|\[INVALID_FORMULA\]/i.test(str)) {
      issues.push({
        severity: 'error',
        ruleId: 'accuracy-broken-formula',
        message: 'Broken formula placeholder detected in academic content.'
      });
    }

    return issues;
  }

  function auditContentQuality(item) {
    if (!item || typeof item !== 'object') {
      return { passed: false, score: 0, issues: [{ severity: 'error', ruleId: 'invalid-item', message: 'Item must be an object' }] };
    }

    const allIssues = [];

    // Audit string fields
    const textFields = [item.introduction, item.summary, item.question, item.answer, item.explanation];
    textFields.forEach(field => {
      if (typeof field === 'string') {
        allIssues.push(...lintLaTeX(field));
        allIssues.push(...lintScientificAccuracy(field));
      }
    });

    const errorCount = allIssues.filter(i => i.severity === 'error').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;

    let score = 100 - (errorCount * 25) - (warningCount * 10);
    if (score < 0) score = 0;

    return {
      passed: errorCount === 0,
      score: score,
      errorCount,
      warningCount,
      issues: allIssues
    };
  }

  const api = {
    lintLaTeX,
    lintScientificAccuracy,
    auditContentQuality
  };

  global.IdeaKDCAcademicQualityRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
