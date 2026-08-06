import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const processes = [];

function start(label, args, extraEnv) {
  if (!npmCli) throw new Error('Execute este ambiente com npm run dev:local.');

  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  processes.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[local] ${label} foi encerrado com código ${code}.`);
    }
  });
}

function stop() {
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

console.log('\nVitstock Hub local');
console.log('Interface: http://localhost:3000');
console.log('API local: http://localhost:3001');
console.log('Para encerrar, pressione Ctrl+C.\n');

start('backend', ['run', 'server:dev'], {
  NODE_ENV: 'development',
  PORT: '3001',
  FRONTEND_URL: 'http://localhost:3000',
});

start('frontend', ['run', 'dev:frontend', '--', '--host', '127.0.0.1'], {
  VITE_API_URL: 'http://localhost:3001',
  VITE_USE_MOCK_DATA: 'false',
});
