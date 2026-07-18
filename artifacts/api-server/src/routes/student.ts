import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireStudent, uuidv4 } from '../lib/auth';
import { seededShuffle } from '../lib/shuffle';

const router = Router();

function getUucmsSemesters(uucmsNo: string): number[] | null {
  if (!uucmsNo) return null;
  const clean = String(uucmsNo).trim().toUpperCase();
  const match = clean.match(/^U15BH(24|25|26)S(\d{4})$/);
  if (!match) return null;

  const batch = match[1];
  const number = parseInt(match[2], 10);
  if (number < 1 || number > 250) return null;

  if (batch === '26') return [1];
  if (batch === '25') return [3];
  if (batch === '24') return [5];
  return null;
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

// GET /api/student/quiz/active
router.get('/student/quiz/active', requireStudent, async (req, res) => {
  const requestedSem = Number(req.query.semester);
  if (!req.query.semester || isNaN(requestedSem) || requestedSem < 1 || requestedSem > 6) {
    res.status(400).json({ error: 'Valid semester query parameter is required.' });
    return;
  }

  const user = (req as any).user;

  const { data: students } = await supabase
    .from('students')
    .select('*')
    .eq('id', user.id)
    .limit(1);
  if (!students || students.length === 0) {
    res.status(404).json({ error: 'Student profile not found.' });
    return;
  }

  const student = students[0];
  const allowedSems = getUucmsSemesters(student.uucms_no);
  if (!allowedSems) {
    res.status(403).json({ error: 'Invalid UUCMS registration. Access denied.' });
    return;
  }

  if (!allowedSems.includes(requestedSem)) {
    res.status(403).json({
      error: `Access denied. Your UUCMS number (${student.uucms_no}) does not allow accessing Semester ${requestedSem} quizzes.`,
    });
    return;
  }

  const { data: quizzes } = await supabase
    .from('quiz_sets')
    .select('*')
    .eq('is_active', true)
    .eq('semester', requestedSem)
    .limit(1);
  if (!quizzes || quizzes.length === 0) {
    res.json({ quizSet: null });
    return;
  }

  const quizSet = mapQuizSet(quizzes[0]);

  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .match({ student_id: user.id, quiz_set_id: quizSet.id })
    .limit(1);
  let attempt: any = attempts && attempts.length > 0 ? attempts[0] : null;

  if (!attempt) {
    const seed = `${user.id}::${quizSet.id}`;
    const order = seededShuffle(
      quizSet.questions.map((q: any) => q.id),
      seed,
    );

    attempt = {
      id: uuidv4(),
      student_id: user.id,
      quiz_set_id: quizSet.id,
      question_order: order,
      answers: {},
      tab_switch_count: 0,
      status: 'in_progress',
      started_at: Date.now(),
    };

    const { error } = await supabase.from('attempts').insert(attempt);
    if (error) {
      req.log.error({ err: error }, 'Failed to insert attempt');
      res.status(500).json({ error: 'Database error creating attempt' });
      return;
    }
  }

  const RESULTS_RELEASE_DELAY_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
  const releaseTime = quizSet.createdAt ? quizSet.createdAt + RESULTS_RELEASE_DELAY_MS : 0;
  const resultsReleased = Date.now() >= releaseTime;

  const questionsById = Object.fromEntries(quizSet.questions.map((q: any) => [q.id, q]));
  const orderedQuestions = attempt.question_order
    .map((qid: string) => questionsById[qid])
    .filter(Boolean);

  let finalQuestions = orderedQuestions;
  if (attempt.status === 'in_progress' || !resultsReleased) {
    finalQuestions = orderedQuestions.map((q: any) => {
      const { correctAnswer, ...rest } = q;
      return rest;
    });
  }

  res.json({
    quizSet: {
      id: quizSet.id,
      title: quizSet.title,
      timeLimitSec: quizSet.timeLimitSec || 72,
      createdAt: quizSet.createdAt,
    },
    questions: finalQuestions,
    answers: attempt.answers,
    tabSwitchCount: attempt.tab_switch_count,
    status: attempt.status,
  });
});

// POST /api/student/quiz/:quizId/answer
router.post('/student/quiz/:quizId/answer', requireStudent, async (req, res) => {
  const { questionId, answer } = req.body;
  const { quizId } = req.params;
  const user = (req as any).user;

  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .match({ student_id: user.id, quiz_set_id: quizId })
    .limit(1);
  if (!attempts || attempts.length === 0) {
    res.status(404).json({ error: 'Attempt not found' });
    return;
  }

  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') {
    res.status(400).json({ error: 'Quiz already submitted' });
    return;
  }

  const newAnswers = { ...attempt.answers, [questionId]: answer };
  await supabase.from('attempts').update({ answers: newAnswers }).eq('id', attempt.id);

  res.json({ ok: true });
});

// POST /api/student/quiz/:quizId/tab-switch
router.post('/student/quiz/:quizId/tab-switch', requireStudent, async (req, res) => {
  const { quizId } = req.params;
  const user = (req as any).user;

  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .match({ student_id: user.id, quiz_set_id: quizId })
    .limit(1);
  if (!attempts || attempts.length === 0) {
    res.status(404).json({ error: 'Attempt not found' });
    return;
  }

  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') {
    res.json({ ok: true, status: attempt.status, tabSwitchCount: attempt.tab_switch_count });
    return;
  }

  const newCount = attempt.tab_switch_count + 1;
  let autoSubmitted = false;
  const updates: any = { tab_switch_count: newCount };

  if (newCount >= 3) {
    updates.status = 'auto_submitted';
    updates.submitted_at = Date.now();
    autoSubmitted = true;
  }

  await supabase.from('attempts').update(updates).eq('id', attempt.id);

  res.json({
    ok: true,
    status: updates.status || attempt.status,
    tabSwitchCount: newCount,
    autoSubmitted,
  });
});

// POST /api/student/quiz/:quizId/submit
router.post('/student/quiz/:quizId/submit', requireStudent, async (req, res) => {
  const { quizId } = req.params;
  const user = (req as any).user;

  const { data: attempts } = await supabase
    .from('attempts')
    .select('*')
    .match({ student_id: user.id, quiz_set_id: quizId })
    .limit(1);
  if (!attempts || attempts.length === 0) {
    res.status(404).json({ error: 'Attempt not found' });
    return;
  }

  const attempt = attempts[0];
  if (attempt.status !== 'in_progress') {
    res.status(400).json({ error: 'Already submitted' });
    return;
  }

  await supabase
    .from('attempts')
    .update({ status: 'submitted', submitted_at: Date.now() })
    .eq('id', attempt.id);
  res.json({ ok: true });
});

export default router;
