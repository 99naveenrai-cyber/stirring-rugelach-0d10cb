(function academicNavigationModule(global) {
  'use strict';

  const categories = [
    {
      id: 'school',
      label: 'School Preparation',
      groups: [{
        label: 'Classes',
        items: ['5', '6', '7', '8', '9', '10'].map(classNum => ({ label: `Class ${classNum}`, action: 'courses', filter: { classNum } }))
      }]
    },
    {
      id: 'senior-secondary',
      label: 'Class 11–12',
      groups: [
        { label: 'Science', items: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English'].map(label => ({ label, action: 'courses', filter: { classes: ['11', '12'], stream: 'science', subject: label } })) },
        { label: 'Commerce', items: ['Accountancy', 'Economics', 'Business Studies', 'English'].map(label => ({ label, action: 'courses', filter: { classes: ['11', '12'], stream: 'commerce', subject: label } })) },
        { label: 'Humanities', items: ['History', 'Political Science', 'Geography', 'Hindi', 'English'].map(label => ({ label, action: 'courses', filter: { classes: ['11', '12'], stream: 'humanities', subject: label } })) }
      ]
    },
    {
      id: 'bpsc',
      label: 'BPSC, UPSC, JEE & NEET',
      groups: [{
        label: 'Preparation',
        items: [
          'BPSC Prelims', 'BPSC Mains', 'Bihar Special', 'Current Affairs', 'Practice Questions',
          'UPSC CSE (Civil Services)', 'UPPCS (UP PSC)', 'JEE Mains (Engineering)', 'JEE Advanced (IIT)', 'NEET UG (Medical)'
        ].map(label => ({ label, action: 'courses', filter: { track: 'bpsc', topic: label } }))
      }]
    },
    {
      id: 'live-learning',
      label: 'Live Learning',
      groups: [{
        label: 'Classes',
        items: [
          { label: 'Live Classes', action: 'live' },
          { label: 'Upcoming Classes', action: 'live' }
        ]
      }]
    }
  ];

  
  const studyResourceCategories = [
    { id: 'notes', label: 'Notes', tag: 'Handwritten & Digital', icon: '📝', description: 'Chapter-wise detailed study notes and quick key point summaries.', action: 'resource', resourceType: 'notes' },
    { id: 'practice-test', label: 'Practice Papers', tag: 'Sample & Model Papers', icon: '📄', description: 'Subject practice test papers with solution keys and marking schemes.', action: 'resource', resourceType: 'practice-test' },
    { id: 'important-questions', label: 'Important Questions', tag: 'High-Weightage', icon: '❓', description: 'Curated list of high-probability exam questions with answer hints.', action: 'resource', resourceType: 'important-questions' },
    { id: 'mcq', label: 'MCQ Practice', tag: 'Interactive Quizzes', icon: '🎯', description: 'Objective practice questions with real-time scoring and instant feedback.', action: 'resource', resourceType: 'mcq' },
    { id: 'revision', label: 'Chapter-wise Revision', tag: 'Quick Summary', icon: '🔁', description: 'Fast-track revision guides covering core concepts before tests.', action: 'resource', resourceType: 'revision' },
    { id: 'formulas', label: 'Formula Sheets', tag: 'Maths & Science', icon: '📐', description: 'Consolidated formula cheat-sheets for rapid problem solving.', action: 'resource', resourceType: 'formulas' },
    { id: 'pyq', label: 'Previous Year Questions', tag: 'Exam Archives', icon: '📜', description: 'Previous year board and competitive exam question papers.', action: 'resource', resourceType: 'pyq' },
    { id: 'live-classes', label: 'Live Classes', tag: 'Interactive Sessions', icon: '🔴', description: 'Join scheduled live classes with interactive quiz popup overlays.', action: 'live' }
  ];

  function renderStudyResources(host, closeMenus) {
    if (!host) return;
    const grid = createElement('div', 'study-resources-grid');
    studyResourceCategories.forEach(item => {
      const card = createElement('article', 'study-resource-card');
      const head = createElement('div', 'study-resource-head');
      const icon = createElement('span', 'study-resource-icon', item.icon);
      const tag  = createElement('span', 'study-resource-tag', item.tag);
      head.append(icon, tag);

      const title = createElement('h3', 'study-resource-title', item.label);
      const desc  = createElement('p', 'study-resource-desc', item.description);

      const actionBtn = createElement('button', 'study-resource-action', 'अध्ययन करें');
      actionBtn.type = 'button';
      actionBtn.addEventListener('click', () => {
        if (typeof closeMenus === 'function') closeMenus();
        if (item.action === 'live') {
          const liveTab = document.getElementById('tab-live');
          if (liveTab) liveTab.click();
          const target = document.getElementById('live-classes') || document.getElementById('tab-live');
          if (target) target.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        openStudyResourcePicker(item);
      });

      card.append(head, title, desc, actionBtn);
      grid.append(card);
    });
    host.replaceChildren(grid);
  }

  function openStudyResourcePicker(resourceItem) {
    let modal = document.getElementById('study-resource-picker-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'study-resource-picker-modal';
      modal.className = 'study-resource-modal';
      modal.innerHTML = `
        <div class="study-resource-modal-overlay"></div>
        <div class="study-resource-modal-card" role="dialog" aria-modal="true" aria-labelledby="srm-title">
          <button type="button" class="study-resource-modal-close" aria-label="Close">&times;</button>
          <div class="study-resource-modal-header">
            <span class="study-resource-modal-icon" id="srm-icon">📝</span>
            <div>
              <h3 id="srm-title">Choose Class & Subject</h3>
              <p id="srm-subtitle">Select class to view resources</p>
            </div>
          </div>
          <div class="study-resource-modal-body">
            <div class="form-group">
              <label>Select Class</label>
              <select id="srm-class-select">
                <option value="6">Class 6</option>
                <option value="7">Class 7</option>
                <option value="8">Class 8</option>
                <option value="9">Class 9</option>
                <option value="10" selected>Class 10</option>
                <option value="11">Class 11</option>
                <option value="12">Class 12</option>
              </select>
            </div>
            <div class="form-group">
              <label>Select Subject</label>
              <select id="srm-subject-select">
                <option value="science">Science / Physics</option>
                <option value="mathematics">Mathematics</option>
                <option value="english">English</option>
                <option value="social-science">Social Science</option>
              </select>
            </div>
            <div id="srm-status-banner" class="study-resource-status-banner" style="display:none">
              <div class="srm-status-badge">⏱️ Content Preparation</div>
              <p>This resource set is being prepared by IdeaKDC teachers and will be live shortly.</p>
              <button type="button" id="srm-request-btn" class="srm-btn-request">🔔 Request This Resource</button>
            </div>
          </div>
          <div class="study-resource-modal-footer">
            <button type="button" id="srm-submit-btn" class="srm-btn-primary">View Resource</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('.study-resource-modal-overlay').addEventListener('click', () => { modal.style.display = 'none'; });
      modal.querySelector('.study-resource-modal-close').addEventListener('click', () => { modal.style.display = 'none'; });
    }

    const titleEl = modal.querySelector('#srm-title');
    const iconEl = modal.querySelector('#srm-icon');
    const subtitleEl = modal.querySelector('#srm-subtitle');
    const submitBtn = modal.querySelector('#srm-submit-btn');
    const statusBanner = modal.querySelector('#srm-status-banner');
    const requestBtn = modal.querySelector('#srm-request-btn');

    if (titleEl) titleEl.textContent = `${resourceItem.label} Selection`;
    if (iconEl) iconEl.textContent = resourceItem.icon;
    if (subtitleEl) subtitleEl.textContent = resourceItem.description;
    if (statusBanner) statusBanner.style.display = 'none';

    submitBtn.onclick = () => {
      const classId = modal.querySelector('#srm-class-select').value;
      const subjectId = modal.querySelector('#srm-subject-select').value;
      const path = `/${['class', classId].join('-')}/${subjectId}/${resourceItem.resourceType}/`;
      
      // Check if global AcademicPages exists
      if (window.IdeaKDCAcademicPages && typeof window.IdeaKDCAcademicPages.parseAcademicPath === 'function') {
        const route = window.IdeaKDCAcademicPages.parseAcademicPath(path);
        if (route) {
          modal.style.display = 'none';
          if (typeof window.IdeaKDCRenderAcademicPage === 'function') {
            window.IdeaKDCRenderAcademicPage(path);
          } else {
            window.location.hash = `#academic-${classId}-${subjectId}`;
          }
          return;
        }
      }
      
      // Fallback placeholder state if not directly indexable
      if (statusBanner) {
        statusBanner.style.display = 'block';
      }
    };

    if (requestBtn) {
      requestBtn.onclick = () => {
        requestBtn.textContent = '✓ Request Recorded!';
        requestBtn.disabled = true;
        requestBtn.style.opacity = '0.8';
        setTimeout(() => { modal.style.display = 'none'; }, 1200);
      };
    }

    modal.style.display = 'flex';
  }

  const discoveryGroups = [
    {
      id: 'school-discovery',
      label: 'School',
      description: 'Class 5 से Class 10 तक',
      items: ['5', '6', '7', '8', '9', '10'].map(classNum => ({
        label: `Class ${classNum}`,
        description: 'Subjects और available courses',
        action: 'courses',
        filter: { classNum }
      }))
    },
    {
      id: 'senior-discovery',
      label: 'Senior Secondary',
      description: 'Class 11–12 streams',
      items: ['11', '12'].flatMap(classNum => ['science', 'commerce', 'humanities'].map(stream => ({
        label: `Class ${classNum} ${stream[0].toUpperCase()}${stream.slice(1)}`,
        description: `${stream[0].toUpperCase()}${stream.slice(1)} learning path`,
        action: 'courses',
        filter: { classNum, stream }
      })))
    },
    {
      id: 'competitive-discovery',
      label: 'Competitive Exams',
      description: 'BPSC preparation',
      items: [
        { label: 'BPSC Prelims', description: 'Prelims learning path', action: 'courses', filter: { track: 'bpsc', topic: 'BPSC Prelims' } },
        { label: 'BPSC Mains', description: 'Mains learning path', action: 'courses', filter: { track: 'bpsc', topic: 'BPSC Mains' } }
      ]
    }
  ];

  function normalizedText(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizedClass(value) {
    return normalizedText(value).replace(/^class\s*/, '').replace(/(?:st|nd|rd|th)$/i, '');
  }

  function inferredStream(course) {
    const explicit = normalizedText(course?.stream);
    if (explicit) return explicit === 'arts' ? 'humanities' : explicit;
    const subject = normalizedText(course?.subject);
    if (['physics', 'chemistry', 'mathematics', 'maths', 'biology'].includes(subject)) return 'science';
    if (['accountancy', 'accounts', 'economics', 'business studies'].includes(subject)) return 'commerce';
    if (['history', 'political science', 'geography', 'hindi'].includes(subject)) return 'humanities';
    return '';
  }

  function courseMatchesFilter(course, filter) {
    if (!filter || !Object.keys(filter).length) return true;
    const courseClass = normalizedClass(course?.classNum ?? course?.class ?? course?.grade);
    if (filter.classNum && courseClass !== normalizedClass(filter.classNum)) return false;
    if (Array.isArray(filter.classes) && !filter.classes.map(normalizedClass).includes(courseClass)) return false;
    if (filter.stream && inferredStream(course) !== normalizedText(filter.stream)) return false;
    if (filter.subject && normalizedText(course?.subject) !== normalizedText(filter.subject)) return false;

    const searchText = [course?.classNum, course?.stream, course?.subject, course?.name, course?.tag, course?.category]
      .map(normalizedText).join(' ');
    if (filter.track === 'bpsc' && !searchText.includes('bpsc')) return false;
    if (filter.topic) {
      const topic = normalizedText(filter.topic).replace(/^bpsc\s*/, '');
      if (topic && !searchText.includes(topic)) return false;
    }
    return true;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function runAction(item, category, closeMenus) {
    closeMenus();
    global.dispatchEvent(new CustomEvent('ideakdc:academic-navigation', {
      detail: { category: category.label, destination: item.label, filter: item.filter || null }
    }));
    if (item.action === 'live' && typeof global.showLive === 'function') {
      global.showLive();
      return;
    }
    if (item.filter && typeof global.showAcademicCourses === 'function') {
      global.showAcademicCourses(item.filter, item.label);
      return;
    }
    if (typeof global.showAllCourses === 'function') global.showAllCourses();
  }

  function renderDiscovery(host, closeMenus) {
    if (!host) return;
    const fragment = document.createDocumentFragment();
    discoveryGroups.forEach(group => {
      const section = createElement('section', 'discovery-group');
      section.setAttribute('aria-labelledby', `discovery-title-${group.id}`);
      const headingWrap = createElement('div', 'discovery-group-heading');
      const heading = createElement('h3', 'discovery-group-title', group.label);
      heading.id = `discovery-title-${group.id}`;
      headingWrap.append(heading, createElement('p', 'discovery-group-copy', group.description));
      const grid = createElement('div', 'discovery-card-grid');
      group.items.forEach(item => {
        const button = createElement('button', 'discovery-card');
        button.type = 'button';
        button.append(createElement('strong', 'discovery-card-title', item.label));
        button.append(createElement('span', 'discovery-card-copy', item.description));
        button.append(createElement('span', 'discovery-card-arrow', 'Explore →'));
        button.addEventListener('click', () => runAction(item, group, closeMenus));
        grid.append(button);
      });
      section.append(headingWrap, grid);
      fragment.append(section);
    });
    host.replaceChildren(fragment);
  }

  function renderDesktop(host, closeMenus) {
    const list = createElement('div', 'academic-desktop-list');
    categories.forEach(category => {
      const item = createElement('div', 'academic-desktop-item');
      const button = createElement('button', 'academic-trigger', category.label);
      const panel = createElement('div', 'academic-mega-panel');
      const panelId = `academic-panel-${category.id}`;
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', panelId);
      panel.id = panelId;
      panel.hidden = true;

      category.groups.forEach(group => {
        const section = createElement('section', 'academic-mega-group');
        section.append(createElement('h2', 'academic-group-title', group.label));
        const links = createElement('div', 'academic-link-list');
        group.items.forEach(linkItem => {
          const link = createElement('button', 'academic-link', linkItem.label);
          link.type = 'button';
          link.addEventListener('click', () => runAction(linkItem, category, closeMenus));
          links.append(link);
        });
        section.append(links);
        panel.append(section);
      });

      button.addEventListener('click', event => {
        event.stopPropagation();
        const shouldOpen = button.getAttribute('aria-expanded') !== 'true';
        closeMenus();
        if (shouldOpen) {
          button.setAttribute('aria-expanded', 'true');
          panel.hidden = false;
        }
      });
      item.append(button, panel);
      list.append(item);
    });
    host.replaceChildren(list);
  }

  function renderMobile(host, closeMenus) {
    const list = createElement('div', 'academic-mobile-list');
    categories.forEach(category => {
      const section = createElement('section', 'academic-mobile-section');
      const button = createElement('button', 'academic-mobile-trigger', category.label);
      const panel = createElement('div', 'academic-mobile-panel');
      const panelId = `academic-mobile-panel-${category.id}`;
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', panelId);
      panel.id = panelId;
      panel.hidden = true;

      category.groups.forEach(group => {
        panel.append(createElement('h2', 'academic-mobile-group-title', group.label));
        group.items.forEach(linkItem => {
          const link = createElement('button', 'academic-mobile-link', linkItem.label);
          link.type = 'button';
          link.addEventListener('click', () => runAction(linkItem, category, closeMenus));
          panel.append(link);
        });
      });

      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        host.querySelectorAll('.academic-mobile-trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
        host.querySelectorAll('.academic-mobile-panel').forEach(candidate => { candidate.hidden = true; });
        button.setAttribute('aria-expanded', String(!expanded));
        panel.hidden = expanded;
      });
      section.append(button, panel);
      list.append(section);
    });
    host.replaceChildren(list);
  }

  function init() {
    const desktopHost = document.getElementById('academic-nav-desktop');
    const mobileHost = document.getElementById('academic-nav-mobile');
    const mobileToggle = document.getElementById('academic-mobile-toggle');
    const mobileDrawer = document.getElementById('academic-mobile-drawer');
    if (!desktopHost || !mobileHost || !mobileToggle || !mobileDrawer) return;

    const closeMenus = () => {
      desktopHost.querySelectorAll('.academic-trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      desktopHost.querySelectorAll('.academic-mega-panel').forEach(panel => { panel.hidden = true; });
      mobileToggle.setAttribute('aria-expanded', 'false');
      mobileDrawer.hidden = true;
      document.body.classList.remove('academic-menu-open');
    };

    renderDesktop(desktopHost, closeMenus);
    renderMobile(mobileHost, closeMenus);
    renderDiscovery(document.getElementById('academic-discovery'), closeMenus);
    renderStudyResources(document.getElementById('study-resources-grid'), closeMenus);
    mobileDrawer.querySelectorAll('.academic-mobile-utility button').forEach(button => {
      button.addEventListener('click', closeMenus);
    });

    mobileToggle.addEventListener('click', event => {
      event.stopPropagation();
      const shouldOpen = mobileToggle.getAttribute('aria-expanded') !== 'true';
      closeMenus();
      mobileToggle.setAttribute('aria-expanded', String(shouldOpen));
      mobileDrawer.hidden = !shouldOpen;
      document.body.classList.toggle('academic-menu-open', shouldOpen);
    });
    mobileDrawer.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMenus();
        mobileToggle.focus();
      }
    });
  }

  const api = { categories, discoveryGroups, studyResourceCategories, openStudyResourcePicker, renderStudyResources, courseMatchesFilter, inferredStream, init };
  global.IdeaKDCAcademicNavigation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
