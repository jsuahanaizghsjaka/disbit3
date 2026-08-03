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

const uid = req => req.userId || 0;   // гость = 0 (id никогда не достаётся юзерам)

// GET /api/charges — журнал пользователя (старые сначала, как на фронтенде)
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM charges WHERE user_id = ? ORDER BY day, id'
  ).all(uid(req));
  res.json(rows.map(rowToEntry));
});

// POST /api/charges — записать пачку штрафов (автоитог за прошедшие дни)
// Дубликаты (та же обещание + день) тихо пропускаются.
router.post('/', (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO charges (user_id, habit_id, day, name, icon, mode, amount, recipient, apps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let added = 0, chargedKop = 0, unpaid = 0;
  for (const e of entries) {
    if (!e?.habitId || !e?.day) continue;
    const amountRub = Number(e.amount) || 0;
    const r = ins.run(
      uid(req), String(e.habitId), String(e.day), e.name || '', e.icon || '',
      e.mode === 'lock' ? 'lock' : 'money',
      amountRub, e.recipient || null,
      JSON.stringify(e.apps || [])
    );
    added += r.changes;

    // Деньги списываем ТОЛЬКО за новый штраф (r.changes === 1) и только у
    // авторизованных: у гостя нет кошелька. Не хватило депозита — штраф
    // остаётся в журнале неоплаченным, в минус не уводим.
    if (r.changes && req.userId && e.mode !== 'lock' && amountRub > 0) {
      const kop = Math.round(amountRub * 100);
      try {
        const w = debit(req.userId, kop, {
          meta: { habitId: String(e.habitId), day: String(e.day),
                  name: e.name || '', recipient: e.recipient || null }
        });
        if (w.ok) chargedKop += kop;
        else unpaid += kop;
      } catch (err) {
        console.error('[charges] списание:', err.message);
        unpaid += kop;
      }
    }
  }
  res.status(201).json({
    ok: true, added,
    charged: chargedKop,               // сколько реально ушло с депозита (копейки)
    unpaid,                            // не хватило денег — показать пользователю
    balance: req.userId ? getBalance(req.userId).balance : null
  });
});

export default router;
