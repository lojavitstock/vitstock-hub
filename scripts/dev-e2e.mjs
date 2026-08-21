import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { createQaEnv, validateQaEnv, writeQaCredentials } from './qa-env.mjs';

const composeFile = 'docker-compose.qa.yml';
const npmCli = process.env.npm_execpath;
const qaEnv = createQaEnv();
validateQaEnv(qaEnv);

if (!npmCli) throw new Error('Execute o ambiente E2E por npm run dev:e2e.');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...qaEnv } });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runNpm(args) {
  run(process.execPath, [npmCli, ...args]);
}

function assertDocker() {
  const result = spawnSync('docker', ['info'], { stdio: 'inherit', env: { ...process.env, ...qaEnv } });
  if (result.status !== 0) {
    console.error('Docker daemon inacessível. E2E abortado antes de iniciar banco, backend ou frontend.');
    process.exit(1);
  }
}

async function waitForHttp(label, url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = 'sem resposta';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} não ficou disponível em ${url}: ${lastError}`);
}

function startChild(label, args) {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...qaEnv },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[e2e] ${label} encerrou com código ${code}.`);
  });
  return child;
}

assertDocker();
run('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait']);
runNpm(['--prefix', 'server', 'run', 'migrate']);
runNpm(['--prefix', 'server', 'run', 'qa:seed']);
writeQaCredentials(qaEnv);

console.log('\nVitstock Hub E2E QA isolado');
console.log('Postgres QA: iniciando em 127.0.0.1:55432/vitstock_qa');
console.log('Backend QA: iniciando em http://localhost:3001');
console.log('Frontend: iniciando em http://localhost:3000');
console.log('Evolution/Google: mock-only; produção bloqueada.\n');

const children = [
  startChild('backend', ['run', 'server:dev']),
  startChild('frontend', ['run', 'dev:frontend', '--', '--host', '127.0.0.1']),
];

const stop = () => {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
};
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });

try {
  await waitForHttp('Backend QA', 'http://localhost:3001/health');
  console.log('Backend QA: READY');
  await waitForHttp('Frontend', 'http://localhost:3000/');
  console.log('Frontend: READY');
  console.log('Postgres QA: READY (Compose --wait)');
  console.log('\nAmbiente pronto. Execute npm run test:e2e em outro terminal.');
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

await new Promise(() => undefined);
