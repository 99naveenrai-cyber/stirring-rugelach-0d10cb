const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('memory landing uses the four optimized visual story assets', () => {
  assert.match(source, /assets\/landing-forgetting-hero\.jpg/);
  assert.match(source, /assets\/landing-passive-listening\.jpg/);
  assert.match(source, /assets\/landing-learner-voices\.jpg/);
  assert.match(source, /assets\/landing-curiosity-door\.jpg/);
  assert.match(source, /class="memory-scene-media"[\s\S]*?width="1600" height="900"/);
  assert.match(source, /class="memory-proof-media"[\s\S]*?width="1600" height="900"/);
});

test('landing keeps the coaching recommendation curious and non-descriptive', () => {
  assert.match(source, /PW, ALLEN, Motion or Aakash/);
  assert.match(source, /Add one IdeaKDC course beside it/);
  assert.match(source, /We will not explain it here/);
});

test('scroll reveal works in both directions and touch scratches stay decorative', () => {
  assert.match(source, /scrollDirection = nextY > lastScrollY \? 'down' : 'up'/);
  assert.match(source, /classList\.toggle\('from-above', scrollDirection === 'up'\)/);
  assert.match(source, /id="memory-scratch-canvas" aria-hidden="true"/);
  assert.match(source, /pointer-events:none;mix-blend-mode:screen/);
  assert.match(source, /context\.quadraticCurveTo/);
  assert.match(source, /landing\.addEventListener\('touchmove'/);
});

test('landing provides Devanagari headings and gentle two-way scroll narration', () => {
  assert.match(source, /फिर याद क्यों नहीं रहा\?/);
  assert.match(source, /सिर्फ देखना, याद रखना नहीं है।/);
  assert.match(source, /अपनी coaching मत छोड़िए।/);
  assert.match(source, /data-scroll-down=/);
  assert.match(source, /data-scroll-up=/);
  assert.match(source, /id="memory-scroll-whisper"/);
  assert.match(source, /scrollWhisper\.textContent = scrollDirection === 'up'/);
});

test('immersive dark landing exposes kinetic text, progress, and chapter navigation', () => {
  assert.match(source, /id="memory-progress-bar"/);
  assert.match(source, /class="memory-chapter-nav"/);
  assert.match(source, /class="memory-title-line"/);
  assert.match(source, /class="memory-popline"/);
  assert.match(source, /class="memory-contrast"/);
  assert.match(source, /class="memory-coaching-bridge"/);
  assert.match(source, /@keyframes memoryHeadlinePop/);
  assert.match(source, /progressBar\.style\.transform = `scaleX\(\$\{progress\}\)`/);
  assert.match(source, /section\.classList\.toggle\('is-active'/);
});

test('community figures and regional voices are presented transparently', () => {
  assert.match(source, />15K</);
  assert.match(source, />45% → 85%</);
  assert.match(source, />57K</);
  assert.match(source, /Community figures supplied by IdeaKDC/);
  assert.match(source, /illustrative composites/);
  for (const region of ['Delhi', 'Uttar Pradesh', 'Bihar', 'Madhya Pradesh', 'Bengaluru', 'Maharashtra', 'Odisha']) {
    assert.match(source, new RegExp(`Composite learner voice · ${region}`));
  }
});

test('obsolete cinematic sections stay disabled and no longer load GSAP', () => {
  assert.match(source, /class="cinematic-hero"[^>]* hidden/);
  assert.match(source, /class="home-hero"[^>]* hidden/);
  assert.match(source, /class="trust-strip"[^>]* hidden/);
  assert.match(source, /class="benefit-section"[^>]* hidden/);
  assert.match(source, /class="method-section"[^>]* hidden/);
  assert.match(source, /class="story-section"[^>]* hidden/);
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/gsap/);
});
