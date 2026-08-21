import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { createQaEnv, validateQaEnv, writeQaCredentials } from './qa-env.mjs';

const composeFile = 'docker-compose.qa.yml';
const npmCli = process.env.npm_execpath;
const qaEnv = createQaEnv();
validateQaEnv(qaEnv);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...qaEnv }, ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runNpm(args) {
  if (!npmCli) throw new Error('Execute os comandos QA por npm run qa:<comando>.');
  run(process.execPath, [npmCli, ...args]);
}

function compose(args) {
  run('docker', ['compose', '-f', composeFile, ...args]);
}

function dockerAvailable() {
  const result = spawnSync('docker', ['info'], { stdio: 'inherit', env: { ...process.env, ...qaEnv } });
  return result.status === 0;
}

function start() {
  if (!npmCli) throw new Error('Execute qa:start por npm.');
  const children = [];
  const startChild = (label, args, env = {}) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...qaEnv, ...env },
      stdio: 'inherit',
    });
    children.push(child);
    child.on('exit', (code) => { if (code && code !== 0) console.error(`[qa] ${label} encerrou com código ${code}.`); });
  };
  console.log('\nVitstock Hub QA isolado');
  console.log('Frontend: http://localhost:3000');
  console.log('API: http://localhost:3001');
  console.log('Banco: PostgreSQL local em 127.0.0.1:55432/vitstock_qa');
  console.log('Integrações Google/Evolution: mock-only; pressione Ctrl+C para encerrar.\n');
  startChild('backend', ['run', 'server:dev']);
  startChild('frontend', ['run', 'dev', '--', '--host', '127.0.0.1']);
  const stop = () => { for (const child of children) if (!child.killed) child.kill('SIGTERM'); };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
}

const command = process.argv[2];
if (command === 'setup') {
  if (!dockerAvailable()) {
    console.error('Docker daemon inacessível. QA/E2E abortado sem iniciar banco ou backend.');
    process.exit(1);
  }
  compose(['up', '-d', '--wait']);
  runNpm(['--prefix', 'server', 'run', 'migrate']);
} else if (command === 'seed') {
  runNpm(['--prefix', 'server', 'run', 'qa:seed']);
  writeQaCredentials(qaEnv);
} else if (command === 'reset') {
  if (!dockerAvailable()) {
    console.error('Docker daemon inacessível. QA/E2E abortado sem resetar banco.');
    process.exit(1);
  }
  compose(['down', '-v', '--remove-orphans']);
  compose(['up', '-d', '--wait']);
  runNpm(['--prefix', 'server', 'run', 'migrate']);
  runNpm(['--prefix', 'server', 'run', 'qa:seed']);
  writeQaCredentials(qaEnv);
} else if (command === 'start') {
  start();
} else if (command === 'stop') {
  if (!dockerAvailable()) {
    console.error('Docker daemon inacessível. Nenhum recurso QA foi alterado.');
    process.exit(1);
  }
  compose(['down', '--remove-orphans']);
} else {
  console.error('Uso: npm run qa:setup | qa:seed | qa:reset | qa:start | qa:stop');
  process.exit(1);
}
