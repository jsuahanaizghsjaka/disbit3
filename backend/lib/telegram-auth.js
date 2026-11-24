/* Проверка подписи Telegram Mini App (initData). ТЗ, раздел 4.
   secret = HMAC_SHA256(key="WebAppData", msg=bot_token);
   hash   = HMAC_SHA256(key=secret, msg=data_check_string).
   Токен бота и сырой initData не логируются. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export class InitDataError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function verifyInitData(initData, botToken, { now = Date.now(), maxAgeSec = INIT_DATA_MAX_AGE_SEC } = {}) {
  if (!botToken) throw new InitDataError('not_configured');
  if (typeof initData !== 'string' || !initData || initData.length > 4096) throw new InitDataError('malformed');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError('bad_signature');
  params.delete('hash');
  // Поле signature (Ed25519 для сторонней проверки) в HMAC-строку не входит только у старых клиентов;
  // по документации в data_check_string участвуют все поля, кроме hash.
  const checkString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InitDataError('bad_signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new InitDataError('malformed');
  const age = Math.floor(now / 1000) - authDate;
  if (age > maxAgeSec) throw new InitDataError('expired');
  if (age < -300) throw new InitDataError('malformed');   // дата из будущего

  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch { throw new InitDataError('malformed'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new InitDataError('malformed');
  if (user.is_bot === true) throw new InitDataError('bot');   // ТЗ, раздел 10: только обычные пользователи
  return {
    user: {
      id: user.id,
      firstName: typeof user.first_name === 'string' ? user.first_name.slice(0, 64) : '',
      username: typeof user.username === 'string' ? user.username.slice(0, 32) : '',
      languageCode: typeof user.language_code === 'string' ? user.language_code.slice(0, 8) : '',
      allowsWriteToPm: user.allows_write_to_pm === true
    },
    authDate,
    startParam: sanitizeStartParam(params.get('start_param'))
  };
}

// Метка: латиница, цифры, _ и -, до 64 символов. Иное → нет метки.
export function sanitizeStartParam(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '';
}
