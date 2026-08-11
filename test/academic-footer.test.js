const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('index.html contains Stage 9 SEO internal-linking footer with required sections', () => {
  assert.match(indexSource, /id="site-footer"/);
  assert.match(indexSource, /School Classes/);
  assert.match(indexSource, /Class 11–12/);
  assert.match(indexSource, /Popular Subjects/);
  assert.match(indexSource, /Competitive Exams \(BPSC, UPSC, SSC, JEE, NEET\)/);
  assert.match(indexSource, /SSC \(Staff Selection Commission\)/);
  assert.match(indexSource, /IdeaKDC Platform/);
});

test('footer internal links map cleanly to valid indexable academic routes and actions', () => {
  assert.match(indexSource, /href="\/class-6\/"/);
  assert.match(indexSource, /href="\/class-10\/"/);
  assert.match(indexSource, /href="\/class-11\/science\/"/);
  assert.match(indexSource, /href="\/class-11\/commerce\/"/);
  assert.match(indexSource, /Student Partner Program/);
});
