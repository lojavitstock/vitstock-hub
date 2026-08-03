import { createApp } from './app.js';
import { closeDatabase } from './db.js';
import { config } from './config.js';

const app = await createApp();

const shutdown = async () => {
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.PORT });
