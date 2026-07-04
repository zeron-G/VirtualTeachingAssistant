/**
 * Verification-email delivery.
 *
 * Uses Resend when `RESEND_API_KEY` is configured; otherwise falls back to
 * logging the code to the server console so the whole flow is exercisable in
 * development (and before an email provider is provisioned). The fallback NEVER
 * runs when a key is present, so it can't leak codes in production.
 */

const FROM = process.env.RESEND_FROM ?? 'VTA <onboarding@resend.dev>';

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey === undefined || apiKey === '') {
    // Dev fallback: no provider configured — surface the code in the logs.
    // eslint-disable-next-line no-console
    console.warn(`[email:dev-fallback] verification code for ${email}: ${code}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Your VTA sign-in code',
      text: `Your Virtual Teaching Assistant sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto">
        <h2 style="color:#002d72">Virtual Teaching Assistant</h2>
        <p>Your sign-in code is:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#002d72">${code}</p>
        <p style="color:#555">It expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}
