import { useState, useEffect } from 'react';

import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [role, setRole] = useState('student');
  const [teamName, setTeamName] = useState('');
  const [password, setPassword] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [bannerIndex, setBannerIndex] = useState(0);
  const BANNER_IMAGES = ['/1.png', '/2.png', '/3.png', '/4.png'];

  // Cycle banner images every 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setBannerIndex((prev) => (prev + 1) % BANNER_IMAGES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [BANNER_IMAGES.length]);



  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (role === 'student') {
      if (!teamName.trim()) return setError('Enter your team name or number.');
      if (!password.trim()) return setError('Enter your password.');
    } else {
      if (!teacherId.trim()) return setError('Enter your Teacher ID.');
      if (!password.trim()) return setError('Enter your password.');
    }

    setLoading(true);
    try {
      if (role === 'teacher') {
        // Call backend API to get a real JWT token
        const res = await api.login({
          role: 'teacher',
          email: teacherId.trim().toLowerCase(),
          password: password.trim(),
        });
        onLogin({
          token: res.token,
          role: 'teacher',
          email: res.email,
          uucmsNo: null,
        });
        return;
      }

      // Student login via API
      const payload = { role, teamName: teamName.trim(), password: password.trim() };
      const res = await api.login(payload);
      onLogin({
        token: res.token,
        role: res.role,
        email: res.email,
        uucmsNo: res.uucmsNo
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const [isSwapping, setIsSwapping] = useState(false);

  function switchRole(r) {
    if (role === r) return;
    setIsSwapping(true);
    setRole(r);
    setError('');
    setPassword('');
    setTimeout(() => setIsSwapping(false), 500);
  }

  return (
    <div className="app-shell">
      <div className="card card--narrow">
        <p className="eyebrow">Weekly Quiz</p>
        <h1 className="title">Welcome back</h1>

        <p className="subtitle">Sign in with your credentials.</p>

        <div className={`role-tabs ${isSwapping ? 'swapping-effect' : ''}`}>
          <button
            type="button"
            className={`role-tab ${role === 'student' ? 'water-type active' : 'dark-glass'}`}
            onClick={() => switchRole('student')}
          >
            <span className="water-wave-glow" />
            Participant
          </button>
          <button
            type="button"
            className={`role-tab ${role === 'teacher' ? 'water-type active' : 'dark-glass'}`}
            onClick={() => switchRole('teacher')}
          >
            <span className="water-wave-glow" />
            Organizer
          </button>
        </div>

        {error && <div className="error-msg">⚠ {error}</div>}

        <form onSubmit={handleSubmit}>
          {role === 'student' ? (
            <>
              <div className="field">
                <label htmlFor="teamName">Team Number / Name</label>
                <input
                  id="teamName"
                  type="text"
                  placeholder="Enter Team Number:"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter team password :"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="teacherId">Teacher ID</label>
                <input
                  id="teacherId"
                  type="text"
                  placeholder="e.g. teacher@1"
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <button className="btn btn-primary btn-signin-pill" type="submit" disabled={loading}>
            {loading ? <><span className="spinner" /> Signing in…</> : 'Sign in →'}
          </button>
        </form>

        <div
          className="login-credit-card"
          onClick={() => window.dispatchEvent(new CustomEvent('iru-trigger-intro'))}
          title="Click card to view intro animation"
        >
          <div
            className="login-credit-avatar"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('iru-open-photo'));
            }}
            title="Click photo to view full image"
          >
            <img
              src="/image.png"
              alt="Iru Profile"
              className="login-credit-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.nextElementSibling) {
                  e.currentTarget.nextElementSibling.style.display = 'flex';
                }
              }}
            />
            <div className="login-credit-fallback" style={{ display: 'none' }}>I</div>
          </div>
          <div className="login-credit-info">
            <span className="login-credit-label">Developed by</span>
            <span className="login-credit-name">iru</span>
          </div>
        </div>
      </div>
    </div>
  );
}
