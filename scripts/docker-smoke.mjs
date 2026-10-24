import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// Disposable, synthetic-data test. Never mounts a host directory or production DB.
const image = process.argv[2];
if (!image) throw Error('Usage: node scripts/docker-smoke.mjs <built-image>');
const name = `disbit-qa-${Date.now()}-${randomBytes(3).toString('hex')}`;
const volume = `${name}-data`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim();
const release = docker('image', 'inspect', image, '--format', '{{.Id}}').replace('sha256:', '').slice(0, 40);
const admin = randomBytes(24).toString('hex');
let createdVolume = false;
let createdContainer = false;

async function start(initialize) {
  const args = ['run', '-d', '--name', name, '-p', '127.0.0.1::3000', '-v', `${volume}:/data`];
  for (const env of ['APP_ENV=staging', 'PUBLIC_URL=https://qa.invalid', 'PAYMENTS_PROVIDER=disabled',
    'DB_PATH=/data/disbit.db', 'PROOFS_DIR=/data/proofs', `ADMIN_KEY=${admin}`, `RELEASE_SHA=${release}`,
    ...(initialize ? ['INITIALIZE_DATABASE=1'] : [])]) args.push('-e', env);
  docker(...args, image);
  createdContainer = true;
  const binding = docker('port', name, '3000/tcp');
  const base = `http://${binding}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return base;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Readiness timeout: ${docker('logs', name)}`);
}
function sql(code) {
  return docker('exec', name, 'node', '--no-warnings', '-e',
    `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/disbit.db');${code};db.close()`);
}
try {
  docker('volume', 'create', volume);
  createdVolume = true;
  docker('run', '--rm', '--user', 'root', '-v', `${volume}:/data`, image, 'chown', '1000:1000', '/data');
  const base = await start(true);
  assert.equal(docker('exec', name, 'id', '-u'), '1000');
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.environment, 'staging');
  assert.equal(health.release, release);
  sql("db.exec('CREATE TABLE qa_restart(value TEXT)'); db.prepare('INSERT INTO qa_restart VALUES (?)').run('retained')");
  docker('stop', '--time', '15', name);
  docker('rm', name);
  createdContainer = false;
  await start(false);
  assert.equal(sql("console.log(db.prepare('SELECT value FROM qa_restart').get().value)"), 'retained');
  console.log('Docker smoke PASS: non-root, hosted health/readiness, persistent SQLite after container replacement.');
} finally {
  if (createdContainer) docker('rm', '-f', name);
  if (createdVolume) docker('volume', 'rm', volume);
}
