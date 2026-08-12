import { useState, useEffect } from 'react';
import Login from './components/Login.jsx';
import StudentQuiz from './components/StudentQuiz.jsx';
import TeacherDashboard from './components/TeacherDashboard.jsx';
import BackgroundSlider from './components/BackgroundSlider.jsx';
import DevelopedByIru from './components/DevelopedByIru.jsx';

const SESSION_KEY = 'quiz_session_v1';

function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore session from sessionStorage on load (survives page refresh,
  // cleared when the browser tab/window closes - reasonable for a quiz app).
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // Discard legacy / fake tokens — a real JWT has exactly 3 dot-separated parts
        const isRealJwt = saved?.token && saved.token.split('.').length === 3;
        if (isRealJwt) {
          setSession(saved);
        } else {
          window.sessionStorage.removeItem(SESSION_KEY);
        }
      }
    } catch {
      // ignore corrupt storage
    }
    setReady(true);
  }, []);


  function handleLogin(newSession) {
    setSession(newSession);
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    window.dispatchEvent(new CustomEvent('iru-trigger-intro'));
  }

  function handleLogout() {
    setSession(null);
    window.sessionStorage.removeItem(SESSION_KEY);
  }

  if (!ready) return null;

  return (
    <>
      <BackgroundSlider />
      {!session ? (
        <Login onLogin={handleLogin} />
      ) : session.role === 'teacher' ? (
        <TeacherDashboard session={session} onLogout={handleLogout} />
      ) : (
        <StudentQuiz session={session} onLogout={handleLogout} />
      )}
      <DevelopedByIru hideBadge={!session} />
    </>
  );
}

export default App;

