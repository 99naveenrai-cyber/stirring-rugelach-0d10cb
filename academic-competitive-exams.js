(function academicCompetitiveExamsModule(global) {
  'use strict';

  const COMPETITIVE_EXAMS = [
    {
      id: 'bpsc',
      name: 'BPSC (Bihar PSC)',
      subtitle: 'Bihar Public Service Commission',
      badge: 'State PSC',
      sections: [
        { id: 'bpsc-prelims', title: 'BPSC Prelims (GS & CA)', icon: '📖' },
        { id: 'bpsc-mains', title: 'BPSC Mains (GS I, II & Essay)', icon: '✍️' },
        { id: 'bpsc-bihar-special', title: 'Bihar Special History & Geo', icon: '🌾' },
        { id: 'bpsc-current-affairs', title: 'State & National Current Affairs', icon: '📰' },
        { id: 'bpsc-practice', title: 'Mock Tests & Practice Questions', icon: '📝' }
      ]
    },
    {
      id: 'upsc',
      name: 'UPSC CSE',
      subtitle: 'Union Public Service Commission',
      badge: 'Civil Services',
      sections: [
        { id: 'upsc-prelims', title: 'Prelims (GS Paper I & CSAT)', icon: '🏛️' },
        { id: 'upsc-mains-gs', title: 'Mains GS Papers I–IV', icon: '📚' },
        { id: 'upsc-essay', title: 'Essay & Case Studies', icon: '📝' },
        { id: 'upsc-current', title: 'Daily Current Affairs & Analysis', icon: '🗞️' }
      ]
    },
    {
      id: 'uppcs',
      name: 'UPPCS (UP PSC)',
      subtitle: 'Uttar Pradesh Public Service Commission',
      badge: 'State PSC',
      sections: [
        { id: 'uppcs-prelims', title: 'UPPCS Prelims GS', icon: '📍' },
        { id: 'uppcs-mains', title: 'UPPCS Mains Strategy', icon: '📖' },
        { id: 'uppcs-up-special', title: 'UP Special GK & History', icon: '🏛️' },
        { id: 'uppcs-practice', title: 'UPPCS Practice Sets', icon: '✍️' }
      ]
    },
    {
      id: 'jee-mains',
      name: 'JEE Mains',
      subtitle: 'Engineering Entrance Examination',
      badge: 'Engineering',
      sections: [
        { id: 'jee-physics', title: 'Physics (Mechanics, Optics, Electrodynamics)', icon: '⚡' },
        { id: 'jee-chemistry', title: 'Chemistry (Physical, Organic, Inorganic)', icon: '🧪' },
        { id: 'jee-maths', title: 'Mathematics (Calculus, Algebra, Geometry)', icon: '📐' },
        { id: 'jee-mains-mocks', title: 'Chapter-wise MCQ Mocks', icon: '🎯' }
      ]
    },
    {
      id: 'jee-advanced',
      name: 'JEE Advanced',
      subtitle: 'IIT Entrance Examination',
      badge: 'IIT Prep',
      sections: [
        { id: 'jee-adv-problem-solving', title: 'Advanced Multi-Concept Problems', icon: '🧩' },
        { id: 'jee-adv-numerical', title: 'Numerical Response & Matrix Match', icon: '🔢' },
        { id: 'jee-adv-pyq', title: '15+ Years PYQ Detailed Solutions', icon: '📜' }
      ]
    },
    {
      id: 'neet',
      name: 'NEET (UG)',
      subtitle: 'Medical Entrance Examination',
      badge: 'Medical',
      sections: [
        { id: 'neet-biology', title: 'Biology (Botany & Zoology NCERT)', icon: '🧬' },
        { id: 'neet-physics', title: 'Physics Numerical Practice', icon: '⚙️' },
        { id: 'neet-chemistry', title: 'Organic & Inorganic NCERT Drill', icon: '🧫' },
        { id: 'neet-ncert-line', title: 'NCERT Line-by-Line MCQ Drill', icon: '🎯' }
      ]
    }
  ];

  function getCompetitiveExams() {
    return COMPETITIVE_EXAMS;
  }

  function getExamDetails(examId) {
    const id = String(examId || '').toLowerCase().trim();
    return COMPETITIVE_EXAMS.find(e => e.id === id) || null;
  }

  const api = {
    COMPETITIVE_EXAMS,
    getCompetitiveExams,
    getExamDetails
  };

  global.IdeaKDCAcademicCompetitiveExams = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
