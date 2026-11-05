// Real Google login on loopback, with its own persistent test DB. No credentials
// or production data are read from the repository or printed to the terminal.
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.LOCALAPPDATA) throw Error('This launcher requires Windows LOCALAPPDATA');
const root = path.join(process.env.LOCALAPPDATA, 'Disbit');
const credential = JSON.parse(readFileSync(path.join(root, 'secrets', 'google-staging-client.json'), 'utf8')).web;
if (credential?.project_id !== 'disbit-staging-20261104' || !credential.client_id || !credential.client_secret) throw Error('Staging credential is missing or invalid');
// Separate persistent databases keep first-login and password-link QA independent.
const data = path.join(root, process.argv.includes('--link-fixture') ? 'social-auth-link' : 'social-auth-local');
mkdirSync(path.join(data, 'proofs'), { recursive: true });
for (const key of ['RESEND_API_KEY', 'POSTMARK_TOKEN', 'SENDGRID_API_KEY', 'RUSENDER_API_TOKEN', 'TIMEWEB_SMTP_PASSWORD', 'ADMIN_KEY']) delete process.env[key];
Object.assign(process.env, { APP_ENV: 'development', NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3470',
  DB_PATH: path.join(data, 'disbit.db'), PROOFS_DIR: path.join(data, 'proofs'), PUBLIC_URL: 'http://127.0.0.1:3470',
  PAYMENTS_PROVIDER: 'disabled', YOOKASSA_TEST_ENABLED: '0', PASSWORD_RESET_ENABLED: '0',
  GOOGLE_OAUTH_ENABLED: '1', GOOGLE_OAUTH_CLIENT_ID: credential.client_id, GOOGLE_OAUTH_CLIENT_SECRET: credential.client_secret });
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
await import('../backend/server.js');
