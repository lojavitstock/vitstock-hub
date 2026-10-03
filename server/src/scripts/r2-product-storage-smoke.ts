import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2S3Client, validateR2ProductStorageConfig } from '../productStorage.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = resolve(projectRoot, '.env.e2e.preview.local');
if (!existsSync(envPath)) throw new Error('R2 smoke requires the ignored local Preview environment file.');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)\s*=\s*(.*?)\s*$/);
  const key = match?.[1];
  const value = match?.[2];
  if (key && value && !process.env[key]) process.env[key] = value.replace(/^['"]|['"]$/g, '');
}

const r2Config = validateR2ProductStorageConfig({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
});
const client = createR2S3Client(r2Config);
const key = `__vitstock_health/r2-preview-smoke-${randomUUID()}.txt`;
const contents = 'vitstock-r2-preview-ok';
const url = `${r2Config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
let objectMayExist = false;
let cleanupPassed = true;

const notFound = (error: unknown) => Boolean(error && typeof error === 'object' && (
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
  || ['NoSuchKey', 'NotFound'].includes((error as { name?: string }).name || '')
));

async function headExists() {
  try {
    await client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

async function publicStatus() {
  const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (response.ok) await response.arrayBuffer();
  return response.status;
}

async function run() {
  await client.send(new PutObjectCommand({
    Bucket: r2Config.bucket,
    Key: key,
    Body: contents,
    ContentType: 'text/plain',
    CacheControl: 'no-store',
  }));
  objectMayExist = true;
  process.stdout.write('PUT: PASS\n');

  assert.equal(await headExists(), true);
  process.stdout.write('EXISTS: PASS\n');

  const response = await client.send(new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }));
  assert.ok(response.Body);
  assert.equal(Buffer.from(await response.Body.transformToByteArray()).toString('utf8'), contents);
  process.stdout.write('S3 GET: PASS\n');

  const publicResponse = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  assert.equal(publicResponse.status, 200);
  assert.equal(await publicResponse.text(), contents);
  process.stdout.write('PUBLIC GET: PASS\n');

  await client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
  objectMayExist = false;
  assert.equal(await headExists(), false);
  let publicResponseAfterDelete = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    publicResponseAfterDelete = await publicStatus();
    if (publicResponseAfterDelete === 404) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  assert.equal(publicResponseAfterDelete, 404);
  process.stdout.write('DELETE: PASS\n');
  process.stdout.write('AFTER DELETE: PASS\n');
  process.stdout.write('RESULT: PASS\n');
}

try {
  await run();
} catch (error) {
  const candidate = error && typeof error === 'object'
    ? error as { name?: string; $metadata?: { httpStatusCode?: number } }
    : {};
  process.stderr.write(`R2 smoke failed (${candidate.name || 'Error'}, HTTP ${candidate.$metadata?.httpStatusCode || 'n/a'}).\n`);
  process.exitCode = 1;
} finally {
  if (objectMayExist) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
      objectMayExist = false;
    } catch {
      cleanupPassed = false;
    }
  }
  client.destroy();
  process.stdout.write(`CLEANUP: ${cleanupPassed && !objectMayExist ? 'PASS' : 'FAIL'}\n`);
}
