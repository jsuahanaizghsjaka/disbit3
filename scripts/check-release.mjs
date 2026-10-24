import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'capacitor.config.json')));
if (config.server?.url) throw Error('Mobile release must bundle assets, not load a remote UI');
if (config.android?.allowMixedContent !== false) throw Error('Mixed content is forbidden');
const script = readFileSync(path.join(root, 'frontend/script.js'), 'utf8');
if (!script.includes("const BACKEND = 'https://disbit.ru'")) throw Error('Unexpected mobile API origin');
for (const file of readdirSync(path.join(root, 'frontend')).filter(f => /\.(js|html|css)$/.test(f))) {
  if (/https?:\/\/[^\s'"<>]*railway/i.test(readFileSync(path.join(root, 'frontend', file), 'utf8'))) throw Error(`Obsolete Railway URL in ${file}`);
}
console.log('Release asset checks passed: HTTPS API, bundled assets, no Railway endpoints');
