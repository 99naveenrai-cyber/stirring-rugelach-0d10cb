(function (global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.IdeaKDCAcademicPages = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RESOURCE_TYPES = Object.freeze({
    notes: 'Notes',
    mcq: 'MCQ Practice',
    'important-questions': 'Important Questions',
    revision: 'Revision',
    formulas: 'Formula Sheet',
    'practice-test': 'Practice Test'
  });
  const SENIOR_STREAMS = Object.freeze(['science', 'commerce', 'humanities']);
  const BASE_URL = 'https://betalaunch.ideakdc.in';

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

  function parseAcademicPath(pathname) {
    let parts;
    try {
      parts = String(pathname || '/').split('/').filter(Boolean).map(part => decodeURIComponent(part));
    } catch (_) {
      return null;
    }
    const classMatch = /^(?:class)-(5|6|7|8|9|10|11|12)$/i.exec(parts[0] || '');
    if (!classMatch || parts.length > 4) return null;
    const route = {
      classId: classMatch[1],
      subjectId: parts[1] ? slugify(parts[1]) : '',
      chapterId: parts[2] ? slugify(parts[2]) : '',
      resourceType: parts[3] ? slugify(parts[3]) : ''
    };
    if (route.chapterId && !route.subjectId) return null;
    if (route.resourceType && (!route.chapterId || !RESOURCE_TYPES[route.resourceType])) return null;
    route.kind = route.resourceType ? 'resource' : route.chapterId ? 'chapter' : route.subjectId ? 'subject' : 'class';
    return route;
  }

  function buildAcademicPath(route) {
    const parts = [`class-${String(route?.classId || '').replace(/\D/g, '')}`];
    if (route?.subjectId) parts.push(slugify(route.subjectId));
    if (route?.chapterId) parts.push(slugify(route.chapterId));
    if (route?.resourceType) parts.push(slugify(route.resourceType));
    return `/${parts.join('/')}/`;
  }

  function inferStream(subjectId) {
    const subject = slugify(subjectId);
    if (['physics', 'chemistry', 'mathematics', 'biology'].includes(subject)) return 'science';
    if (['accountancy', 'economics', 'business-studies'].includes(subject)) return 'commerce';
    if (['history', 'political-science', 'geography', 'hindi', 'hindi-core'].includes(subject)) return 'humanities';
    return '';
  }

  function findSubject(curriculum, classId, subjectId) {
    const direct = curriculum.getSubjects(classId).find(subject => subject.id === subjectId);
    if (direct) return { ...direct, streamId: '' };
    const preferred = inferStream(subjectId);
    const streams = preferred ? [preferred, ...SENIOR_STREAMS.filter(item => item !== preferred)] : SENIOR_STREAMS;
    for (const streamId of streams) {
      const found = curriculum.getSubjects(classId, streamId).find(subject => subject.id === subjectId);
      if (found) return { ...found, streamId };
    }
    return null;
  }

  function getClassSubjects(curriculum, classId) {
    const direct = curriculum.getSubjects(classId).map(subject => ({ ...subject, streamId: '' }));
    if (!['11', '12'].includes(String(classId))) return direct;
    const seen = new Set();
    return [...direct, ...SENIOR_STREAMS.flatMap(streamId => curriculum.getSubjects(classId, streamId).map(subject => ({ ...subject, streamId })))]
      .filter(subject => {
        const key = subject.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function courseText(course) {
    return [course?.name, course?.title, course?.classNum, course?.className, course?.stream, course?.subject, course?.chapter]
      .map(value => String(value || '').toLowerCase()).join(' ');
  }

  function relatedCourses(courses, route, chapterTitle) {
    const classNeedle = String(route.classId);
    const subjectNeedle = slugify(route.subjectId).replace(/-/g, ' ');
    const chapterNeedle = slugify(cleanChapterTitle(chapterTitle)).replace(/-/g, ' ');
    return (Array.isArray(courses) ? courses : []).filter(course => {
      const text = courseText(course);
      const courseClass = String(course?.classNum || course?.className || '').replace(/\D/g, '');
      if (courseClass && courseClass !== classNeedle) return false;
      if (subjectNeedle && !text.includes(subjectNeedle)) return false;
      return !chapterNeedle || text.includes(chapterNeedle) || !String(course?.chapter || '').trim();
    }).slice(0, 6);
  }

  function createPageModel(route, curriculum, courses = [], resources = {}) {
    if (!route || !curriculum) return { found: false, reason: 'invalid-route' };
    const classItem = curriculum.getClasses().find(item => String(item.id) === String(route.classId));
    if (!classItem) return { found: false, reason: 'class-not-found', route };

    const subject = route.subjectId ? findSubject(curriculum, route.classId, route.subjectId) : null;
    if (route.subjectId && !subject) return { found: false, reason: 'subject-not-found', route, classItem };
    const chapters = subject ? curriculum.getChapters(route.classId, subject.id, subject.streamId) : [];
    const chapter = route.chapterId
      ? chapters.find(item => slugify(cleanChapterTitle(item.title)) === route.chapterId || slugify(item.id) === route.chapterId)
      : null;
    if (route.chapterId && !chapter) return { found: false, reason: 'chapter-not-found', route, classItem, subject };

    const classTitle = `Class ${route.classId}`;
    const chapterTitle = chapter ? cleanChapterTitle(chapter.title) : '';
    const resourceKey = `${route.classId}/${subject?.id || ''}/${route.chapterId || ''}/${route.resourceType || ''}`;
    const resource = route.resourceType ? resources[resourceKey] || null : null;
    const resourceAvailable = Boolean(resource && (resource.content || resource.sections || resource.url));
    const path = buildAcademicPath(route);
    const canonical = `${BASE_URL}${path}`;

    let heading = `${classTitle} Learning`;
    let title = `${classTitle} Courses, Subjects and Chapters | IdeaKDC`;
    let description = `Explore ${classTitle} subjects, chapter-wise learning and available IdeaKDC courses in one organised place.`;
    if (subject) {
      heading = `${classTitle} ${subject.title}`;
      title = `${classTitle} ${subject.title}: Chapters and Courses | IdeaKDC`;
      description = `Explore ${classTitle} ${subject.title} chapters, related video courses and structured practice paths on IdeaKDC.`;
    }
    if (chapter) {
      heading = chapterTitle;
      title = `${chapterTitle} - ${classTitle} ${subject.title} | IdeaKDC`;
      description = `Study ${chapterTitle} for ${classTitle} ${subject.title} with organised IdeaKDC video lessons and related learning resources.`;
    }
    if (route.resourceType) {
      const resourceLabel = RESOURCE_TYPES[route.resourceType];
      heading = `${chapterTitle}: ${resourceLabel}`;
      title = `${chapterTitle} ${resourceLabel} - ${classTitle} ${subject.title} | IdeaKDC`;
      description = `${resourceLabel} for ${chapterTitle}, ${classTitle} ${subject.title}, prepared for focused IdeaKDC learning and revision.`;
    }

    const breadcrumbs = [
      { label: 'Home', path: '/' },
      { label: classTitle, path: buildAcademicPath({ classId: route.classId }) }
    ];
    if (subject) breadcrumbs.push({ label: subject.title, path: buildAcademicPath({ classId: route.classId, subjectId: subject.id }) });
    if (chapter) breadcrumbs.push({ label: chapterTitle, path: buildAcademicPath({ classId: route.classId, subjectId: subject.id, chapterId: route.chapterId }) });
    if (route.resourceType) breadcrumbs.push({ label: RESOURCE_TYPES[route.resourceType], path });

    return {
      found: true,
      route,
      path,
      canonical,
      classItem,
      subject,
      subjects: getClassSubjects(curriculum, route.classId),
      chapter,
      chapterTitle,
      chapters,
      resource,
      resourceAvailable,
      indexable: route.kind !== 'resource' || resourceAvailable,
      heading,
      title,
      description,
      breadcrumbs,
      relatedCourses: relatedCourses(courses, route, chapterTitle),
      resourceTypes: RESOURCE_TYPES
    };
  }

  function breadcrumbSchema(model) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: model.breadcrumbs.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.label,
        item: `${BASE_URL}${item.path}`
      }))
    };
  }

  return {
    BASE_URL,
    RESOURCE_TYPES,
    slugify,
    cleanChapterTitle,
    parseAcademicPath,
    buildAcademicPath,
    inferStream,
    findSubject,
    getClassSubjects,
    relatedCourses,
    createPageModel,
    breadcrumbSchema
  };
});
