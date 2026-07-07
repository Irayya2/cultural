// index.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const ExcelJS = require('exceljs');

const dotenvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotenvPath) && process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: dotenvPath });
}

const { initDb } = require('./db');
const { sendOtpEmail } = require('./mailer');
const { seededShuffle } = require('./shuffle');
const {
  generateOtp,
  createToken,
  requireStudent,
  requireTeacher,
  OTP_EXPIRY_MS,
  uuidv4,
} = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

// Comma-separated list of teacher emails allowed to log in as teacher.
// Set this in server/.env, e.g. TEACHER_EMAILS=sir@college.edu,hod@college.edu
const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

let db;

function getUucmsSemesters(uucmsNo) {
  if (!uucmsNo) return null;
  const clean = String(uucmsNo).trim().toUpperCase();
  const match = clean.match(/^U15BH(24|25|26)S(\d{4})$/);
  if (!match) return null;
  
  const batch = match[1]; // "24", "25", "26"
  const number = parseInt(match[2], 10);
  
  if (number < 1 || number > 250) return null;
  
  if (batch === '26') return [1, 2];
  if (batch === '25') return [3, 4];
  if (batch === '24') return [5, 6];
  
  return null;
}

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

// ---------- OTP: request ----------
// Used by both student and teacher login screens.
app.post('/api/otp/request', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Email and role are required' });
  const normalizedEmail = String(email).trim().toLowerCase();

  if (role === 'teacher' && !TEACHER_EMAILS.includes(normalizedEmail)) {
    return res.status(403).json({ error: 'This email is not registered as a teacher account' });
  }

  const code = generateOtp();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  await db.read();
  // remove any previous unconsumed OTPs for this email+role to avoid clutter
  db.data.otps = db.data.otps.filter((o) => !(o.email === normalizedEmail && o.role === role));
  db.data.otps.push({ id: uuidv4(), email: normalizedEmail, code, role, expiresAt, used: false });
  await db.write();

  try {
    await sendOtpEmail(normalizedEmail, code, role);
    res.json({ ok: true, message: 'OTP sent to email' });
  } catch (err) {
    console.error('Failed to send OTP email:', err.message);
    console.log(`[OTP FALLBACK] OTP for ${normalizedEmail} (${role}): ${code}`);
    res.json({ ok: true, message: 'OTP generated, but email delivery failed. Check server logs for the code.' });
  }
});

// ---------- OTP: verify ----------
app.post('/api/otp/verify', async (req, res) => {
  const { email, role, code, name, uucmsNo } = req.body;
  if (!email || !role || !code) return res.status(400).json({ error: 'Missing fields' });
  const normalizedEmail = String(email).trim().toLowerCase();

  if (role === 'student') {
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!uucmsNo || !uucmsNo.trim()) {
      return res.status(400).json({ error: 'UUCMS number is required' });
    }
    const semesters = getUucmsSemesters(uucmsNo);
    if (!semesters) {
      return res.status(400).json({ error: 'Invalid UUCMS Number format or range (Must be U15BH24S/25S/26S from 0001 to 0250)' });
    }
  }

  await db.read();
  const otpRecord = db.data.otps.find(
    (o) => o.email === normalizedEmail && o.role === role && !o.used
  );

  if (!otpRecord) return res.status(400).json({ error: 'No OTP requested for this email. Please request a new one.' });
  if (otpRecord.code !== String(code).trim()) return res.status(400).json({ error: 'Incorrect OTP' });
  if (Date.now() > otpRecord.expiresAt) return res.status(400).json({ error: 'OTP expired. Please request a new one.' });

  otpRecord.used = true;

  let userId;
  let finalUucmsNo = undefined;
  if (role === 'student') {
    finalUucmsNo = uucmsNo.trim().toUpperCase();
    let student = db.data.students.find((s) => s.email === normalizedEmail);
    if (!student) {
      student = { id: uuidv4(), email: normalizedEmail, name: name.trim(), uucmsNo: finalUucmsNo, createdAt: Date.now() };
      db.data.students.push(student);
    } else {
      student.name = name.trim();
      student.uucmsNo = finalUucmsNo;
    }
    userId = student.id;
  } else {
    let teacher = db.data.teachers.find((t) => t.email === normalizedEmail);
    if (!teacher) {
      teacher = { id: uuidv4(), email: normalizedEmail, name: name || normalizedEmail };
      db.data.teachers.push(teacher);
    } else if (name) {
      teacher.name = name.trim();
    }
    userId = teacher.id;
  }

  await db.write();

  const tokenPayload = { id: userId, email: normalizedEmail, role };
  if (role === 'student') {
    tokenPayload.uucmsNo = finalUucmsNo;
  }

  const token = createToken(tokenPayload);
  res.json({ ok: true, token, role });
});

