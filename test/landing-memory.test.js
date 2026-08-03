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
  assert.match(landingSource, /class="hero wrap"/);
  assert.match(landingSource, /class="ecosystem wrap-outer"/);
  assert.match(landingSource, /id="diyas"/);
});

test('the old generated landing and its runtime are fully removed', () => {
  assert.doesNotMatch(indexSource, /memory-landing|memory-scratch-canvas|initMemoryLandingMotion|memoryHeadlinePop/);
  assert.doesNotMatch(indexSource, /assets\/landing-(?:forgetting|passive|learner|curiosity)/);
});

test('the course catalogue remains below the landing and its CTA opens courses', () => {
  assert.match(indexSource, /id="uploaded-landing-host"[\s\S]*?id="courses"/);
  assert.match(indexSource, /courseButton\.href = '#courses'/);
  assert.match(indexSource, /document\.getElementById\('courses'\)\?\.scrollIntoView/);
  assert.match(indexSource, /id="courses-grid"/);
});

test('uploaded landing animations are scoped to the isolated content', () => {
  assert.match(indexSource, /root\.querySelectorAll\('\.reveal'\)/);
  assert.match(indexSource, /root\.querySelector\('#diyas'\)/);
  assert.match(indexSource, /root\.querySelector\('\.hub'\)/);
  assert.match(indexSource, /page-home.*classList\.contains\('active'\)/);
});

test('existing legacy cinematic sections remain disabled', () => {
  assert.match(indexSource, /class="cinematic-hero"[^>]* hidden/);
  assert.match(indexSource, /class="home-hero"[^>]* hidden/);
  assert.match(indexSource, /class="trust-strip"[^>]* hidden/);
  assert.match(indexSource, /class="benefit-section"[^>]* hidden/);
  assert.match(indexSource, /class="method-section"[^>]* hidden/);
  assert.match(indexSource, /class="story-section"[^>]* hidden/);
  assert.doesNotMatch(indexSource, /cdn\.jsdelivr\.net\/npm\/gsap/);
});
