import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | null = null;

function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
    });
  }
  return transporter;
}

/**
 * Sends a plain-text email via SMTP. The transporter is created lazily on the
 * first send so the server boots and tests run before credentials exist.
 *
 * Without SMTP credentials the send fails — except in development, where the
 * message is printed to the server console so OTP flows can be exercised
 * before Gmail creds are added.
 */
export async function sendMail({ to, subject, text }: MailMessage): Promise<void> {
  if (!isSmtpConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[mailer] dev fallback (no SMTP credentials) -> ${to}\nSubject: ${subject}\n\n${text}`);
      return;
    }
    throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Email service is not configured.');
  }

  await getTransporter().sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to,
    subject,
    text
  });
}