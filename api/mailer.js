// mailer.js
// Sends OTP emails using Resend (https://resend.com).
//
// SETUP (one-time):
// 1. Sign up at https://resend.com and verify your sending domain (or use the
//    Resend sandbox address onboarding@resend.dev for testing without a domain).
// 2. Create an API key in the Resend dashboard.
// 3. Add it to your environment as RESEND_API_KEY.
// 4. Set RESEND_FROM to the address you want to send from, e.g.:
//      RESEND_FROM=Weekly Quiz <noreply@yourdomain.com>
//    If omitted, the Resend onboarding sandbox address is used automatically.

const { Resend } = require('resend');

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

async function sendOtpEmail(toEmail, code, purpose) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();

  // In local/dev mode without a real API key configured,
  // log the OTP to the console so the flow can still be tested.
  if (!apiKey) {
    console.log(`[DEV MODE - no RESEND_API_KEY configured] OTP for ${toEmail}: ${code}`);
    return { devMode: true };
  }

  const subject = purpose === 'teacher' ? 'Your Teacher Login OTP' : 'Your Student Login OTP';

  const from =
    (process.env.RESEND_FROM || '').trim() ||
    'Weekly Quiz <onboarding@resend.dev>';

  const client = getResendClient();

  const { error } = await client.emails.send({
    from,
    to: [toEmail],
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

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  return { devMode: false };
}

module.exports = { sendOtpEmail };
