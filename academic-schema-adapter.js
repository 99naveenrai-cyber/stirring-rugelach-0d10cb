(function academicSchemaAdapterModule(global) {
  'use strict';

  function slugify(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\u0900-\u097f]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function cleanChapterTitle(value) {
    return String(value || '').replace(/^(?:ch(?:apter)?|unit|prose|poem|reader|geo|hist|pol|eco|hor|flam|snap|vistas)\s*\d*\s*:\s*/i, '').trim();
  }

  function validateAcademicSchema(data) {
    if (!data || typeof data !== 'object') return { valid: false, errors: ['Data must be a non-null object'] };
    const errors = [];

    if (!data.class || !['5', '6', '7', '8', '9', '10', '11', '12'].includes(String(data.class))) {
      errors.push('class must be string "5" through "12"');
    }

    if (!data.subject || typeof data.subject !== 'string') {
      errors.push('subject is required string');
    }

    if (!data.subjectSlug || typeof data.subjectSlug !== 'string') {
      errors.push('subjectSlug is required string');
    }

    if (!Array.isArray(data.chapters)) {
      errors.push('chapters must be an array');
    } else {
      data.chapters.forEach((ch, idx) => {
        if (!ch.name || typeof ch.name !== 'string') errors.push(`chapters[${idx}].name is required`);
        if (!ch.slug || typeof ch.slug !== 'string') errors.push(`chapters[${idx}].slug is required`);
      });
    }

    return { valid: errors.length === 0, errors };
  }

  function toStructuredSchema(classId, streamId, subjectName, chapterTitlesList = []) {
    const subSlug = slugify(subjectName);
    const chapters = (Array.isArray(chapterTitlesList) ? chapterTitlesList : []).map(chTitle => {
      const clean = cleanChapterTitle(chTitle);
      return {
        name: clean,
        slug: slugify(clean),
        description: `Study ${clean} concepts, key formulas and practice questions.`,
        resources: {
          notes: null,
          mcq: null,
          importantQuestions: null,
          revision: null,
          formulas: null,
          pyq: null,
          videos: []
        }
      };
    });

    const schema = {
      class: String(classId),
      stream: streamId || null,
      subject: subjectName,
      subjectSlug: subSlug,
      chapters: chapters
    };

    return schema;
  }

  function fromStructuredSchema(schema) {
    const check = validateAcademicSchema(schema);
    if (!check.valid) {
      throw new Error(`Invalid academic schema: ${check.errors.join(', ')}`);
    }

    return {
      classId: schema.class,
      streamId: schema.stream || '',
      subjectId: schema.subjectSlug,
      subjectTitle: schema.subject,
      chapters: schema.chapters.map((ch, idx) => ({
        id: ch.slug,
        title: ch.name,
        index: idx + 1,
        description: ch.description || '',
        resources: ch.resources || {}
      }))
    };
  }

  const api = {
    slugify,
    cleanChapterTitle,
    validateAcademicSchema,
    toStructuredSchema,
    fromStructuredSchema
  };

  global.IdeaKDCAcademicSchemaAdapter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
