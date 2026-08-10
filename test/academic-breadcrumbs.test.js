const test = require('node:test');
const assert = require('node:assert/strict');
const breadcrumbsModule = require('../academic-breadcrumbs.js');

test('Stage 10 generateBreadcrumbs builds complete hierarchy trail', () => {
  const classId = '10';
  const subject = { id: 'science', title: 'Science' };
  const chapterTitle = 'Light - Reflection and Refraction';
  const resourceLabel = 'Notes';

  const trail = breadcrumbsModule.generateBreadcrumbs(classId, subject, chapterTitle, resourceLabel);

  assert.equal(Array.isArray(trail), true);
  assert.equal(trail.length, 5);
  assert.equal(trail[0].label, 'Home');
  assert.equal(trail[1].label, 'Class 10');
  assert.equal(trail[2].label, 'Science');
  assert.equal(trail[3].label, 'Light - Reflection and Refraction');
  assert.equal(trail[4].label, 'Notes');
});

test('Stage 10 getContextualRelatedLinks generates Next, Prev, Notes, MCQ & Live links', () => {
  const classId = '10';
  const subject = { id: 'science', title: 'Science' };
  const chapters = [
    { title: 'Chemical Reactions' },
    { title: 'Acids Bases and Salts' },
    { title: 'Metals and Non-Metals' }
  ];

  // Middle chapter (Acids Bases and Salts at idx 1)
  const linksMiddle = breadcrumbsModule.getContextualRelatedLinks(classId, subject, 1, chapters);

  const prevLink = linksMiddle.find(l => l.kind === 'prev-chapter');
  assert.ok(prevLink);
  assert.ok(prevLink.label.includes('Chemical Reactions'));

  const nextLink = linksMiddle.find(l => l.kind === 'next-chapter');
  assert.ok(nextLink);
  assert.ok(nextLink.label.includes('Metals and Non-Metals'));

  const notesLink = linksMiddle.find(l => l.kind === 'notes');
  assert.ok(notesLink);

  const mcqLink = linksMiddle.find(l => l.kind === 'mcq');
  assert.ok(mcqLink);

  const liveLink = linksMiddle.find(l => l.kind === 'live-class');
  assert.ok(liveLink);
});

test('first chapter has no previous chapter link and last chapter has no next chapter link', () => {
  const chapters = [{ title: 'Chapter 1' }, { title: 'Chapter 2' }];

  const firstLinks = breadcrumbsModule.getContextualRelatedLinks('10', { id: 'science', title: 'Science' }, 0, chapters);
  assert.equal(firstLinks.some(l => l.kind === 'prev-chapter'), false);
  assert.equal(firstLinks.some(l => l.kind === 'next-chapter'), true);

  const lastLinks = breadcrumbsModule.getContextualRelatedLinks('10', { id: 'science', title: 'Science' }, 1, chapters);
  assert.equal(lastLinks.some(l => l.kind === 'prev-chapter'), true);
  assert.equal(lastLinks.some(l => l.kind === 'next-chapter'), false);
});
