/* Telegram: конфигурация, Bot API, привязки и аккаунты (ТЗ docs/TELEGRAM-TZ.md, разделы 4 и 9).
   Токен бота и секрет вебхука — только из окружения, нигде не логируются. */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { db } from '../db/db.js';
import { recordConsent } from './legal.js';
import { financialState } from './account-erasure.js';

export const telegramConfig = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  secret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  username: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
  shortName: process.env.TELEGRAM_MINIAPP_SHORTNAME || 'app',
  apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  site: (process.env.PUBLIC_URL || 'https://disbit.ru').replace(/\/$/, '')
});
export const telegramEnabled = () => { const c = telegramConfig(); return !!(c.token && c.secret); };

/* Вызов Bot API. Возвращает тело ответа Telegram ({ok, result} или {ok:false, error_code, ...}).
   URL содержит токен, поэтому ни он, ни ошибки сети не печатаются. */
export async function callBot(method, params = {}) {
  const { token, apiBase } = telegramConfig();
  if (!token) return { ok: false, error_code: 0, description: 'not_configured' };
  try {
    const response = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: AbortSignal.timeout(15000)
    });
    try { return await response.json(); } catch { return { ok: false, error_code: response.status, description: 'bad_response' }; }
  } catch { return { ok: false, error_code: 0, description: 'network' }; }
}

export const placeholderEmail = telegramId => `tg${telegramId}@telegram.invalid`;
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => Date.now();

export const linkByTelegramId = id => db.prepare('SELECT * FROM telegram_links WHERE telegram_id=?').get(id);
export const linkByUser = userId => db.prepare('SELECT * FROM telegram_links WHERE user_id=?').get(userId);
const logLink = (userId, oldId, newId, event) =>
  db.prepare('INSERT INTO telegram_link_log(user_id,old_telegram_id,new_telegram_id,event,at) VALUES(?,?,?,?,?)').run(userId, oldId ?? null, newId ?? null, event, now());

/* Аккаунт, у которого нет почты и входа другим способом: его данные живут только в Telegram. */
export function isTelegramOnly(userId) {
  const user = db.prepare('SELECT email FROM users WHERE id=?').get(userId);
  if (!user || !/^tg\d+@telegram\.invalid$/.test(user.email)) return false;
  return !db.prepare('SELECT 1 FROM social_identities WHERE user_id=?').get(userId);
}
/* Войти без Telegram можно, если есть настоящая почта или Google. */
export const hasOtherLogin = userId => !isTelegramOnly(userId);

function pickLogin(identity) {
  const fallback = 'tg' + identity.id;
  const candidate = identity.username.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  if (candidate.length >= 3 && !db.prepare('SELECT 1 FROM users WHERE login=?').get(candidate)) return candidate;
  return fallback;
}

