import { Router } from 'express';
import ExcelJS from 'exceljs';
import { supabase } from '../lib/supabase';
import { requireTeacher, uuidv4 } from '../lib/auth';

const router = Router();

function normalizeQuizQuestion(
  question: any,
  fallbackTimeLimit = 72,
): { text: string; options: string[]; correctAnswer: string; timeLimitSec: number } {
  if (typeof question === 'string') {
    return { text: question.trim(), options: [], correctAnswer: '', timeLimitSec: fallbackTimeLimit };
  }

  const text = String(question?.text ?? '').trim();
  const options = Array.isArray(question?.options)
    ? question.options
        .map((opt: any) => String(opt ?? '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const correctAnswer = String(question?.correctAnswer ?? '').trim();

  return {
    text,
    options,
    correctAnswer,
    timeLimitSec: Number.isFinite(Number(question?.timeLimitSec))
      ? Number(question.timeLimitSec)
      : fallbackTimeLimit,
  };
}

const mapQuizSet = (q: any) => ({
  id: q.id,
  title: q.title,
  semester: q.semester,
  questions: q.questions,
  isActive: q.is_active,
  createdAt: q.created_at,
  timeLimitSec: q.questions[0]?.timeLimitSec || 72,
});

// POST /api/teacher/quiz
router.post('/teacher/quiz', requireTeacher, async (req, res) => {
  const { title, questions, semester } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: 'Title and at least one question are required' });
    return;
  }

  const semesterNum = Number(semester);
  if (!semester || isNaN(semesterNum) || semesterNum < 1 || semesterNum > 6) {
    res.status(400).json({ error: 'Valid Semester (1 to 6) is required' });
    return;
  }

  await supabase.from('quiz_sets').update({ is_active: false }).eq('semester', semesterNum);

  const normalizedQuestions = questions
    .map((q: any) => normalizeQuizQuestion(q, 72))
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
    semester: semesterNum,
    questions: normalizedQuestions,
    created_at: Date.now(),
    is_active: true,
  };

  const { error } = await supabase.from('quiz_sets').insert(quizSet);
  if (error) {
    req.log.error({ err: error }, 'Insert quiz error');
    res.status(500).json({ error: 'Failed to save quiz to database' });
    return;
  }

  res.json({ ok: true, quizSet: mapQuizSet(quizSet) });
});

