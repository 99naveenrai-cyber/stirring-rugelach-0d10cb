const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('memory landing uses the three optimized visual story assets', () => {
  assert.match(source, /assets\/landing-forgetting-hero\.jpg/);
  assert.match(source, /assets\/landing-passive-listening\.jpg/);
  assert.match(source, /assets\/landing-curiosity-door\.jpg/);
  assert.match(source, /class="memory-scene-media"[\s\S]*?width="1600" height="900"/);
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

test('obsolete cinematic sections stay disabled and no longer load GSAP', () => {
  assert.match(source, /class="cinematic-hero"[^>]* hidden/);
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/gsap/);
});
