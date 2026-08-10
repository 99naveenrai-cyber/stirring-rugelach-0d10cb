const test = require('node:test');
const assert = require('node:assert/strict');
const schemaAdapter = require('../academic-schema-adapter.js');

test('Stage 11 validateAcademicSchema validates structured schema compliance', () => {
  const validSchema = {
    class: '10',
    stream: null,
    subject: 'Science',
    subjectSlug: 'science',
    chapters: [
      {
        name: 'Light – Reflection and Refraction',
        slug: 'light-reflection-and-refraction',
        description: 'Ray optics and lenses',
        resources: {
          notes: null,
          mcq: null,
          importantQuestions: null,
          revision: null,
          videos: []
        }
      }
    ]
  };

  const validation = schemaAdapter.validateAcademicSchema(validSchema);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);

  const invalidSchema = {
    class: '99', // Invalid class
    subject: 'Science'
  };
  const invalidVal = schemaAdapter.validateAcademicSchema(invalidSchema);
  assert.equal(invalidVal.valid, false);
  assert.ok(invalidVal.errors.length > 0);
});

test('toStructuredSchema converts flat inputs into standardized schema format', () => {
  const classId = '10';
  const streamId = null;
  const subjectName = 'Science';
  const chapters = ['Chapter 1: Chemical Reactions', 'Chapter 2: Acids Bases'];

  const schema = schemaAdapter.toStructuredSchema(classId, streamId, subjectName, chapters);

  assert.equal(schema.class, '10');
  assert.equal(schema.stream, null);
  assert.equal(schema.subject, 'Science');
  assert.equal(schema.subjectSlug, 'science');
  assert.equal(Array.isArray(schema.chapters), true);
  assert.equal(schema.chapters.length, 2);
  assert.equal(schema.chapters[0].name, 'Chemical Reactions');
  assert.equal(schema.chapters[0].slug, 'chemical-reactions');
});

test('fromStructuredSchema converts structured schema back into runtime repository format', () => {
  const schema = {
    class: '11',
    stream: 'science',
    subject: 'Physics',
    subjectSlug: 'physics',
    chapters: [
      {
        name: 'Units and Measurements',
        slug: 'units-and-measurements',
        description: 'Physical quantities',
        resources: { notes: 'notes.pdf' }
      }
    ]
  };

  const runtimeObj = schemaAdapter.fromStructuredSchema(schema);
  assert.equal(runtimeObj.classId, '11');
  assert.equal(runtimeObj.streamId, 'science');
  assert.equal(runtimeObj.subjectTitle, 'Physics');
  assert.equal(runtimeObj.chapters.length, 1);
  assert.equal(runtimeObj.chapters[0].id, 'units-and-measurements');
  assert.equal(runtimeObj.chapters[0].title, 'Units and Measurements');
});
