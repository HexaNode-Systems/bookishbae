import { createHandler } from '@/lib/api/handler';
import { sendEmail } from '@/lib/brevo';
import { env } from '@/lib/env';
import { contactSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'public',
    body: contactSchema,
    rateLimit: { name: 'contact', by: 'ip' },
  },
  async ({ body, log }) => {
    log.info('Contact message received', { email: body.email, subject: body.subject });

    const adminEmail = env.EMAIL_REPLY_TO || 'hello@bookishbae.com';

    await sendEmail({
      to: adminEmail,
      subject: `[Contact Form] ${body.subject} (from ${body.name})`,
      template: 'contact_form',
      replyTo: body.email,
      text: `Name: ${body.name}\nEmail: ${body.email}\nSubject: ${body.subject}\n\nMessage:\n${body.message}`,
      html: `<p><strong>Name:</strong> ${body.name}</p><p><strong>Email:</strong> ${body.email}</p><p><strong>Subject:</strong> ${body.subject}</p><p><strong>Message:</strong></p><p>${body.message.replace(/\n/g, '<br>')}</p>`,
    });

    return { ok: true, message: 'Your message has been sent.' };
  },
);
