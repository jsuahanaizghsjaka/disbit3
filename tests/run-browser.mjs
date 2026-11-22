// Runs every browser scenario against its own fresh local fixture (never a hosted server).
// Usage: node tests/run-browser.mjs [tests/browser-x.js ...]
// Needs Playwright with Chromium: `npm i -g playwright && npx playwright install chromium`.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = () => { try { return createRequire(import.meta.url)('playwright'); } catch { return createRequire(path.join(execSync('npm root -g').toString().trim(), 'x'))('playwright'); } };
const { chromium } = load();

// Scenarios that need something other than the default fixture for their port.
const special = {
  'browser-password-recovery.js': { fixture: 'recovery-fixture.mjs', login: [1, 'recovery_one'] },
  'browser-audit-remediation.js': { fixture: 'recovery-fixture.mjs', login: [2, 'recovery_two'] },
  'browser-swimming.js': { login: [1, 'beta_tester'] },
  'browser-money-live.js': { fixture: 'money-live-fixture.mjs' },
  'browser-money-terms-card.js': { fixture: 'money-live-fixture.mjs' },
  'browser-wallet-history.js': { env: { DISBIT_HISTORY_FIXTURE: '1' } },
  'browser-account-safety.cjs': { fixture: 'recovery-fixture.mjs', env: { ADMIN_KEY: 'local-review-fixture-12345678901234567890' } },
  'browser-moderation-appeal.cjs': { fixture: 'recovery-fixture.mjs', env: { ADMIN_KEY: 'local-review-fixture-12345678901234567890' } }
};

function plan(file) {
  const name = path.basename(file), src = readFileSync(path.join(root, file), 'utf8'), s = special[name] || {};
  const port = s.port || (src.match(/(?:localhost|127\.0\.0\.1):(\d{4})/) || [])[1] || '3337';
  const fixture = s.fixture || (port === '3399' ? 'sandbox-ui-fixture.mjs' : 'fixture-server.mjs');
  return { name, src, port, fixture, ...s };
}

async function withTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Timeout after ' + ms + ' ms')), ms);
  })]); } finally { clearTimeout(timer); }
}

async function run(file) {
  const p = plan(file);
  const server = spawn(process.execPath, [path.join(root, 'tests', p.fixture)], {
    cwd: root, env: { ...process.env, PORT: '0', ...(p.env || {}) }, stdio: ['ignore','pipe','pipe','ipc']
  });
  let output = '', browser, page;
  server.stdout.on('data', d => output += d);
  server.stderr.on('data', d => output += d);
  try {
    const deadline = Date.now() + 15000;
    let port, control;
    while (Date.now() < deadline) {
      port = output.match(/http:\/\/localhost:(\d+)/)?.[1];
      control = output.match(/Control port: (\d+)/)?.[1];
      if (port && (p.fixture !== 'money-live-fixture.mjs' || control)) break;
      if (server.exitCode !== null) throw Error('Fixture exited: ' + output.slice(-400));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!port || (p.fixture === 'money-live-fixture.mjs' && !control)) throw Error('Fixture readiness timeout');
    // Existing scenarios are also runnable standalone on their documented ports.
    const src = p.src.replace(/(localhost|127\.0\.0\.1):(\d{4,5})/g, (url, host, original) =>
      original === p.port ? host + ':' + port : control && original === '3422' ? host + ':' + control : url);
    browser = await chromium.launch();
    page = await (await browser.newContext()).newPage(); page.setDefaultTimeout(8000);
    const base = 'http://localhost:' + port;
    await page.goto(base);
    await page.evaluate(login => {
      localStorage.clear(); localStorage.setItem('disbit_intro_v1', '1');
      if (login) { const [id, name] = login; localStorage.setItem('disbit_token_v1', String(id).repeat(64)); localStorage.setItem('disbit_owner_v1', name);
        localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id, login: name, emailVerified: true })); }
    }, p.login || null);
    await page.reload();
    if (!/page\.goto\(/.test(p.src.slice(0, 1500))) await page.goto(base);
    let code;
    if (p.name === 'browser-password-recovery.js') {
      let receive;
      const mail = new Promise(resolve => {receive = resolve;});
      server.on('message', event => { if (event.type === 'mail') receive(event.mail); });
      await page.getByRole('link',{name:'Профиль',exact:true}).click();
      await page.getByText('Настройки',{exact:true}).filter({visible:true}).first().click();
      await page.locator('#profile-password').click();
      await page.locator('#reset-submit').click();
      const message = await withTimeout(mail, 8000);
      code = message.html.match(/<p>([0-9a-f]{64})<\/p>/)?.[1];
      if (!code) throw Error('Synthetic recovery email missing code');
    }
    const scenario = (0, eval)('(' + src.replace(/^\s*(\/\/.*\n)+/, '') + ')');
    const result = await withTimeout(scenario(page, code), 150000);
    return { file, status: 'PASS', detail: result === undefined ? '' : JSON.stringify(result).slice(0, 160) };
  } catch (error) {
    const shot = `test-results/fail-${p.name}.png`;
    await page?.screenshot({ path: shot }).catch(() => {});
    const where = (String(error.message).match(/waiting for (locator\([^)]*\)|getBy[^)]*\))/) || [])[1] || '';
    return { file, status: 'FAIL', detail: String(error.message).split('\n')[0].slice(0, 300) + (where ? ' @ ' + where : '') + ' (снимок: ' + shot + ')' };
  } finally { await browser?.close(); server.kill(); }
}

process.chdir(root);
mkdirSync('test-results', { recursive: true });
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync('tests').filter(f => /^browser-.*\.(c?js)$/.test(f)).sort().map(f => 'tests/' + f);
let failed = 0;
for (const file of files) {
  const r = await run(file); if (r.status === 'FAIL') failed++;
  console.log(`${r.status} ${r.file}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\n${files.length} scenarios, ${failed} failed`);
process.exit(failed ? 1 : 0);
