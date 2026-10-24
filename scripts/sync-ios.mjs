import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'ios'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
// Capacitor generates Windows separators in local Swift package references.
// Keep the generated manifest portable for Xcode and the macOS CI runner.
const manifest = path.join(root, 'ios/App/CapApp-SPM/Package.swift');
const source = readFileSync(manifest, 'utf8');
writeFileSync(manifest, source.replace(/path: "([^"]+)"/g, (_, value) => `path: "${value.replaceAll('\\', '/')}"`));
