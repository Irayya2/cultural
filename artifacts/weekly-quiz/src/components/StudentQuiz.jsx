import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';

const LETTERS = ['A', 'B', 'C', 'D'];

const MALPRACTICE_SHORTCUTS = [
  { label: 'Alt+Tab (window switch)',  test: (e) => e.altKey  && e.key === 'Tab' },
  { label: 'Win+D (show desktop)',     test: (e) => e.metaKey && e.key.toLowerCase() === 'd' },
  { label: 'Win+Tab (task view)',      test: (e) => e.metaKey && e.key === 'Tab' },
  { label: 'Win+L (lock screen)',      test: (e) => e.metaKey && e.key.toLowerCase() === 'l' },
  { label: 'Win+M (minimise all)',     test: (e) => e.metaKey && e.key.toLowerCase() === 'm' },
  { label: 'Alt+F4 (close window)',    test: (e) => e.altKey  && e.key === 'F4' },
  { label: 'Ctrl+W (close tab)',       test: (e) => e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'w' },
  { label: 'Ctrl+T (new tab)',         test: (e) => e.ctrlKey && !e.altKey && e.key.toLowerCase() === 't' },
  { label: 'Ctrl+N (new window)',      test: (e) => e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n' },
  { label: 'Ctrl+Alt+T (terminal)',    test: (e) => e.ctrlKey && e.altKey  && e.key.toLowerCase() === 't' },
  { label: 'Cmd+Tab (app switcher)',   test: (e) => e.metaKey && e.key === 'Tab' },
  { label: 'Cmd+H (hide window)',      test: (e) => e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'h' },
  { label: 'Cmd+Q (quit app)',         test: (e) => e.metaKey && e.key.toLowerCase() === 'q' },
  { label: 'Cmd+Space (Spotlight)',    test: (e) => e.metaKey && e.code === 'Space' },
];
function detectShortcut(e) { return (MALPRACTICE_SHORTCUTS.find(s => s.test(e)) || null)?.label ?? null; }

const RULES = [
  { icon: '🔀', title: 'Randomised questions', body: 'Every student gets questions in a different order — copying answers won\'t help.' },
  { icon: '🚫', title: 'No tab switching', body: 'Switching apps, minimising, or opening a new tab is detected instantly.' },
  { icon: '⚠️', title: 'Three strikes', body: 'Three malpractice actions and your quiz is auto-submitted with whatever you\'ve answered.' },
  { icon: '🔒', title: 'No going back', body: 'Once you start, you cannot pause. Make sure you\'re ready and have no distractions open.' },
  { icon: '✅', title: 'Auto-saved', body: 'Answers save as you select them — no data is lost if the page refreshes.' },
  { icon: '📊', title: 'Instant score', body: 'Your score appears as soon as you submit.' },
];

function startedKey(quizId) { return `quiz-started-${quizId}`; }

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

export default function StudentQuiz({ session, onLogout }) {
  const uucmsNo = session.uucmsNo || '';
  const eligibleSemesters = getUucmsSemesters(uucmsNo) || [];

  const [selectedSemester, setSelectedSemester] = useState(() => {
    const saved = window.sessionStorage.getItem(`selected_semester_${session.email}`);
    if (saved) {
      const savedNum = Number(saved);
      if (eligibleSemesters.includes(savedNum)) return savedNum;
    }
    if (eligibleSemesters.length === 1) return eligibleSemesters[0];
    return null;
  });

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [quizSet, setQuizSet]       = useState(null);
  const [questions, setQuestions]   = useState([]);
  const [answers, setAnswers]       = useState({});
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [status, setStatus]         = useState('in_progress');
  const [toast, setToast]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [started, setStarted]       = useState(false); // instructions gate

  const quizIdRef       = useRef(null);
  const statusRef       = useRef('in_progress');
  const startedRef      = useRef(false);
  const lastReportedRef = useRef(0);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { startedRef.current = started; }, [started]);

  const showToast = useCallback((msg, type = 'warn') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 5000);
  }, []);

  const reportMalpractice = useCallback(async (reason) => {
    // Only fire after student clicks "Start Quiz"
    if (!startedRef.current) return;
    if (statusRef.current !== 'in_progress' || !quizIdRef.current) return;
    const now = Date.now();
    if (now - lastReportedRef.current < 2500) return;
    lastReportedRef.current = now;
    try {
      const res = await api.reportTabSwitch(session.token, quizIdRef.current);
      setTabSwitchCount(res.tabSwitchCount);
      setStatus(res.status);
      const left = Math.max(0, 3 - res.tabSwitchCount);
      if (res.status === 'auto_submitted') {
        showToast('⛔ Quiz auto-submitted — 3 malpractice actions detected.', 'danger');
      } else {
        showToast(`🚨 ${reason} detected — ⚠ ${left} strike${left !== 1 ? 's' : ''} left before auto-submit`, 'warn');
      }
    } catch (err) { console.error('Malpractice report failed:', err.message); }
  }, [session.token, showToast]);

  const loadQuiz = useCallback(async () => {
    if (!selectedSemester) return;
    setLoading(true); setError('');
    try {
      const data = await api.getActiveQuiz(session.token, selectedSemester);
      if (!data.quizSet) {
        setQuizSet(null);
      } else {
        setQuizSet(data.quizSet);
        setQuestions(data.questions);
        setAnswers(data.answers || {});
        setTabSwitchCount(data.tabSwitchCount || 0);
        setStatus(data.status);
        quizIdRef.current = data.quizSet.id;
        // Restore started state from localStorage
        const alreadyStarted = data.status !== 'in_progress' ||
          localStorage.getItem(startedKey(data.quizSet.id)) === '1';
        setStarted(alreadyStarted);
        startedRef.current = alreadyStarted;
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [session.token, selectedSemester]);

  useEffect(() => {
    if (selectedSemester) {
      loadQuiz();
    }
  }, [loadQuiz, selectedSemester]);

  // ── Malpractice listeners (only active after "Start Quiz") ────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if (!startedRef.current || statusRef.current !== 'in_progress' || !quizIdRef.current) return;
      const label = detectShortcut(e);
      if (!label) return;
      e.preventDefault();
      reportMalpractice(label);
    }
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [reportMalpractice]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'hidden') return;
      reportMalpractice('Screen switch');
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reportMalpractice]);

  useEffect(() => {
    function handleBlur() { reportMalpractice('Window focus lost'); }
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [reportMalpractice]);

  function handleSemesterSelect(sem) {
    setSelectedSemester(sem);
    if (sem) {
      window.sessionStorage.setItem(`selected_semester_${session.email}`, sem);
    } else {
      window.sessionStorage.removeItem(`selected_semester_${session.email}`);
      setQuizSet(null);
      setQuestions([]);
    }
  }

  function handleStartQuiz() {
    localStorage.setItem(startedKey(quizSet.id), '1');
    setStarted(true);
    startedRef.current = true;
  }

  const saveTimers = useRef({});
  function handleAnswerChange(questionId, value) {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(() => {
      api.saveAnswer(session.token, quizSet.id, questionId, value).catch(console.error);
    }, 500);
  }

  async function handleSubmit() {
    setSubmitting(true); setError('');
    try {
      await api.submitQuiz(session.token, quizSet.id);
      localStorage.removeItem(startedKey(quizSet.id));
      // Re-fetch quiz data — backend now returns correctAnswer for submitted attempts,
      // which lets the client compute and display the score breakdown immediately.
      await loadQuiz();
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  // ── Score calculation (client-side) ──────────────────────────────────
  const gradableQuestions = questions.filter(q => q.correctAnswer);
  const score    = gradableQuestions.reduce((sum, q) => sum + (answers[q.id] === q.correctAnswer ? 1 : 0), 0);
  const scorePct = gradableQuestions.length ? Math.round((score / gradableQuestions.length) * 100) : null;
  function scoreEmoji(pct) {
    if (pct === 100) return '🏆'; if (pct >= 80) return '🎉';
    if (pct >= 60)  return '👍';  if (pct >= 40) return '📚';
    return '💪';
  }
  function scoreColor(pct) {
    if (pct >= 80) return 'var(--success)';
    if (pct >= 50) return 'var(--warn)';
    return 'var(--danger)';
  }

  // Results are always available immediately after submission.

  const isLocked      = status !== 'in_progress';
  const answeredCount = questions.filter(q => answers[q.id]?.trim()).length;
  const progress      = questions.length ? (answeredCount / questions.length) * 100 : 0;
  const initials      = session.email ? session.email[0].toUpperCase() : '?';
  const currentQ      = questions[currentIdx];
  const canChangeSemester = !started && !isLocked;

  return (
    <div className="quiz-shell">
      {/* Toast */}
      {toast && (
        <div className="toast" role="alert" style={{
          borderColor: toast.type === 'danger' ? 'rgba(244,63,94,0.4)' : 'rgba(245,158,11,0.4)',
          color:       toast.type === 'danger' ? 'var(--danger)' : 'var(--warn)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Top Bar */}
      <div className="top-bar">
        <div className="top-bar-user">
          <div className="avatar">{initials}</div>
          <div>
            <div className="top-bar-role">Student {uucmsNo ? `(${uucmsNo})` : ''}</div>
            <div className="top-bar-email">{session.email}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          {selectedSemester && (
            <span className="badge" style={{ background: 'rgba(56,182,255,0.2)', color: 'var(--accent-bright)', border: '1px solid rgba(56,182,255,0.3)' }}>Sem {selectedSemester}</span>
          )}
          {canChangeSemester && eligibleSemesters.length > 1 && (
            <button className="signout-link" onClick={() => handleSemesterSelect(null)}>Change Semester</button>
          )}
          {quizSet && started && !isLocked && (
            <span style={{ fontSize:13, color:'var(--text-muted)' }}>{answeredCount}/{questions.length} answered</span>
          )}
          <button className="signout-link" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {/* Progress Bar */}
      {quizSet && started && !isLocked && (
        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width:`${progress}%` }} />
        </div>
      )}

      {/* Main */}
      <div className="quiz-main">
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16, color:'var(--text-muted)' }}>
            <div className="spinner spinner-dark" style={{ width:32, height:32, borderWidth:3 }} />
            <span style={{ fontSize:14 }}>Loading quiz…</span>
          </div>
        )}

        {!loading && error && <div className="card card--full"><div className="error-msg">⚠ {error}</div></div>}

        {!loading && !selectedSemester && eligibleSemesters.length > 0 && (
          <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: '24px 24px 30px' }}>
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🎓</span>
            <h2 className="title" style={{ fontSize: 20, marginBottom: 8 }}>Select Your Semester</h2>
            <p className="subtitle" style={{ marginBottom: 24, fontSize: 13.5 }}>
              Your UUCMS number ({uucmsNo}) maps to multiple semesters. Please select the correct semester to proceed:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {eligibleSemesters.map((sem) => (
                <button
                  key={sem}
                  className="btn btn-primary"
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700 }}
                  onClick={() => handleSemesterSelect(sem)}
                >
                  Semester {sem}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && eligibleSemesters.length === 0 && (
          <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: '24px 24px 30px' }}>
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>⚠️</span>
            <h2 className="title" style={{ fontSize: 20, color: 'var(--danger)', marginBottom: 8 }}>Access Denied</h2>
            <p className="subtitle" style={{ marginBottom: 24, fontSize: 13.5 }}>
              Your UUCMS number ({uucmsNo || 'None'}) is not recognized or does not map to semesters 1-6. Please log out and check your credentials.
            </p>
            <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
          </div>
        )}

        {!loading && selectedSemester && !quizSet && !error && (
          <div className="card" style={{ maxWidth:480, width:'100%', padding:0 }}>
            <div className="no-quiz-card">
              <span className="no-quiz-icon">📭</span>
              <div className="no-quiz-title">No quiz right now</div>
              <p className="no-quiz-sub">Your teacher hasn't posted this week's questions for Semester {selectedSemester} yet. Check back soon!</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop:20, width:'auto', padding:'10px 20px' }} onClick={loadQuiz}>Refresh</button>
            </div>
          </div>
        )}

        {!loading && quizSet && (
          isLocked ? (
            /* ── Results shown immediately after submission ── */
            <div className="question-card">
              <div className="question-body">
                {status === 'auto_submitted' ? (
                    <div className="banner-locked danger">
                      <span className="banner-locked-icon">⛔</span>
                      <strong style={{ fontSize:18 }}>Quiz auto-submitted</strong>
                      <p>Your answers were automatically submitted after 3 malpractice detections.</p>
                      {scorePct !== null && (
                        <div style={{ marginTop:16, padding:'14px 20px', background:'rgba(0,0,0,0.2)', borderRadius:10, textAlign:'center' }}>
                          <div style={{ fontSize:36, fontWeight:700, color:scoreColor(scorePct) }}>{score}/{gradableQuestions.length}</div>
                          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:2 }}>Your score ({scorePct}%)</div>
                        </div>
                      )}
                      <p style={{ fontSize:13, opacity:0.7, marginTop:8 }}>Contact your teacher if this was a mistake.</p>
                    </div>
                  ) : (
                    <div className="banner-locked success">
                      <span className="banner-locked-icon">{scorePct !== null ? scoreEmoji(scorePct) : '✅'}</span>
                      <strong style={{ fontSize:20 }}>Quiz submitted!</strong>

                      {scorePct !== null && (
                        <div style={{ width:'100%', marginTop:8 }}>
                          {/* Big score block */}
                          <div style={{ textAlign:'center', padding:'22px 16px', background:'rgba(0,0,0,0.2)', borderRadius:12, marginBottom:16 }}>
                            <div style={{ fontSize:56, fontWeight:800, color:scoreColor(scorePct), lineHeight:1 }}>{score}</div>
                            <div style={{ fontSize:15, color:'var(--text-soft)', marginTop:4 }}>out of {gradableQuestions.length} correct</div>
                            <div style={{ marginTop:12, height:8, background:'rgba(255,255,255,0.08)', borderRadius:99, overflow:'hidden' }}>
                              <div style={{ height:'100%', width:`${scorePct}%`, background:`linear-gradient(90deg,${scoreColor(scorePct)},${scoreColor(scorePct)}99)`, borderRadius:99, transition:'width 0.8s ease' }} />
                            </div>
                            <div style={{ fontSize:26, fontWeight:700, color:scoreColor(scorePct), marginTop:8 }}>{scorePct}%</div>
                          </div>

                          {/* Motivational message */}
                          <div style={{ padding:'14px 18px', borderRadius:10, marginBottom:16, textAlign:'center', background: scorePct===100?'rgba(34,197,94,0.1)':scorePct>=80?'rgba(56,182,255,0.1)':scorePct>=60?'rgba(245,158,11,0.08)':scorePct>=40?'rgba(56,182,255,0.06)':'rgba(244,63,94,0.07)', border:`1px solid ${scorePct===100?'rgba(34,197,94,0.25)':scorePct>=80?'rgba(56,182,255,0.25)':scorePct>=60?'rgba(245,158,11,0.2)':scorePct>=40?'rgba(56,182,255,0.15)':'rgba(244,63,94,0.15)'}` }}>
                            {scorePct === 100 && <>
                              <div style={{ fontSize:22, marginBottom:6 }}>🏆</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'var(--success)', marginBottom:4 }}>Perfect score — you nailed it!</div>
                              <div style={{ fontSize:13, color:'var(--text-soft)', lineHeight:1.55 }}>Outstanding! You got every single question right. Your hard work and focus really paid off today. Keep it up!</div>
                            </>}
                            {scorePct >= 80 && scorePct < 100 && <>
                              <div style={{ fontSize:22, marginBottom:6 }}>🎉</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'var(--accent-bright)', marginBottom:4 }}>Excellent work!</div>
                              <div style={{ fontSize:13, color:'var(--text-soft)', lineHeight:1.55 }}>You did really well! A few small mistakes here and there, but overall you clearly understand the material. Keep pushing and you'll hit that 100 soon!</div>
                            </>}
                            {scorePct >= 60 && scorePct < 80 && <>
                              <div style={{ fontSize:22, marginBottom:6 }}>👍</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'var(--warn)', marginBottom:4 }}>Good effort — you're on the right track!</div>
                              <div style={{ fontSize:13, color:'var(--text-soft)', lineHeight:1.55 }}>Not bad at all! You got more than half right. Review the ones you missed, understand where you went wrong, and you'll do even better next time.</div>
                            </>}
                            {scorePct >= 40 && scorePct < 60 && <>
                              <div style={{ fontSize:22, marginBottom:6 }}>📚</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'var(--accent-bright)', marginBottom:4 }}>Keep going — don't give up!</div>
                              <div style={{ fontSize:13, color:'var(--text-soft)', lineHeight:1.55 }}>This is a learning moment. Look at the answers below, figure out what you missed, and revise those topics. Every quiz makes you stronger!</div>
                            </>}
                            {scorePct < 40 && <>
                              <div style={{ fontSize:22, marginBottom:6 }}>💪</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'var(--danger)', marginBottom:4 }}>It's okay — every expert was once a beginner!</div>
                              <div style={{ fontSize:13, color:'var(--text-soft)', lineHeight:1.55 }}>This quiz was tough, but that's how we grow. Go through each answer below carefully, ask your teacher for help on anything unclear, and come back stronger next time!</div>
                            </>}
                          </div>

                          {/* Per-question breakdown */}
                          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                            {questions.map((q, i) => {
                              const studentAnswer = answers[q.id];
                              const isCorrect = q.correctAnswer && studentAnswer === q.correctAnswer;
                              const isWrong   = q.correctAnswer && studentAnswer && studentAnswer !== q.correctAnswer;
                              return (
                                <div key={q.id} style={{ padding:'10px 14px', borderRadius:8, background: isCorrect?'rgba(34,197,94,0.08)':isWrong?'rgba(244,63,94,0.08)':'rgba(255,255,255,0.03)', border:`1px solid ${isCorrect?'rgba(34,197,94,0.2)':isWrong?'rgba(244,63,94,0.15)':'var(--border)'}` }}>
                                  <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                                    <span style={{ fontSize:18, flexShrink:0 }}>{isCorrect ? '✅' : isWrong ? '❌' : '⬜'}</span>
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>Q{i+1}. {q.text}</div>
                                      <div style={{ fontSize:12.5 }}>
                                        <span style={{ color:'var(--text-muted)' }}>Your answer: </span>
                                        <span style={{ color: isCorrect?'var(--success)':isWrong?'var(--danger)':'var(--text-muted)', fontWeight:500 }}>
                                          {studentAnswer || 'Not answered'}
                                        </span>
                                      </div>
                                      {isWrong && q.correctAnswer && (
                                        <div style={{ fontSize:12.5, marginTop:2 }}>
                                          <span style={{ color:'var(--text-muted)' }}>Correct: </span>
                                          <span style={{ color:'var(--success)', fontWeight:500 }}>{q.correctAnswer}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {scorePct === null && <p style={{ margin:'8px 0 0', fontSize:13.5, color:'var(--text-soft)' }}>Your answers are in — well done for completing it!</p>}

                      {/* gcc_code_zone branding footer */}
                      <div style={{ marginTop:24, paddingTop:16, borderTop:'1px solid var(--border)', width:'100%', textAlign:'center' }}>
                        <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'8px 18px', borderRadius:99, background:'rgba(56,182,255,0.10)', border:'1px solid rgba(56,182,255,0.22)' }}>
                          <span style={{ fontSize:15 }}>⚡</span>
                          <span style={{ fontSize:12.5, fontWeight:700, color:'var(--accent-bright)', letterSpacing:'0.04em' }}>gcc_code_zone</span>
                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>team</span>
                        </div>
                        <div style={{ fontSize:11.5, color:'var(--text-muted)', marginTop:6 }}>Wishing you success in every step of your journey 🚀</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
          ) : !started ? (
            /* ── Instructions page ── */
            <div className="question-card" style={{ maxWidth:560, width:'100%' }}>
              <div className="question-body" style={{ gap:0 }}>
                {/* Header */}
                <div style={{ textAlign:'center', marginBottom:28 }}>
                  <div style={{ fontSize:40, marginBottom:10 }}>📋</div>
                  <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:'var(--text)' }}>Before you begin</h2>
                  <p style={{ margin:'6px 0 0', fontSize:13.5, color:'var(--text-muted)' }}>
                    Read these rules carefully — the quiz starts the moment you click the button.
                  </p>
                </div>

                {/* Quiz info strip */}
                <div style={{ display:'flex', gap:12, marginBottom:24, padding:'12px 16px', background:'rgba(56,182,255,0.08)', border:'1px solid rgba(56,182,255,0.2)', borderRadius:10 }}>
                  <div style={{ flex:1, textAlign:'center' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:'var(--accent-bright)' }}>{questions.length}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>Questions</div>
                  </div>
                  <div style={{ width:1, background:'var(--border)' }} />
                  <div style={{ flex:2, display:'flex', alignItems:'center', paddingLeft:12 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{quizSet.title}</div>
                      <div style={{ fontSize:11.5, color:'var(--text-muted)', marginTop:2 }}>Your question order is unique to you</div>
                    </div>
                  </div>
                </div>

                {/* Rules grid */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:28 }}>
                  {RULES.map((rule, i) => (
                    <div key={i} style={{ padding:'12px 13px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:9 }}>
                      <div style={{ fontSize:18, marginBottom:6 }}>{rule.icon}</div>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{rule.title}</div>
                      <div style={{ fontSize:11.5, color:'var(--text-muted)', lineHeight:1.45 }}>{rule.body}</div>
                    </div>
                  ))}
                </div>

                {/* Agreement + CTA */}
                <div style={{ padding:'16px', background:'rgba(34,197,94,0.05)', border:'1px solid rgba(34,197,94,0.15)', borderRadius:10, marginBottom:16, textAlign:'center' }}>
                  <p style={{ margin:'0 0 14px', fontSize:13, color:'var(--text-soft)', lineHeight:1.5 }}>
                    By clicking <strong style={{ color:'var(--text)' }}>Start Quiz</strong> you confirm you are the person logged in as <strong style={{ color:'var(--accent-bright)' }}>{session.email}</strong> and you will not attempt to cheat.
                  </p>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize:16, padding:'14px 40px', letterSpacing:'0.01em', fontWeight:700 }}
                    onClick={handleStartQuiz}
                  >
                    🚀 Start Quiz
                  </button>
                </div>
              </div>
            </div>

          ) : (
            /* ── Active quiz ── */
            <div className="question-card">
              <div className="question-meta">
                <div className="question-counter">
                  <span style={{ fontSize:13, color:'var(--text-soft)' }}>{quizSet.title}</span>
                  <div className="question-counter-dots">
                    {questions.map((q, i) => (
                      <button key={q.id} onClick={()=>setCurrentIdx(i)} className={`counter-dot ${i===currentIdx?'active':answers[q.id]?.trim()?'done':''}`} title={`Question ${i+1}`} style={{ border:'none', padding:0, cursor:'pointer', background:'none' }} />
                    ))}
                  </div>
                </div>
                <div className="tab-tally" title={`${tabSwitchCount} of 3 strikes used`}>
                  <span style={{ fontSize:11, color:'var(--text-muted)', marginRight:2 }}>Strikes</span>
                  {[0,1,2].map(i => <span key={i} className={`tally-mark ${i<tabSwitchCount?'used':''}`} />)}
                </div>
              </div>

              {currentQ && (
                <div className="question-body" key={currentQ.id}>
                  <div className="question-number-label">Question {currentIdx+1} of {questions.length}</div>
                  <p className="question-text">{currentQ.text}</p>

                  {currentQ.options?.length >= 2 ? (
                    <div className="options-grid">
                      {currentQ.options.map((opt, oi) => (
                        <button key={oi} type="button" className={`option-btn ${answers[currentQ.id]===opt?'selected':''}`} onClick={()=>handleAnswerChange(currentQ.id, opt)} disabled={isLocked}>
                          <span className="option-letter">{LETTERS[oi]||oi+1}</span>
                          <span>{opt}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <textarea className="answer-area" placeholder="Type your answer here…" value={answers[currentQ.id]||''} onChange={e=>handleAnswerChange(currentQ.id, e.target.value)} disabled={isLocked} />
                  )}

                  <div className="quiz-nav" style={{ marginTop:20 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setCurrentIdx(i=>Math.max(0,i-1))} disabled={currentIdx===0} style={{ opacity:currentIdx===0?0:1 }}>← Previous</button>
                    {currentIdx < questions.length-1 ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={()=>setCurrentIdx(i=>Math.min(questions.length-1,i+1))}>Next →</button>
                    ) : (
                      <button type="button" className="btn btn-success btn-sm" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? <><span className="spinner" style={{ width:14,height:14,borderWidth:2 }}/> Submitting…</> : '✓ Submit quiz'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {error && <div className="error-msg" style={{ marginTop:12 }}>⚠ {error}</div>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
