/**
 * Transactional email through Brevo (formerly Sendinblue).
 *
 * Two rules govern this module:
 *
 *   1. Sending email never fails the request that triggered it. A buyer who has
 *      paid must land on their download page whether or not our mail provider
 *      is having an outage — the book is already in their library, and the
 *      email is a convenience. So `sendEmail` resolves rather than throws, and
 *      reports what happened in its return value.
 *
 *   2. Every attempt is recorded in `public.email_log`, including failures.
 *      When a buyer says "I never got it", that table is the answer.
 */

import { BrevoClient } from '@getbrevo/brevo';

import { env } from './env';
import { logger } from './logger';
import { createAdminClient } from './supabase/admin';

let client: BrevoClient | null = null;

function brevo(): BrevoClient {
  client ??= new BrevoClient({ apiKey: env.BREVO_API_KEY });
  return client;
}

export type EmailTemplate =
  | 'purchase_confirmation'
  | 'download_links'
  | 'refund_notice'
  | 'review_published'
  | 'contact_form'
  | 'admin_sale_alert';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always supply one; some clients prefer it and spam filters expect it. */
  text: string;
  template: EmailTemplate;
  /** Links the log row to an order, for support lookups. */
  orderId?: string | null;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  providerId?: string;
  error?: string;
}

/** Parses RFC 5322 style 'Name <email@example.com>' or bare 'email@example.com'. */
function parseSender(from: string): { name?: string; email: string } {
  const match = from.match(/^(?:(?:"?([^"]*)"?\s)?<([^>]+)>|([^<]+))$/);
  if (match) {
    const name = match[1]?.trim();
    const email = (match[2] || match[3] || from).trim();
    return name ? { name, email } : { email };
  }
  return { email: from.trim() };
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const to = params.to.trim().toLowerCase();
  const replyTo = params.replyTo ?? env.EMAIL_REPLY_TO;
  let result: SendEmailResult;

  if (env.NODE_ENV === 'test') {
    result = { sent: false, error: 'Email delivery is disabled in automated tests.' };
    await recordEmail({ to, template: params.template, subject: params.subject, orderId: params.orderId ?? null, result });
    return result;
  }

  try {
    const response = await brevo().transactionalEmails.sendTransacEmail({
      sender: parseSender(env.EMAIL_FROM),
      to: [{ email: to }],
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      headers: {
        // Stops Gmail and friends from threading unrelated receipts together.
        'X-Entity-Ref-ID': crypto.randomUUID(),
      },
    });

    const providerId = response.messageId ?? response.messageIds?.[0];
    result = { sent: true, providerId };
    logger.info('Email sent via Brevo', { template: params.template, providerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown send failure';
    result = { sent: false, error: message };
    logger.error('Brevo email send threw', error, { template: params.template });
  }

  await recordEmail({
    to,
    template: params.template,
    subject: params.subject,
    orderId: params.orderId ?? null,
    result,
  });

  return result;
}

async function recordEmail(entry: {
  to: string;
  template: EmailTemplate;
  subject: string;
  orderId: string | null;
  result: SendEmailResult;
}): Promise<void> {
  try {
    await createAdminClient()
      .from('email_log')
      .insert({
        to_email: entry.to,
        template: entry.template,
        subject: entry.subject.slice(0, 200),
        provider_id: entry.result.providerId ?? null,
        order_id: entry.orderId,
        status: entry.result.sent ? 'sent' : 'failed',
        error: entry.result.error?.slice(0, 500) ?? null,
      });
  } catch (error) {
    // The log is for us, not the buyer. A failure here is worth a line and nothing more.
    logger.warn('Could not write email_log row', { error });
  }
}

// ---------------------------------------------------------------------------
// Template shell
// ---------------------------------------------------------------------------

/**
 * Wraps body HTML in a layout that survives real email clients.
 *
 * Tables and inline styles, not flexbox: Outlook on Windows renders with Word's
 * engine and will quietly discard a modern layout. Colours are hard-coded here
 * rather than taken from the Tailwind tokens because an email has no access to
 * our stylesheet.
 */
export function emailShell(options: {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote?: string;
}): string {
  const cta =
    options.ctaLabel && options.ctaHref
      ? `<tr><td style="padding:8px 0 24px;">
           <a href="${options.ctaHref}"
              style="display:inline-block;background:#4c1e43;color:#fdf8f2;text-decoration:none;
                     padding:13px 26px;border-radius:10px;font-weight:600;font-size:15px;">
             ${options.ctaLabel}
           </a>
         </td></tr>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${options.heading}</title>
</head>
<body style="margin:0;padding:0;background:#f4ece4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4ece4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#fffdfa;border-radius:16px;
                    border:1px solid #ecdfd5;padding:36px 32px;font-family:Georgia,'Times New Roman',serif;">
        <tr><td style="padding-bottom:6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;
                       letter-spacing:.14em;text-transform:uppercase;color:#b9707b;">
          BookishBae
        </td></tr>
        <tr><td style="font-size:25px;line-height:1.25;color:#2c1b26;padding-bottom:18px;">
          ${options.heading}
        </td></tr>
        <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#453644;">
          ${options.bodyHtml}
        </td></tr>
        ${cta}
        <tr><td style="border-top:1px solid #efe3da;padding-top:18px;
                       font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a7a86;">
          ${options.footerNote ?? 'Stories that stay with you.'}<br>
          <a href="${env.NEXT_PUBLIC_SITE_URL}" style="color:#8a7a86;">bookishbae</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
