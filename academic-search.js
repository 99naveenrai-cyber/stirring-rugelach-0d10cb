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

    // 2. Competitive & Entrance Exam Topics (BPSC, UPSC, UPPCS, SSC, JEE Mains, JEE Advanced, NEET)
    const competitiveTopics = [
      { title: 'BPSC Prelims', desc: 'General Studies & CSAT', cat: 'BPSC', id: 'bpsc' },
      { title: 'BPSC Mains', desc: 'General Studies 1, 2 & Essay', cat: 'BPSC', id: 'bpsc' },
      { title: 'Bihar Special', desc: 'Bihar History, Geography & Economy', cat: 'BPSC', id: 'bpsc' },
      { title: 'UPSC CSE (Civil Services)', desc: 'IAS/IPS Prelims, Mains & CSAT', cat: 'UPSC', id: 'upsc' },
      { title: 'UPPCS (UP PSC)', desc: 'UP Public Service Commission GS', cat: 'UPPCS', id: 'uppcs' },
      { title: 'SSC', desc: 'Staff Selection Commission and Central Government Exams', cat: 'SSC', id: 'ssc' },
      { title: 'JEE Mains', desc: 'Engineering Physics, Chemistry & Maths', cat: 'JEE Mains', id: 'jee-mains' },
      { title: 'JEE Advanced', desc: 'IIT Entrance Problem Solving & PYQs', cat: 'JEE Advanced', id: 'jee-advanced' },
      { title: 'NEET UG', desc: 'Medical Entrance Biology, Physics & Chemistry', cat: 'NEET', id: 'neet' }
    ];

    competitiveTopics.forEach(b => {
      index.push({
        type: 'bpsc',
        title: b.title,
        subtitle: `Competitive Exam | ${b.desc}`,
        category: b.cat,
        keywords: `${b.title} ${b.desc} ${b.id} ${b.cat} exam preparation upsc jee neet bpsc uppcs ssc`,
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

