(function academicContentImporterModule(global) {
  'use strict';

  function validateImportItem(item, idx) {
    const errors = [];
    const prefix = `[Import Item #${idx + 1}]`;

    if (!item || typeof item !== 'object') {
      return { valid: false, errors: [`${prefix} Must be an object`] };
    }

    if (!item.classId || !['5', '6', '7', '8', '9', '10', '11', '12'].includes(String(item.classId))) {
      errors.push(`${prefix} classId must be string "5" through "12"`);
    }

    if (!item.subject || typeof item.subject !== 'string') {
      errors.push(`${prefix} subject string is required`);
    }

    if (!item.chapterTitle || typeof item.chapterTitle !== 'string') {
      errors.push(`${prefix} chapterTitle string is required`);
    }

    // Optional arrays validation if present
    if (item.mcqs && !Array.isArray(item.mcqs)) {
      errors.push(`${prefix} mcqs must be an array`);
    } else if (Array.isArray(item.mcqs)) {
      item.mcqs.forEach((mcq, mIdx) => {
        if (!mcq.question || typeof mcq.question !== 'string') {
          errors.push(`${prefix} mcqs[${mIdx}].question is required`);
        }
        if (!Array.isArray(mcq.options) || mcq.options.length < 2) {
          errors.push(`${prefix} mcqs[${mIdx}].options must be an array of at least 2 strings`);
        }
        if (typeof mcq.correct !== 'number') {
          errors.push(`${prefix} mcqs[${mIdx}].correct option index (number) is required`);
        }
      });
    }

    if (item.formulas && !Array.isArray(item.formulas)) {
      errors.push(`${prefix} formulas must be an array`);
    }

    if (item.faqs && !Array.isArray(item.faqs)) {
      errors.push(`${prefix} faqs must be an array`);
    }

    return { valid: errors.length === 0, errors };
  }

  function parseAndValidateImportPayload(payload) {
    const list = Array.isArray(payload) ? payload : [payload];
    const allErrors = [];
    const validItems = [];

    list.forEach((item, idx) => {
      const res = validateImportItem(item, idx);
      if (res.valid) {
        validItems.push(item);
      } else {
        allErrors.push(...res.errors);
      }
    });

    return {
      success: allErrors.length === 0,
      totalProcessed: list.length,
      validCount: validItems.length,
      errors: allErrors,
      items: validItems
    };
  }

  const api = {
    validateImportItem,
    parseAndValidateImportPayload
  };

  global.IdeaKDCAcademicImporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
