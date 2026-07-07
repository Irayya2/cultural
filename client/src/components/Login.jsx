import { useState, useRef } from 'react';
import { api } from '../api';

function getUucmsSemesters(uucmsNo) {
  if (!uucmsNo) return null;
  const clean = String(uucmsNo).trim().toUpperCase();
  const match = clean.match(/^U15BH(24|25|26)S(\d{4})$/);
  if (!match) return null;
  
  const batch = match[1]; // "24", "25", "26"
  const number = parseInt(match[2], 10);
  
  if (number < 1 || number > 250) return null;
  
  if (batch === '26') return [1];
  if (batch === '25') return [3];
  if (batch === '24') return [5];
  
  return null;
}

export default function Login({ onLogin }) {
  const [role, setRole] = useState('student');
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [uucmsNo, setUucmsNo] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const otpRefs = useRef([]);

  async function handleSendOtp(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) return setError('Enter your email address.');
    if (role === 'student') {
      if (!name.trim()) return setError('Enter your name.');
      if (!uucmsNo.trim()) return setError('Enter your UUCMS number.');
      if (!getUucmsSemesters(uucmsNo)) {
        return setError('Invalid UUCMS Number (Must be U15BH24S/25S/26S followed by a number from 0001 to 0250).');
      }
    }
    setLoading(true);
    try {
      await api.requestOtp(email.trim(), role);
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    const code = otp.join('');
    if (code.length !== 6) return setError('Enter the full 6-digit code.');
    setLoading(true);
    try {
      const res = await api.verifyOtp(email.trim(), role, code, name.trim(), role === 'student' ? uucmsNo.trim().toUpperCase() : undefined);
      onLogin({ token: res.token, role: res.role, email: email.trim(), uucmsNo: role === 'student' ? uucmsNo.trim().toUpperCase() : undefined });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(idx, val) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpKeyDown(idx, e) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && idx > 0) otpRefs.current[idx - 1]?.focus();
    if (e.key === 'ArrowRight' && idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function handleOtpPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    const next = [...otp];
    for (let i = 0; i < 6; i++) next[i] = text[i] || '';
    setOtp(next);
    const focusIdx = Math.min(text.length, 5);
    otpRefs.current[focusIdx]?.focus();
  }

  function switchRole(r) {
    setRole(r);
    setStep('email');
    setError('');
    setOtp(['', '', '', '', '', '']);
  }

  function goBack() {
    setStep('email');
    setOtp(['', '', '', '', '', '']);
    setError('');
  }

  const initials = email ? email[0].toUpperCase() : '?';

  return (
    <div className="app-shell">
      <div className="card card--narrow">
        {step === 'email' ? (
          <>
            <p className="eyebrow">Weekly Quiz</p>
            <h1 className="title">Welcome back</h1>
            <p className="subtitle">Sign in with your email — no password needed.</p>

            <div className="role-tabs">
              <button type="button" className={`role-tab ${role === 'student' ? 'active' : ''}`} onClick={() => switchRole('student')}>
                🎓 Student
              </button>
              <button type="button" className={`role-tab ${role === 'teacher' ? 'active' : ''}`} onClick={() => switchRole('teacher')}>
                📋 Teacher
              </button>
            </div>

            {error && <div className="error-msg">⚠ {error}</div>}

            <form onSubmit={handleSendOtp}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={role === 'teacher' ? 'teacher@school.edu' : 'you@college.edu'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              {role === 'student' && (
                <>
                  <div className="field">
                    <label htmlFor="name">Your name</label>
                    <input
                      id="name"
                      type="text"
                      placeholder="As it should appear to your teacher"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="uucms">UUCMS Number</label>
                    <input
                      id="uucms"
                      type="text"
                      placeholder="e.g. U15BH26S0001"
                      value={uucmsNo}
                      onChange={(e) => setUucmsNo(e.target.value)}
                      style={{ textTransform: 'uppercase' }}
                    />
                    {uucmsNo.trim() && (() => {
                      const sems = getUucmsSemesters(uucmsNo);
                      if (sems) {
                        return (
                          <div style={{ fontSize: 12, color: '#10B981', marginTop: 4, fontWeight: 500 }}>
                            ✅ Semesters {sems.join(' & ')} detected
                          </div>
                        );
                      } else {
                        return (
                          <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4, fontWeight: 500 }}>
                            ❌ Invalid UUCMS number or outside range (0001 - 0250)
                          </div>
                        );
                      }
                    })()}
                  </div>
                </>
              )}
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <><span className="spinner" /> Sending…</> : 'Send code →'}
              </button>
            </form>

            <p className="hint-msg" style={{ marginTop: 18 }}>
              We'll email you a one-time 6-digit code to verify your identity.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div className="avatar" style={{ width: 44, height: 44, fontSize: 18 }}>{initials}</div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 2 }}>Code sent to</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{email}</div>
              </div>
            </div>

            <p className="eyebrow">Check your inbox</p>
            <h1 className="title" style={{ fontSize: 24, marginBottom: 6 }}>Enter your code</h1>
            <p className="subtitle" style={{ marginBottom: 20 }}>
              Enter the 6-digit code we just sent you. Check spam if it doesn't arrive.
            </p>

            {error && <div className="error-msg">⚠ {error}</div>}

            <form onSubmit={handleVerify}>
              <div style={{ marginBottom: 20 }}>
                <div className="otp-grid" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => (otpRefs.current[i] = el)}
                      className={`otp-box ${digit ? 'filled' : ''}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    />
                  ))}
                </div>
              </div>

              <button className="btn btn-primary" type="submit" disabled={loading || otp.join('').length < 6}>
                {loading ? <><span className="spinner" /> Verifying…</> : 'Verify & sign in →'}
              </button>
            </form>

            <p className="hint-msg" style={{ marginTop: 16 }}>
              Didn't get it?{' '}
              <button type="button" onClick={goBack}>Try again</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
