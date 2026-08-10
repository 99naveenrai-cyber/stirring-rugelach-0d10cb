(function academicBilingualModule(global) {
  'use strict';

  let currentMode = 'bilingual';

  function setLanguageMode(mode) {
    if (['bilingual', 'hi', 'en'].includes(mode)) {
      currentMode = mode;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('ideakdc_lang_mode', mode); } catch (_) {}
      }
    }
    return currentMode;
  }

  function getLanguageMode() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('ideakdc_lang_mode');
        if (saved && ['bilingual', 'hi', 'en'].includes(saved)) currentMode = saved;
      } catch (_) {}
    }
    return currentMode;
  }

  function getBilingualTitle(titleEn, titleHi, mode = currentMode) {
    const en = String(titleEn || '').trim();
    const hi = String(titleHi || '').trim();

    if (mode === 'hi') return hi || en;
    if (mode === 'en') return en || hi;
    if (en && hi && en !== hi) return `${en} / ${hi}`;
    return en || hi;
  }

  function formatBilingualContent(item, mode = currentMode) {
    if (!item || typeof item !== 'object') return item;
    return {
      ...item,
      displayTitle: getBilingualTitle(item.titleEn || item.title || item.name, item.titleHi || item.nameHi, mode),
      displayDescription: getBilingualTitle(item.descEn || item.description, item.descHi || item.descriptionHi, mode)
    };
  }

  const api = {
    setLanguageMode,
    getLanguageMode,
    getBilingualTitle,
    formatBilingualContent
  };

  global.IdeaKDCAcademicBilingual = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
