const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'academic-navigation.js'), 'utf8');
const landingSource = fs.readFileSync(path.join(root, 'ideakdc-landing.html'), 'utf8');
const navigation = require(path.join(root, 'academic-navigation.js'));

test('academic navigation exposes the approved Stage 1 taxonomy', () => {
  const byId = Object.fromEntries(navigation.categories.map(category => [category.id, category]));
  assert.deepEqual(byId.school.groups[0].items.map(item => item.label), [
    'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'
  ]);
  assert.deepEqual(byId['senior-secondary'].groups.map(group => group.label), ['Science', 'Commerce', 'Humanities']);
  const allCompLabels = byId.bpsc.groups.flatMap(g => g.items).map(item => item.label);
  assert.ok(allCompLabels.includes('BPSC Prelims'));
  assert.ok(allCompLabels.includes('Prelims'));
  assert.ok(allCompLabels.includes('Biology'));
  assert.ok(allCompLabels.includes('Mathematics'));
  assert.ok(allCompLabels.includes('SSC CGL'));
  assert.ok(allCompLabels.includes('SSC CHSL'));
  assert.deepEqual(byId['live-learning'].groups[0].items.map(item => item.label), ['Live Classes', 'Upcoming Classes']);
});

test('desktop and mobile navigation have accessible expansion controls', () => {
  assert.match(indexSource, /id="academic-nav-desktop"/);
  assert.match(indexSource, /id="academic-mobile-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="academic-mobile-drawer"/);
  assert.match(indexSource, /id="academic-mobile-drawer" hidden/);
  assert.match(navigationSource, /setAttribute\('aria-expanded'/);
  assert.match(navigationSource, /event\.key === 'Escape'/);
  assert.match(indexSource, /@media \(max-width:900px\)/);
  assert.match(indexSource, /\.academic-mobile-toggle\{display:flex\}/);
  assert.match(landingSource, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
});

test('existing utility and account actions remain available', () => {
  for (const action of ['showLive()', 'showReferralSupport()', 'showAllCourses()', 'showLogin()', 'startConvoReg(null)']) {
    assert.match(indexSource, new RegExp(action.replace(/[()]/g, '\\$&')));
  }
  assert.match(indexSource, /addButton\('Dashboard', showDashboard, true\)/);
  assert.match(indexSource, /id="bottom-nav"/);
  assert.match(indexSource, /id="bn-live"/);
  assert.match(indexSource, /id="bn-dash"/);
  assert.match(indexSource, /id="bn-referral"/);
});

test('public Firebase module parses and exports student entry points', () => {
  const moduleMatch = indexSource.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(moduleMatch, 'public Firebase module script is present');
  new vm.SourceTextModule(moduleMatch[1]);
  assert.match(moduleMatch[1], /window\.showLogin\s*=\s*\(\)\s*=>/);
  assert.match(moduleMatch[1], /window\.startConvoReg\s*=\s*\(courseId\)\s*=>/);
  assert.match(moduleMatch[1], /window\.showReferralSupport\s*=\s*async\s*\(\)\s*=>/);
});

test('new student registration offers Google and details-only routes', () => {
  assert.match(indexSource, /chooseStudentRegistration\('google'\)/);
  assert.match(indexSource, /chooseStudentRegistration\('details'\)/);
  assert.match(indexSource, /Google से Sign in/);
  assert.match(indexSource, /बिना Google details भरें/);
  assert.match(indexSource, /convoSteps = \['name', 'class', 'whatsapp', 'state', 'city', 'pincode'\]/);
  assert.match(indexSource, /mode === 'google'[\s\S]*?window\.doGoogleAuth\(\)/);
  assert.match(indexSource, /signInAnonymously\(auth\)/);
});

test('registration uses native mobile keyboards and saves the complete profile', () => {
  assert.match(indexSource, /id="ci-whatsapp" type="tel" inputmode="numeric" pattern="\[0-9\]\*"\s+autocomplete="tel-national" enterkeyhint="next" maxlength="10"/);
  assert.match(indexSource, /id="ci-pincode" type="tel" inputmode="numeric" pattern="\[0-9\]\*"\s+autocomplete="postal-code" enterkeyhint="done" maxlength="6"/);
  assert.match(indexSource, /String\(input\?\.value \|\| ''\)\.replace\(\/\\D\/g, ''\)/);
  for (const field of ['whatsapp', 'state', 'city', 'pincode']) {
    assert.match(indexSource, new RegExp(`${field}: payload\\.${field}`));
  }
  assert.match(indexSource, /convoData\.registrationSource\s*=\s*'details-without-google'/);
  assert.match(indexSource, /detailsRegistrationAuthInFlight/);
});

test('academic destinations reuse the current catalogue and live-class flows', () => {
  assert.match(navigationSource, /item\.action === 'live'/);
  assert.match(navigationSource, /global\.showLive\(\)/);
  assert.match(navigationSource, /global\.showAllCourses\(\)/);
  assert.doesNotMatch(navigationSource, /location\.href\s*=\s*['"]\/(?:class|subject|bpsc)/);
});

test('homepage hero provides the approved bilingual actions without fictional metrics', () => {
  assert.match(landingSource, /IdeaKDC/);
  assert.match(landingSource, /समझो, practice करो/);
  assert.match(landingSource, /New Student/);
  assert.match(landingSource, /सभी Courses देखें/);
  assert.doesNotMatch(landingSource, /\b\d+[kK]\b|happy learners|rating|results/i);
});
