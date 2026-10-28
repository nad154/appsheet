import argon2 from 'argon2';
import readline from 'node:readline';
import { runWrite, checkpoint, closeDb } from './db/connection.js';
import { runRead } from './db/connection.js';
import { promptHidden } from './lib/promptHidden.js';
import { newPasswordRule } from '@tracker/shared';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(text: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(text, (answer) => resolve(answer));
  });
}

async function main() {
  try {
    if (!process.stdin.isTTY) {
      console.error('reset-password must be run in an interactive terminal');
      process.exit(1);
    }

    let email = process.argv[2];
    if (!email) {
      email = await question('Enter user email: ');
    }
    email = email.trim();

    const rows = await runRead<{ id: string; email: string; role: string; is_active: boolean }>(
      `SELECT id, email, role, is_active FROM users WHERE lower(email) = lower(?)`,
      [email],
    );
    const user = rows[0];
    if (!user) {
      console.error('User not found');
      process.exit(1);
    }
    if (!user.is_active) {
      console.error('User is inactive');
      process.exit(1);
    }

    const newPass = await promptHidden('New password: ');
    const confirmPass = await promptHidden('Confirm new password: ');

    if (newPass !== confirmPass) {
      console.error('Passwords do not match');
      process.exit(1);
    }

    const parsed = newPasswordRule.safeParse(newPass);
    if (!parsed.success) {
      console.error('Invalid password (min 8, max 128)');
      process.exit(1);
    }

    const newHash = await argon2.hash(newPass);

    await runWrite(async (ex) => {
      await ex(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);
      await ex(`UPDATE sessions SET revoked = true WHERE user_id = ?`, [user.id]);
    });

    await checkpoint();
    await closeDb();
    rl.close();
    console.log(`Password updated for ${user.email}`);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    try {
      await closeDb();
    } catch {
      // ignore
    }
    rl.close();
    process.exit(1);
  }
}

main();