// ======================================================================
// TEACHER ROUTES
// ======================================================================

// Create a new weekly quiz set
app.post('/api/teacher/quiz', requireTeacher, async (req, res) => {
  const { title, questions, semester } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Title and at least one question are required' });
  }

  const semesterNum = Number(semester);
  if (!semester || isNaN(semesterNum) || semesterNum < 1 || semesterNum > 6) {
    return res.status(400).json({ error: 'Valid Semester (1 to 6) is required' });
  }

  await db.read();
  // Deactivate previous quiz sets for the SAME semester
  db.data.quizSets.forEach((q) => {
    if (q.semester === semesterNum) {
      q.isActive = false;
    }
  });

  const normalizedQuestions = questions
    .map((q) => normalizeQuizQuestion(q, 72))
    .filter((q) => q.text);

  const quizSet = {
    id: uuidv4(),
    title,
    semester: semesterNum,
    questions: normalizedQuestions.map((q) => ({
      id: uuidv4(),
      text: q.text,
      options: q.options,
      correctAnswer: q.correctAnswer || '',
      timeLimitSec: q.timeLimitSec || 72,
    })),
    createdAt: Date.now(),
    isActive: true,
    timeLimitSec: 72,
  };
  db.data.quizSets.push(quizSet);
  await db.write();

  res.json({ ok: true, quizSet });
});

