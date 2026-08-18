import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const composeFile = 'docker-compose.qa.yml';
const npmCli = process.env.npm_execpath;
const qaSecret = (label) => `${label}-${randomUUID()}-${'x'.repeat(64)}`;
const qaEnv = {
  QA_MODE: 'true',
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://vitstock@127.0.0.1:55432/vitstock_qa',
  EVOLUTION_API_URL: 'http://127.0.0.1:3999',
  EVOLUTION_API_KEY: 'qa-local-disabled-key',
  EVOLUTION_INSTANCE_NAME: 'vitstock_qa_mock',
  SESSION_SECRET: qaSecret('qa-local-session'),
  WEBHOOK_SECRET: qaSecret('qa-local-webhook'),
  FRONTEND_URL: 'http://localhost:3000',
  ALLOWED_FRONTEND_ORIGINS: 'http://127.0.0.1:3000',
  GOOGLE_CLIENT_ID: 'qa-local-google-client-id-not-real',
  GOOGLE_CLIENT_SECRET: 'qa-local-google-client-secret-not-real',
  VITE_API_URL: 'http://localhost:3001',
  VITE_USE_MOCK_DATA: 'false',
};

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
  compose(['up', '-d', '--wait']);
  runNpm(['--prefix', 'server', 'run', 'migrate']);
} else if (command === 'seed') {
  runNpm(['--prefix', 'server', 'run', 'qa:seed']);
} else if (command === 'reset') {
  compose(['down', '-v', '--remove-orphans']);
  compose(['up', '-d', '--wait']);
  runNpm(['--prefix', 'server', 'run', 'migrate']);
  runNpm(['--prefix', 'server', 'run', 'qa:seed']);
} else if (command === 'start') {
  start();
} else {
  console.error('Uso: npm run qa:setup | qa:seed | qa:reset | qa:start');
  process.exit(1);
}
