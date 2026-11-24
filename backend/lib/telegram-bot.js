/* Бот Disbit: команды, кнопки под сообщениями, очередь отправки и расписание уведомлений
   (ТЗ docs/TELEGRAM-TZ.md, раздел 6). Работает на том же сервере через webhook. */
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../db/db.js';
import { markDay } from '../routes/habits.js';
import { sendMail } from './email.js';
import {
  telegramConfig, callBot, linkByTelegramId, linkByUser, consumeLinkCode, linkTelegram, publicLink
} from './telegram.js';
import { habitsForDay, weekSummary, streakList, zoneOf, localParts, hhmmToMinutes, addDays } from './telegram-habits.js';

const esc = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const DAILY_CAP = 4;                 // несервисных сообщений в день на человека
const MAX_ATTEMPTS = 5;
const SEND_GAP_MS = 40;              // ~25 сообщений в секунду при лимите Bot API около 30
const MAX_PER_FLUSH = 400;
export const STREAK_MILESTONES = [7, 30, 100];

/* ---------- ссылки на мини-приложение ---------- */
export function appUrl(param = '') {
  const c = telegramConfig();
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(param) ? param : '';
  if (c.username) return `https://t.me/${c.username}/${c.shortName}${safe ? '?startapp=' + safe : ''}`;
  return `${c.site}/tg/${safe ? '?startapp=' + safe : ''}`;
}
const appButton = (text, param = '') => {
  const c = telegramConfig();
  return c.username ? { text, url: appUrl(param) } : { text, web_app: { url: appUrl(param) } };
};
const shareButton = (text, url, label) =>
  ({ text: label, url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` });

/* ---------- очередь ---------- */
function newAction(userId, habitId, day) {
  return Number(db.prepare('INSERT INTO telegram_actions(user_id,habit_id,day,created_at) VALUES(?,?,?,?)')
    .run(userId, habitId, day, Date.now()).lastInsertRowid);
}

export function enqueue(userId, kind, idemKey, payload, { service = false, nextAt = Date.now(), createdAt = Date.now() } = {}) {
  const link = linkByUser(userId);
  if (!link) return false;
  const result = db.prepare(`INSERT OR IGNORE INTO telegram_outbox(user_id,chat_id,kind,service,idem_key,payload,next_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(userId, link.chat_id, kind, service ? 1 : 0, idemKey, JSON.stringify(payload), nextAt, createdAt);
  return result.changes > 0;
}

function inQuiet(link, minutes) {
  const from = hhmmToMinutes(link.quiet_from), to = hhmmToMinutes(link.quiet_to);
  if (from === null || to === null || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
function minutesUntilQuietEnds(link, minutes) {
  const to = hhmmToMinutes(link.quiet_to);
  return (to - minutes + 1440) % 1440;
}
// Сообщения, за которыми стоит возможное наказание, молчание ночью не переносит (ТЗ 6: «Последний шанс»).
const QUIET_EXEMPT = new Set(['last_chance']);

async function deliver(row, link) {
  const payload = JSON.parse(row.payload);
  const params = { chat_id: row.chat_id, text: payload.text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (payload.reply_markup) params.reply_markup = payload.reply_markup;
  return callBot('sendMessage', params);
}

async function moneyEmailFallback(row) {
  const user = db.prepare('SELECT email FROM users WHERE id=?').get(row.user_id);
  if (!user || !user.email || /@telegram\.invalid$/.test(user.email)) return;
  try {
    const payload = JSON.parse(row.payload);
    await sendMail(user.email, 'Disbit — уведомление', `<p>${payload.text.replace(/<[^>]+>/g, '')}</p>`);
  } catch { console.error('[telegram] email fallback failed'); }
}

export async function flushOutbox(now = Date.now()) {
  let sent = 0;
  const due = db.prepare("SELECT * FROM telegram_outbox WHERE status='pending' AND next_at<=? ORDER BY next_at,id LIMIT ?").all(now, MAX_PER_FLUSH);
  for (const row of due) {
    const link = linkByUser(row.user_id);
    const skip = reason => db.prepare("UPDATE telegram_outbox SET status='skipped' WHERE id=?").run(row.id) && reason;
    if (!link || link.chat_id !== row.chat_id) { skip('no_link'); continue; }
    if (link.blocked_at) {
      db.prepare("UPDATE telegram_outbox SET status='failed' WHERE id=?").run(row.id);
      if (row.service) await moneyEmailFallback(row);
      continue;
    }
    if (!link.can_write) { skip('no_write'); continue; }
    if (!row.service) {
      if (link.stopped) { skip('stopped'); continue; }
      const local = localParts(zoneOf(row.user_id), now);
      if (!QUIET_EXEMPT.has(row.kind) && inQuiet(link, local.minutes)) {
        const wait = minutesUntilQuietEnds(link, local.minutes);
        if (now - row.next_at > 6 * 3600000 || wait > 12 * 60) { skip('quiet_expired'); continue; }
        db.prepare('UPDATE telegram_outbox SET next_at=? WHERE id=?').run(now + wait * 60000, row.id);
        continue;
      }
      const sentToday = db.prepare("SELECT sent_at FROM telegram_outbox WHERE user_id=? AND service=0 AND status='sent' AND sent_at>?")
        .all(row.user_id, now - 36 * 3600000).filter(r => localParts(zoneOf(row.user_id), r.sent_at).day === local.day).length;
      if (sentToday >= DAILY_CAP) { skip('daily_cap'); continue; }
    }
    const reply = await deliver(row, link);
    if (reply.ok) {
      db.prepare("UPDATE telegram_outbox SET status='sent',sent_at=?,attempts=attempts+1 WHERE id=?").run(now, row.id);
      sent++;
    } else if (reply.error_code === 429) {
      const wait = Math.max(1, Number(reply.parameters?.retry_after) || 1);
      db.prepare('UPDATE telegram_outbox SET next_at=? WHERE id=?').run(now + wait * 1000, row.id);
      break;                                                   // лимит Bot API: остальное — в следующий проход
    } else if (reply.error_code === 403) {
      db.prepare('UPDATE telegram_links SET blocked_at=? WHERE user_id=?').run(Date.now(), row.user_id);
      db.prepare("UPDATE telegram_outbox SET status='failed',attempts=attempts+1 WHERE id=?").run(row.id);
      if (row.service) await moneyEmailFallback(row);
    } else {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) db.prepare("UPDATE telegram_outbox SET status='failed',attempts=? WHERE id=?").run(attempts, row.id);
      else db.prepare('UPDATE telegram_outbox SET attempts=?,next_at=? WHERE id=?').run(attempts, Date.now() + 60000 * attempts, row.id);
    }
    await sleep(SEND_GAP_MS);
  }
  db.prepare("DELETE FROM telegram_outbox WHERE status<>'pending' AND created_at<?").run(now - 14 * 86400000);
  db.prepare('DELETE FROM telegram_actions WHERE created_at<?').run(now - 3 * 86400000);
  return sent;
}

/* ---------- тексты и кнопки ---------- */
function habitRows(userId, day, habits, { withProof = true } = {}) {
  const rows = [];
  for (const h of habits.slice(0, 8)) {
    if (h.done || h.skipped) continue;
    const id = newAction(userId, h.id, day);
    const row = [{ text: `Сделал: ${h.name.slice(0, 24)}`, callback_data: `d|${id}` }];
    if (h.minimumAction) row.push({ text: 'Минимум', callback_data: `m|${id}` });
    rows.push(row);
    if (withProof) rows.push([appButton(`Пруф: ${h.name.slice(0, 24)}`, `ck_${id}`)]);
  }
  return rows;
}
const mark = h => (h.done ? (h.minimum ? '🟡' : '✅') : h.skipped ? '⏭' : '▫️');
const habitLine = h => `${mark(h)} ${esc(h.name)}${h.streak ? ` — серия ${h.streak}` : ''}`;

export function todayMessage(userId, day, { title = 'Сегодня' } = {}) {
  const habits = habitsForDay(userId, day);
  if (!habits.length) return { text: `<b>${title}</b>\nНа сегодня обещаний нет.`, reply_markup: { inline_keyboard: [[appButton('Открыть Disbit')]] } };
  const rows = habitRows(userId, day, habits);
  rows.push([appButton('Открыть Disbit')]);
  if (habits.some(h => !h.done && !h.skipped)) rows.push([{ text: 'Пропуск дня', callback_data: `k|${newAction(userId, habits.find(h => !h.done && !h.skipped).id, day)}` }]);
  const open = habits.filter(h => !h.done && !h.skipped).length;
  return {
    text: `<b>${title}</b>\n${habits.map(habitLine).join('\n')}\n\n${open ? `Осталось отметить: ${open}` : 'Всё отмечено. Хороший день.'}`,
    reply_markup: { inline_keyboard: rows }
  };
}

const dayEndsInHours = h => `за ${h} ${h === 1 ? 'час' : 'часа'} до конца дня`;

export function buildNotification(kind, userId, day) {
  const habits = habitsForDay(userId, day);
  const open = habits.filter(h => !h.done && !h.skipped);
  if (kind === 'morning') {
    if (!habits.length) return null;
    return { text: `<b>Доброе утро</b>\nСегодня в планах:\n${habits.map(habitLine).join('\n')}`, reply_markup: { inline_keyboard: [[appButton('Открыть')]] } };
  }
  if (kind === 'evening') {
    if (!open.length) return null;
    return { text: `<b>Не отмечено</b> (${dayEndsInHours(3)})\n${open.map(h => `▫️ ${esc(h.name)}`).join('\n')}`, reply_markup: { inline_keyboard: habitRows(userId, day, open) } };
  }
  if (kind === 'last_chance') {
    const punished = open.filter(h => h.punished);
    if (!punished.length) return null;
    return { text: `<b>Последний шанс</b> (${dayEndsInHours(1)})\n${punished.map(h => `▫️ ${esc(h.name)}`).join('\n')}`, reply_markup: { inline_keyboard: habitRows(userId, day, punished) } };
  }
  return null;
}

function summaryMessage(userId, day) {
  const habits = habitsForDay(userId, day);
  if (!habits.length) return null;
  const done = habits.filter(h => h.done).length;
  return {
    text: `<b>Итог дня</b>\nВыполнено ${done} из ${habits.length}.\n${habits.map(habitLine).join('\n')}`,
    reply_markup: { inline_keyboard: [[appButton('Открыть')]] }
  };
}

/* ---------- расписание ---------- */
export function schedulerTick(now = Date.now()) {
  const links = db.prepare('SELECT * FROM telegram_links WHERE can_write=1 AND blocked_at IS NULL AND stopped=0').all();
  let queued = 0;
  for (const link of links) {
    try {
      const zone = zoneOf(link.user_id);
      const local = localParts(zone, now);
      const uid = link.user_id;
      const remind = hhmmToMinutes(link.remind_time) ?? 540;
      const put = (kind, key, build) => {
        const message = build();
        if (message && enqueue(uid, kind, key, message, { nextAt: now, createdAt: now })) queued++;
      };
      if (link.notify_morning && local.minutes >= remind && local.minutes < remind + 180)
        put('morning', `morning:${uid}:${local.day}`, () => buildNotification('morning', uid, local.day));
      if (link.notify_evening && local.minutes >= 21 * 60 && local.minutes < 22 * 60 + 30)
        put('evening', `evening:${uid}:${local.day}`, () => buildNotification('evening', uid, local.day));
      if (link.notify_last_chance && local.minutes >= 23 * 60 && local.minutes < 23 * 60 + 50)
        put('last_chance', `last:${uid}:${local.day}`, () => buildNotification('last_chance', uid, local.day));
      if (local.minutes < 3 * 60) {
        const yesterday = addDays(local.day, -1);
        if (link.notify_summary) put('summary', `summary:${uid}:${yesterday}`, () => summaryMessage(uid, yesterday));
        if (link.notify_social) queued += queueStreakMilestones(uid, yesterday, now);
      }
    } catch { console.error('[telegram] scheduler failed for one account'); }
  }
  return queued;
}

function queueStreakMilestones(userId, day, now = Date.now()) {
  const site = telegramConfig().site;
  let queued = 0;
  for (const h of habitsForDay(userId, day)) {
    if (!h.done || !STREAK_MILESTONES.includes(h.streak)) continue;
    const text = `${h.streak} дней подряд: «${h.name}». Серия держится.`;
    if (enqueue(userId, 'streak', `streak:${userId}:${h.id}:${h.streak}`, {
      text: `<b>Серия ${h.streak}</b>\n«${esc(h.name)}» — ${h.streak} дней подряд.`,
      reply_markup: { inline_keyboard: [[shareButton(text, site, 'Поделиться')]] }
    }, { nextAt: now, createdAt: now })) queued++;
  }
  return queued;
}

/* ---------- события из других частей сервера ---------- */
export function notifyProofDecision(proofId) {
  const proof = db.prepare('SELECT id,user_id,habit_name,day,status FROM proofs WHERE id=?').get(proofId);
  if (!proof || !['approved', 'rejected'].includes(proof.status)) return;
  const rejected = proof.status === 'rejected';
  enqueue(proof.user_id, 'proof', `proof:${proof.id}:${proof.status}`, {
    text: rejected ? `<b>Пруф отклонён</b>\n«${esc(proof.habit_name || 'Обещание')}» за ${proof.day}. Если вы не согласны, откройте Disbit.`
      : `<b>Пруф принят</b>\n«${esc(proof.habit_name || 'Обещание')}» за ${proof.day}.`,
    reply_markup: { inline_keyboard: [[appButton(rejected ? 'Оспорить' : 'Открыть', rejected ? `pf_${proof.id}` : '')]] }
  }, { service: true });
}

export function notifyFriendAccepted(ownerUserId, friendLogin, friendUserId) {
  const link = linkByUser(ownerUserId);
  if (!link || !link.notify_social) return;
  enqueue(ownerUserId, 'friend', `friend:${ownerUserId}:${friendUserId}`, {
    text: `<b>Друг принял приглашение</b>\n@${esc(friendLogin)} теперь с вами.`,
    reply_markup: { inline_keyboard: [[appButton('Открыть')]] }
  });
}

export function notifyPenalty(userId, { day, habitName, rubles, penaltyId }) {
  enqueue(userId, 'penalty', `penalty:${userId}:${penaltyId}`, {
    text: `<b>Начислена неустойка</b>\n«${esc(habitName)}» за ${day}: ${rubles} ₽. Оспорить можно 30 дней.`,
    reply_markup: { inline_keyboard: [[appButton('Оспорить', `pn_${penaltyId}`)]] }
  }, { service: true });
}

export function notifyAccountDeleted(chatId) {
  return callBot('sendMessage', { chat_id: chatId, text: 'Аккаунт Disbit удалён. Сообщения от бота больше не придут.' });
}

/* Новая редакция документов: не позже чем за 10 дней до вступления в силу. */
export function queueLegalNotice(text, key) {
  let queued = 0;
  for (const link of db.prepare('SELECT user_id FROM telegram_links WHERE can_write=1 AND blocked_at IS NULL').all()) {
    if (enqueue(link.user_id, 'legal', `legal:${key}:${link.user_id}`, {
      text: `<b>Новая редакция документов</b>\n${esc(text)}`,
      reply_markup: { inline_keyboard: [[{ text: 'Прочитать', url: telegramConfig().site + '/terms.html' }]] }
    }, { service: true })) queued++;
  }
  return queued;
}

/* ---------- входящие обновления ---------- */
const say = (chatId, text, reply_markup) => callBot('sendMessage', {
  chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {})
});
const today = userId => localParts(zoneOf(userId)).day;

function settingsMessage(link) {
  const s = publicLink(link);
  const on = v => (v ? '✅' : '▫️');
  return {
    text: `<b>Напоминания</b>\nУтреннее — ${esc(s.remindTime)}. Тихие часы: ${esc(s.quietFrom)}–${esc(s.quietTo)}.\nСообщения бота: ${s.stopped ? 'выключены (/start включит)' : 'включены'}.`,
    reply_markup: {
      inline_keyboard: [
        ['0700', '0800', '0900', '1000', '1200'].map(t => ({ text: `${t.slice(0, 2)}:${t.slice(2)}`, callback_data: `r|t|${t}` })),
        [{ text: `${on(s.notify.morning)} Утро`, callback_data: 'r|f|morning' }, { text: `${on(s.notify.evening)} Вечер`, callback_data: 'r|f|evening' }],
        [{ text: `${on(s.notify.lastChance)} Последний шанс`, callback_data: 'r|f|last' }, { text: `${on(s.notify.summary)} Итог дня`, callback_data: 'r|f|summary' }],
        [{ text: `${on(s.notify.social)} Друзья и серии`, callback_data: 'r|f|social' }],
        [{ text: 'Тихо 22–07', callback_data: 'r|q|2200|0700' }, { text: 'Тихо 23–08', callback_data: 'r|q|2300|0800' }, { text: 'Тихо 00–09', callback_data: 'r|q|0000|0900' }]
      ]
    }
  };
}
const FLAG = { morning: 'notify_morning', evening: 'notify_evening', last: 'notify_last_chance', summary: 'notify_summary', social: 'notify_social' };

function identityFrom(from) {
  return { id: from.id, firstName: String(from.first_name || '').slice(0, 64), username: String(from.username || '').slice(0, 32), allowsWriteToPm: true };
}

async function onStart(message, param, deps) {
  const from = message.from, chatId = message.chat.id;
  let link = linkByTelegramId(from.id);
  if (param.startsWith('link_')) {
    const userId = consumeLinkCode(param.slice(5));
    if (!userId) return say(chatId, 'Ссылка устарела или уже использована. Откройте профиль на disbit.ru и нажмите «Привязать Telegram» ещё раз.');
    const result = linkTelegram(userId, identityFrom(from), { source: 'web', eraseAccountFully: deps.eraseAccountFully });
    if (result.error) return say(chatId, esc(result.error));
    link = linkByTelegramId(from.id);
    db.prepare('UPDATE telegram_links SET chat_id=?,can_write=1,blocked_at=NULL,stopped=0 WHERE user_id=?').run(chatId, userId);
    return say(chatId, '<b>Telegram привязан</b>\nТеперь напоминания придут сюда, а отмечаться можно кнопками под сообщениями.', { inline_keyboard: [[appButton('Открыть Disbit')]] });
  }
  if (link) db.prepare('UPDATE telegram_links SET chat_id=?,can_write=1,blocked_at=NULL,stopped=0 WHERE user_id=?').run(chatId, link.user_id);
  const forward = /^(inv|pr|ch|cr|ad|web|ck)_[A-Za-z0-9_-]{1,60}$/.test(param) ? param : '';
  return say(chatId, '<b>Disbit</b>\nСказал — сделал. Обещания с ценой пропуска, а я напоминаю вовремя.\n\nКоманды: /today, /stats, /remind, /invite, /stop, /help.',
    { inline_keyboard: [[appButton('Открыть Disbit', forward)]] });
}

async function onCommand(message, command, args, deps) {
  const chatId = message.chat.id;
  if (command === 'start') return onStart(message, args.trim(), deps);
  if (command === 'help') {
    const site = telegramConfig().site;
    return say(chatId, '<b>Как работает Disbit</b>\nВы заранее обещаете делать дело и сами выбираете цену пропуска. Каждый день отмечаете выполнение, для отметки нужен пруф — фото или видео.\n\n'
      + `Оферта: ${site}/terms.html\nПолитика: ${site}/privacy\nПоддержка: disbitx1@gmail.com`);
  }
  const link = linkByTelegramId(message.from.id);
  if (!link) return say(chatId, 'Сначала откройте Disbit — аккаунт создаётся там за минуту.', { inline_keyboard: [[appButton('Открыть Disbit')]] });
  db.prepare('UPDATE telegram_links SET chat_id=?,can_write=1,blocked_at=NULL WHERE user_id=?').run(chatId, link.user_id);
  const userId = link.user_id;
  if (command === 'today') { const m = todayMessage(userId, today(userId)); return say(chatId, m.text, m.reply_markup); }
  if (command === 'stats') {
    const day = today(userId), week = weekSummary(userId, day), streaks = streakList(userId, day);
    const bits = db.prepare('SELECT balance FROM trusted_bits WHERE user_id=?').get(userId)?.balance ?? 0;
    return say(chatId, `<b>Статистика</b>\nНеделя: ${week.done} из ${week.planned} (${week.pct}%).\nБиты: ${bits}.\n\n`
      + (streaks.length ? streaks.map(s => `${esc(s.name)} — серия ${s.streak}`).join('\n') : 'Обещаний пока нет.'));
  }
  if (command === 'remind') { const m = settingsMessage(link); return say(chatId, m.text, m.reply_markup); }
  if (command === 'invite') {
    const token = db.prepare('SELECT token FROM friend_links WHERE user_id=?').get(userId)?.token;
    if (!token) return say(chatId, 'Личная ссылка появится после первого открытия вкладки «Друзья» в приложении.', { inline_keyboard: [[appButton('Открыть Disbit')]] });
    const url = appUrl('inv_' + token);
    return say(chatId, `<b>Ваше приглашение</b>\n${esc(url)}\nДруг, перешедший по ссылке, станет вашим другом сразу.`,
      { inline_keyboard: [[shareButton('Присоединяйся к Disbit: обещания с ценой пропуска.', url, 'Отправить другу')]] });
  }
  if (command === 'stop') {
    db.prepare('UPDATE telegram_links SET stopped=1 WHERE user_id=?').run(userId);
    return say(chatId, 'Сообщения бота выключены, кроме сообщений о деньгах и проверке пруфов. Включить снова — /start.');
  }
  return say(chatId, 'Неизвестная команда. Список: /help');
}

async function answer(id, text, alert = false) {
  return callBot('answerCallbackQuery', { callback_query_id: id, text: text || undefined, show_alert: alert || undefined });
}

async function refreshMessage(query, userId, day) {
  const m = todayMessage(userId, day, { title: 'Сегодня' });
  return callBot('editMessageText', {
    chat_id: query.message.chat.id, message_id: query.message.message_id, text: m.text, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: m.reply_markup
  });
}

async function onCallback(query) {
  const link = linkByTelegramId(query.from.id);
  const [op, a, b, c] = String(query.data || '').split('|');
  if (!link || !query.message) return answer(query.id, 'Откройте Disbit, чтобы продолжить');
  const userId = link.user_id;
  if (op === 'r') {                                         // настройки напоминаний
    if (a === 't' && /^(0[6-9]|1[0-2])00$/.test(b || '')) db.prepare('UPDATE telegram_links SET remind_time=? WHERE user_id=?').run(`${b.slice(0, 2)}:${b.slice(2)}`, userId);
    else if (a === 'f' && FLAG[b]) db.prepare(`UPDATE telegram_links SET ${FLAG[b]}=1-${FLAG[b]} WHERE user_id=?`).run(userId);
    else if (a === 'q' && /^\d{4}$/.test(b || '') && /^\d{4}$/.test(c || '') && hhmmToMinutes(`${b.slice(0, 2)}:${b.slice(2)}`) !== null && hhmmToMinutes(`${c.slice(0, 2)}:${c.slice(2)}`) !== null)
      db.prepare('UPDATE telegram_links SET quiet_from=?,quiet_to=? WHERE user_id=?').run(`${b.slice(0, 2)}:${b.slice(2)}`, `${c.slice(0, 2)}:${c.slice(2)}`, userId);
    else return answer(query.id);
    const m = settingsMessage(linkByUser(userId));
    await callBot('editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: m.text, parse_mode: 'HTML', reply_markup: m.reply_markup });
    return answer(query.id, 'Сохранено');
  }
  if (!['d', 'm', 'k'].includes(op)) return answer(query.id);
  const action = /^\d{1,12}$/.test(a || '') ? db.prepare('SELECT * FROM telegram_actions WHERE id=?').get(Number(a)) : null;
  if (!action || action.user_id !== userId) return answer(query.id, 'Кнопка устарела');   // нажавший обязан быть владельцем
  const day = today(userId);
  if (action.day !== day) {
    await callBot('editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } });
    return answer(query.id, 'День уже закрыт', true);
  }
  if (op !== 'k') {
    const current = habitsForDay(userId, day).find(h => h.id === action.habit_id);
    if (current?.done) { await refreshMessage(query, userId, day); return answer(query.id, 'Уже отмечено'); }
  }
  const result = markDay(userId, action.habit_id, day, op === 'k' ? { skip: true } : { done: true, minimum: op === 'm' }, day);
  if (result.status === 200) { await refreshMessage(query, userId, day); return answer(query.id, op === 'k' ? 'День пропущен' : 'Отмечено'); }
  if (result.status === 409 && /пруф/i.test(result.json.error || '')) {
    await callBot('editMessageReplyMarkup', {
      chat_id: query.message.chat.id, message_id: query.message.message_id,
      reply_markup: { inline_keyboard: [[appButton('Отправить пруф', `ck_${action.id}`)]] }
    });
    return answer(query.id, 'Нужен пруф — откройте Disbit', true);
  }
  return answer(query.id, result.json.error || 'Не получилось', true);
}

export async function handleUpdate(update, deps = {}) {
  if (update.my_chat_member?.chat?.type === 'private') {
    const status = update.my_chat_member.new_chat_member?.status;
    const link = linkByTelegramId(update.my_chat_member.from.id);
    if (link && (status === 'kicked' || status === 'left')) db.prepare('UPDATE telegram_links SET blocked_at=? WHERE user_id=?').run(Date.now(), link.user_id);
    else if (link && status === 'member') db.prepare('UPDATE telegram_links SET blocked_at=NULL,can_write=1 WHERE user_id=?').run(link.user_id);
    return;
  }
  if (update.callback_query) return onCallback(update.callback_query);
  const message = update.message;
  // Группы и каналы: бот реагирует только на свои команды и не показывает личных данных (ТЗ 6).
  if (!message || !message.from || message.from.is_bot || message.chat?.type !== 'private') return;
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(message.text || '').trim());
  if (!match) return;
  return onCommand(message, match[1].toLowerCase(), match[2] || '', deps);
}

export function randomSecret() { return randomBytes(24).toString('base64url'); }
