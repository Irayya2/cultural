import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const LETTERS = ['A', 'B', 'C', 'D'];
const EMPTY_Q = () => ({ text: '', options: ['', '', '', ''], correctAnswer: '' });

export default function TeacherDashboard({ session, onLogout }) {
  const [quizzes, setQuizzes]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [title, setTitle]               = useState('');
  const [semester, setSemester]         = useState(1);
  const [draftQuestions, setDraftQuestions] = useState([EMPTY_Q(), EMPTY_Q()]);
  const [creating, setCreating]         = useState(false);

  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [attempts, setAttempts]         = useState([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const [aiTopic, setAiTopic]     = useState('');
  const [aiCount, setAiCount]     = useState(5);
  const [generating, setGenerating] = useState(false);
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiError, setAiError]     = useState('');
  const [addedAll, setAddedAll]   = useState(false);

  const showSuccess = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 4000); };

  const loadQuizzes = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.listQuizzes(session.token);
      setQuizzes(data.quizSets);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [session.token]);

  useEffect(() => { loadQuizzes(); }, [loadQuizzes]);

  // ── Draft helpers ────────────────────────────────────────────────────
  function updateDraftText(i, value)     { setDraftQuestions(prev => prev.map((q,idx) => idx===i ? {...q, text:value} : q)); }
  function updateDraftOption(qi, oi, v)  { setDraftQuestions(prev => prev.map((q,idx) => idx===qi ? {...q, options:q.options.map((o,oidx)=>oidx===oi?v:o)} : q)); }
  function updateDraftCorrect(qi, value) { setDraftQuestions(prev => prev.map((q,idx) => idx===qi ? {...q, correctAnswer:value} : q)); }
  function addDraftRow()                 { setDraftQuestions(prev => [...prev, EMPTY_Q()]); }
  function removeDraftRow(i)             { setDraftQuestions(prev => prev.filter((_,idx)=>idx!==i)); }

  // ── AI helpers ───────────────────────────────────────────────────────
  function getQuestionObj(q) {
    if (typeof q === 'string') return { text:q, options:[], correctAnswer:'' };
    return { text:q?.text??'', options:Array.isArray(q?.options)?q.options:[], correctAnswer:q?.correctAnswer??'' };
  }

  function buildDraftFromObj(obj) {
    return {
      text: obj.text,
      options: obj.options.length === 4 ? obj.options : ['','','',''],
      correctAnswer: obj.correctAnswer || '',
    };
  }

  function addGeneratedQuestion(q) {
    const newQ = buildDraftFromObj(getQuestionObj(q));
    setDraftQuestions(prev => {
      const emptyIdx = prev.findIndex(r => !r.text.trim());
      if (emptyIdx !== -1) return prev.map((r,idx) => idx===emptyIdx ? newQ : r);
      return [...prev, newQ];
    });
  }

  function addAllGeneratedQuestions() {
    setDraftQuestions(prev => {
      let result = [...prev];
      for (const q of aiQuestions) {
        const newQ = buildDraftFromObj(getQuestionObj(q));
        const emptyIdx = result.findIndex(r => !r.text.trim());
        if (emptyIdx !== -1) result = result.map((r,idx) => idx===emptyIdx ? newQ : r);
        else result = [...result, newQ];
      }
      return result;
    });
    setAddedAll(true);
  }

  async function handleGenerateAIQuestions(e) {
    e.preventDefault();
    if (!aiTopic.trim()) return setAiError('Enter a topic first.');
    setGenerating(true); setAiError(''); setAiQuestions([]); setAddedAll(false);
    try {
      const data = await api.generateQuestions(session.token, aiTopic.trim(), aiCount);
      setAiQuestions(data.questions);
    } catch (err) { setAiError(err.message); }
    finally { setGenerating(false); }
  }

  async function handleCreateQuiz(e) {
    e.preventDefault(); setError('');
    const cleanQuestions = draftQuestions.filter(q=>q.text.trim()).map(q=>({
      text: q.text.trim(),
      options: q.options.map(o=>o.trim()).filter(Boolean),
      correctAnswer: q.correctAnswer.trim(),
    }));
    if (!title.trim()) return setError('Give this quiz a title.');
    if (cleanQuestions.length === 0) return setError('Add at least one question.');
    const missingOptions = cleanQuestions.filter(q=>q.options.length < 2);
    if (missingOptions.length > 0) return setError(`Add at least 2 options for: "${missingOptions[0].text.slice(0,60)}"`);
    const missingAnswer = cleanQuestions.filter(q=>!q.correctAnswer);
    if (missingAnswer.length > 0) return setError(`Mark the correct answer for: "${missingAnswer[0].text.slice(0,60)}"`);
    setCreating(true);
    try {
      await api.createQuiz(session.token, title.trim(), cleanQuestions, semester);
      showSuccess(`"${title.trim()}" (Semester ${semester}) is now live! 🎉`);
      setTitle(''); setDraftQuestions([EMPTY_Q(), EMPTY_Q()]); setAiQuestions([]);
      loadQuizzes();
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  }

  async function viewAttempts(quiz) {
    setSelectedQuiz(quiz); setAttemptsLoading(true); setError('');
    try {
      const data = await api.getAttempts(session.token, quiz.id);
      setAttempts(data.attempts);
    } catch (err) { setError(err.message); }
    finally { setAttemptsLoading(false); }
  }

  async function handleResetAttempt(studentId) {
    try {
      await api.resetAttempt(session.token, selectedQuiz.id, studentId);
      const data = await api.getAttempts(session.token, selectedQuiz.id);
      setAttempts(data.attempts);
    } catch (err) { setError(err.message); }
  }

  const initials    = session.email ? session.email[0].toUpperCase() : 'T';
  const activeQuiz  = quizzes.find(q => q.isActive);
  const filledCount = draftQuestions.filter(q => q.text.trim()).length;

  // Score helpers for responses view
  function scoreColor(pct) {
    if (pct >= 80) return '#6EE7B7';
    if (pct >= 50) return '#FDE68A';
    return '#FCA5A5';
  }

  const sortedAttempts = [...attempts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topScore = sortedAttempts[0]?.score ?? 0;

  return (
    <div style={{ minHeight:'100vh', background:'radial-gradient(ellipse 800px 500px at 60% -120px,rgba(99,102,241,0.16),transparent),var(--bg)', display:'flex', flexDirection:'column' }}>

      {/* Top Bar */}
      <div className="top-bar">
        <div className="top-bar-user">
          <div className="avatar">{initials}</div>
          <div>
            <div className="top-bar-role">Teacher dashboard</div>
            <div className="top-bar-email">{session.email}</div>
          </div>
        </div>
        <button className="signout-link" onClick={onLogout}>Sign out</button>
      </div>

      <div style={{ flex:1, maxWidth:1020, width:'100%', margin:'0 auto', padding:'24px 20px 48px' }}>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{quizzes.length}</div>
            <div className="stat-label">Total quizzes</div>
          </div>
          <div className="stat-card" style={{ borderColor:activeQuiz?'rgba(99,102,241,0.35)':undefined }}>
            <div className="stat-value" style={{ fontSize:activeQuiz?18:undefined, color:activeQuiz?'var(--accent-bright)':undefined }}>
              {activeQuiz ? '● Live' : '—'}
            </div>
            <div className="stat-label">Active quiz</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{filledCount}</div>
            <div className="stat-label">Draft questions</div>
          </div>
        </div>

        {error      && <div className="error-msg">⚠ {error}</div>}
        {successMsg && <div className="success-msg">✅ {successMsg}</div>}

        {!selectedQuiz ? (
          <>
            {/* ── Quiz creator ── */}
            <div className="card" style={{ padding:0, marginBottom:24 }}>
              <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)' }}>
                <div className="section-title"><span className="icon">📝</span>Post this week's quiz</div>
                <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:-8 }}>
                  Every question is MCQ. Mark the correct answer — students see their score after submission.
                </p>
              </div>

              <div className="dash-grid" style={{ padding:'24px', gap:32 }}>

                {/* Left — manual builder */}
                <div>
                  <form onSubmit={handleCreateQuiz}>
                    <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Quiz title</label>
                        <input type="text" placeholder="e.g. Week 6 — Data Structures" value={title} onChange={e=>setTitle(e.target.value)} />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Semester</label>
                        <select 
                          value={semester} 
                          onChange={e=>setSemester(Number(e.target.value))} 
                          style={{ 
                            padding: '10px', 
                            borderRadius: '8px', 
                            border: '1.5px solid var(--border)', 
                            background: 'rgba(255,255,255,0.05)', 
                            color: 'var(--text)', 
                            width: '100%', 
                            height: '42px', 
                            marginTop: '2px',
                            cursor: 'pointer'
                          }}
                        >
                          {[1,2,3,4,5,6].map(num => (
                            <option key={num} value={num} style={{ background: '#1e1b4b', color: '#fff' }}>Semester {num}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ marginBottom:14 }}>
                      <label style={{ fontSize:12.5, fontWeight:600, color:'var(--text-soft)', display:'block', marginBottom:12 }}>
                        Questions ({filledCount} added)
                      </label>

                      {draftQuestions.map((q, qi) => (
                        <div key={qi} style={{ marginBottom:16, background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 14px 12px' }}>
                          {/* Question text */}
                          <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:10 }}>
                            <span className="q-num" style={{ paddingTop:10 }}>{qi+1}</span>
                            <input type="text" placeholder={`Question ${qi+1}`} value={q.text} onChange={e=>updateDraftText(qi,e.target.value)}
                              style={{ flex:1, fontSize:14, padding:'10px 12px', background:'rgba(255,255,255,0.05)', border:'1.5px solid var(--border)', borderRadius:8, color:'var(--text)' }} />
                            {draftQuestions.length > 1 && (
                              <button type="button" className="btn btn-danger btn-icon" onClick={()=>removeDraftRow(qi)} title="Remove" style={{ fontSize:16, marginTop:2 }}>×</button>
                            )}
                          </div>

                          {/* 4 options in 2×2 grid */}
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, paddingLeft:36, marginBottom:10 }}>
                            {LETTERS.map((letter, oi) => (
                              <div key={oi} style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <span style={{ width:22, height:22, borderRadius:6, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'var(--accent-bright)', flexShrink:0 }}>{letter}</span>
                                <input type="text" placeholder={`Option ${letter}`} value={q.options[oi]} onChange={e=>updateDraftOption(qi,oi,e.target.value)}
                                  style={{ flex:1, fontSize:13, padding:'7px 10px', background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text)' }} />
                              </div>
                            ))}
                          </div>

                          {/* Correct answer picker */}
                          <div style={{ paddingLeft:36 }}>
                            <div style={{ fontSize:11.5, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }}>
                              ✓ Correct answer
                            </div>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                              {LETTERS.map((letter, oi) => {
                                const optText = q.options[oi]?.trim();
                                const isSelected = q.correctAnswer === optText && optText;
                                return (
                                  <button key={oi} type="button"
                                    onClick={() => optText && updateDraftCorrect(qi, optText)}
                                    disabled={!optText}
                                    style={{
                                      padding:'5px 12px', borderRadius:6, fontSize:12.5, fontWeight:600,
                                      border: isSelected ? '1.5px solid var(--success)' : '1.5px solid var(--border)',
                                      background: isSelected ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)',
                                      color: isSelected ? '#6EE7B7' : optText ? 'var(--text-soft)' : 'var(--text-muted)',
                                      cursor: optText ? 'pointer' : 'not-allowed',
                                      opacity: optText ? 1 : 0.4,
                                      transition:'all 0.15s ease',
                                    }}>
                                    {isSelected && '✓ '}{letter}
                                    {optText ? ` — ${optText.length > 14 ? optText.slice(0,14)+'…' : optText}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}

                      <button type="button" className="btn btn-ghost btn-sm" onClick={addDraftRow} style={{ marginTop:2 }}>+ Add question</button>
                    </div>

                    <button className="btn btn-primary" type="submit" disabled={creating}>
                      {creating ? <><span className="spinner"/>Publishing…</> : '🚀 Post quiz to all students'}
                    </button>
                  </form>
                </div>

                {/* Right — AI panel */}
                <div className="ai-panel">
                  <div className="ai-badge">✨ AI Assistant</div>
                  <p style={{ fontSize:13, color:'var(--text-soft)', marginBottom:16, lineHeight:1.5 }}>
                    Gemini generates MCQ questions with the correct answer pre-marked.
                  </p>
                  {aiError && <div className="error-msg">⚠ {aiError}</div>}
                  <form onSubmit={handleGenerateAIQuestions} style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <div className="field" style={{ marginBottom:0 }}>
                      <label>Topic / concept</label>
                      <input type="text" placeholder="e.g. JavaScript Promises" value={aiTopic} onChange={e=>setAiTopic(e.target.value)} />
                    </div>
                    <div className="field" style={{ marginBottom:0 }}>
                      <label>How many questions</label>
                      <input type="number" min="1" step="1" value={aiCount} onChange={e=>setAiCount(Math.max(1,parseInt(e.target.value)||1))} />
                    </div>
                    <button type="submit" className="btn btn-ghost" disabled={generating} style={{ marginTop:2 }}>
                      {generating ? <><span className="spinner spinner-dark" style={{ width:14,height:14,borderWidth:2 }}/>Generating…</> : '✨ Generate with Gemini'}
                    </button>
                  </form>

                  {aiQuestions.length > 0 && (
                    <div style={{ marginTop:20 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                        <span style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)' }}>{aiQuestions.length} generated</span>
                        <button type="button" className={`btn btn-sm ${addedAll?'btn-ghost':'btn-primary'}`} style={{ fontSize:12, padding:'6px 12px' }} onClick={addAllGeneratedQuestions} disabled={addedAll}>
                          {addedAll ? '✓ All added' : '+ Add all'}
                        </button>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:340, overflowY:'auto', paddingRight:2 }}>
                        {aiQuestions.map((q, idx) => {
                          const obj = getQuestionObj(q);
                          return (
                            <div key={idx} className="ai-question-card" style={{ animationDelay:`${idx*0.04}s`, flexDirection:'column', gap:8 }}>
                              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
                                <span style={{ fontWeight:600, color:'var(--text)', fontSize:13 }}>{idx+1}. {obj.text}</span>
                                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize:11, padding:'4px 10px', flexShrink:0 }} onClick={()=>addGeneratedQuestion(q)}>+ Add</button>
                              </div>
                              {obj.options.length > 0 && (
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                                  {obj.options.map((opt, oi) => (
                                    <span key={oi} style={{ fontSize:11.5, color: opt===obj.correctAnswer?'#6EE7B7':'var(--text-soft)', display:'flex', gap:5 }}>
                                      <span style={{ fontWeight:700, color:opt===obj.correctAnswer?'#6EE7B7':'var(--accent-bright)', flexShrink:0 }}>
                                        {opt===obj.correctAnswer ? '✓' : LETTERS[oi]+'.'}
                                      </span>
                                      {opt}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {obj.correctAnswer && (
                                <div style={{ fontSize:11, color:'#6EE7B7', fontWeight:600 }}>✓ Correct: {obj.correctAnswer}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Past quizzes ── */}
            <div className="card" style={{ padding:'20px 24px' }}>
              <div className="section-title" style={{ marginBottom:16 }}><span className="icon">📚</span>Past quizzes</div>
              {loading && <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--text-muted)', padding:'12px 0' }}><span className="spinner spinner-dark" style={{ width:16,height:16,borderWidth:2 }}/> Loading…</div>}
              {!loading && quizzes.length === 0 && <div className="empty-state"><span className="empty-icon">📭</span>No quizzes posted yet.</div>}
              {!loading && quizzes.map(q => (
                <div className="quiz-card" key={q.id}>
                  <div>
                    <div className="quiz-card-title">
                      {q.title}
                      {q.isActive && <span className="badge">● Live</span>}
                      {q.semester && (
                        <span className="badge" style={{ marginLeft: 8, background: 'rgba(99,102,241,0.15)', color: 'var(--accent-bright)', border: '1px solid rgba(99,102,241,0.25)' }}>Sem {q.semester}</span>
                      )}
                    </div>
                    <div className="quiz-card-meta">{q.questions.length} question{q.questions.length!==1?'s':''} · {new Date(q.createdAt).toLocaleDateString()}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>viewAttempts(q)}>View responses →</button>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* ── Responses / results view ── */
          <div className="card" style={{ padding:'20px 24px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelectedQuiz(null)}>← Back</button>
              <div>
                <div style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>{selectedQuiz.title}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)' }}>Results &amp; responses</div>
              </div>
            </div>

            {attemptsLoading && <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--text-muted)', padding:'16px 0' }}><span className="spinner spinner-dark" style={{ width:16,height:16,borderWidth:2 }}/> Loading…</div>}

            {!attemptsLoading && attempts.length === 0 && <div className="empty-state"><span className="empty-icon">📭</span>No students have started this quiz yet.</div>}

            {!attemptsLoading && attempts.length > 0 && (() => {
              const gradableTotal = sortedAttempts[0]?.gradableTotal ?? 0;

              return (
                <>
                  {/* ── Leaderboard / summary cards ── */}
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)', marginBottom:12 }}>
                      📊 Score summary — {gradableTotal} gradable question{gradableTotal!==1?'s':''}
                    </div>

                    {/* Class stats row */}
                    {gradableTotal > 0 && (() => {
                      const scored = sortedAttempts.filter(a=>a.status!=='in_progress');
                      const avg = scored.length ? Math.round(scored.reduce((s,a)=>s+(a.score??0),0)/scored.length*100/gradableTotal) : null;
                      return (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
                          {[
                            { label:'Highest', value:`${topScore}/${gradableTotal}`, color:'#6EE7B7' },
                            { label:'Class avg', value:avg!==null?`${avg}%`:'—', color: avg!=null?scoreColor(avg):'var(--text-muted)' },
                            { label:'Submitted', value:`${scored.length}/${sortedAttempts.length}`, color:'var(--accent-bright)' },
                          ].map(s => (
                            <div key={s.label} className="stat-card">
                              <div className="stat-value" style={{ fontSize:22, color:s.color }}>{s.value}</div>
                              <div className="stat-label">{s.label}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Ranked list */}
                    {gradableTotal > 0 && (
                      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
                        {sortedAttempts.map((a, rank) => {
                          const pct = gradableTotal ? Math.round((a.score??0)/gradableTotal*100) : null;
                          const medals = ['🥇','🥈','🥉'];
                          return (
                            <div key={a.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:10 }}>
                              <span style={{ fontSize:18, width:28, textAlign:'center', flexShrink:0 }}>{medals[rank] || `#${rank+1}`}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontWeight:600, fontSize:14, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.studentName}</div>
                                <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>{a.studentEmail}</div>
                              </div>
                              {pct !== null && (
                                <div style={{ textAlign:'right', flexShrink:0 }}>
                                  <div style={{ fontSize:20, fontWeight:700, color:scoreColor(pct) }}>{a.score}/{gradableTotal}</div>
                                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>{pct}%</div>
                                </div>
                              )}
                              <span className={`status-pill status-${a.status}`}>{a.status.replace('_',' ')}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Full answer table ── */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text-soft)' }}>Detailed answers</div>
                    <a href={api.exportUrl(selectedQuiz.id, session.token)} className="btn btn-primary btn-sm" style={{ textDecoration:'none' }}>↓ Download Excel</a>
                  </div>

                  <div className="table-wrap">
                    <table className="responses">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>UUCMS No</th>
                          <th>Score</th>
                          <th>Status</th>
                          <th>Switches</th>
                          {selectedQuiz.questions.map((q,i) => <th key={q.id} title={q.text}>Q{i+1}</th>)}
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAttempts.map(a => (
                          <tr key={a.id}>
                            <td>
                              <strong style={{ color:'var(--text)', display:'block' }}>{a.studentName}</strong>
                              <span style={{ color:'var(--text-muted)', fontSize:11 }}>{a.studentEmail}</span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--text-soft)' }}>
                              {a.studentUucmsNo || '—'}
                            </td>
                            <td>
                              {gradableTotal > 0 ? (
                                <span style={{ fontWeight:700, fontSize:14, color:scoreColor(Math.round((a.score??0)/gradableTotal*100)) }}>
                                  {a.score??0}/{gradableTotal}
                                </span>
                              ) : '—'}
                            </td>
                            <td><span className={`status-pill status-${a.status}`}>{a.status.replace('_',' ')}</span></td>
                            <td style={{ color:a.tabSwitchCount>=3?'var(--danger)':'var(--text-soft)' }}>{a.tabSwitchCount}</td>
                            {selectedQuiz.questions.map(q => {
                              const studentAns = a.answers[q.id];
                              const isCorrect = q.correctAnswer && studentAns === q.correctAnswer;
                              const isWrong   = q.correctAnswer && studentAns && studentAns !== q.correctAnswer;
                              return (
                                <td key={q.id} style={{
                                  background: isCorrect?'rgba(16,185,129,0.07)': isWrong?'rgba(239,68,68,0.07)':'transparent',
                                  color: isCorrect?'#6EE7B7': isWrong?'#FCA5A5':'var(--text-soft)',
                                  fontWeight: isCorrect||isWrong ? 500 : 400,
                                }}>
                                  {studentAns
                                    ? <span title={studentAns}>{isCorrect?'✅ ':isWrong?'❌ ':''}{studentAns.length>22?studentAns.slice(0,22)+'…':studentAns}</span>
                                    : <span style={{ color:'var(--text-muted)' }}>—</span>}
                                </td>
                              );
                            })}
                            <td>
                              <button className="btn btn-danger btn-sm" style={{ fontSize:11, padding:'4px 10px' }} onClick={()=>handleResetAttempt(a.studentId)}>Reset</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Answer key */}
                  {selectedQuiz.questions.some(q=>q.correctAnswer) && (
                    <div style={{ marginTop:20, padding:'16px 18px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:10 }}>
                      <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#6EE7B7', marginBottom:12 }}>Answer Key</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:8 }}>
                        {selectedQuiz.questions.map((q,i) => (
                          <div key={q.id} style={{ fontSize:12.5, color:'var(--text-soft)' }}>
                            <span style={{ fontWeight:700, color:'var(--text)' }}>Q{i+1}.</span>{' '}
                            <span style={{ color:'#6EE7B7' }}>{q.correctAnswer || <em style={{ color:'var(--text-muted)' }}>not set</em>}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
