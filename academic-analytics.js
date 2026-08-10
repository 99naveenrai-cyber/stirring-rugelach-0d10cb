(function academicAnalyticsModule(global) {
  'use strict';

  const ALLOWED_EVENTS = [
    'page_view',
    'class_select',
    'subject_select',
    'chapter_view',
    'resource_click',
    'live_registration',
    'search_query'
  ];

  const eventBuffer = [];

  function trackAcademicEvent(eventName, payload = {}) {
    if (!ALLOWED_EVENTS.includes(eventName)) return false;

    const eventObj = {
      event: eventName,
      timestamp: new Date().toISOString(),
      ...payload
    };

    eventBuffer.push(eventObj);
    if (eventBuffer.length > 200) eventBuffer.shift();

    // Safely dispatch to window.gtag or firebase analytics without blocking UX
    try {
      if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
        window.gtag('event', eventName, payload);
      }
    } catch (_) {
      // Non-blocking fail-safe
    }

    return true;
  }

  function getBufferedEvents() {
    return [...eventBuffer];
  }

  const api = {
    ALLOWED_EVENTS,
    trackAcademicEvent,
    getBufferedEvents
  };

  global.IdeaKDCAcademicAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
