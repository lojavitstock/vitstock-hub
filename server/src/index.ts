import { createApp } from './app.js';
import { closeDatabase } from './db.js';
import { config } from './config.js';
import { runtimeBling } from './bling.js';
import { startBlingStockSyncScheduler } from './blingStockSync.js';

const stockSyncBling = runtimeBling();
const app = await createApp({ bling: stockSyncBling });
const stockSyncScheduler = startBlingStockSyncScheduler({
  enabled: config.BLING_STOCK_SYNC_ENABLED,
  ...(stockSyncBling ? { bling: stockSyncBling } : {}),
  logger: {
    info: (data, message) => app.log.info(data, message),
    warn: (data, message) => app.log.warn(data, message),
  },
});
app.addHook('preClose', async () => stockSyncScheduler.stop());

const shutdown = async () => {
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port: config.PORT });
