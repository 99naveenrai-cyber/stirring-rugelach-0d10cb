(function academicCompetitiveExamsModule(global) {
  'use strict';

  const COMPETITIVE_EXAMS = [
    {
      id: 'bpsc',
      name: 'BPSC (Bihar PSC)',
      subtitle: 'Bihar Public Service Commission',
      badge: 'State PSC',
      sections: [
        { id: 'bpsc-prelims', title: 'BPSC Prelims (GS & CA)', icon: 'ðŸ“–' },
        { id: 'bpsc-mains', title: 'BPSC Mains (GS I, II & Essay)', icon: 'âœï¸' },
        { id: 'bpsc-bihar-special', title: 'Bihar Special History & Geo', icon: 'ðŸŒ¾' },
        { id: 'bpsc-current-affairs', title: 'State & National Current Affairs', icon: 'ðŸ“°' },
        { id: 'bpsc-practice', title: 'Mock Tests & Practice Questions', icon: 'ðŸ“' }
      ]
    },
    {
      id: 'upsc',
      name: 'UPSC CSE',
      subtitle: 'Union Public Service Commission',
      badge: 'Civil Services',
      sections: [
        { id: 'upsc-prelims', title: 'Prelims (GS Paper I & CSAT)', icon: 'ðŸ›ï¸' },
        { id: 'upsc-mains-gs', title: 'Mains GS Papers Iâ€“IV', icon: 'ðŸ“š' },
        { id: 'upsc-essay', title: 'Essay & Case Studies', icon: 'ðŸ“' },
        { id: 'upsc-current', title: 'Daily Current Affairs & Analysis', icon: 'ðŸ—žï¸' }
      ]
    },
    {
      id: 'uppcs',
      name: 'UPPCS (UP PSC)',
      subtitle: 'Uttar Pradesh Public Service Commission',
      badge: 'State PSC',
      sections: [
        { id: 'uppcs-prelims', title: 'UPPCS Prelims GS', icon: 'ðŸ“' },
        { id: 'uppcs-mains', title: 'UPPCS Mains Strategy', icon: 'ðŸ“–' },
        { id: 'uppcs-up-special', title: 'UP Special GK & History', icon: 'ðŸ›ï¸' },
        { id: 'uppcs-practice', title: 'UPPCS Practice Sets', icon: 'âœï¸' }
      ]
    },
    {
      id: 'ssc',
      name: 'SSC',
      subtitle: 'Staff Selection Commission',
      badge: 'Central Government Exams',
      sections: [
        { id: 'ssc-cgl', title: 'SSC CGL', icon: 'ðŸ›ï¸' },
        { id: 'ssc-chsl', title: 'SSC CHSL', icon: 'ðŸ“' },
        { id: 'ssc-mts', title: 'SSC MTS', icon: 'ðŸ“š' },
        { id: 'ssc-cpo', title: 'SSC CPO & GD', icon: 'ðŸŽ¯' }
      ]
    },
    {
      id: 'jee-mains',
      name: 'JEE Mains',
      subtitle: 'Engineering Entrance Examination',
      badge: 'Engineering',
      sections: [
        { id: 'jee-physics', title: 'Physics (Mechanics, Optics, Electrodynamics)', icon: 'âš¡' },
        { id: 'jee-chemistry', title: 'Chemistry (Physical, Organic, Inorganic)', icon: 'ðŸ§ª' },
        { id: 'jee-maths', title: 'Mathematics (Calculus, Algebra, Geometry)', icon: 'ðŸ“' },
        { id: 'jee-mains-mocks', title: 'Chapter-wise MCQ Mocks', icon: 'ðŸŽ¯' }
      ]
    },
    {
      id: 'jee-advanced',
      name: 'JEE Advanced',
      subtitle: 'IIT Entrance Examination',
      badge: 'IIT Prep',
      sections: [
        { id: 'jee-adv-problem-solving', title: 'Advanced Multi-Concept Problems', icon: 'ðŸ§©' },
        { id: 'jee-adv-numerical', title: 'Numerical Response & Matrix Match', icon: 'ðŸ”¢' },
        { id: 'jee-adv-pyq', title: '15+ Years PYQ Detailed Solutions', icon: 'ðŸ“œ' }
      ]
    },
    {
      id: 'neet',
      name: 'NEET (UG)',
      subtitle: 'Medical Entrance Examination',
      badge: 'Medical',
      sections: [
        { id: 'neet-biology', title: 'Biology (Botany & Zoology NCERT)', icon: 'ðŸ§¬' },
        { id: 'neet-physics', title: 'Physics Numerical Practice', icon: 'âš™ï¸' },
        { id: 'neet-chemistry', title: 'Organic & Inorganic NCERT Drill', icon: 'ðŸ§«' },
        { id: 'neet-ncert-line', title: 'NCERT Line-by-Line MCQ Drill', icon: 'ðŸŽ¯' }
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

