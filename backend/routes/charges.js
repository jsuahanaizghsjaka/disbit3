/* ============================================================
   Эндпоинты журнала списаний (автоитог дня).
   Штраф деньгами списывается с ДЕПОЗИТА пользователя (lib/wallet.js):
   карта не привязывается, рекуррентных платежей нет. Не хватило денег —
   штраф остаётся неоплаченным, баланс в минус не уходит.
   ============================================================ */

import { Router } from 'express';
import { db } from '../db/db.js';
import { debit, getBalance } from '../lib/wallet.js';

const router = Router();

// строка БД → объект журнала на фронтенде
function rowToEntry(r) {
  return {
    day: r.day,
    habitId: r.habit_id,
    name: r.name,
    icon: r.icon,
    mode: r.mode,
    amount: r.amount,
    recipient: r.recipient,
    apps: JSON.parse(r.apps || '[]'),
    status: r.status
  };
}

const uid = req => req.userId;

/* Гостевого пространства больше нет. Раньше здесь стояло `req.userId || 0`, и всё
   записанное до входа падало в общую корзину user_id = 0 — а её мог прочитать
   ЛЮБОЙ запрос без токена. Регистрация в приложении обязательна, гость писать
   на сервер не должен вовсе. */
function authRequired(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Нужен аккаунт' });
  next();
}
router.use(authRequired);

// GET /api/charges — журнал пользователя (старые сначала, как на фронтенде)
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM charges WHERE user_id = ? ORDER BY day, id'
  ).all(uid(req));
  res.json(rows.map(rowToEntry));
});

/* POST /api/charges — записать пачку штрафов (автоитог за прошедшие дни).
   Дубликаты (то же обещание + день) тихо пропускаются.

   Клиент присылает ТОЛЬКО «за какое обещание и за какой день» — сумму, режим,
   получателя и название берём из своей базы. Раньше `amount` приходил в теле
   запроса и уходил прямо в debit(): с настоящими платежами это означало бы, что
   кошелёк опустошается по указке клиента, а не по условию обещания.

   Если пользователь менял размер штрафа, спишется ТЕКУЩИЙ: истории ставок мы
   не храним, а верить присланному «а тогда было столько» нельзя. */
const MAX_ENTRIES = 2000;      // автоитог за год на десяток обещаний — с запасом

// «завтра» по UTC, а не «сегодня»: телефон в UTC+12 закрывает свой вчерашний день,
// когда на сервере ещё сегодня. Сутки запаса, чтобы не отбрасывать честный итог.
function maxAllowedDay() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

router.post('/', (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  if (entries.length > MAX_ENTRIES) {
    return res.status(413).json({ error: 'Слишком много записей за раз' });
  }
  const maxDay = maxAllowedDay();

  const findHabit = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO charges (user_id, habit_id, day, name, icon, mode, amount, recipient, apps, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setStatus = db.prepare('UPDATE charges SET status = ? WHERE user_id = ? AND habit_id = ? AND day = ?');

  let added = 0, chargedKop = 0, unpaid = 0, skipped = 0;
  for (const e of entries) {
    const habitId = String(e?.habitId || '');
    const day = String(e?.day || '');
    if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > maxDay) { skipped++; continue; }

    // обещание должно быть своим и существовать: чужой habit_id ничего не спишет
    const h = findHabit.get(habitId, uid(req));
    if (!h || day < h.created_day) { skipped++; continue; }   // нет обещания или день до его создания

    const mode = h.stake_mode === 'lock' ? 'lock' : 'money';
    const amountRub = mode === 'money' ? Math.max(0, Number(h.stake_amount) || 0) : 0;

    // 'pending' только там, где реально пойдут деньги — ниже он станет charged/failed
    const r = ins.run(
      uid(req), habitId, day, h.name || '', h.icon || '',
      mode, amountRub, h.stake_recipient || null,
      mode === 'lock' ? (h.stake_apps || '[]') : '[]',
      (mode === 'money' && amountRub > 0) ? 'pending' : 'simulated'
    );
    added += r.changes;

    // Деньги списываем ТОЛЬКО за новый штраф (r.changes === 1). Не хватило
    // депозита — штраф остаётся в журнале со статусом 'failed', в минус не уводим.
    if (r.changes && mode === 'money' && amountRub > 0) {
      const kop = Math.round(amountRub * 100);
      let ok = false;
      try {
        const w = debit(uid(req), kop, {
          meta: { habitId, day, name: h.name || '', recipient: h.stake_recipient || null }
        });
        ok = !!w.ok;
      } catch (err) {
        console.error('[charges] списание:', err.message);
      }
      if (ok) chargedKop += kop; else unpaid += kop;
      setStatus.run(ok ? 'charged' : 'failed', uid(req), habitId, day);
    }
  }
  res.status(201).json({
    ok: true, added,
    skipped,                           // отброшено: чужое/удалённое обещание или кривой день
    charged: chargedKop,               // сколько реально ушло с депозита (копейки)
    unpaid,                            // не хватило денег — показать пользователю
    balance: getBalance(uid(req)).balance
  });
});

export default router;
