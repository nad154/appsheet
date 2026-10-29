// MAIL_DRIVER selection must be safe by default: with no configuration at all
// the app runs with email disabled, and a half-configured SMTP setup degrades
// to 'off' with a warning instead of crashing the server.
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/** Re-import config.ts with a clean, fully-specified set of mail env vars. */
async function loadConfig(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const key of MAIL_ENV) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./config.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('mailConfig', () => {
  it('defaults to the off driver with no credentials', async () => {
    const { mailConfig, isMailEnabled, mailConfigWarning } = await loadConfig();

    expect(mailConfig.driver).toBe('off');
    expect(isMailEnabled()).toBe(false);
    expect(mailConfigWarning()).toBeNull();
  });

  it('treats an unknown driver as off', async () => {
    const { mailConfig, isMailEnabled } = await loadConfig({ MAIL_DRIVER: 'sendmail' });

    expect(mailConfig.driver).toBe('off');
    expect(isMailEnabled()).toBe(false);
  });

  it('accepts the log driver without any SMTP settings', async () => {
    const { mailConfig, isMailEnabled, mailConfigWarning } = await loadConfig({ MAIL_DRIVER: 'log' });

    expect(mailConfig.driver).toBe('log');
    expect(isMailEnabled()).toBe(true);
    expect(mailConfigWarning()).toBeNull();
  });

  it('degrades to off with a warning when smtp settings are missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { mailConfig, isMailEnabled, mailConfigWarning } = await loadConfig({ MAIL_DRIVER: 'smtp' });

    expect(mailConfig.driver).toBe('off');
    expect(isMailEnabled()).toBe(false);
    const warning = mailConfigWarning();
    expect(warning).toContain('MAIL_DRIVER=smtp');
    expect(warning).toContain('SMTP_HOST');
    expect(warning).toContain('MAIL_FROM');
    expect(warn).toHaveBeenCalled();
  });

  it('enables smtp when host and sender are configured', async () => {
    const { mailConfig, isMailEnabled, mailConfigWarning } = await loadConfig({
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.office365.com',
      MAIL_FROM: 'no-reply@example.com',
    });

    expect(mailConfig.driver).toBe('smtp');
    expect(isMailEnabled()).toBe(true);
    expect(mailConfigWarning()).toBeNull();
    expect(mailConfig.host).toBe('smtp.office365.com');
    expect(mailConfig.from).toBe('no-reply@example.com');
    // Defaults: STARTTLS on 587, generic display name, no link base.
    expect(mailConfig.port).toBe(587);
    expect(mailConfig.secure).toBe(false);
    expect(mailConfig.fromName).toBe('Project Tracker');
    expect(mailConfig.appBaseUrl).toBe('');
  });

  it('falls back to SMTP_USER for the sender and parses port/secure/base URL', async () => {
    const { mailConfig } = await loadConfig({
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.office365.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'no-reply@example.com',
      SMTP_PASSWORD: 'secret',
      MAIL_FROM_NAME: 'Tracker',
      APP_BASE_URL: 'https://tracker.example.com',
    });

    expect(mailConfig.from).toBe('no-reply@example.com');
    expect(mailConfig.port).toBe(465);
    expect(mailConfig.secure).toBe(true);
    expect(mailConfig.fromName).toBe('Tracker');
    expect(mailConfig.appBaseUrl).toBe('https://tracker.example.com');
  });
});
