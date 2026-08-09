(function academicNavigationModule(global) {
  'use strict';

  const categories = [
    {
      id: 'school',
      label: 'School Preparation',
      groups: [{
        label: 'Classes',
        items: ['Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'].map(label => ({ label, action: 'courses' }))
      }]
    },
    {
      id: 'senior-secondary',
      label: 'Class 11–12',
      groups: [
        { label: 'Science', items: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English'].map(label => ({ label, action: 'courses' })) },
        { label: 'Commerce', items: ['Accountancy', 'Economics', 'Business Studies', 'English'].map(label => ({ label, action: 'courses' })) },
        { label: 'Humanities', items: ['History', 'Political Science', 'Geography', 'Hindi', 'English'].map(label => ({ label, action: 'courses' })) }
      ]
    },
    {
      id: 'bpsc',
      label: 'BPSC',
      groups: [{
        label: 'Preparation',
        items: ['BPSC Prelims', 'BPSC Mains', 'Bihar Special', 'Current Affairs', 'Practice Questions'].map(label => ({ label, action: 'courses' }))
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

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function runAction(item, category, closeMenus) {
    closeMenus();
    global.dispatchEvent(new CustomEvent('ideakdc:academic-navigation', {
      detail: { category: category.label, destination: item.label }
    }));
    if (item.action === 'live' && typeof global.showLive === 'function') {
      global.showLive();
      return;
    }
    if (typeof global.showAllCourses === 'function') global.showAllCourses();
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

  const api = { categories, init };
  global.IdeaKDCAcademicNavigation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
