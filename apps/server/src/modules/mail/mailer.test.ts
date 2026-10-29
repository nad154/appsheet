// The mailer is the only place that talks to nodemailer. 'off' must be a silent
// no-op, 'log' must render without a transport, and 'smtp' must hand the
// message to the transport exactly once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

const MAIL_ENV = [
  'MAIL_DRIVER',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
  'MAIL_FROM_NAME',
  'APP_BASE_URL',
];

async function loadMailer(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const key of MAIL_ENV) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./mailer.js');
}

const mail = {
  to: 'staff@example.com',
  subject: '[Project Tracker] Issue assigned: Website Revamp',
  text: 'Hello,',
  html: '<p>Hello,</p>',
};

beforeEach(() => {
  createTransportMock.mockReset();
  sendMailMock.mockReset();
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendMail', () => {
  it('is a no-op that returns false when the driver is off', async () => {
    const { sendMail } = await loadMailer();

    await expect(sendMail(mail)).resolves.toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('renders to the console and sends nothing in log mode', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { sendMail } = await loadMailer({ MAIL_DRIVER: 'log' });

    await expect(sendMail(mail)).resolves.toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain('staff@example.com');
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends through the SMTP transport once, with the no-reply From header', async () => {
    const { sendMail } = await loadMailer({
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.office365.com',
      SMTP_PORT: '587',
      SMTP_USER: 'no-reply@example.com',
      SMTP_PASSWORD: 'secret',
      MAIL_FROM: 'no-reply@example.com',
      MAIL_FROM_NAME: 'Project Tracker',
    });

    await expect(sendMail(mail)).resolves.toBe(true);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock.mock.calls[0][0]).toMatchObject({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: { user: 'no-reply@example.com', pass: 'secret' },
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      from: '"Project Tracker" <no-reply@example.com>',
      to: 'staff@example.com',
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  });

  it('reuses one transport for subsequent sends', async () => {
    const { sendMail } = await loadMailer({
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.office365.com',
      MAIL_FROM: 'no-reply@example.com',
    });

    await sendMail(mail);
    await sendMail(mail);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('lets SMTP errors propagate so the caller can log them per recipient', async () => {
    sendMailMock.mockRejectedValue(new Error('relay refused'));
    const { sendMail } = await loadMailer({
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.office365.com',
      MAIL_FROM: 'no-reply@example.com',
    });

    await expect(sendMail(mail)).rejects.toThrow('relay refused');
  });
});
