// api/index.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');

// Load .env only in local development (not on Vercel where env vars are set in dashboard)
if (process.env.NODE_ENV !== 'production') {
  const dotenvPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  }
}

const { initDb, supabase } = require('./db');
const { seededShuffle } = require('./shuffle');
const {
  createToken,
  requireStudent,
  requireTeacher,
  uuidv4,
} = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// Health check and root endpoints for Render & Vercel
app.get('/', (req, res) => {
  res.send('Weekly Quiz App API is running 🚀');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;

// Comma-separated list of teacher emails allowed to log in as teacher.
const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);



function normalizeQuizQuestion(question, fallbackTimeLimit = 72) {
  if (typeof question === 'string') {
    return { text: question.trim(), options: [], correctAnswer: '', timeLimitSec: fallbackTimeLimit };
  }

  const text = String(question?.text ?? '').trim();
  const options = Array.isArray(question?.options)
    ? question.options
        .map((opt) => String(opt ?? '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const correctAnswer = String(question?.correctAnswer ?? '').trim();

  return {
    text,
    options,
    correctAnswer,
    timeLimitSec: Number.isFinite(Number(question?.timeLimitSec)) ? Number(question.timeLimitSec) : fallbackTimeLimit,
  };
}

// Map snake_case to camelCase for the frontend
const mapQuizSet = (q) => {
  if (!q) return null;
  let questions = [];
  if (Array.isArray(q.questions)) {
    questions = q.questions;
  } else if (typeof q.questions === 'string') {
    try {
      questions = JSON.parse(q.questions);
    } catch (e) {
      questions = [];
    }
  }
  const firstTimeLimit = Array.isArray(questions) && questions[0] ? Number(questions[0].timeLimitSec) : NaN;
  return {
    id: q.id,
    title: q.title || 'Untitled Quiz',
    semester: q.semester ?? null,
    questions: Array.isArray(questions) ? questions : [],
    isActive: Boolean(q.is_active),
    createdAt: q.created_at ? (typeof q.created_at === 'number' ? q.created_at : (isNaN(new Date(q.created_at).getTime()) ? Date.now() : new Date(q.created_at).getTime())) : Date.now(),
    timeLimitSec: Number.isFinite(firstTimeLimit) ? firstTimeLimit : 72,
  };
};

// ---------- Auth: Login / Register ----------
app.post('/api/auth/login', async (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Role is required' });

  if (role === 'student') {
    const { teamName, password, semester } = req.body;
    if (!teamName || !teamName.trim()) return res.status(400).json({ error: 'Team name/number is required' });
    if (!password || !password.trim()) return res.status(400).json({ error: 'Password is required' });

    const rawTeam = String(teamName).trim();
    const digits = rawTeam.replace(/\D/g, '');
    const teamNum = digits ? parseInt(digits, 10) : null;

    let canonicalEmail = rawTeam.toUpperCase();
    let expectedPassword = null;

    if (teamNum !== null && teamNum >= 1 && teamNum <= 48) {
      canonicalEmail = `TEAM ${teamNum}`;
      expectedPassword = `Team@${String(teamNum).padStart(3, '0')}`;
    }

    // Search by team_number or email or team_name
    let query = supabase.from('students').select('*');
    if (teamNum !== null) {
      query = query.or(`team_number.eq.${teamNum},email.eq."${canonicalEmail}",email.eq."TEAM${teamNum}",email.eq."${rawTeam.toUpperCase()}"`);
    } else {
      query = query.or(`email.eq."${rawTeam.toUpperCase()}",team_name.ilike."${rawTeam}"`);
    }

    const { data: students } = await query.limit(1);

    let student;
    if (!students || students.length === 0) {
      // Auto-register team if missing
      const semNum = Number(semester) && Number(semester) >= 1 && Number(semester) <= 6 ? Number(semester) : 1;
      const userId = uuidv4();
      const pwdToHash = expectedPassword || password.trim();
      const hashedPassword = await bcrypt.hash(pwdToHash, 10);
      const newStudent = {
        id: userId,
        team_number: teamNum || 1,
        team_name: teamNum ? `Team ${teamNum}` : rawTeam,
        email: canonicalEmail,
        password_hash: hashedPassword,
        uucms_no: `${semNum}::${hashedPassword}`,
        semester: semNum,
        created_at: new Date().toISOString()
      };
      
      let { error } = await supabase.from('students').insert(newStudent);
      if (error && error.message.includes('column')) {
        // Fallback for legacy schema
        const fallback = {
          id: userId,
          team_number: teamNum || 1,
          team_name: teamNum ? `Team ${teamNum}` : rawTeam,
          email: canonicalEmail,
          password_hash: hashedPassword,
          uucms_no: `${semNum}::${hashedPassword}`,
          semester: semNum,
          created_at: new Date().toISOString()
        };
        const res = await supabase.from('students').insert(fallback);
        error = res.error;
      }

      if (error) {
        return res.status(500).json({ error: 'Registration failed: ' + error.message });
      }
      student = newStudent;
    } else {
      student = students[0];
    }

    // Password validation using password_hash or fallback uucms_no
    const trimmedInputPassword = password.trim();
    let isMatch = false;

    if (expectedPassword && trimmedInputPassword === expectedPassword) {
      isMatch = true;
    } else if (student.password_hash) {
      isMatch = await bcrypt.compare(trimmedInputPassword, student.password_hash);
    } else {
      const uucmsNo = student.uucms_no || '';
      const parts = uucmsNo.split('::');
      if (parts.length >= 2) {
        isMatch = await bcrypt.compare(trimmedInputPassword, parts[1]);
      }
    }

    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect password for this team' });
    }

    const tokenPayload = { 
      id: student.id, 
      email: student.email, 
      role: 'student', 
      teamNumber: student.team_number || teamNum,
      teamName: student.team_name || rawTeam
    };
    const token = createToken(tokenPayload);
    return res.json({ 
      ok: true, 
      token, 
      role: 'student', 
      email: student.email,
      teamNumber: student.team_number || teamNum,
      teamName: student.team_name || rawTeam
    });

  } else if (role === 'teacher') {
    const { email, password } = req.body;
    if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required' });
    if (!password || !password.trim()) return res.status(400).json({ error: 'Password is required' });

    const normalizedEmail = String(email).trim().toLowerCase();

    if (!TEACHER_EMAILS.includes(normalizedEmail)) {
      return res.status(403).json({ error: 'This email is not registered as a teacher account' });
    }

    // Verify against TEACHER_PASSWORD env var or fallback
    const expectedPassword = process.env.TEACHER_PASSWORD || 'admin123';
    if (password.trim() !== expectedPassword) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    // Check if teacher exists in DB, otherwise insert
    const { data: teachers } = await supabase.from('teachers').select('*').eq('email', normalizedEmail).limit(1);
    let userId;
    if (!teachers || teachers.length === 0) {
      userId = uuidv4();
      await supabase.from('teachers').insert({
        id: userId,
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0]
      });
    } else {
      userId = teachers[0].id;
    }

    const tokenPayload = { id: userId, email: normalizedEmail, role: 'teacher' };
    const token = createToken(tokenPayload);
    return res.json({ ok: true, token, role: 'teacher', email: normalizedEmail });
  }

  return res.status(400).json({ error: 'Invalid role' });
});

// ======================================================================
// TEACHER ROUTES
// ======================================================================

app.post('/api/teacher/quiz', requireTeacher, async (req, res) => {
  const { title, questions, semester } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Title and at least one question are required' });
  }

  const semNum = Number(semester) && Number(semester) >= 1 && Number(semester) <= 6 ? Number(semester) : 1;

  // Deactivate ALL currently active quizzes before posting a new one
  await supabase.from('quiz_sets').update({ is_active: false }).eq('is_active', true);

  const normalizedQuestions = questions
    .map((q) => normalizeQuizQuestion(q, 72))
    .filter((q) => q.text)
    .map((q) => ({
      id: uuidv4(),
      text: q.text,
      options: q.options,
      correctAnswer: q.correctAnswer || '',
      timeLimitSec: q.timeLimitSec || 72,
    }));

  const quizSet = {
    id: uuidv4(),
    title,
    semester: semNum,
    questions: normalizedQuestions,
    created_at: new Date().toISOString(),
    is_active: true,
  };
  
  const { error } = await supabase.from('quiz_sets').insert(quizSet);
  if (error) {
    console.error("Insert quiz error:", error);
    return res.status(500).json({ error: 'Failed to save quiz to database' });
  }

  res.json({ ok: true, quizSet: mapQuizSet(quizSet) });
});

