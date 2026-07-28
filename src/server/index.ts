import './config/load-local-env.js';

import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = await buildApp({ config });
let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'graceful shutdown started');

  const forceExit = setTimeout(() => {
    app.log.fatal('graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'graceful shutdown failed');
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, 'server startup failed');
  await app.close();
  process.exit(1);
}