// POST /api/teacher/generate-questions
router.post('/teacher/generate-questions', requireTeacher, async (req, res) => {
  const { topic, count } = req.body;
  if (!topic) {
    res.status(400).json({ error: 'Topic is required' });
    return;
  }

  const requestedCount = Math.max(parseInt(count, 10) || 5, 1);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: 'Gemini API Key is not configured on the server.' });
    return;
  }

  async function fetchQuestionBatch(batchSize: number) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Generate exactly ${batchSize} educational multiple-choice quiz questions for the topic: "${topic}". Each question must be a single, clear MCQ with exactly four options and one correct answer. Return the result strictly as a JSON array of objects in this shape: [{"text":"...","options":["...","...","...","..."],"correctAnswer":"..."}] where correctAnswer is the exact text of the correct option (must match one of the four options exactly). Keep the wording concise, relevant to the topic, and make the distractors plausible.`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error((errJson as any).error?.message || 'Failed to generate questions from Gemini API');
    }

    const data: any = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) throw new Error('Invalid response format from Gemini API.');

    const questions = JSON.parse(generatedText);
    if (!Array.isArray(questions)) throw new Error('Gemini API did not return an array of questions.');

    return questions
      .map((question: any) => {
        const text = String(question?.text ?? '').trim();
        const options = Array.isArray(question?.options)
          ? question.options.map((o: any) => String(o ?? '').trim()).filter(Boolean).slice(0, 4)
          : [];
        const correctAnswer = String(question?.correctAnswer ?? '').trim();
        return { text, options: options.length === 4 ? options : [], correctAnswer };
      })
      .filter((q: any) => q.text && q.options.length === 4);
  }

  try {
    const allQuestions: any[] = [];
    let remaining = requestedCount;
    let attempts = 0;
    const maxAttempts = Math.max(10, Math.ceil(requestedCount / 15));

    while (allQuestions.length < requestedCount && attempts < maxAttempts) {
      const batchSize = Math.min(Math.max(remaining, 1), 20);
      const batch = await fetchQuestionBatch(batchSize);
      allQuestions.push(...batch.slice(0, batchSize));
      remaining = requestedCount - allQuestions.length;
      attempts++;
    }

    res.json({ ok: true, questions: allQuestions.slice(0, requestedCount) });
  } catch (err: any) {
    req.log.error({ err }, 'Error generating questions');
    res.status(500).json({ error: 'An error occurred while generating questions.' });
  }
});

// PUT /api/teacher/quiz/:quizId  — edit title, semester, questions
router.put('/teacher/quiz/:quizId', requireTeacher, async (req, res) => {
  const { quizId } = req.params;
  const { title, questions, semester } = req.body;

  if (!title || !Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: 'Title and at least one question are required' });
    return;
  }

  const semesterNum = Number(semester);
  if (!semester || isNaN(semesterNum) || semesterNum < 1 || semesterNum > 6) {
    res.status(400).json({ error: 'Valid Semester (1 to 6) is required' });
    return;
  }

  const { data: existing } = await supabase
    .from('quiz_sets').select('id').eq('id', quizId).limit(1);
  if (!existing || existing.length === 0) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  // Preserve existing question IDs so saved student answers remain valid.
  // New questions (no id) get a fresh UUID.
  const normalizedQuestions = questions
    .map((q: any) => {
      const norm = normalizeQuizQuestion(q, 72);
      return { ...norm, id: typeof q.id === 'string' && q.id ? q.id : uuidv4() };
    })
    .filter((q) => q.text)
    .map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correctAnswer: q.correctAnswer || '',
      timeLimitSec: q.timeLimitSec || 72,
    }));

  const { error } = await supabase
    .from('quiz_sets')
    .update({ title, semester: semesterNum, questions: normalizedQuestions })
    .eq('id', quizId);

  if (error) {
    req.log.error({ err: error }, 'Update quiz error');
    res.status(500).json({ error: 'Failed to update quiz' });
    return;
  }

  const { data: updated } = await supabase
    .from('quiz_sets').select('*').eq('id', quizId).limit(1);
  res.json({ ok: true, quizSet: mapQuizSet(updated![0]) });
});

// DELETE /api/teacher/quiz/:quizId
router.delete('/teacher/quiz/:quizId', requireTeacher, async (req, res) => {
  const { quizId } = req.params;

  // Remove attempts first to satisfy any FK constraint
  await supabase.from('attempts').delete().eq('quiz_set_id', quizId);

  const { error } = await supabase.from('quiz_sets').delete().eq('id', quizId);
  if (error) {
    req.log.error({ err: error }, 'Delete quiz error');
    res.status(500).json({ error: 'Failed to delete quiz' });
    return;
  }

  res.json({ ok: true });
});

// PATCH /api/teacher/quiz/:quizId/activate — make this quiz the active one for its semester
router.patch('/teacher/quiz/:quizId/activate', requireTeacher, async (req, res) => {
  const { quizId } = req.params;

  const { data: existing } = await supabase
    .from('quiz_sets').select('id, semester').eq('id', quizId).limit(1);
  if (!existing || existing.length === 0) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  const { semester } = existing[0];
  await supabase.from('quiz_sets').update({ is_active: false }).eq('semester', semester);
  await supabase.from('quiz_sets').update({ is_active: true }).eq('id', quizId);

  res.json({ ok: true });
});

// GET /api/teacher/quiz
router.get('/teacher/quiz', requireTeacher, async (req, res) => {
  const { data: quizSets, error } = await supabase
    .from('quiz_sets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    res.status(500).json({ error: 'Failed to fetch quizzes' });
    return;
  }
  res.json({ quizSets: quizSets.map(mapQuizSet) });
});

// GET /api/teacher/quiz/:quizId/attempts
router.get('/teacher/quiz/:quizId/attempts', requireTeacher, async (req, res) => {
  const { quizId } = req.params;

  const { data: quizzes } = await supabase.from('quiz_sets').select('*').eq('id', quizId).limit(1);
  if (!quizzes || quizzes.length === 0) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  const quizSet = mapQuizSet(quizzes[0]);
  const gradableQuestions = quizSet.questions.filter((q: any) => q.correctAnswer);

  const { data: attemptsDb } = await supabase
    .from('attempts')
    .select('*, students(*)')
    .eq('quiz_set_id', quizId);

  const attempts = (attemptsDb || []).map((a: any) => {
    const score = gradableQuestions.reduce((sum: number, q: any) => {
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
      studentName: a.students?.name || 'unknown',
      studentUucmsNo: a.students?.uucms_no || 'unknown',
      score,
      gradableTotal: gradableQuestions.length,
    };
  });

  res.json({ quizSet, attempts });
});

// POST /api/teacher/quiz/:quizId/attempts/:studentId/reset
router.post('/teacher/quiz/:quizId/attempts/:studentId/reset', requireTeacher, async (req, res) => {
  const { quizId, studentId } = req.params;
  const { error } = await supabase
    .from('attempts')
    .delete()
    .match({ quiz_set_id: quizId, student_id: studentId });
  if (error) {
    res.status(500).json({ error: 'Failed to reset attempt' });
    return;
  }
  res.json({ ok: true });
});

// GET /api/teacher/quiz/:quizId/export
router.get('/teacher/quiz/:quizId/export', requireTeacher, async (req, res) => {
  const { quizId } = req.params;

  const { data: quizzes } = await supabase.from('quiz_sets').select('*').eq('id', quizId).limit(1);
  if (!quizzes || quizzes.length === 0) {
    res.status(404).json({ error: 'Quiz not found' });
    return;
  }

  const quizSet = mapQuizSet(quizzes[0]);
  const gradableQuestions = quizSet.questions.filter((q: any) => q.correctAnswer);

  const { data: attemptsDb } = await supabase
    .from('attempts')
    .select('*, students(*)')
    .eq('quiz_set_id', quizId);
  const attempts = attemptsDb || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'gcc_code_zone';

  const sheet = workbook.addWorksheet('Responses');
  sheet.columns = [
    { header: 'Student Name', key: 'name', width: 22 },
    { header: 'Student Email', key: 'email', width: 30 },
    { header: 'UUCMS No', key: 'uucmsNo', width: 20 },
    { header: 'Semester', key: 'semester', width: 12 },
    { header: 'Score', key: 'score', width: 10 },
    { header: `/ ${gradableQuestions.length}`, key: 'total', width: 8 },
    { header: 'Percentage', key: 'pct', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Tab Switches', key: 'tabSwitches', width: 14 },
    { header: 'Submitted At', key: 'submittedAt', width: 22 },
    ...quizSet.questions.map((q: any, idx: number) => ({
      header: `Q${idx + 1}: ${q.text}`,
      key: q.id,
      width: 32,
    })),
  ] as ExcelJS.Column[];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3730A3' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 22;

  ['score', 'total', 'pct'].forEach((key) => {
    sheet.getColumn(key).alignment = { horizontal: 'center' };
  });

  const sortedAttempts = [...attempts].sort((a: any, b: any) => {
    const scoreA = gradableQuestions.reduce(
      (s: number, q: any) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0),
      0,
    );
    const scoreB = gradableQuestions.reduce(
      (s: number, q: any) => s + (b.answers[q.id] === q.correctAnswer ? 1 : 0),
      0,
    );
    return scoreB - scoreA;
  });

  sortedAttempts.forEach((a: any, rowIdx: number) => {
    const student = a.students;
    const score = gradableQuestions.reduce(
      (s: number, q: any) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0),
      0,
    );
    const pct = gradableQuestions.length
      ? Math.round((score / gradableQuestions.length) * 100)
      : null;

    const rowData: any = {
      name: student ? student.name : 'unknown',
      email: student ? student.email : 'unknown',
      uucmsNo: student ? student.uucms_no : 'unknown',
      semester: quizSet.semester || '—',
      score: gradableQuestions.length ? score : '—',
      total: gradableQuestions.length ? gradableQuestions.length : '—',
      pct: pct !== null ? `${pct}%` : '—',
      status: a.status.replace(/_/g, ' '),
      tabSwitches: a.tab_switch_count,
      submittedAt: a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—',
    };

    quizSet.questions.forEach((q: any) => {
      const studentAns = a.answers[q.id] || '';
      const isCorrect = q.correctAnswer && studentAns === q.correctAnswer;
      const isWrong = q.correctAnswer && studentAns && studentAns !== q.correctAnswer;
      if (isCorrect) rowData[q.id] = `✓ ${studentAns}`;
      else if (isWrong) rowData[q.id] = `✗ ${studentAns}`;
      else rowData[q.id] = studentAns || '—';
    });

    const excelRow = sheet.addRow(rowData);
    excelRow.height = 18;

    const bgColor = rowIdx % 2 === 0 ? 'FFFAFAFA' : 'FFF3F4F6';
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });

    const scoreCell = excelRow.getCell('score');
    if (pct !== null) {
      scoreCell.font = {
        bold: true,
        color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' },
      };
    }

    const pctCell = excelRow.getCell('pct');
    if (pct !== null) {
      pctCell.font = {
        bold: true,
        color: { argb: pct >= 80 ? 'FF059669' : pct >= 50 ? 'FFD97706' : 'FFDC2626' },
      };
    }

    quizSet.questions.forEach((q: any) => {
      const studentAns = a.answers[q.id] || '';
      const isCorrect = q.correctAnswer && studentAns === q.correctAnswer;
      const isWrong = q.correctAnswer && studentAns && studentAns !== q.correctAnswer;
      const cell = excelRow.getCell(q.id);
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
      { header: '#', key: 'num', width: 6 },
      { header: 'Question', key: 'text', width: 50 },
      { header: 'Correct Answer', key: 'answer', width: 30 },
    ] as ExcelJS.Column[];
    const keyHeader = keySheet.getRow(1);
    keyHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    keyHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
    keyHeader.height = 22;

    quizSet.questions.forEach((q: any, idx: number) => {
      const row = keySheet.addRow({ num: idx + 1, text: q.text, answer: q.correctAnswer || '—' });
      row.height = 18;
      if (q.correctAnswer) {
        row.getCell('answer').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1FAE5' },
        };
        row.getCell('answer').font = { bold: true, color: { argb: 'FF065F46' } };
      }
    });
    keySheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 20 },
  ] as ExcelJS.Column[];
  const sumHeader = summarySheet.getRow(1);
  sumHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sumHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
  sumHeader.height = 22;

  const submitted = sortedAttempts.filter((a: any) => a.status !== 'in_progress');
  const scores = submitted.map((a: any) =>
    gradableQuestions.reduce(
      (s: number, q: any) => s + (a.answers[q.id] === q.correctAnswer ? 1 : 0),
      0,
    ),
  );
  const avgScore = scores.length
    ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(1)
    : '—';
  const highest = scores.length ? Math.max(...scores) : '—';
  const lowest = scores.length ? Math.min(...scores) : '—';
  const avgPct =
    scores.length && gradableQuestions.length
      ? `${Math.round((Number(avgScore) / gradableQuestions.length) * 100)}%`
      : '—';

  [
    { metric: 'Quiz Title', value: quizSet.title },
    { metric: 'Total Questions', value: quizSet.questions.length },
    { metric: 'Gradable Questions', value: gradableQuestions.length },
    { metric: 'Total Students', value: sortedAttempts.length },
    { metric: 'Submitted', value: submitted.length },
    {
      metric: 'Highest Score',
      value: gradableQuestions.length ? `${highest} / ${gradableQuestions.length}` : '—',
    },
    {
      metric: 'Lowest Score',
      value: gradableQuestions.length ? `${lowest} / ${gradableQuestions.length}` : '—',
    },
    {
      metric: 'Class Average Score',
      value: gradableQuestions.length ? `${avgScore} / ${gradableQuestions.length}` : '—',
    },
    { metric: 'Class Average %', value: avgPct },
    { metric: 'Exported At', value: new Date().toLocaleString() },
    { metric: 'Exported By', value: 'gcc_code_zone team' },
  ].forEach((item, i) => {
    const row = summarySheet.addRow(item);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: i % 2 === 0 ? 'FFF5F3FF' : 'FFFAFAFA' },
      };
    });
    row.getCell('metric').font = { bold: true };
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${quizSet.title.replace(/\s+/g, '_')}_responses.xlsx"`,
  );
  await workbook.xlsx.write(res as any);
  res.end();
});

export default router;
