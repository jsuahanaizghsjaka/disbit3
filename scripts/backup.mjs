import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

function hash(file) {
  const digest = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error('Backup must not contain symlinks');
    if (entry.isDirectory()) return files(root, relative);
    if (!entry.isFile()) throw Error('Unsupported file in backup');
    return [relative];
  }).sort();
}
function inspectDatabase(file, proofs) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('SQLite integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('SQLite foreign key check failed');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const counts = {};
    for (const { name } of tables) counts[name] = db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"','""')}"`).get().n;
    if (tables.some(t => t.name === 'proofs')) {
      for (const row of db.prepare('SELECT file FROM proofs').all()) {
        if (!row.file || row.file.includes('/') || row.file.includes('\\') || row.file === '..') throw Error('Unsafe media reference');
        if (!fs.statSync(path.join(proofs, row.file)).isFile()) throw Error('Missing proof file');
      }
    }
    return counts;
  } finally { db.close(); }
}
function newDestination(destination, sources) {
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw Error('Destination already exists; refusing to overwrite');
  const parent = fs.realpathSync(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  for (const source of sources) {
    const root = fs.realpathSync(source);
    const relative = path.relative(root, resolved);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Destination must be outside source');
  }
  fs.mkdirSync(target, { mode: 0o700 });
  return target;
}
export function verifyBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1) throw Error('Unsupported backup format');
  const actual = files(directory).filter(f => f !== 'manifest.json');
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw Error('Backup file inventory mismatch');
  for (const file of actual) {
    if (hash(path.join(directory, file)) !== manifest.files[file]) throw Error(`Checksum mismatch: ${file}`);
  }
  const counts = inspectDatabase(path.join(directory, 'disbit.db'), path.join(directory, 'proofs'));
  if (JSON.stringify(counts) !== JSON.stringify(manifest.rows)) throw Error('Database row count mismatch');
  return { ok: true, files: actual.length, createdAt: manifest.createdAt };
}
export function createBackup({ database, proofs, destination, offline = false }) {
  if (!offline) throw Error('Stop the application first, then supply --offline for a consistent DB + media snapshot');
  if (!fs.statSync(database).isFile() || !fs.statSync(proofs).isDirectory()) throw Error('Invalid source paths');
  files(proofs); // Reject symlinks before copying.
  const target = newDestination(destination, [path.dirname(database), proofs]);
  const source = new DatabaseSync(database, { readOnly: true });
  try { source.prepare('VACUUM INTO ?').run(path.join(target, 'disbit.db')); }
  finally { source.close(); }
  fs.cpSync(proofs, path.join(target, 'proofs'), { recursive: true, errorOnExist: true, force: false });
  const rows = inspectDatabase(path.join(target, 'disbit.db'), path.join(target, 'proofs'));
  const manifest = { format: 1, createdAt: new Date().toISOString(), rows, files: {} };
  for (const file of files(target)) manifest.files[file] = hash(path.join(target, file));
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return verifyBackup(target);
}
export function restoreBackup(source, destination) {
  verifyBackup(source);
  const target = newDestination(destination, [source]);
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  return verifyBackup(target);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    let result;
    if (command === 'create' && args.length === 4 && args[3] === '--offline') result = createBackup({ database: args[0], proofs: args[1], destination: args[2], offline: true });
    else if (command === 'verify' && args.length === 1) result = verifyBackup(args[0]);
    else if (command === 'restore' && args.length === 2) result = restoreBackup(args[0], args[1]);
    else throw Error('Usage: backup.mjs create DB PROOFS NEW_DIR --offline | verify DIR | restore BACKUP NEW_DIR');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
