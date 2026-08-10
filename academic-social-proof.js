(function academicSocialProofModule(global) {
  'use strict';

  // ════════════════════════════════════════
  // STAGE 8 — RESULTS & TESTIMONIALS DATA SCHEMA
  // Note: All initial records are developer placeholders (verified: false)
  // Replace with genuine verified student data before public launch.
  // ════════════════════════════════════════

  const developerResultsPlaceholder = [
    {
      studentName: 'Student Name (Placeholder)',
      exam: 'Class 10 CBSE Board',
      score: '98.4%',
      rank: 'Top District Rank',
      year: '2026',
      image: '',
      verified: false
    },
    {
      studentName: 'Aspirant Name (Placeholder)',
      exam: 'BPSC Prelims',
      score: 'Qualified',
      rank: 'Rank -- (Verified Pending)',
      year: '2026',
      image: '',
      verified: false
    }
  ];

  const developerTestimonialsPlaceholder = [
    {
      studentName: 'Learner Name (Placeholder)',
      classOrExam: 'Class 12 Science',
      quote: 'IdeaKDC live classes and chapter-wise MCQ practice helped me clarify difficult Physics and Chemistry concepts.',
      image: '',
      verified: false
    },
    {
      studentName: 'Student Name (Placeholder)',
      classOrExam: 'BPSC Mains Aspirant',
      quote: 'Structured notes, Bihar special study material, and regular practice questions provided excellent exam focus.',
      image: '',
      verified: false
    }
  ];

  function validateResultSchema(item) {
    return Boolean(
      item &&
      typeof item.studentName === 'string' &&
      typeof item.exam === 'string' &&
      typeof item.score === 'string' &&
      typeof item.verified === 'boolean'
    );
  }

  function validateTestimonialSchema(item) {
    return Boolean(
      item &&
      typeof item.studentName === 'string' &&
      typeof item.classOrExam === 'string' &&
      typeof item.quote === 'string' &&
      typeof item.verified === 'boolean'
    );
  }

  function getVerifiedResults(resultsList = developerResultsPlaceholder, includePlaceholdersInDev = true) {
    const list = Array.isArray(resultsList) ? resultsList : [];
    if (!includePlaceholdersInDev) {
      return list.filter(item => validateResultSchema(item) && item.verified === true);
    }
    return list.filter(validateResultSchema);
  }

  function getVerifiedTestimonials(testimonialsList = developerTestimonialsPlaceholder, includePlaceholdersInDev = true) {
    const list = Array.isArray(testimonialsList) ? testimonialsList : [];
    if (!includePlaceholdersInDev) {
      return list.filter(item => validateTestimonialSchema(item) && item.verified === true);
    }
    return list.filter(validateTestimonialSchema);
  }

  const api = {
    developerResultsPlaceholder,
    developerTestimonialsPlaceholder,
    validateResultSchema,
    validateTestimonialSchema,
    getVerifiedResults,
    getVerifiedTestimonials
  };

  global.IdeaKDCSocialProof = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
