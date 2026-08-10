// api.js
// Small helper around fetch() for talking to the backend.
// Set VITE_API_URL in client/.env to point at your deployed backend,
// e.g. VITE_API_URL=https://your-quiz-backend.onrender.com

// Strip any trailing slash so that URL + "/api/..." never produces a double-slash (//)
const rawApiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');
const API_URL = rawApiUrl.replace(/\/+$/, '');

if (!import.meta.env.VITE_API_URL && !import.meta.env.DEV) {
  console.warn(
    '[API Config Warning]: VITE_API_URL environment variable is not defined. ' +
    'API calls will default to relative URLs, which fail with 405 Method Not Allowed on static hosting like Vercel. ' +
    'Set VITE_API_URL=https://MY-RENDER-SERVICE.onrender.com in your Vercel Dashboard.'
  );
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;

    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),

  // student
  getActiveQuiz: (token) => request(`/api/student/quiz/active`, { token }),
  getQuizHistory: (token) => request('/api/student/quiz/history', { token }),
  saveAnswer: (token, quizId, questionId, answer) =>
    request(`/api/student/quiz/${quizId}/answer`, { method: 'POST', token, body: { questionId, answer } }),
  reportTabSwitch: (token, quizId) =>
    request(`/api/student/quiz/${quizId}/tab-switch`, { method: 'POST', token }),
  submitQuiz: (token, quizId) =>
    request(`/api/student/quiz/${quizId}/submit`, { method: 'POST', token }),

  // teacher
  createQuiz: (token, title, questions) =>
    request('/api/teacher/quiz', { method: 'POST', token, body: { title, questions } }),
  listQuizzes: (token) => request('/api/teacher/quiz', { token }),
  getAttempts: (token, quizId) => request(`/api/teacher/quiz/${quizId}/attempts`, { token }),
  resetAttempt: (token, quizId, studentId) =>
    request(`/api/teacher/quiz/${quizId}/attempts/${studentId}/reset`, { method: 'POST', token }),
  reactivateQuiz: (token, quizId) =>
    request(`/api/teacher/quiz/${quizId}/reactivate`, { method: 'POST', token }),
  deactivateQuiz: (token, quizId) =>
    request(`/api/teacher/quiz/${quizId}/deactivate`, { method: 'POST', token }),
  deleteQuiz: (token, quizId) =>
    request(`/api/teacher/quiz/${quizId}`, { method: 'DELETE', token }),
  exportUrl: (quizId, token) => `${API_URL}/api/teacher/quiz/${quizId}/export?token=${token}`,
  generateQuestions: (token, topic, count) =>
    request('/api/teacher/generate-questions', { method: 'POST', token, body: { topic, count } }),
};

export { API_URL };
