import { parseArgs } from 'node:util';
import readline from 'node:readline';

import './config/load-local-env.js';

import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/db/database.js';
import { createAuth } from './modules/auth/auth.js';
import { bootstrapPlatformAdmin } from './modules/users/admin-bootstrap.js';

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
        finish(new Error('Administrator creation cancelled.'));
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
  if (command !== 'admin:create') {
    throw new Error('Usage: pnpm club admin:create --email <email> --name <display-name>');
  }
  const { values } = parseArgs({
    args: arguments_,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
    },
    strict: true,
  });
  if (!values.email || !values.name) {
    throw new Error('Both --email and --name are required.');
  }
  const password = process.env.CLUB_ADMIN_PASSWORD ?? (await promptHidden('Password: '));
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  try {
    const auth = createAuth({ config, database });
    const administrator = await bootstrapPlatformAdmin({
      auth,
      database,
      email: values.email,
      name: values.name,
      password,
    });
    process.stdout.write(`Created platform administrator ${administrator.email}.\n`);
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown administrator creation error.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
