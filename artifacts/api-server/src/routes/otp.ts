import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { sendOtpEmail } from '../lib/mailer';
import { generateOtp, createToken, OTP_EXPIRY_MS, uuidv4 } from '../lib/auth';

const router = Router();

const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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

// POST /api/otp/request
router.post('/otp/request', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    res.status(400).json({ error: 'Email and role are required' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  if (role === 'teacher' && !TEACHER_EMAILS.includes(normalizedEmail)) {
    res.status(403).json({ error: 'This email is not registered as a teacher account' });
    return;
  }

  const code = generateOtp();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  await supabase.from('otps').delete().match({ email: normalizedEmail, role, used: false });

  const { error } = await supabase.from('otps').insert({
    id: uuidv4(),
    email: normalizedEmail,
    code,
    role,
    expires_at: expiresAt,
    used: false,
  });

  if (error) {
    req.log.error({ err: error }, 'Supabase OTP insert error');
    res.status(500).json({ error: 'Failed to generate OTP in DB', details: error.message });
    return;
  }

  try {
    await sendOtpEmail(normalizedEmail, code, role);
    res.json({ ok: true, message: 'OTP sent to email' });
  } catch (err: any) {
    req.log.error({ err }, 'Failed to send OTP email');
    req.log.info(`[OTP FALLBACK] OTP for ${normalizedEmail} (${role}): ${code}`);
    res.json({
      ok: true,
      message: 'OTP generated, but email delivery failed. Check server logs for the code.',
    });
  }
});

// POST /api/otp/verify
router.post('/otp/verify', async (req, res) => {
  const { email, role, code, name, uucmsNo } = req.body;
  if (!email || !role || !code) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  let finalUucmsNo: string | undefined;

  if (role === 'student') {
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!uucmsNo || !uucmsNo.trim()) {
      res.status(400).json({ error: 'UUCMS number is required' });
      return;
    }
    const semesters = getUucmsSemesters(uucmsNo);
    if (!semesters) {
      res.status(400).json({
        error:
          'Invalid UUCMS Number format or range (Must be U15BH24S/25S/26S from 0001 to 0250)',
      });
      return;
    }
    finalUucmsNo = uucmsNo.trim().toUpperCase();
  }

  const { data: otps } = await supabase
    .from('otps')
    .select('*')
    .match({ email: normalizedEmail, role, used: false })
    .order('expires_at', { ascending: false })
    .limit(1);

  if (!otps || otps.length === 0) {
    res.status(400).json({
      error: 'No active OTP requested for this email. Please request a new one.',
    });
    return;
  }

  const otpRecord = otps[0];
  if (otpRecord.code !== String(code).trim()) {
    res.status(400).json({ error: 'Incorrect OTP' });
    return;
  }
  if (Date.now() > otpRecord.expires_at) {
    res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    return;
  }

  await supabase.from('otps').update({ used: true }).match({ id: otpRecord.id });

  let userId: string;

  if (role === 'student') {
    const { data: students } = await supabase
      .from('students')
      .select('*')
      .eq('email', normalizedEmail)
      .limit(1);

    if (!students || students.length === 0) {
      userId = uuidv4();
      await supabase.from('students').insert({
        id: userId,
        email: normalizedEmail,
        name: name.trim(),
        uucms_no: finalUucmsNo,
        created_at: Date.now(),
      });
    } else {
      userId = students[0].id;
      await supabase.from('students').update({
        name: name.trim(),
        uucms_no: finalUucmsNo,
      }).match({ id: userId });
    }
  } else {
    const { data: teachers } = await supabase
      .from('teachers')
      .select('*')
      .eq('email', normalizedEmail)
      .limit(1);

    if (!teachers || teachers.length === 0) {
      userId = uuidv4();
      await supabase.from('teachers').insert({
        id: userId,
        email: normalizedEmail,
        name: name || normalizedEmail,
      });
    } else {
      userId = teachers[0].id;
      if (name) {
        await supabase.from('teachers').update({ name: name.trim() }).match({ id: userId });
      }
    }
  }

  const tokenPayload: any = { id: userId, email: normalizedEmail, role };
  if (role === 'student') tokenPayload.uucmsNo = finalUucmsNo;

  const token = createToken(tokenPayload);
  res.json({ ok: true, token, role });
});

export default router;
