import os from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

os.userInfo = () => ({ username: 'vitstock-tests' });
createRequire(import.meta.url)('node:os').userInfo = os.userInfo;
const preload = resolve('tests/os-userinfo.cjs').replaceAll('\\', '/');
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require="${preload}"`]
  .filter(Boolean)
  .join(' ');

process.argv = [process.argv[0], process.argv[1], '--test', ...process.argv.slice(2)];

await import('../server/node_modules/tsx/dist/cli.mjs');

