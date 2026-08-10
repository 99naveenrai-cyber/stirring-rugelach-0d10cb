const test = require('node:test');
const assert = require('node:assert/strict');
const socialProof = require('../academic-social-proof.js');

test('Stage 8 validates result schema correctly', () => {
  const validResult = {
    studentName: 'Rohan Sharma',
    exam: 'Class 10 CBSE',
    score: '97.6%',
    rank: 'Rank 1',
    year: '2026',
    image: '',
    verified: true
  };
  assert.equal(socialProof.validateResultSchema(validResult), true);

  const invalidResult = {
    studentName: 'Invalid Item'
    // Missing exam, score, verified
  };
  assert.equal(socialProof.validateResultSchema(invalidResult), false);
});

test('Stage 8 validates testimonial schema correctly', () => {
  const validTestimonial = {
    studentName: 'Priya Verma',
    classOrExam: 'Class 12 Science',
    quote: 'Excellent concept clarity and live quiz support.',
    image: '',
    verified: true
  };
  assert.equal(socialProof.validateTestimonialSchema(validTestimonial), true);

  const invalidTestimonial = {
    studentName: 'Invalid Item'
  };
  assert.equal(socialProof.validateTestimonialSchema(invalidTestimonial), false);
});

test('developer placeholders are flagged verified: false and hidable in production mode', () => {
  const defaultResults = socialProof.developerResultsPlaceholder;
  assert.ok(defaultResults.length > 0);
  assert.equal(defaultResults.every(r => r.verified === false), true);

  // In production (includePlaceholdersInDev = false), empty verified list returns 0
  const prodResults = socialProof.getVerifiedResults(defaultResults, false);
  assert.equal(prodResults.length, 0);

  // When a verified student result is added, it is retained in production
  const verifiedList = [
    ...defaultResults,
    { studentName: 'Real Student', exam: 'Class 10', score: '99%', rank: '1', year: '2026', image: '', verified: true }
  ];
  const prodFiltered = socialProof.getVerifiedResults(verifiedList, false);
  assert.equal(prodFiltered.length, 1);
  assert.equal(prodFiltered[0].studentName, 'Real Student');
});
