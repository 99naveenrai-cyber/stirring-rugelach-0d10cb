const test = require('node:test');
const assert = require('node:assert/strict');
const analyticsModule = require('../academic-analytics.js');

test('Stage 18 trackAcademicEvent tracks all 7 required event types', () => {
  const events = [
    'page_view',
    'class_select',
    'subject_select',
    'chapter_view',
    'resource_click',
    'live_registration',
    'search_query'
  ];

  events.forEach(evt => {
    const res = analyticsModule.trackAcademicEvent(evt, { testKey: 'val' });
    assert.equal(res, true);
  });

  const invalidRes = analyticsModule.trackAcademicEvent('unsupported_event', {});
  assert.equal(invalidRes, false);
});

test('Stage 18 analytics does not block user experience if window.gtag throws error', () => {
  global.window = {
    gtag: () => {
      throw new Error('Analytics failed to load');
    }
  };

  assert.doesNotThrow(() => {
    analyticsModule.trackAcademicEvent('class_select', { classId: '10' });
  });

  delete global.window;
});

test('getBufferedEvents retrieves recorded interaction logs', () => {
  analyticsModule.trackAcademicEvent('search_query', { query: 'physics' });
  const buffer = analyticsModule.getBufferedEvents();
  assert.ok(buffer.length > 0);
  assert.equal(buffer[buffer.length - 1].event, 'search_query');
  assert.equal(buffer[buffer.length - 1].query, 'physics');
});
