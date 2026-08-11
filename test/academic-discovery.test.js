const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'academic-navigation.js'), 'utf8');
const navigation = require(path.join(root, 'academic-navigation.js'));

test('Stage 2 discovery exposes school, senior-secondary and BPSC paths', () => {
  const groups = Object.fromEntries(navigation.discoveryGroups.map(group => [group.id, group]));
  assert.deepEqual(groups['school-discovery'].items.map(item => item.filter.classNum), ['5', '6', '7', '8', '9', '10']);
  assert.equal(groups['senior-discovery'].items.length, 6);
  assert.deepEqual(new Set(groups['senior-discovery'].items.map(item => item.filter.stream)), new Set(['science', 'commerce', 'humanities']));
  assert.ok(groups['competitive-discovery'].items.map(item => item.label).includes('BPSC (Bihar PSC)'));
  assert.ok(groups['competitive-discovery'].items.map(item => item.label).includes('UPSC CSE (Civil Services)'));
  assert.ok(groups['competitive-discovery'].items.map(item => item.label).includes('JEE Mains'));
  assert.ok(groups['competitive-discovery'].items.map(item => item.label).includes('NEET UG'));
});

test('course filters use existing classNum, stream and subject fields', () => {
  const science = { id: 'physics-11', classNum: '11th', stream: 'Science', subject: 'Physics', name: 'Mechanics' };
  const commerce = { id: 'accounts-11', classNum: 11, stream: 'commerce', subject: 'Accountancy', name: 'Accounts' };
  assert.equal(navigation.courseMatchesFilter(science, { classNum: '11', stream: 'science' }), true);
  assert.equal(navigation.courseMatchesFilter(science, { classNum: '12' }), false);
  assert.equal(navigation.courseMatchesFilter(commerce, { classes: ['11', '12'], stream: 'science' }), false);
  assert.equal(navigation.courseMatchesFilter({ classNum: 12, subject: 'Biology' }, { classNum: 12, stream: 'science' }), true);
});

test('ambiguous legacy subjects are not assigned to the wrong senior stream', () => {
  const legacyEnglish = { classNum: 11, subject: 'English', name: 'English Core' };
  assert.equal(navigation.inferredStream(legacyEnglish), '');
  assert.equal(navigation.courseMatchesFilter(legacyEnglish, { stream: 'science' }), false);
  assert.equal(navigation.courseMatchesFilter({ ...legacyEnglish, stream: 'Humanities' }, { stream: 'humanities' }), true);
});

test('BPSC filters match only BPSC-labelled catalogue records', () => {
  const prelims = { classNum: 'BPSC', subject: 'General Studies', name: 'BPSC Prelims Foundation' };
  const school = { classNum: '10', subject: 'Social Science', name: 'Board Foundation' };
  assert.equal(navigation.courseMatchesFilter(prelims, { track: 'bpsc', topic: 'BPSC Prelims' }), true);
  assert.equal(navigation.courseMatchesFilter(prelims, { track: 'bpsc', topic: 'BPSC Mains' }), false);
  assert.equal(navigation.courseMatchesFilter(school, { track: 'bpsc' }), false);
});

test('discovery renders into the homepage and filters only catalogue presentation', () => {
  assert.match(indexSource, /id="academic-discovery"/);
  assert.match(navigationSource, /renderDiscovery\(document\.getElementById\('academic-discovery'\)/);
  assert.match(indexSource, /window\.showAcademicCourses = async/);
  assert.match(indexSource, /allCourses\.filter\(course => matcher\(course, activeAcademicFilter\)\)/);
  assert.match(indexSource, /getCourseAccess\(course\.id, course\)/);
  assert.doesNotMatch(navigationSource, /(?:addDoc|setDoc|updateDoc|deleteDoc|httpsCallable)/);
});

test('class learning shortcuts remain contained on narrow mobile screens', () => {
  assert.match(indexSource, /class="academic-route-shortcuts"/);
  assert.match(indexSource, /@media\(max-width:480px\)\{\.academic-route-shortcuts\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(indexSource, /\.academic-route-shortcuts a\{[^}]*min-width:0;[^}]*max-width:100%;[^}]*overflow-wrap:anywhere/);
});

test('empty filtered paths provide a working return to the full catalogue', () => {
  assert.match(indexSource, /इस learning path में अभी कोई active course नहीं मिला।/);
  assert.match(indexSource, /onclick="showAllCourses\(\)"/);
  assert.match(indexSource, /activeAcademicFilter = null/);
});
