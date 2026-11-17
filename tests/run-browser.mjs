// Runs every browser scenario against its own fresh local fixture (never a hosted server).
// Usage: node tests/run-browser.mjs [tests/browser-x.js ...]
// Needs Playwright with Chromium: `npm i -g playwright && npx playwright install chromium`.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const load = () => { try { return createRequire(import.meta.url)('playwright'); } catch { return createRequire(path.join(execSync('npm root -g').toString().trim(), 'x'))('playwright'); } };
const { chromium } = load();

// Scenarios that need something other than the default fixture for their port.
const special = {
  'browser-password-recovery.js': { skip: 'second stage of a manual flow: needs a code requested in the same session' },
  'browser-audit-remediation.js': { fixture: 'recovery-fixture.mjs', login: [2, 'recovery_two'] },
  'browser-swimming.js': { login: [1, 'beta_tester'] },
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

async function run(file) {
  const p = plan(file);
  if (p.skip) return { file, status: 'SKIP', detail: p.skip };
  const server = spawn(process.execPath, [path.join(root, 'tests', p.fixture)], { cwd: root, env: { ...process.env, PORT: p.port, ...(p.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
  const browser = await chromium.launch(); let page;
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('fixture timeout: ' + out.slice(-300))), 15000);
      const i = setInterval(() => { if (/http:\/\/localhost:\d+/.test(out)) { clearTimeout(t); clearInterval(i); resolve(); } }, 100); });
    page = await (await browser.newContext()).newPage(); page.setDefaultTimeout(8000);
    const base = `http://localhost:${p.port}`;
    await page.goto(base);
    await page.evaluate(login => {
      localStorage.clear(); localStorage.setItem('disbit_intro_v1', '1');
      if (login) { const [id, name] = login; localStorage.setItem('disbit_token_v1', String(id).repeat(64)); localStorage.setItem('disbit_owner_v1', name);
        localStorage.setItem('disbit_auth_user_v1', JSON.stringify({ id, login: name, emailVerified: true })); }
    }, p.login || null);
    await page.reload();
    if (!/page\.goto\(/.test(p.src.slice(0, 1500))) await page.goto(base);
    const scenario = (0, eval)('(' + p.src.replace(/^\s*(\/\/.*\n)+/, '') + ')');
    const result = await Promise.race([scenario(page), new Promise((_, reject) => setTimeout(() => reject(Error('timeout 150 s')), 150000))]);
    return { file, status: 'PASS', detail: result === undefined ? '' : JSON.stringify(result).slice(0, 160) };
  } catch (error) {
    const shot = `test-results/fail-${p.name}.png`;
    await page?.screenshot({ path: shot }).catch(() => {});
    const where = (String(error.message).match(/waiting for (locator\([^)]*\)|getBy[^)]*\))/) || [])[1] || '';
    return { file, status: 'FAIL', detail: String(error.message).split('\n')[0].slice(0, 300) + (where ? ' @ ' + where : '') + ' (снимок: ' + shot + ')' };
  } finally { await browser.close(); server.kill(); }
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