app.post('/api/teacher/generate-questions', requireTeacher, async (req, res) => {
  const { topic, count } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  const requestedCount = Math.max(parseInt(count, 10) || 5, 1);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'Gemini API Key is not configured on the server.' });

  async function fetchQuestionBatch(batchSize) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate exactly ${batchSize} educational multiple-choice quiz questions for the topic: "${topic}". Each question must be a single, clear MCQ with exactly four options and one correct answer. Return the result strictly as a JSON array of objects in this shape: [{"text":"...","options":["...","...","...","..."],"correctAnswer":"..."}] where correctAnswer is the exact text of the correct option (must match one of the four options exactly). Keep the wording concise, relevant to the topic, and make the distractors plausible.`
          }]
        }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || 'Failed to generate questions from Gemini API');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) throw new Error('Invalid response format from Gemini API.');

    const questions = JSON.parse(generatedText);
    if (!Array.isArray(questions)) throw new Error('Gemini API did not return an array of questions.');

    return questions
      .map((question) => {
        const text = String(question?.text ?? '').trim();
        const options = Array.isArray(question?.options)
          ? question.options.map((option) => String(option ?? '').trim()).filter(Boolean).slice(0, 4)
          : [];
        const correctAnswer = String(question?.correctAnswer ?? '').trim();
        return { text, options: options.length === 4 ? options : [], correctAnswer };
      })
      .filter((question) => question.text && question.options.length === 4);
  }

  try {
    const allQuestions = [];
    let remaining = requestedCount;
    let attempts = 0;
    const maxAttempts = Math.max(10, Math.ceil(requestedCount / 15));

    while (allQuestions.length < requestedCount && attempts < maxAttempts) {
      const batchSize = Math.min(Math.max(remaining, 1), 20);
      const batch = await fetchQuestionBatch(batchSize);
      allQuestions.push(...batch.slice(0, batchSize));
      remaining = requestedCount - allQuestions.length;
      attempts += 1;
    }

    res.json({ ok: true, questions: allQuestions.slice(0, requestedCount) });
  } catch (err) {
    console.error('Error generating questions:', err);
    res.status(500).json({ error: 'An error occurred while generating questions.' });
  }
});


app.get('/api/teacher/quiz', requireTeacher, async (req, res) => {
  try {
    const { data: quizSets, error } = await supabase
      .from('quiz_sets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch quizzes database error:', error);
      return res.status(500).json({ error: `Failed to fetch quizzes: ${error.message}` });
    }

    const safeQuizSets = (quizSets || []).map(mapQuizSet).filter(Boolean);
    res.json({ quizSets: safeQuizSets });
  } catch (err) {
    console.error('GET /api/teacher/quiz exception:', err);
    res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

app.get('/api/teacher/quiz/:quizId/attempts', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  
  const { data: quizzes } = await supabase.from('quiz_sets').select('*').eq('id', quizId).limit(1);
  if (!quizzes || quizzes.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  
  const quizSet = mapQuizSet(quizzes[0]);
  const gradableQuestions = quizSet.questions.filter((q) => q.correctAnswer);

  const { data: attemptsDb } = await supabase.from('attempts').select('*, students(*)').eq('quiz_set_id', quizId);
  
  const attempts = (attemptsDb || []).map((a) => {
    const score = gradableQuestions.reduce((sum, q) => {
      return sum + (a.answers[q.id] === q.correctAnswer ? 1 : 0);
    }, 0);
    
    return {
      id: a.id,
      studentId: a.student_id,
      quizSetId: a.quiz_set_id,
      questionOrder: a.question_order,
      answers: a.answers,
      tabSwitchCount: a.tab_switch_count,
      status: a.status,
      startedAt: a.started_at,
      submittedAt: a.submitted_at,
      studentEmail: a.students?.email || 'unknown',
      studentName: a.students?.team_name || a.students?.email || 'unknown',
      studentUucmsNo: (() => {
        const uNo = a.students?.uucms_no || '';
        const parts = uNo.split('::');
        return parts.length > 1 ? `Semester ${parts[0]}` : 'Semester 1';
      })(),
      score,
      gradableTotal: gradableQuestions.length,
    };
  });

  res.json({ quizSet, attempts });
});

app.post('/api/teacher/quiz/:quizId/attempts/:studentId/reset', requireTeacher, async (req, res) => {
  const { quizId, studentId } = req.params;
  const { error } = await supabase.from('attempts').delete().match({ quiz_set_id: quizId, student_id: studentId });
  if (error) return res.status(500).json({ error: 'Failed to reset attempt' });
  res.json({ ok: true });
});

app.post('/api/teacher/quiz/:quizId/reactivate', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  
  // Find the quiz to know its semester
  const { data: quizzes, error: fetchErr } = await supabase.from('quiz_sets').select('*').eq('id', quizId).limit(1);
  if (fetchErr || !quizzes || quizzes.length === 0) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  
  const quiz = quizzes[0];
  const semesterNum = quiz.semester;

  // Deactivate all quizzes for this semester
  await supabase.from('quiz_sets').update({ is_active: false }).eq('semester', semesterNum);

  // Reactivate the chosen quiz and update its creation time to reset the 2-day timer
  const { error: updateErr } = await supabase
    .from('quiz_sets')
    .update({ 
      is_active: true, 
      created_at: new Date().toISOString() 
    })
    .eq('id', quizId);

  if (updateErr) {
    console.error("Reactivation error:", updateErr);
    return res.status(500).json({ error: 'Failed to reactivate quiz' });
  }

  res.json({ ok: true });
});

app.post('/api/teacher/quiz/:quizId/deactivate', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  const { error } = await supabase.from('quiz_sets').update({ is_active: false }).eq('id', quizId);
  if (error) {
    console.error("Deactivation error:", error);
    return res.status(500).json({ error: 'Failed to close quiz' });
  }
  res.json({ ok: true });
});

app.delete('/api/teacher/quiz/:quizId', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  await supabase.from('attempts').delete().eq('quiz_set_id', quizId);
  const { error } = await supabase.from('quiz_sets').delete().eq('id', quizId);
  if (error) {
    console.error("Delete quiz error:", error);
    return res.status(500).json({ error: 'Failed to delete quiz' });
  }
  res.json({ ok: true });
});

app.get('/api/teacher/quiz/:quizId/export', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  
  const { data: quizzes } = await supabase.from('quiz_sets').select('*').eq('id', quizId).limit(1);
  if (!quizzes || quizzes.length === 0) return res.status(404).json({ error: 'Quiz not found' });
  
  const quizSet = mapQuizSet(quizzes[0]);
  const gradableQuestions = quizSet.questions.filter((q) => q.correctAnswer);

  const { data: attemptsDb } = await supabase.from('attempts').select('*, students(*)').eq('quiz_set_id', quizId);
  const attempts = attemptsDb || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'gcc_code_zone';

  const sheet = workbook.addWorksheet('Responses');

  sheet.columns = [
    { header: 'Team Name / No',  key: 'name',        width: 22 },
    { header: 'Team ID (Upper)', key: 'email',        width: 30 },
    { header: 'Semester',      key: 'uucmsNo',     width: 20 },
    { header: 'Quiz Semester',      key: 'semester',    width: 12 },
    { header: 'Score',         key: 'score',        width: 10 },
    { header: `/ ${gradableQuestions.length}`,      key: 'total',       width: 8  },
    { header: 'Percentage',    key: 'pct',          width: 14 },
    { header: 'Status',        key: 'status',       width: 16 },
    { header: 'Tab Switches',  key: 'tabSwitches',  width: 14 },
    { header: 'Submitted At',  key: 'submittedAt',  width: 22 },
    ...quizSet.questions.map((q, idx) => ({ header: `Q${idx + 1}: ${q.text}`, key: q.id, width: 32 })),
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3730A3' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  ['score', 'total', 'pct'].forEach((key) => {
    sheet.getColumn(key).alignment = { horizontal: 'center' };
  });

  const sortedAttempts = [...attempts].sort((a, b) => {
    const scoreA = gradableQuestions.reduce((s, q) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    const scoreB = gradableQuestions.reduce((s, q) => s + (b.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    return scoreB - scoreA;
  });

  sortedAttempts.forEach((a, rowIdx) => {
    const student = a.students;
    const score = gradableQuestions.reduce((s, q) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    const pct = gradableQuestions.length ? Math.round((score / gradableQuestions.length) * 100) : null;

    const rowData = {
      name:        student ? (student.team_name || student.email) : 'unknown',
      email:       student ? student.email : 'unknown',
      uucmsNo:     (() => {
        const uNo = student?.uucms_no || '';
        const parts = uNo.split('::');
        return parts.length > 1 ? `Semester ${parts[0]}` : 'Semester 1';
      })(),
      semester:    quizSet.semester || '—',
      score:       gradableQuestions.length ? score : '—',
      total:       gradableQuestions.length ? gradableQuestions.length : '—',
      pct:         pct !== null ? `${pct}%` : '—',
      status:      a.status.replace(/_/g, ' '),
      tabSwitches: a.tab_switch_count,
      submittedAt: a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—',
    };

    quizSet.questions.forEach((q) => {
      const studentAns = a.answers[q.id] || '';
      const isCorrect  = q.correctAnswer && studentAns === q.correctAnswer;
      const isWrong    = q.correctAnswer && studentAns && studentAns !== q.correctAnswer;
      if (isCorrect)   rowData[q.id] = `✓ ${studentAns}`;
      else if (isWrong) rowData[q.id] = `✗ ${studentAns}`;
      else              rowData[q.id] = studentAns || '—';
    });

    const excelRow = sheet.addRow(rowData);
    excelRow.height = 18;

    const bgColor = rowIdx % 2 === 0 ? 'FFFAFAFA' : 'FFF3F4F6';
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });

    const scoreCell = excelRow.getCell('score');
    scoreCell.font = { bold: true };
    if (pct !== null) {
      scoreCell.font = { bold: true, color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' } };
    }

    const pctCell = excelRow.getCell('pct');
    if (pct !== null) {
      pctCell.font = { bold: true, color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' } };
    }

    quizSet.questions.forEach((q) => {
      const studentAns = a.answers[q.id] || '';
      const isCorrect  = q.correctAnswer && studentAns === q.correctAnswer;
      const isWrong    = q.correctAnswer && studentAns && studentAns !== q.correctAnswer;
      const cell       = excelRow.getCell(q.id);
      if (isCorrect) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        cell.font = { color: { argb: 'FF065F46' } };
      } else if (isWrong) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        cell.font = { color: { argb: 'FF991B1B' } };
      }
    });
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  if (gradableQuestions.length > 0) {
    const keySheet = workbook.addWorksheet('Answer Key');
    keySheet.columns = [
      { header: '#',              key: 'num',    width: 6  },
      { header: 'Question',       key: 'text',   width: 50 },
      { header: 'Correct Answer', key: 'answer', width: 30 },
    ];
    const keyHeader = keySheet.getRow(1);
    keyHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    keyHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
    keyHeader.height = 22;

    quizSet.questions.forEach((q, idx) => {
      const row = keySheet.addRow({ num: idx + 1, text: q.text, answer: q.correctAnswer || '—' });
      row.height = 18;
      if (q.correctAnswer) {
        row.getCell('answer').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        row.getCell('answer').font  = { bold: true, color: { argb: 'FF065F46' } };
      }
    });
    keySheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value',  key: 'value',  width: 20 },
  ];
  const sumHeader = summarySheet.getRow(1);
  sumHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sumHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
  sumHeader.height = 22;

  const submitted = sortedAttempts.filter((a) => a.status !== 'in_progress');
  const scores    = submitted.map((a) => gradableQuestions.reduce((s, q) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0), 0));
  const avgScore  = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  const highest   = scores.length ? Math.max(...scores) : '—';
  const lowest    = scores.length ? Math.min(...scores) : '—';
  const avgPct    = scores.length && gradableQuestions.length ? `${Math.round((avgScore / gradableQuestions.length) * 100)}%` : '—';

  [
    { metric: 'Quiz Title',          value: quizSet.title },
    { metric: 'Total Questions',     value: quizSet.questions.length },
    { metric: 'Gradable Questions',  value: gradableQuestions.length },
    { metric: 'Total Students',      value: sortedAttempts.length },
    { metric: 'Submitted',           value: submitted.length },
    { metric: 'Highest Score',       value: gradableQuestions.length ? `${highest} / ${gradableQuestions.length}` : '—' },
    { metric: 'Lowest Score',        value: gradableQuestions.length ? `${lowest} / ${gradableQuestions.length}` : '—' },
    { metric: 'Class Average Score', value: gradableQuestions.length ? `${avgScore} / ${gradableQuestions.length}` : '—' },
    { metric: 'Class Average %',     value: avgPct },
    { metric: 'Exported At',         value: new Date().toLocaleString() },
    { metric: 'Exported By',         value: 'gcc_code_zone team' },
  ].forEach((item, i) => {
    const row = summarySheet.addRow(item);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFF5F3FF' : 'FFFAFAFA' } };
    });
    row.getCell('metric').font = { bold: true };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${quizSet.title.replace(/\s+/g, '_')}_responses.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ======================================================================
// STUDENT ROUTES
// ======================================================================

app.get('/api/student/quiz/history', requireStudent, async (req, res) => {
  try {
    const { data: attempts, error } = await supabase
      .from('attempts')
      .select('*, quiz_sets(*)')
      .eq('student_id', req.user.id);

    if (error) {
      console.error("Fetch history error:", error);
      return res.status(500).json({ error: 'Failed to fetch attempt history' });
    }

    const history = (attempts || []).map((a) => {
      const quizSet = a.quiz_sets ? mapQuizSet(a.quiz_sets) : null;
      if (!quizSet) return null;
      
      const gradableQuestions = quizSet.questions.filter((q) => q.correctAnswer);
      const score = gradableQuestions.reduce((sum, q) => {
        return sum + (a.answers[q.id] === q.correctAnswer ? 1 : 0);
      }, 0);

      const RESULTS_RELEASE_DELAY_MS = 2 * 24 * 60 * 60 * 1000;
      const releaseTime = quizSet.createdAt ? quizSet.createdAt + RESULTS_RELEASE_DELAY_MS : 0;
      const resultsReleased = Date.now() >= releaseTime;

      return {
        id: a.id,
        quizSetId: a.quiz_set_id,
        quizTitle: quizSet.title,
        semester: quizSet.semester,
        score,
        totalQuestions: quizSet.questions.length,
        gradableTotal: gradableQuestions.length,
        status: a.status,
        submittedAt: a.submitted_at,
        startedAt: a.started_at,
        resultsReleased,
        quizCreatedAt: quizSet.createdAt,
      };
    }).filter(Boolean);

    res.json({ history });
  } catch (err) {
    console.error("History endpoint error:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/student/quiz/active', requireStudent, async (req, res) => {
  // No semester filtering — all students see the same active quiz
  const { data: quizzes } = await supabase.from('quiz_sets').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
  if (!quizzes || quizzes.length === 0) return res.json({ quizSet: null });
  
  const quizSet = mapQuizSet(quizzes[0]);

  const EXPIRE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
  const isQuizExpired = Date.now() > (quizSet.createdAt || 0) + EXPIRE_DURATION_MS;

  const { data: attempts } = await supabase.from('attempts').select('*').match({ student_id: req.user.id, quiz_set_id: quizSet.id }).limit(1);
  let attempt = attempts && attempts.length > 0 ? attempts[0] : null;

  if (!attempt) {
    if (isQuizExpired) {
      return res.json({ quizSet: null });
    }

    const seed = `${req.user.id}::${quizSet.id}`;
    const order = seededShuffle(quizSet.questions.map((q) => q.id), seed);
    
    attempt = {
      id: uuidv4(),
      student_id: req.user.id,
      quiz_set_id: quizSet.id,
      question_order: order,
      answers: {},
      tab_switch_count: 0,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    };
    
    const { error } = await supabase.from('attempts').insert(attempt);
    if (error) {
      console.error("Failed to insert attempt", error);
      return res.status(500).json({ error: 'Database error creating attempt' });
    }
  } else if (attempt.status === 'in_progress' && isQuizExpired) {
    const nowIso = new Date().toISOString();
    attempt.status = 'auto_submitted';
    attempt.submitted_at = nowIso;
    await supabase.from('attempts').update({ 
      status: 'auto_submitted', 
      submitted_at: nowIso 
    }).eq('id', attempt.id);
  }

  const questionsById = Object.fromEntries(quizSet.questions.map((q) => [q.id, q]));
  const orderedQuestions = attempt.question_order.map((qid) => questionsById[qid]).filter(Boolean);

  // If student is still in progress, hide correct answers
  let finalQuestions = orderedQuestions;
  if (attempt.status === 'in_progress') {
    finalQuestions = orderedQuestions.map((q) => {
      const { correctAnswer, ...rest } = q;
      return rest;
    });
  }

  res.json({
    quizSet: { 
      id: quizSet.id, 
      title: quizSet.title, 
      timeLimitSec: quizSet.timeLimitSec || 72,
      createdAt: quizSet.createdAt
    },
    questions: finalQuestions,
    answers: attempt.answers,
    tabSwitchCount: attempt.tab_switch_count,
    status: attempt.status,
  });
});

app.post('/api/student/quiz/:quizId/answer', requireStudent, async (req, res) => {
  const { questionId, answer } = req.body;
  const { quizId } = req.params;
  
  const { data: attempts } = await supabase.from('attempts').select('*').match({ student_id: req.user.id, quiz_set_id: quizId }).limit(1);
  if (!attempts || attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
  
  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Quiz already submitted' });

  const newAnswers = { ...attempt.answers, [questionId]: answer };
  await supabase.from('attempts').update({ answers: newAnswers }).eq('id', attempt.id);
  
  res.json({ ok: true });
});

app.post('/api/student/quiz/:quizId/tab-switch', requireStudent, async (req, res) => {
  const { quizId } = req.params;
  
  const { data: attempts } = await supabase.from('attempts').select('*').match({ student_id: req.user.id, quiz_set_id: quizId }).limit(1);
  if (!attempts || attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
  
  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') {
    return res.json({ ok: true, status: attempt.status, tabSwitchCount: attempt.tab_switch_count });
  }

  const newCount = attempt.tab_switch_count + 1;
  let autoSubmitted = false;
  
  let updates = { tab_switch_count: newCount };
  if (newCount >= 3) {
    updates.status = 'auto_submitted';
    updates.submitted_at = new Date().toISOString();
    autoSubmitted = true;
  }

  await supabase.from('attempts').update(updates).eq('id', attempt.id);
  
  res.json({ ok: true, status: updates.status || attempt.status, tabSwitchCount: newCount, autoSubmitted });
});

app.post('/api/student/quiz/:quizId/submit', requireStudent, async (req, res) => {
  const { quizId } = req.params;
  
  const { data: attempts } = await supabase.from('attempts').select('*').match({ student_id: req.user.id, quiz_set_id: quizId }).limit(1);
  if (!attempts || attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
  
  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Already submitted' });

  await supabase.from('attempts').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', attempt.id);
  res.json({ ok: true });
});

// ---------- Start server for local development & Render ----------
if (require.main === module || (!process.env.VERCEL && !process.env.VERCEL_ENV)) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    if (TEACHER_EMAILS.length === 0) {
      console.log('WARNING: No TEACHER_EMAILS configured in environment - no one will be able to log in as teacher.');
    }
  });

  initDb().catch((err) => {
    console.error('Failed to initialize Supabase client:', err);
  });
}

module.exports = app;