/* Первый вход: аккаунт без почты, согласие с источником 'telegram'. */
export function createTelegramAccount(identity, { source = '', hashPassword }) {
  const password = hashPassword(randomBytes(32).toString('base64url'));
  db.exec('BEGIN IMMEDIATE');
  try {
    const login = pickLogin(identity);
    const created = db.prepare('INSERT INTO users(login,email,pass_hash,pass_salt,email_verified) VALUES(?,?,?,?,0)')
      .run(login, placeholderEmail(identity.id), password.hash, password.salt);
    const userId = Number(created.lastInsertRowid);
    recordConsent(db, userId, 'telegram');
    db.prepare(`INSERT INTO telegram_links(user_id,telegram_id,chat_id,can_write,source,first_name,created_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(userId, identity.id, identity.id, identity.allowsWriteToPm ? 1 : 0, source.slice(0, 64), identity.firstName, now(), now());
    logLink(userId, null, identity.id, 'created');
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function touchLink(identity) {
  const link = linkByTelegramId(identity.id);
  if (!link) return null;
  db.prepare(`UPDATE telegram_links SET last_seen_at=?, first_name=?,
    can_write=CASE WHEN ?=1 THEN 1 ELSE can_write END,
    blocked_at=CASE WHEN ?=1 THEN NULL ELSE blocked_at END WHERE user_id=?`)
    .run(now(), identity.firstName || link.first_name, identity.allowsWriteToPm ? 1 : 0, identity.allowsWriteToPm ? 1 : 0, link.user_id);
  return link;
}

/* Привязать Telegram к существующему аккаунту.
   Возвращает { ok:true } или { error, status } — ошибки без деталей, пригодных для перебора. */
export function linkTelegram(userId, identity, { source = '', confirmReplace = false, eraseAccountFully } = {}) {
  const existing = linkByTelegramId(identity.id);
  if (existing && existing.user_id === userId) { touchLink(identity); return { ok: true, unchanged: true }; }
  if (existing) {
    // Telegram уже привязан к другому аккаунту.
    if (!isTelegramOnly(existing.user_id)) return { status: 409, error: 'Этот Telegram уже привязан к другому аккаунту Disbit. Отвяжите его там и повторите.' };
    const fin = financialState(db, existing.user_id);
    if (fin.pending || fin.history) return { status: 409, error: 'На аккаунте, созданном в Telegram, есть деньги или платежи. Привязка запрещена до возврата. Поддержка: disbitx1@gmail.com.' };
    const hasData = db.prepare('SELECT 1 FROM habits WHERE user_id=? LIMIT 1').get(existing.user_id);
    if (hasData && confirmReplace !== true) {
      return { status: 409, needConfirm: true, error: 'Останется аккаунт с почтой, данные Telegram-аккаунта будут удалены.' };
    }
    const doomed = db.prepare('SELECT * FROM users WHERE id=?').get(existing.user_id);
    db.prepare('DELETE FROM telegram_links WHERE user_id=?').run(existing.user_id);
    logLink(existing.user_id, identity.id, null, 'replaced_by_account:' + userId);
    eraseAccountFully(doomed);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const own = linkByUser(userId);
    if (own) {
      db.prepare('DELETE FROM telegram_links WHERE user_id=?').run(userId);
      logLink(userId, own.telegram_id, identity.id, 'replaced');
    } else logLink(userId, null, identity.id, 'linked');
    db.prepare(`INSERT INTO telegram_links(user_id,telegram_id,chat_id,can_write,source,first_name,created_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(userId, identity.id, identity.id, identity.allowsWriteToPm ? 1 : 0, source.slice(0, 64), identity.firstName, now(), now());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { ok: true };
}

export function unlinkTelegram(userId) {
  if (!hasOtherLogin(userId)) return { status: 409, error: 'Сначала добавьте почту или войдите через Google: без этого аккаунт будет потерян.' };
  const link = linkByUser(userId);
  if (!link) return { ok: true };
  db.prepare('DELETE FROM telegram_links WHERE user_id=?').run(userId);
  db.prepare("UPDATE telegram_outbox SET status='skipped' WHERE user_id=? AND status='pending'").run(userId);
  logLink(userId, link.telegram_id, null, 'unlinked');
  return { ok: true };
}

/* Коды привязки с сайта: одноразовые, 10 минут, в базе только хеш. */
export function issueLinkCode(userId) {
  const code = String(randomInt(10 ** 9, 10 ** 10)) + randomBytes(3).toString('hex');   // 16 знаков, цифры+hex: латиница и цифры
  db.prepare('DELETE FROM telegram_link_codes WHERE user_id=? OR expires_at<?').run(userId, now());
  db.prepare('INSERT INTO telegram_link_codes(code_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(code), userId, now() + 10 * 60000);
  return code;
}
export function consumeLinkCode(code) {
  if (typeof code !== 'string' || !/^[a-z0-9]{16}$/.test(code)) return null;
  const row = db.prepare('DELETE FROM telegram_link_codes WHERE code_hash=? AND expires_at>? RETURNING user_id').get(digest(code), now());
  return row ? row.user_id : null;
}

export const SETTING_FIELDS = ['remind_time', 'quiet_from', 'quiet_to', 'notify_morning', 'notify_evening', 'notify_last_chance', 'notify_summary', 'notify_social', 'stopped'];
export function publicLink(link) {
  if (!link) return null;
  return {
    canWrite: !!link.can_write && !link.blocked_at, blocked: !!link.blocked_at, stopped: !!link.stopped,
    remindTime: link.remind_time, quietFrom: link.quiet_from, quietTo: link.quiet_to,
    notify: { morning: !!link.notify_morning, evening: !!link.notify_evening, lastChance: !!link.notify_last_chance, summary: !!link.notify_summary, social: !!link.notify_social },
    writeAskedAt: link.write_asked_at || null
  };
}
