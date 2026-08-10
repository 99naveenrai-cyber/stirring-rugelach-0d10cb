const test = require('node:test');
const assert = require('node:assert/strict');
const bilingualModule = require('../academic-bilingual.js');

test('Stage 16 getBilingualTitle formats side-by-side title in bilingual mode', () => {
  const titleEn = 'Light - Reflection and Refraction';
  const titleHi = 'प्रकाश – परावर्तन तथा अपवर्तन';

  const bilingualTitle = bilingualModule.getBilingualTitle(titleEn, titleHi, 'bilingual');
  assert.equal(bilingualTitle, 'Light - Reflection and Refraction / प्रकाश – परावर्तन तथा अपवर्तन');

  const hiTitle = bilingualModule.getBilingualTitle(titleEn, titleHi, 'hi');
  assert.equal(hiTitle, 'प्रकाश – परावर्तन तथा अपवर्तन');

  const enTitle = bilingualModule.getBilingualTitle(titleEn, titleHi, 'en');
  assert.equal(enTitle, 'Light - Reflection and Refraction');
});

test('Stage 16 setLanguageMode updates active mode', () => {
  bilingualModule.setLanguageMode('hi');
  assert.equal(bilingualModule.getLanguageMode(), 'hi');

  bilingualModule.setLanguageMode('bilingual');
  assert.equal(bilingualModule.getLanguageMode(), 'bilingual');
});

test('formatBilingualContent injects displayTitle and displayDescription', () => {
  const item = {
    titleEn: 'Science',
    titleHi: 'विज्ञान',
    descEn: 'Study of nature',
    descHi: 'प्रकृति का अध्ययन'
  };

  const formatted = bilingualModule.formatBilingualContent(item, 'bilingual');
  assert.equal(formatted.displayTitle, 'Science / विज्ञान');
  assert.equal(formatted.displayDescription, 'Study of nature / प्रकृति का अध्ययन');
});
