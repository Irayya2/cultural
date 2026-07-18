import nodemailer from 'nodemailer';
import { logger } from './logger';

let transporter: nodemailer.Transporter | null = null;

function normalizeEnvValue(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    auth: {
      user: normalizeEnvValue(process.env.GMAIL_USER),
      pass: normalizeEnvValue(process.env.GMAIL_APP_PASSWORD),
    },
    tls: {
      rejectUnauthorized: false,
    },
  } as any);

  return transporter;
}

export async function sendOtpEmail(
  toEmail: string,
  code: string,
  purpose: string,
): Promise<{ devMode: boolean }> {
  const gmailUser = normalizeEnvValue(process.env.GMAIL_USER);
  const gmailPassword = normalizeEnvValue(process.env.GMAIL_APP_PASSWORD);

  if (!gmailUser || !gmailPassword) {
    logger.info(`[DEV MODE - no email configured] OTP for ${toEmail}: ${code}`);
    return { devMode: true };
  }

  const t = getTransporter();
  await t.verify();
  logger.info('SMTP connection successful');

  const subject =
    purpose === 'teacher' ? 'Your Teacher Login OTP' : 'Your Student Login OTP';

  await t.sendMail({
    from: `"Weekly Quiz" <${gmailUser}>`,
    to: toEmail,
    subject,
    text: `Your OTP code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#1a1a2e;">Your Login Code</h2>
        <p>Use this code to log in:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #4338ca;">${code}</p>
        <p style="color:#666; font-size: 14px;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  return { devMode: false };
}
