import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { DrizzleQueryError } from 'drizzle-orm';

import './config/load-local-env.js';

import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/db/database.js';
import { validatePassword } from './modules/auth/password.js';
import {
  bootstrapPlatformAdmin,
  resetPlatformAdminPassword,
} from './modules/users/admin-bootstrap.js';

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Set CLUB_ADMIN_PASSWORD when running without an interactive terminal.');
  }
  readline.emitKeypressEvents(process.stdin);
  process.stdout.write(prompt);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKeypress = (character: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Administrator command cancelled.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command !== 'admin:create' && command !== 'admin:reset-password') {
    throw new Error(
      'Usage: npm run club -- admin:create --username <username> --name <display-name> | admin:reset-password --username <username>',
    );
  }
  const { values } = parseArgs({
    args: arguments_,
    options: {
      username: { type: 'string' },
      name: { type: 'string' },
    },
    strict: true,
  });
  if (!values.username || (command === 'admin:create' && !values.name)) {
    throw new Error('--username is required, and admin:create also requires --name.');
  }
  const password = process.env.CLUB_ADMIN_PASSWORD ?? (await promptHidden('Password: '));
  validatePassword(password);
  if (
    process.env.CLUB_ADMIN_PASSWORD === undefined &&
    password !== (await promptHidden('Confirm password: '))
  ) {
    throw new Error('Passwords do not match.');
  }

  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  try {
    await database.checkSchema();
    if (command === 'admin:create') {
      const administrator = await bootstrapPlatformAdmin({
        database,
        username: values.username,
        name: values.name!,
        password,
      });
      process.stdout.write(`Created platform administrator ${administrator.username}.\n`);
    } else {
      await resetPlatformAdminPassword({ database, username: values.username, password });
      process.stdout.write('Administrator password reset; all sessions revoked.\n');
    }
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof DrizzleQueryError
      ? 'Administrator command failed while accessing the database; credential parameters omitted.'
      : error instanceof Error
        ? error.message
        : 'Unknown administrator command error.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
