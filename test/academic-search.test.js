const test = require('node:test');
const assert = require('node:assert/strict');
const academicSearch = require('../academic-search.js');

test('Stage 7 buildSearchIndex indexes classes, subjects, chapters, BPSC, resources and courses', () => {
  const mockCurriculum = {
    getClasses: () => [{ id: '10' }],
    getSubjects: (cId) => [{ id: 'science', title: 'Science', streamId: '' }],
    getChapters: (cId, sId) => [{ id: 'light', title: 'Light - Reflection and Refraction' }]
  };

  const mockCourses = [
    { id: 'c1', name: 'Class 10 Science Mastery', classNum: '10', subject: 'Science' }
  ];

  const mockResources = [
    { id: 'notes', label: 'Notes', tag: 'Digital', description: 'Chapter study notes', resourceType: 'notes' }
  ];

  const index = academicSearch.buildSearchIndex(mockCurriculum, mockCourses, mockResources);
  assert.ok(Array.isArray(index));
  assert.ok(index.length > 5);

  const classItem = index.find(item => item.type === 'class' && item.title === 'Class 10');
  assert.ok(classItem);
  assert.equal(classItem.path, '/class-10/');

  const subjectItem = index.find(item => item.type === 'subject' && item.title === 'Class 10 Science');
  assert.ok(subjectItem);

  const chapterItem = index.find(item => item.type === 'chapter' && item.title.includes('Light'));
  assert.ok(chapterItem);

  const bpscItem = index.find(item => item.type === 'bpsc' && item.title === 'BPSC Prelims');
  assert.ok(bpscItem);

  const sscItem = index.find(item => item.type === 'bpsc' && item.title === 'SSC');
  assert.ok(sscItem);

  const resourceItem = index.find(item => item.type === 'resource' && item.title === 'Notes');
  assert.ok(resourceItem);

  const courseItem = index.find(item => item.type === 'course' && item.title.includes('Science Mastery'));
  assert.ok(courseItem);
});

test('academic search returns relevant ranked results for query tokens', () => {
  const mockCurriculum = {
    getClasses: () => [{ id: '10' }, { id: '12' }],
    getSubjects: (cId) => [
      { id: 'science', title: 'Science', streamId: '' },
      { id: 'physics', title: 'Physics', streamId: 'science' }
    ],
    getChapters: (cId, sId) => [
      { id: 'light', title: 'Light - Reflection and Refraction' },
      { id: 'optics', title: 'Ray Optics and Optical Instruments' }
    ]
  };

  const index = academicSearch.buildSearchIndex(mockCurriculum, [], []);

  const resultsLight = academicSearch.search('Light', index);
  assert.ok(resultsLight.length > 0);
  assert.ok(resultsLight[0].title.includes('Light'));

  const resultsPhysics = academicSearch.search('Physics', index);
  assert.ok(resultsPhysics.length > 0);
  assert.ok(resultsPhysics[0].title.includes('Physics'));

  const emptyShort = academicSearch.search('a', index);
  assert.equal(emptyShort.length, 0);

  const emptyQuery = academicSearch.search('', index);
  assert.equal(emptyQuery.length, 0);
});
