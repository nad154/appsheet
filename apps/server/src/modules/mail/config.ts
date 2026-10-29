// Outbound email configuration. Everything is optional and defaults to OFF so
// the app boots and runs safely on a machine with no SMTP credentials yet.
//
// MAIL_DRIVER=off  -> email is disabled (default)
// MAIL_DRIVER=log  -> render the email and print it, send nothing (dev/e2e)
// MAIL_DRIVER=smtp -> use the SMTP settings below; if the required ones are
//                     missing the driver degrades to 'off' with a warning.
//
// Values are read from process.env, which auth/config.ts already populated from
// apps/server/.env at import time.

export type MailDriver = 'off' | 'log' | 'smtp';

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

const rawDriver = env('MAIL_DRIVER').toLowerCase();
const requested: MailDriver = rawDriver === 'smtp' || rawDriver === 'log' ? rawDriver : 'off';

const host = env('SMTP_HOST');
const port = Number(env('SMTP_PORT') || 587);
// 465 typically uses implicit TLS; 587 uses STARTTLS (secure: false).
const secure = env('SMTP_SECURE').toLowerCase() === 'true';
const user = env('SMTP_USER');
const pass = env('SMTP_PASSWORD');
const from = env('MAIL_FROM') || user;
// No-reply display name, optional.
const fromName = env('MAIL_FROM_NAME') || 'Project Tracker';
// Used only to build the optional "Open project" link in the email.
const appBaseUrl = env('APP_BASE_URL');

let driver: MailDriver = requested;
let configWarning: string | null = null;

if (requested === 'smtp') {
  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!Number.isFinite(port) || port <= 0) missing.push('SMTP_PORT');
  if (!from) missing.push('MAIL_FROM');
  if (missing.length > 0) {
    driver = 'off';
    configWarning = `MAIL_DRIVER=smtp but ${missing.join(', ')} missing — email disabled`;
    console.warn(`[mail] ${configWarning}`);
  }
}

export const mailConfig = {
  driver,
  host,
  port,
  secure,
  user,
  pass,
  from,
  fromName,
  appBaseUrl,
} as const;

/** True when email is enabled (log driver included). */
export function isMailEnabled(): boolean {
  return mailConfig.driver !== 'off';
}

/** Diagnostics for startup logging / tests. */
export function mailConfigWarning(): string | null {
  return configWarning;
}
