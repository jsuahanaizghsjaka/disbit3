// Enrolment of a phone for automatic app restrictions.
// A device counts only while all of these hold: it belongs to the account, the
// session that enrolled it is still alive, and the stored consent matches the
// current disclosure text. Anything else means "no restriction" (fail open):
// an unfair lock is worse than a missed one.
import {randomUUID,createHash} from 'node:crypto';
import {db} from '../db/db.js';

export const BLOCKING_CONSENT_VERSION = 1;   // bump when the in-app disclosure text changes
export const MAX_DEVICES = 5;
export const PLAN_LEASE_MS = 2 * 60 * 60 * 1000;      // a phone that cannot reach the server stops restricting after this
export const PLAN_REFRESH_MS = 15 * 60 * 1000;
export const enforcementEnabled = () => process.env.BLOCKING_ENFORCEMENT === '1';

db.exec(`CREATE TABLE IF NOT EXISTS blocking_devices (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('android')),
 installation_id TEXT NOT NULL,
 label TEXT NOT NULL DEFAULT '',
 app_version TEXT NOT NULL DEFAULT '',
 consent_version INTEGER NOT NULL,
 consent_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL,
 last_plan_version TEXT,
 UNIQUE(user_id, installation_id));
CREATE INDEX IF NOT EXISTS idx_blocking_devices_installation ON blocking_devices(installation_id);
CREATE TABLE IF NOT EXISTS blocking_receipts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 device_id TEXT NOT NULL REFERENCES blocking_devices(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_version TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('applied','cleared','failed','service_off')),
 habit_ids TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_blocking_receipts_device ON blocking_receipts(device_id, id);`);

