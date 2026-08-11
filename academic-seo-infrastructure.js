(function academicSeoInfrastructureModule(global) {
  'use strict';

  const BASE_DOMAIN = 'https://betalaunch.ideakdc.in';

  function buildCanonicalUrl(path) {
    const p = String(path || '/').trim();
    const cleanPath = p.startsWith('/') ? p : `/${p}`;
    return `${BASE_DOMAIN}${cleanPath}`;
  }

  function getEducationalOrganizationSchema() {
    return {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      name: 'IdeaKDC',
      url: BASE_DOMAIN,
      logo: `${BASE_DOMAIN}/icon.png`,
      description: 'IdeaKDC EdTech Platform – Creating Thoughtful Minds for School, Senior Secondary, BPSC & SSC Exams.',
      sameAs: []
    };
  }

  function getCourseSchema(courseName, description, path = '/') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: courseName || 'IdeaKDC Academic Preparation',
      description: description || 'NCERT/CBSE aligned academic courses and exam prep.',
      provider: {
        '@type': 'Organization',
        name: 'IdeaKDC',
        sameAs: BASE_DOMAIN
      },
      url: buildCanonicalUrl(path)
    };
  }

  function getBreadcrumbListSchema(itemsList = []) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: itemsList.map((item, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: item.label,
        item: buildCanonicalUrl(item.path)
      }))
    };
  }

  function getFaqPageSchema(faqsList = []) {
    if (!Array.isArray(faqsList) || faqsList.length === 0) return null;
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqsList.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer
        }
      }))
    };
  }

  function buildMetaTags(title, description, path = '/', imageUrl = `${BASE_DOMAIN}/icon.png`) {
    const canonical = buildCanonicalUrl(path);
    return {
      canonical,
      og: {
        'og:title': title,
        'og:description': description,
        'og:url': canonical,
        'og:type': 'website',
        'og:image': imageUrl,
        'og:site_name': 'IdeaKDC'
      },
      twitter: {
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:description': description,
        'twitter:image': imageUrl
      }
    };
  }

  const api = {
    BASE_DOMAIN,
    buildCanonicalUrl,
    getEducationalOrganizationSchema,
    getCourseSchema,
    getBreadcrumbListSchema,
    getFaqPageSchema,
    buildMetaTags
  };

  global.IdeaKDCAcademicSeoInfra = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
