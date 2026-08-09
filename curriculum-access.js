(function (global) {
  'use strict';

  const titleOverrides = {
    'social-science': 'Social Science',
    'business-studies': 'Business Studies',
    'political-science': 'Political Science',
    'hindi-core': 'Hindi Core',
    accountancy: 'Accountancy',
    mathematics: 'Mathematics',
    physics: 'Physics',
    chemistry: 'Chemistry',
    economics: 'Economics',
    history: 'History',
    geography: 'Geography',
    english: 'English',
    science: 'Science'
  };

  function slug(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  }

  function title(value) {
    const id = slug(value);
    return titleOverrides[id] || id.split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  }

  function root() {
    return global.NCERT_CURRICULUM_2026_27 || {};
  }

  function classMap() {
    const data = root();
    if (Array.isArray(data.classes)) {
      return Object.fromEntries(data.classes.map(item => [String(item.id || item.slug || item.classId || ''), item]));
    }
    return data.classes && typeof data.classes === 'object' ? data.classes : data;
  }

  function classData(classId) {
    return classMap()[String(classId || '')] || {};
  }

  function entries(value) {
    if (Array.isArray(value)) {
      return value.map((item, index) => [String(item?.id || item?.slug || item?.key || index), item]);
    }
    return value && typeof value === 'object' ? Object.entries(value) : [];
  }

  function getClasses() {
    return entries(classMap()).map(([id, item]) => ({ id, title: String(item?.title || item?.name || `Class ${id}`) }));
  }

  function getStreams(classId) {
    return entries(classData(classId).streams).map(([id, item]) => ({ id: slug(id), title: String(item?.title || item?.name || title(id)) }));
  }

  function getSubjectEntries(classId, streamId) {
    const data = classData(classId);
    const structured = [];
    entries(data.subjects).forEach(pair => structured.push(pair));
    entries(data.commonSubjects).forEach(pair => structured.push(pair));
    const wantedStream = slug(streamId) === 'arts' ? 'humanities' : slug(streamId);
    const stream = entries(data.streams).find(([id]) => slug(id) === wantedStream)?.[1];
    entries(stream?.subjects || stream).forEach(pair => structured.push(pair));
    if (structured.length) return structured;

    const flat = [];
    Object.entries(data).forEach(([key, value]) => {
      if (!Array.isArray(value)) return;
      const keySlug = slug(key);
      if (String(classId) === '11' || String(classId) === '12') {
        if (keySlug === 'english') flat.push(['english', value]);
        else if (wantedStream && keySlug.startsWith(`${wantedStream}-`)) flat.push([keySlug.slice(wantedStream.length + 1), value]);
      } else {
        flat.push([keySlug, value]);
      }
    });
    return flat;
  }

  function getSubjects(classId, streamId) {
    const seen = new Set();
    return getSubjectEntries(classId, streamId).reduce((result, [id, item]) => {
      const subjectId = slug(item?.id || item?.slug || id);
      if (!subjectId || seen.has(subjectId)) return result;
      seen.add(subjectId);
      result.push({ id: subjectId, title: String(item?.title || item?.name || title(subjectId)) });
      return result;
    }, []);
  }

  function subjectNode(classId, subjectId, streamId) {
    const wanted = slug(subjectId);
    return getSubjectEntries(classId, streamId).find(([id, item]) => slug(item?.id || item?.slug || id) === wanted)?.[1] || null;
  }

  function getSections(classId, subjectId, streamId) {
    const subject = subjectNode(classId, subjectId, streamId);
    return entries(subject?.sections).map(([id, item]) => ({ id: slug(item?.id || item?.slug || id), title: String(item?.title || item?.name || title(id)) }));
  }

  function chapterList(value) {
    const list = Array.isArray(value) ? value : Array.isArray(value?.chapters) ? value.chapters : [];
    return list.map((item, index) => ({
      id: String(item?.id || item?.slug || item?.chapterId || slug(item?.title || item?.name || item || index)),
      title: String(item?.title || item?.name || item || '')
    })).filter(item => item.title);
  }

  function getChapters(classId, subjectId, streamId, sectionId) {
    const subject = subjectNode(classId, subjectId, streamId);
    if (!subject) return [];
    if (sectionId) {
      const section = entries(subject.sections).find(([id, item]) => slug(item?.id || item?.slug || id) === slug(sectionId))?.[1];
      return chapterList(section);
    }
    const direct = chapterList(subject);
    if (direct.length) return direct;
    return entries(subject.sections).flatMap(([, section]) => chapterList(section));
  }

  function findChapterById(classId, subjectId, chapterId, streamId, sectionId) {
    return getChapters(classId, subjectId, streamId, sectionId).find(item => item.id === String(chapterId) || slug(item.title) === slug(chapterId)) || null;
  }

  global.IdeaKDCCurriculum = Object.freeze({ getClasses, getStreams, getSubjects, getSections, getChapters, findChapterById });
})(window);
