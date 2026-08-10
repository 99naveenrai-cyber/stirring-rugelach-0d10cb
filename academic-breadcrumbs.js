(function academicBreadcrumbsModule(global) {
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

  function generateBreadcrumbs(classId, subject, chapterTitle, resourceLabel) {
    const classTitle = `Class ${classId}`;
    const items = [
      { label: 'Home', path: '/' },
      { label: classTitle, path: `/class-${classId}/` }
    ];

    if (subject) {
      items.push({
        label: subject.title || subject.name || subject.id,
        path: `/class-${classId}/${subject.id}/`
      });
    }

    if (chapterTitle) {
      const cleanTitle = cleanChapterTitle(chapterTitle);
      const chSlug = slugify(cleanTitle);
      const subSlug = subject ? subject.id : 'learning';
      items.push({
        label: cleanTitle,
        path: `/class-${classId}/${subSlug}/${chSlug}/`
      });

      if (resourceLabel) {
        items.push({
          label: resourceLabel,
          path: `/class-${classId}/${subSlug}/${chSlug}/${slugify(resourceLabel)}/`
        });
      }
    }

    return items;
  }

  function getContextualRelatedLinks(classId, subject, currentChapterIndex, chaptersList = []) {
    const list = Array.isArray(chaptersList) ? chaptersList : [];
    const prevChapter = currentChapterIndex > 0 ? list[currentChapterIndex - 1] : null;
    const nextChapter = currentChapterIndex >= 0 && currentChapterIndex < list.length - 1 ? list[currentChapterIndex + 1] : null;

    const subId = subject ? subject.id : 'learning';

    const links = [];

    if (prevChapter) {
      const prevTitle = cleanChapterTitle(prevChapter.title || prevChapter.name);
      links.push({
        kind: 'prev-chapter',
        label: `← Previous Chapter: ${prevTitle}`,
        path: `/class-${classId}/${subId}/${slugify(prevTitle)}/`
      });
    }

    if (nextChapter) {
      const nextTitle = cleanChapterTitle(nextChapter.title || nextChapter.name);
      links.push({
        kind: 'next-chapter',
        label: `Next Chapter: ${nextTitle} →`,
        path: `/class-${classId}/${subId}/${slugify(nextTitle)}/`
      });
    }

    if (subject) {
      links.push(
        { kind: 'notes', label: `${subject.title} Chapter Notes`, path: `/class-${classId}/${subId}/notes/` },
        { kind: 'mcq', label: `${subject.title} MCQ Practice`, path: `/class-${classId}/${subId}/mcq/` },
        { kind: 'important-questions', label: `Important Questions`, path: `/class-${classId}/${subId}/important-questions/` },
        { kind: 'live-class', label: `Related Live Class`, path: `#live-classes` }
      );
    }

    return links;
  }

  const api = {
    slugify,
    cleanChapterTitle,
    generateBreadcrumbs,
    getContextualRelatedLinks
  };

  global.IdeaKDCAcademicBreadcrumbs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
