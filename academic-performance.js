(function academicPerformanceModule(global) {
  'use strict';

  function initPerformanceOptimizations() {
    // 1. Enforce lazy loading and async decoding on images
    if (typeof document !== 'undefined') {
      const images = document.querySelectorAll('img:not([loading])');
      images.forEach(img => {
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
      });
    }

    // 2. Resource hint helper for dynamic asset prefetching
    function preconnectOrigin(originUrl) {
      if (typeof document === 'undefined') return;
      if (document.querySelector(`link[rel="preconnect"][href="${originUrl}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = originUrl;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }

    return {
      preconnectOrigin
    };
  }

  const api = initPerformanceOptimizations();
  global.IdeaKDCAcademicPerf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