// Generate quiz questions using Gemini AI
app.post('/api/teacher/generate-questions', requireTeacher, async (req, res) => {
  const { topic, count } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const requestedCount = Math.max(parseInt(count, 10) || 5, 1);
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API Key is not configured on the server.' });
  }

  async function fetchQuestionBatch(batchSize) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate exactly ${batchSize} educational multiple-choice quiz questions for the topic: "${topic}". Each question must be a single, clear MCQ with exactly four options and one correct answer. Return the result strictly as a JSON array of objects in this shape: [{"text":"...","options":["...","...","...","..."],"correctAnswer":"..."}] where correctAnswer is the exact text of the correct option (must match one of the four options exactly). Keep the wording concise, relevant to the topic, and make the distractors plausible.`
          }]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || 'Failed to generate questions from Gemini API');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error('Invalid response format from Gemini API.');
    }

    const questions = JSON.parse(generatedText);
    if (!Array.isArray(questions)) {
      throw new Error('Gemini API did not return an array of questions.');
    }

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

    console.log(`[ai-generate] requested=${requestedCount} generated=${allQuestions.length} attempts=${attempts}`);
    res.json({ ok: true, questions: allQuestions.slice(0, requestedCount) });
  } catch (err) {
    console.error('Error generating questions:', err);
    res.status(500).json({ error: 'An error occurred while generating questions.' });
  }
});


// List all quiz sets (history)
app.get('/api/teacher/quiz', requireTeacher, async (req, res) => {
  await db.read();
  res.json({ quizSets: db.data.quizSets.sort((a, b) => b.createdAt - a.createdAt) });
});

// Get all attempts/answers for a quiz set
app.get('/api/teacher/quiz/:quizId/attempts', requireTeacher, async (req, res) => {
  await db.read();
  const { quizId } = req.params;
  const quizSet = db.data.quizSets.find((q) => q.id === quizId);
  if (!quizSet) return res.status(404).json({ error: 'Quiz not found' });

  const gradableQuestions = quizSet.questions.filter((q) => q.correctAnswer);

  const attempts = db.data.attempts
    .filter((a) => a.quizSetId === quizId)
    .map((a) => {
      const student = db.data.students.find((s) => s.id === a.studentId);
      const score = gradableQuestions.reduce((sum, q) => {
        return sum + (a.answers[q.id] === q.correctAnswer ? 1 : 0);
      }, 0);
      return {
        ...a,
        studentEmail: student ? student.email : 'unknown',
        studentName: student ? student.name : 'unknown',
        studentUucmsNo: student ? student.uucmsNo : 'unknown',
        score,
        gradableTotal: gradableQuestions.length,
      };
    });

  res.json({ quizSet, attempts });
});

// Reset a student's attempt data so they can start over.
app.post('/api/teacher/quiz/:quizId/attempts/:studentId/reset', requireTeacher, async (req, res) => {
  await db.read();
  const { quizId, studentId } = req.params;
  const attemptIndex = db.data.attempts.findIndex(
    (a) => a.quizSetId === quizId && a.studentId === studentId
  );

  if (attemptIndex === -1) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  db.data.attempts.splice(attemptIndex, 1);
  await db.write();
  res.json({ ok: true });
});

// Download attempts as Excel
app.get('/api/teacher/quiz/:quizId/export', requireTeacher, async (req, res) => {
  await db.read();
  const { quizId } = req.params;
  const quizSet = db.data.quizSets.find((q) => q.id === quizId);
  if (!quizSet) return res.status(404).json({ error: 'Quiz not found' });

  const attempts = db.data.attempts.filter((a) => a.quizSetId === quizId);
  const gradableQuestions = quizSet.questions.filter((q) => q.correctAnswer);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'gcc_code_zone';

  // ── Sheet 1: Responses ──────────────────────────────────────────────
  const sheet = workbook.addWorksheet('Responses');

  sheet.columns = [
    { header: 'Student Name',  key: 'name',        width: 22 },
    { header: 'Student Email', key: 'email',        width: 30 },
    { header: 'UUCMS No',      key: 'uucmsNo',     width: 20 },
    { header: 'Semester',      key: 'semester',    width: 12 },
    { header: 'Score',         key: 'score',        width: 10 },
    { header: `/ ${gradableQuestions.length}`,      key: 'total',       width: 8  },
    { header: 'Percentage',    key: 'pct',          width: 14 },
    { header: 'Status',        key: 'status',       width: 16 },
    { header: 'Tab Switches',  key: 'tabSwitches',  width: 14 },
    { header: 'Submitted At',  key: 'submittedAt',  width: 22 },
    ...quizSet.questions.map((q, idx) => ({ header: `Q${idx + 1}: ${q.text}`, key: q.id, width: 32 })),
  ];

  // Header row styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3730A3' } }; // indigo
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  // Score / Total / % header cells get a slightly different shade
  ['score', 'total', 'pct'].forEach((key) => {
    const col = sheet.getColumn(key);
    col.alignment = { horizontal: 'center' };
  });

  // Sort by score descending (highest first)
  const sortedAttempts = [...attempts].sort((a, b) => {
    const scoreA = gradableQuestions.reduce((s, q) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    const scoreB = gradableQuestions.reduce((s, q) => s + (b.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    return scoreB - scoreA;
  });

  sortedAttempts.forEach((a, rowIdx) => {
    const student = db.data.students.find((s) => s.id === a.studentId);
    const score = gradableQuestions.reduce((s, q) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0), 0);
    const pct = gradableQuestions.length ? Math.round((score / gradableQuestions.length) * 100) : null;

    const rowData = {
      name:        student ? student.name  : 'unknown',
      email:       student ? student.email : 'unknown',
      uucmsNo:     student ? student.uucmsNo : 'unknown',
      semester:    quizSet.semester || '—',
      score:       gradableQuestions.length ? score : '—',
      total:       gradableQuestions.length ? gradableQuestions.length : '—',
      pct:         pct !== null ? `${pct}%` : '—',
      status:      a.status.replace(/_/g, ' '),
      tabSwitches: a.tabSwitchCount,
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—',
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

    // Alternating row background
    const bgColor = rowIdx % 2 === 0 ? 'FFFAFAFA' : 'FFF3F4F6';
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });

    // Score cell colour
    const scoreCell = excelRow.getCell('score');
    scoreCell.font = { bold: true };
    if (pct !== null) {
      scoreCell.font = { bold: true, color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' } };
    }

    // Pct cell colour
    const pctCell = excelRow.getCell('pct');
    if (pct !== null) {
      pctCell.font = { bold: true, color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' } };
    }

    // Answer cells: green for correct, red for wrong
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

  // Freeze the header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2: Answer Key ─────────────────────────────────────────────
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

  // ── Sheet 3: Summary ────────────────────────────────────────────────
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

// Get the currently active quiz, with THIS student's shuffled question order.
// Also returns any in-progress answers/tab-switch count if they already started.
app.get('/api/student/quiz/active', requireStudent, async (req, res) => {
  const requestedSem = Number(req.query.semester);
  if (!req.query.semester || isNaN(requestedSem) || requestedSem < 1 || requestedSem > 6) {
    return res.status(400).json({ error: 'Valid semester query parameter is required.' });
  }

  await db.read();
  const student = db.data.students.find((s) => s.id === req.user.id);
  if (!student) return res.status(404).json({ error: 'Student profile not found.' });

  const allowedSems = getUucmsSemesters(student.uucmsNo);
  if (!allowedSems) {
    return res.status(403).json({ error: 'Invalid UUCMS registration. Access denied.' });
  }

  if (!allowedSems.includes(requestedSem)) {
    return res.status(403).json({ error: `Access denied. Your UUCMS number (${student.uucmsNo}) does not allow accessing Semester ${requestedSem} quizzes.` });
  }

  const quizSet = db.data.quizSets.find((q) => q.isActive && q.semester === requestedSem);
  if (!quizSet) return res.json({ quizSet: null });

  let attempt = db.data.attempts.find((a) => a.studentId === req.user.id && a.quizSetId === quizSet.id);

  if (!attempt) {
    const seed = `${req.user.id}::${quizSet.id}`;
    const order = seededShuffle(quizSet.questions.map((q) => q.id), seed);
    attempt = {
      id: uuidv4(),
      studentId: req.user.id,
      quizSetId: quizSet.id,
      questionOrder: order,
      answers: {},
      tabSwitchCount: 0,
      status: 'in_progress',
      startedAt: Date.now(),
      submittedAt: null,
    };
    db.data.attempts.push(attempt);
    await db.write();
  }

  // Build the question list in THIS student's shuffled order
  const questionsById = Object.fromEntries(quizSet.questions.map((q) => [q.id, q]));
  const orderedQuestions = attempt.questionOrder.map((qid) => questionsById[qid]).filter(Boolean);

  res.json({
    quizSet: { id: quizSet.id, title: quizSet.title, timeLimitSec: quizSet.timeLimitSec || 72 },
    questions: orderedQuestions,
    answers: attempt.answers,
    tabSwitchCount: attempt.tabSwitchCount,
    status: attempt.status,
  });
});

// Save an answer to one question (auto-save as the student types/selects)
app.post('/api/student/quiz/:quizId/answer', requireStudent, async (req, res) => {
  const { questionId, answer } = req.body;
  await db.read();
  const attempt = db.data.attempts.find(
    (a) => a.studentId === req.user.id && a.quizSetId === req.params.quizId
  );
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Quiz already submitted' });

  attempt.answers[questionId] = answer;
  await db.write();
  res.json({ ok: true });
});

// Report a tab-switch / visibility-change event.
// After the 3rd switch, the attempt is auto-submitted.
app.post('/api/student/quiz/:quizId/tab-switch', requireStudent, async (req, res) => {
  await db.read();
  const attempt = db.data.attempts.find(
    (a) => a.studentId === req.user.id && a.quizSetId === req.params.quizId
  );
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') {
    return res.json({ ok: true, status: attempt.status, tabSwitchCount: attempt.tabSwitchCount });
  }

  attempt.tabSwitchCount += 1;

  let autoSubmitted = false;
  if (attempt.tabSwitchCount >= 3) {
    attempt.status = 'auto_submitted';
    attempt.submittedAt = Date.now();
    autoSubmitted = true;
  }

  await db.write();
  res.json({ ok: true, status: attempt.status, tabSwitchCount: attempt.tabSwitchCount, autoSubmitted });
});

// Manual submit (student clicks "Submit")
app.post('/api/student/quiz/:quizId/submit', requireStudent, async (req, res) => {
  await db.read();
  const attempt = db.data.attempts.find(
    (a) => a.studentId === req.user.id && a.quizSetId === req.params.quizId
  );
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Already submitted' });

  attempt.status = 'submitted';
  attempt.submittedAt = Date.now();
  await db.write();
  res.json({ ok: true });
});

// ---------- Serve built frontend in production ----------
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ---------- Start server ----------
initDb().then((database) => {
  db = database;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!process.env.GMAIL_USER) {
      console.log('NOTE: No GMAIL_USER configured - OTPs will be logged to console instead of emailed.');
    }
    if (TEACHER_EMAILS.length === 0) {
      console.log('WARNING: No TEACHER_EMAILS configured in .env - no one will be able to log in as teacher.');
    }
  });
});
