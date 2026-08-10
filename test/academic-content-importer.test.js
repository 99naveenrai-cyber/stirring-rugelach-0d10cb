const test = require('node:test');
const assert = require('node:assert/strict');
const contentImporter = require('../academic-content-importer.js');

test('Stage 12 validateImportItem validates valid import item correctly', () => {
  const validItem = {
    classId: '10',
    subject: 'Science',
    chapterTitle: 'Light – Reflection and Refraction',
    mcqs: [
      {
        question: 'What is f when R = 20cm?',
        options: ['10cm', '20cm'],
        correct: 0
      }
    ]
  };

  const validation = contentImporter.validateImportItem(validItem, 0);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('Stage 12 parseAndValidateImportPayload reports detailed missing field errors', () => {
  const invalidPayload = [
    {
      // Missing classId and subject
      chapterTitle: 'Light'
    },
    {
      classId: '10',
      subject: 'Science',
      chapterTitle: 'Electricity',
      mcqs: [
        {
          question: 'Invalid MCQ missing options and correct index'
        }
      ]
    }
  ];

  const result = contentImporter.parseAndValidateImportPayload(invalidPayload);
  assert.equal(result.success, false);
  assert.equal(result.totalProcessed, 2);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some(e => e.includes('classId')));
  assert.ok(result.errors.some(e => e.includes('options')));
});

test('parseAndValidateImportPayload accepts single item or array payload', () => {
  const singleItem = {
    classId: '12',
    subject: 'Physics',
    chapterTitle: 'Ray Optics'
  };

  const result = contentImporter.parseAndValidateImportPayload(singleItem);
  assert.equal(result.success, true);
  assert.equal(result.validCount, 1);
});
