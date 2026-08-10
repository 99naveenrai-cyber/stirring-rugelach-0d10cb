const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const landingSource = fs.readFileSync(path.join(__dirname, '..', 'ideakdc-landing.html'), 'utf8');

test('the supplied landing page is loaded through an isolated host', () => {
  assert.match(indexSource, /id="uploaded-landing-host"/);
  assert.match(indexSource, /fetch\('ideakdc-landing\.html'/);
  assert.match(indexSource, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(indexSource, /node\.nodeName !== 'SCRIPT'/);
  assert.match(landingSource, /class="hero"/);
  assert.match(landingSource, /class="learning-map/);
  assert.match(landingSource, /data-landing-action="register"/);
});

test('the old generated landing and its runtime are fully removed', () => {
  assert.doesNotMatch(indexSource, /memory-landing|memory-scratch-canvas|initMemoryLandingMotion|memoryHeadlinePop/);
  assert.doesNotMatch(indexSource, /assets\/landing-(?:forgetting|passive|learner|curiosity)/);
});

test('the course catalogue remains below the landing and both hero actions use existing flows', () => {
  assert.match(indexSource, /id="uploaded-landing-host"[\s\S]*?id="courses"/);
  assert.match(indexSource, /data-landing-action=\"register\"/);
  assert.match(indexSource, /startConvoReg\(null\)/);
  assert.match(indexSource, /data-landing-action=\"courses\"/);
  assert.match(indexSource, /showAllCourses\(\)/);
  assert.match(indexSource, /id="courses-grid"/);
});

test('uploaded landing animations are scoped to the isolated content', () => {
  assert.match(indexSource, /root\.querySelectorAll\('\.reveal'\)/);
  assert.doesNotMatch(indexSource, /root\.querySelector\('#diyas'\)/);
  assert.doesNotMatch(indexSource, /root\.querySelector\('\.hub'\)/);
  assert.doesNotMatch(indexSource, /mins \+= Math\.floor/);
});

test('homepage contains only the supplied landing and course list', () => {
  const homePage = indexSource.match(/<div class="page active" id="page-home">([\s\S]*?)<div class="page" id="page-catalogue">/)?.[1] || '';
  assert.match(homePage, /id="uploaded-landing-host"[\s\S]*?id="courses"/);
  assert.doesNotMatch(homePage, /cinematic-hero|home-hero|trust-strip|benefit-section|method-section|story-section|home-footer/);
  assert.doesNotMatch(indexSource, /initCinematicHero|goToSlide|hero-carousel/);
  assert.doesNotMatch(indexSource, /assets\/(?:ideakdc-education-visual|benefit-concept-clarity|benefit-daily-practice|benefit-guided-revision)/);
});

test('hero uses truthful feature labels without invented statistics', () => {
  assert.match(landingSource, /School Preparation/);
  assert.match(landingSource, /Senior Secondary/);
  assert.match(landingSource, /Bihar Exam Preparation/);
  assert.match(landingSource, /Live Classes/);
  assert.match(landingSource, /Quiz Practice/);
  assert.doesNotMatch(landingSource, /Minutes watched|happy learners|15k|57k|rating/i);
});
