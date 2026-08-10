const test = require('node:test');
const assert = require('node:assert/strict');
const academicPages = require('../academic-pages.js');
const academicNav = require('../academic-navigation.js');

test('Stage 5 study resources exposes all 8 required categories', () => {
  const categories = academicNav.studyResourceCategories;
  assert.equal(Array.isArray(categories), true);
  assert.equal(categories.length, 8);

  const requiredIds = [
    'notes',
    'practice-test',
    'important-questions',
    'mcq',
    'revision',
    'formulas',
    'pyq',
    'live-classes'
  ];

  requiredIds.forEach(id => {
    const found = categories.find(c => c.id === id);
    assert.ok(found, `Resource category ${id} should exist`);
    assert.ok(found.label, `Resource ${id} must have a label`);
    assert.ok(found.description, `Resource ${id} must have a description`);
  });
});

test('academic-pages RESOURCE_TYPES supports all Stage 5 categories', () => {
  const types = academicPages.RESOURCE_TYPES;
  assert.equal(types.notes, 'Notes');
  assert.equal(types['practice-test'], 'Practice Test');
  assert.equal(types['important-questions'], 'Important Questions');
  assert.equal(types.mcq, 'MCQ Practice');
  assert.equal(types.revision, 'Revision');
  assert.equal(types.formulas, 'Formula Sheet');
  assert.equal(types.pyq, 'Previous Year Questions');
  assert.equal(types['live-classes'], 'Live Classes');
});

test('resource page model resolves valid resource paths and flags non-indexed placeholders', () => {
  const mockCurriculum = {
    getClasses: () => [{ id: '10', label: 'Class 10' }],
    getSubjects: (classId) => [{ id: 'science', title: 'Science', streamId: '' }],
    getChapters: () => [{ id: 'light', title: 'Light - Reflection and Refraction' }]
  };

  const route = academicPages.parseAcademicPath('/class-10/science/light/notes/');
  assert.ok(route);
  assert.equal(route.classId, '10');
  assert.equal(route.subjectId, 'science');
  assert.equal(route.resourceType, 'notes');

  const model = academicPages.createPageModel(route, mockCurriculum, [], {});
  assert.equal(model.found, true);
  assert.equal(model.resourceAvailable, false);
  assert.equal(model.indexable, false); // Empty resources stay noindex until real content exists
  assert.ok(model.title.includes('Notes'));
});
