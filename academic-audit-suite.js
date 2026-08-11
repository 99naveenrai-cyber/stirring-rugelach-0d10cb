(function academicAuditSuiteModule(global) {
  'use strict';

  function runPlatformAudit() {
    const report = {
      timestamp: new Date().toISOString(),
      passed: true,
      checks: []
    };

    function recordCheck(name, passed, details = '') {
      report.checks.push({ name, passed, details });
      if (!passed) report.passed = false;
    }

    // 1. Taxonomy & Route Integrity Check
    try {
      const taxonomyOk = Boolean(global.IdeaKDCAcademicNavigation || (typeof module !== 'undefined' && require('./academic-navigation.js')));
      recordCheck('Taxonomy Routing Integrity', taxonomyOk, 'Academic taxonomy routing active.');
    } catch (e) {
      recordCheck('Taxonomy Routing Integrity', false, e.message);
    }

    // 2. SEO Metadata Infrastructure Check
    try {
      const seoMod = global.IdeaKDCAcademicSeoInfra || (typeof module !== 'undefined' && require('./academic-seo-infrastructure.js'));
      const canonical = seoMod.buildCanonicalUrl('/class-10/');
      const seoOk = canonical.startsWith('https://betalaunch.ideakdc.in');
      recordCheck('SEO Metadata & Canonical HTTPS', seoOk, `Canonical URL: ${canonical}`);
    } catch (e) {
      recordCheck('SEO Metadata & Canonical HTTPS', false, e.message);
    }

    // 3. Search Indexing Logic Check
    try {
      const searchMod = global.IdeaKDCAcademicSearch || (typeof module !== 'undefined' && require('./academic-search.js'));
      const sampleIndex = searchMod.buildSearchIndex(
        [{ id: '10', name: 'Class 10', subjects: [{ id: 'science', name: 'Science', chapters: ['Light'] }] }],
        [],
        ['notes']
      );
      const searchOk = Array.isArray(sampleIndex) && sampleIndex.length > 0;
      recordCheck('Search Indexing Logic', searchOk, `Indexed ${sampleIndex.length} items.`);
    } catch (e) {
      recordCheck('Search Indexing Logic', false, e.message);
    }

    // 4. Content Quality Rules Check
    try {
      const qualityMod = global.IdeaKDCAcademicQualityRules || (typeof module !== 'undefined' && require('./academic-quality-rules.js'));
      const auditRes = qualityMod.auditContentQuality({ question: 'Test math $E=mc^2$' });
      recordCheck('Content Quality & LaTeX Audit', auditRes.passed, `Quality Score: ${auditRes.score}`);
    } catch (e) {
      recordCheck('Content Quality & LaTeX Audit', false, e.message);
    }

    // 5. Bilingual Support Check
    try {
      const biMod = global.IdeaKDCAcademicBilingual || (typeof module !== 'undefined' && require('./academic-bilingual.js'));
      const biTitle = biMod.getBilingualTitle('Light', 'प्रकाश', 'bilingual');
      recordCheck('Bilingual Hindi-English Architecture', biTitle.includes('/'), `Title: ${biTitle}`);
    } catch (e) {
      recordCheck('Bilingual Hindi-English Architecture', false, e.message);
    }

    // 6. Competitive Exams Hub Check
    try {
      const compMod = global.IdeaKDCAcademicCompetitiveExams || (typeof module !== 'undefined' && require('./academic-competitive-exams.js'));
      const list = compMod.getCompetitiveExams();
      recordCheck('Competitive Exam Hubs (BPSC, UPSC, UPPCS, SSC, JEE, NEET)', list.length === 7, `Configured ${list.length} hubs.`);
    } catch (e) {
      recordCheck('Competitive Exam Hubs', false, e.message);
    }

    return report;
  }

  const api = {
    runPlatformAudit
  };

  global.IdeaKDCAcademicAuditSuite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