const INSTALLATION = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const short = (value, max) => (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

// Logout, password reset and expiry delete the session row; the device goes with it.
export function dropOrphanDevices() {
  db.prepare('DELETE FROM blocking_devices WHERE session_hash NOT IN (SELECT token FROM sessions)').run();
}

export function publicDevice(row, sessionHash) {
  return { id: row.id, platform: row.platform, label: row.label, appVersion: row.app_version,
    consentVersion: row.consent_version, consentCurrent: row.consent_version === BLOCKING_CONSENT_VERSION,
    createdAt: row.created_at, lastSeenAt: row.last_seen_at, current: row.session_hash === sessionHash };
}

export function enrollDevice({ userId, sessionHash, body, now = Date.now() }) {
  const fail = (status, error, code) => ({ status, body: { error, code } });
  if (body?.platform !== 'android') return fail(422, 'Автоматическое ограничение пока доступно только на Android', 'platform_unsupported');
  if (typeof body.installationId !== 'string' || !INSTALLATION.test(body.installationId)) return fail(400, 'Некорректный идентификатор установки', 'installation_invalid');
  if (body.consentVersion !== BLOCKING_CONSENT_VERSION) {
    return { status: 409, body: { error: 'Нужно принять актуальное раскрытие доступа', code: 'consent_outdated', requiredConsentVersion: BLOCKING_CONSENT_VERSION } };
  }
  dropOrphanDevices();
  db.exec('BEGIN IMMEDIATE');
  try {
    // The same phone under another account: the previous owner's enrolment ends here.
    db.prepare('DELETE FROM blocking_devices WHERE installation_id=? AND user_id<>?').run(body.installationId, userId);
    const existing = db.prepare('SELECT id FROM blocking_devices WHERE user_id=? AND installation_id=?').get(userId, body.installationId);
    if (!existing && db.prepare('SELECT count(*) n FROM blocking_devices WHERE user_id=?').get(userId).n >= MAX_DEVICES) {
      db.exec('ROLLBACK');
      return fail(409, 'Слишком много устройств. Отключите ненужное в настройках блокировки.', 'device_limit');
    }
    const id = existing?.id || randomUUID();
    db.prepare(`INSERT INTO blocking_devices(id,user_id,session_hash,platform,installation_id,label,app_version,consent_version,consent_at,created_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,installation_id) DO UPDATE SET session_hash=excluded.session_hash,label=excluded.label,
        app_version=excluded.app_version,consent_version=excluded.consent_version,consent_at=excluded.consent_at,last_seen_at=excluded.last_seen_at`)
      .run(id, userId, sessionHash, 'android', body.installationId, short(body.label, 60), short(body.appVersion, 20), BLOCKING_CONSENT_VERSION, now, now, now);
    db.exec('COMMIT');
    return { status: existing ? 200 : 201, body: { device: publicDevice(db.prepare('SELECT * FROM blocking_devices WHERE id=?').get(id), sessionHash), enforcement: enforcementEnabled() } };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Returns the usable device, or the reason it is not usable.
export function resolveDevice({ userId, sessionHash, deviceId }) {
  dropOrphanDevices();
  if (typeof deviceId !== 'string' || !DEVICE.test(deviceId)) return { state: 'enrollment_required' };
  const row = db.prepare('SELECT * FROM blocking_devices WHERE id=? AND user_id=?').get(deviceId, userId);
  if (!row) return { state: 'enrollment_required' };
  if (row.session_hash !== sessionHash) return { state: 'session_changed' };
  if (row.consent_version !== BLOCKING_CONSENT_VERSION) return { state: 'consent_outdated' };
  return { state: 'ok', device: row };
}

export const hasUsableDevice = userId => {
  dropOrphanDevices();
  return !!db.prepare('SELECT 1 FROM blocking_devices WHERE user_id=? AND consent_version=?').get(userId, BLOCKING_CONSENT_VERSION);
};

// Android package names only; the app itself and anything needed to call, to
// reach settings or to leave the restriction screen is never restricted.
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const NEVER = [/^io\.disbit\./, /^android$/, /^com\.android\.(settings|systemui|phone|dialer|contacts|emergency|server\.telecom|incallui|stk|providers\.)/,
  /^com\.google\.android\.(dialer|gms|packageinstaller|permissioncontroller|inputmethod\.)/, /^com\.samsung\.android\.(dialer|incallui|app\.telephonyui|honeyboard)/,
  /^com\.(miui\.home|sec\.android\.app\.launcher|google\.android\.apps\.nexuslauncher|android\.launcher3?)$/, /^com\.android\.(vending|packageinstaller|permissioncontroller)$/];
export function allowedPackages(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(name => typeof name === 'string' && name.length <= 150 && PACKAGE.test(name) && !NEVER.some(rule => rule.test(name))))].slice(0, 100);
}

export function planVersion(plan) {
  return createHash('sha256').update(JSON.stringify([plan.today, plan.windows.map(w => [w.habitId, w.startsAt, w.endsAt, w.apps])])).digest('hex').slice(0, 16);
}

export function recordReceipt({ device, body, now = Date.now() }) {
  const states = ['applied', 'cleared', 'failed', 'service_off'];
  if (!states.includes(body?.state) || typeof body.planVersion !== 'string' || !/^[0-9a-f]{16}$/.test(body.planVersion)) return false;
  const habitIds = Array.isArray(body.habitIds) ? body.habitIds.filter(id => typeof id === 'string' && id.length <= 128).slice(0, 100) : [];
  db.prepare('INSERT INTO blocking_receipts(device_id,user_id,plan_version,state,habit_ids,created_at) VALUES(?,?,?,?,?,?)')
    .run(device.id, device.user_id, body.planVersion, body.state, JSON.stringify(habitIds), now);
  db.prepare('DELETE FROM blocking_receipts WHERE device_id=? AND id NOT IN (SELECT id FROM blocking_receipts WHERE device_id=? ORDER BY id DESC LIMIT 200)').run(device.id, device.id);
  db.prepare('UPDATE blocking_devices SET last_seen_at=? WHERE id=?').run(now, device.id);
  return true;
}
