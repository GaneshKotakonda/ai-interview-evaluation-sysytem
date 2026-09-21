// -------------------------------------------------------------
// BLOCK 1: Static Fallback Interview Questions
// -------------------------------------------------------------
// Standard general questions used as a baseline fallback.
export const interviewQuestions = [
  {
    id: 1,
    text: 'Tell me about yourself and your technical background.',
  },
  {
    id: 2,
    text: 'Explain a challenging project you worked on and how you handled it.',
  },
  {
    id: 3,
    text: 'What is the difference between a process and a thread?',
  },
  {
    id: 4,
    text: 'Explain how you would improve the performance of a slow web application.',
  },
  {
    id: 5,
    text: 'Why should we select you for this role?',
  },
];

// -------------------------------------------------------------
// BLOCK 2: Dynamic Role & Job Description Fallback Question Generator
// -------------------------------------------------------------
// If the backend is starting up or temporarily offline, this generator
// extracts keywords from the user's role and job description to create
// 5 highly relevant technical questions instead of generic ones.
export function generateJdFallbackQuestions(roleTitle = 'Software Engineer', jobDescription = '') {
  const role = roleTitle.trim() || 'Software Engineer';
  const jd = (jobDescription || '').toLowerCase();
  const detectedSkills = [];

  const knownKeywords = [
    'React', 'Node', 'Python', 'FastAPI', 'PostgreSQL', 'MongoDB', 'Express',
    'MERN', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Redis', 'TypeScript',
    'JavaScript', 'GraphQL', 'Next.js', 'Django', 'Redux', 'Tailwind', 'CI/CD'
  ];

  knownKeywords.forEach((keyword) => {
    if (jd.includes(keyword.toLowerCase()) || role.toLowerCase().includes(keyword.toLowerCase())) {
      detectedSkills.push(keyword);
    }
  });

  const primaryStack = detectedSkills.length > 0 ? detectedSkills.slice(0, 4).join(', ') : role;

  return [
    {
      index: 1,
      id: 1,
      question: `For this ${role} position requiring proficiency in ${primaryStack}, can you walk through your hands-on production experience and architecture design with these technologies?`,
      text: `For this ${role} position requiring proficiency in ${primaryStack}, can you walk through your hands-on production experience and architecture design with these technologies?`,
    },
    {
      index: 2,
      id: 2,
      question: `In an application built with ${primaryStack}, what state management, data flow, and component lifecycle best practices do you follow to ensure high performance and maintainability?`,
      text: `In an application built with ${primaryStack}, what state management, data flow, and component lifecycle best practices do you follow to ensure high performance and maintainability?`,
    },
    {
      index: 3,
      id: 3,
      question: `Describe a complex technical debugging challenge or architectural bottleneck you encountered while working with ${primaryStack}. How did you identify the root cause and resolve it?`,
      text: `Describe a complex technical debugging challenge or architectural bottleneck you encountered while working with ${primaryStack}. How did you identify the root cause and resolve it?`,
    },
    {
      index: 4,
      id: 4,
      question: `How do you design database schemas, optimize queries/indexes, and handle secure authentication and authorization patterns in a ${role} stack?`,
      text: `How do you design database schemas, optimize queries/indexes, and handle secure authentication and authorization patterns in a ${role} stack?`,
    },
    {
      index: 5,
      id: 5,
      question: `Considering the responsibilities outlined in this ${role} job description, how do you handle automated testing (unit/integration), containerization, and CI/CD deployment pipelines?`,
      text: `Considering the responsibilities outlined in this ${role} job description, how do you handle automated testing (unit/integration), containerization, and CI/CD deployment pipelines?`,
    },
  ];
}
