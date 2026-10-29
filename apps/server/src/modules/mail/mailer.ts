import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { mailConfig } from './config.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    // Relays that don't require auth (e.g. an internal SMTP relay) are allowed:
    // auth is only configured when a username is present.
    ...(mailConfig.user ? { auth: { user: mailConfig.user, pass: mailConfig.pass } } : {}),
  });
  return transporter;
}

/**
 * Send one email. Returns false (without throwing) when email is disabled, so
 * callers can treat "off" as a normal no-op. Real SMTP errors propagate to the
 * caller, which is responsible for logging them per recipient.
 */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  if (mailConfig.driver === 'off') return false;

  if (mailConfig.driver === 'log') {
    // Dev/e2e driver: render the message to the console so the flow can be
    // exercised without real credentials.
    console.info(`[mail:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return true;
  }

  await getTransporter().sendMail({
    from: mailConfig.fromName
      ? `"${mailConfig.fromName}" <${mailConfig.from}>`
      : mailConfig.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return true;
}

/** Test seam: drop the cached transport (e.g. after changing env). */
export function resetMailTransport(): void {
  transporter = null;
}
