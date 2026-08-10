const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seoInfra = require('../academic-seo-infrastructure.js');

test('robots.txt exists and points to HTTPS sitemap.xml', () => {
  const robotsPath = path.join(__dirname, '../robots.txt');
  assert.equal(fs.existsSync(robotsPath), true);
  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  assert.match(robotsContent, /User-agent:\s*\*/);
  assert.match(robotsContent, /Sitemap:\s*https:\/\/betalaunch\.ideakdc\.in\/sitemap\.xml/);
});

test('sitemap.xml exists and lists key academic HTTPS URLs', () => {
  const sitemapPath = path.join(__dirname, '../sitemap.xml');
  assert.equal(fs.existsSync(sitemapPath), true);
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  assert.match(sitemapContent, /<loc>https:\/\/betalaunch\.ideakdc\.in\/<\/loc>/);
  assert.match(sitemapContent, /<loc>https:\/\/betalaunch\.ideakdc\.in\/class-10\/<\/loc>/);
  assert.match(sitemapContent, /<loc>https:\/\/betalaunch\.ideakdc\.in\/class-11\/science\/<\/loc>/);
});

test('Stage 13 canonical URL and meta tags use HTTPS betalaunch.ideakdc.in format', () => {
  const canonical = seoInfra.buildCanonicalUrl('/class-10/science/');
  assert.equal(canonical, 'https://betalaunch.ideakdc.in/class-10/science/');

  const meta = seoInfra.buildMetaTags('Class 10 Science', 'Science prep for Class 10', '/class-10/science/');
  assert.equal(meta.canonical, 'https://betalaunch.ideakdc.in/class-10/science/');
  assert.equal(meta.og['og:title'], 'Class 10 Science');
  assert.equal(meta.twitter['twitter:card'], 'summary_large_image');
});

test('Stage 13 JSON-LD schemas produce EducationalOrganization, Course, Breadcrumbs & FAQ', () => {
  const org = seoInfra.getEducationalOrganizationSchema();
  assert.equal(org['@type'], 'EducationalOrganization');
  assert.equal(org.name, 'IdeaKDC');

  const course = seoInfra.getCourseSchema('Class 10 Science', 'CBSE Science', '/class-10/science/');
  assert.equal(course['@type'], 'Course');
  assert.equal(course.name, 'Class 10 Science');

  const breadcrumbs = seoInfra.getBreadcrumbListSchema([
    { label: 'Home', path: '/' },
    { label: 'Class 10', path: '/class-10/' }
  ]);
  assert.equal(breadcrumbs['@type'], 'BreadcrumbList');
  assert.equal(breadcrumbs.itemListElement.length, 2);

  const faqs = seoInfra.getFaqPageSchema([
    { question: 'What is reflection?', answer: 'Bouncing of light.' }
  ]);
  assert.equal(faqs['@type'], 'FAQPage');
  assert.equal(faqs.mainEntity[0].name, 'What is reflection?');
});
