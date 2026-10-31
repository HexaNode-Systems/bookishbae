import { createHandler } from '@/lib/api/handler';
import { emailShell, sendEmail } from '@/lib/brevo';
import { env } from '@/lib/env';
import { newsletterSubscribeSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'public',
    body: newsletterSubscribeSchema,
    rateLimit: { name: 'newsletter', by: 'ip' },
  },
  async ({ body, admin, log }) => {
    const email = body.email.trim().toLowerCase();

    try {
      await admin()
        .from('profiles')
        .update({ marketing_opt_in: true })
        .eq('email', email);
    } catch {
      // Ignored
    }

    log.info('Newsletter subscriber recorded', { email });

    await sendEmail({
      to: email,
      subject: 'Welcome to BookishBae — Stories by Annu',
      template: 'purchase_confirmation',
      text: `Hello,\n\nThank you for subscribing to Annu's newsletter. You will be the first to know about new books and personal essays.\n\nWarm regards,\nAnnu`,
      html: emailShell({
        heading: 'Welcome to the quiet corner',
        bodyHtml:
          '<p>Thank you for subscribing. You will be the first to receive new chapters, behind-the-scenes writing notes, and new releases from Annu.</p>',
        ctaLabel: 'Visit BookishBae',
        ctaHref: env.NEXT_PUBLIC_SITE_URL,
      }),
    });

    return { ok: true, message: 'Subscribed successfully.' };
  },
);
