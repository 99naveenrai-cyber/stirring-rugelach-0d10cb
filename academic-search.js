(function academicSearchModule(global) {
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

  function buildSearchIndex(curriculum, courses, resourceCategories) {
    const index = [];

    // 1. Classes & Subjects from Curriculum
    if (curriculum && typeof curriculum.getClasses === 'function') {
      curriculum.getClasses().forEach(c => {
        index.push({
          type: 'class',
          title: `Class ${c.id}`,
          subtitle: `School Class ${c.id} Learning Path`,
          category: 'Classes',
          keywords: `class ${c.id} class${c.id} grade ${c.id}`,
          action: 'route',
          path: `/class-${c.id}/`
        });

        const subjects = curriculum.getSubjects(c.id) || [];
        subjects.forEach(sub => {
          index.push({
            type: 'subject',
            title: `Class ${c.id} ${sub.title}`,
            subtitle: `Subject | Class ${c.id}`,
            category: 'Subjects',
            keywords: `class ${c.id} ${sub.title} ${sub.id}`,
            action: 'route',
            path: `/class-${c.id}/${sub.id}/`
          });

          const chapters = curriculum.getChapters(c.id, sub.id, sub.streamId) || [];
          chapters.forEach(ch => {
            const cleanTitle = String(ch.title || '').replace(/^(?:ch(?:apter)?|unit)\s*\d*\s*:\s*/i, '').trim();
            index.push({
              type: 'chapter',
              title: cleanTitle,
              subtitle: `Class ${c.id} ${sub.title} | Chapter`,
              category: 'Chapters',
              keywords: `class ${c.id} ${sub.title} ${cleanTitle} chapter ${ch.id}`,
              action: 'route',
              path: `/class-${c.id}/${sub.id}/${slugify(cleanTitle)}/`
            });
          });
        });
      });
    }

    // 2. BPSC Competitive Exam Topics
    const bpscTopics = [
      { title: 'BPSC Prelims', desc: 'General Studies & CSAT' },
      { title: 'BPSC Mains', desc: 'General Studies 1, 2 & Essay' },
      { title: 'Bihar Special', desc: 'Bihar History, Geography & Economy' },
      { title: 'Current Affairs', desc: 'National & Bihar Current Affairs' },
      { title: 'Practice Questions', desc: 'BPSC Model Test & PYQs' }
    ];

    bpscTopics.forEach(b => {
      index.push({
        type: 'bpsc',
        title: b.title,
        subtitle: `BPSC Prep | ${b.desc}`,
        category: 'BPSC',
        keywords: `bpsc bihar ${b.title} ${b.desc}`,
        action: 'bpsc',
        topic: b.title
      });
    });

    // 3. Resource Types
    if (Array.isArray(resourceCategories)) {
      resourceCategories.forEach(r => {
        index.push({
          type: 'resource',
          title: r.label,
          subtitle: `Study Resource | ${r.tag}`,
          category: 'Study Resources',
          keywords: `${r.label} ${r.tag} ${r.description}`,
          action: 'resource',
          resourceType: r.resourceType || r.id
        });
      });
    }

    // 4. Video Courses
    if (Array.isArray(courses)) {
      courses.forEach(crs => {
        const title = crs.name || crs.title || 'IdeaKDC Course';
        index.push({
          type: 'course',
          title: title,
          subtitle: `Course | Class ${crs.classNum || crs.class || ''} ${crs.subject || ''}`,
          category: 'Courses',
          keywords: `${title} ${crs.subject || ''} ${crs.classNum || ''}`,
          action: 'course',
          courseId: crs.id
        });
      });
    }

    return index;
  }

  function search(query, index, limit = 8) {
    const raw = String(query || '').trim().toLowerCase();
    if (!raw || raw.length < 2) return [];

    const tokens = raw.split(/\s+/).filter(Boolean);

    const scored = index.map(item => {
      const titleLower = item.title.toLowerCase();
      const subLower = item.subtitle.toLowerCase();
      const kwLower = item.keywords.toLowerCase();

      let score = 0;
      if (titleLower === raw) score += 100;
      else if (titleLower.startsWith(raw)) score += 60;
      else if (titleLower.includes(raw)) score += 40;

      let allTokensMatch = true;
      tokens.forEach(tok => {
        if (titleLower.includes(tok)) score += 15;
        else if (subLower.includes(tok)) score += 10;
        else if (kwLower.includes(tok)) score += 5;
        else allTokensMatch = false;
      });

      if (!allTokensMatch && score < 30) score = 0;
      return { item, score };
    }).filter(res => res.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(res => res.item);
  }

  const api = { slugify, buildSearchIndex, search };
  global.IdeaKDCAcademicSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
