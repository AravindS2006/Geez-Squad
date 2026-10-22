import 'server-only';
import { getEmailPolicy } from './email-policy.mjs';
import nodemailer from 'nodemailer';
import { errorContext, logEvent } from './logger';
import { requestContext } from './request-log';
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export async function sendMail(to: string, subject: string, text: string) {
  const policy = getEmailPolicy(process.env);
  const from = process.env.EMAIL_FROM?.includes('<')
    ? process.env.EMAIL_FROM
    : `Geez Squad <${process.env.EMAIL_FROM || ''}>`;
  const started = performance.now();
  try {
    if (policy.mode === 'smtp') {
      if (
        !process.env.SMTP_HOST ||
        !process.env.SMTP_USER ||
        !process.env.SMTP_PASSWORD ||
        !process.env.EMAIL_FROM
      )
        throw new Error('Email delivery is not configured.');
      const port = Number(process.env.SMTP_PORT || 465);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST.trim(),
        port,
        secure: port === 465,
        requireTLS: true,
        auth: {
          user: process.env.SMTP_USER.trim(),
          pass:
            process.env.SMTP_HOST.trim() === 'smtp.gmail.com'
              ? process.env.SMTP_PASSWORD.replace(/\s/g, '')
              : process.env.SMTP_PASSWORD,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      });
      await transport.sendMail({ from, to, subject, text });
      logEvent('info', 'mail_sent', {
        ...requestContext.getStore(),
        provider: 'smtp',
        durationMs: Math.round(performance.now() - started),
      });
      return;
    }
    if (
      !getEmailPolicy(process.env).deliveryEnabled ||
      !process.env.RESEND_API_KEY ||
      !process.env.EMAIL_FROM
    )
      throw new Error('Email delivery is not configured.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Email delivery failed. Please retry.');
    logEvent('info', 'mail_sent', {
      ...requestContext.getStore(),
      provider: 'resend',
      durationMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    logEvent('error', 'mail_delivery_failed', {
      ...requestContext.getStore(),
      provider: policy.mode,
      ...errorContext(error),
    });
    throw new Error('Email could not be delivered. Please retry shortly.');
  }
}
