const test = require('node:test');
const assert = require('node:assert/strict');
const competitiveModule = require('../academic-competitive-exams.js');

test('Stage 17 competitive exams exposes BPSC, UPSC, UPPCS, JEE, NEET, and SSC', () => {
  const list = competitiveModule.getCompetitiveExams();
  assert.equal(Array.isArray(list), true);
  assert.equal(list.length, 7);

  const ids = list.map(e => e.id);
  assert.ok(ids.includes('bpsc'));
  assert.ok(ids.includes('upsc'));
  assert.ok(ids.includes('uppcs'));
  assert.ok(ids.includes('jee-mains'));
  assert.ok(ids.includes('jee-advanced'));
  assert.ok(ids.includes('neet'));
  assert.ok(ids.includes('ssc'));
});

test('SSC exam details contain the main Staff Selection Commission paths', () => {
  const ssc = competitiveModule.getExamDetails('ssc');
  assert.ok(ssc);
  assert.equal(ssc.name, 'SSC');
  const sectionTitles = ssc.sections.map(section => section.title);
  assert.ok(sectionTitles.includes('SSC CGL'));
  assert.ok(sectionTitles.includes('SSC CHSL'));
  assert.ok(sectionTitles.includes('SSC MTS'));
  assert.ok(sectionTitles.includes('SSC CPO & GD'));
});

test('BPSC exam details contains Prelims, Mains, Bihar Special & Current Affairs', () => {
  const bpsc = competitiveModule.getExamDetails('bpsc');
  assert.ok(bpsc);
  assert.equal(bpsc.name, 'BPSC (Bihar PSC)');
  const secTitles = bpsc.sections.map(s => s.title);
  assert.ok(secTitles.some(t => t.includes('Prelims')));
  assert.ok(secTitles.some(t => t.includes('Mains')));
  assert.ok(secTitles.some(t => t.includes('Bihar Special')));
});

test('JEE and NEET exam details contain subjects and NCERT line-by-line practice', () => {
  const jee = competitiveModule.getExamDetails('jee-mains');
  assert.ok(jee);
  assert.ok(jee.sections.some(s => s.title.includes('Physics')));

  const neet = competitiveModule.getExamDetails('neet');
  assert.ok(neet);
  assert.ok(neet.sections.some(s => s.title.includes('NCERT Line-by-Line')));
});

