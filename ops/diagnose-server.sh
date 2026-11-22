#!/bin/sh
# Read-only diagnostics: disk usage, money and shared promises of given accounts.
# Usage on the server: sudo sh diagnose-server.sh <login> [<friend login> ...]
# Changes nothing. Prints no keys, tokens or card data.
set -u

echo "=== Диск ==="
df -h / | tail -1
echo
echo "--- Крупнейшие каталоги /srv ---"
du -xsh /srv/* 2>/dev/null | sort -rh | head
for root in /srv/disbit /srv/disbit-staging; do
  [ -d "$root" ] || continue
  echo
  echo "--- $root ---"
  du -xsh "$root"/* 2>/dev/null | sort -rh | head
  if [ -d "$root/backups" ]; then
    echo "бэкапов: $(find "$root/backups" -mindepth 1 -maxdepth 1 -type d | wc -l), из них *-restored: $(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name '*-restored' | wc -l)"
    echo "самые старые:"; ls -1t "$root/backups" | tail -5
  fi
  [ -d "$root/releases" ] && echo "релизов: $(ls -1 "$root/releases" | wc -l)"
done
echo
echo "--- Системное ---"
journalctl --disk-usage 2>/dev/null
du -xsh /var/log /var/cache/apt /tmp /root/.npm /home/*/.npm 2>/dev/null | sort -rh
ls -1 /tmp/disbit-*.tar 2>/dev/null | wc -l | sed 's/^/архивов выпусков в \/tmp: /'

db=/srv/disbit/data/disbit.db
for login in "$@"; do
echo
echo "=== Аккаунт $login ==="
node --no-warnings - "$db" "$login" <<'JS'
const { DatabaseSync } = require('node:sqlite');
const [db, login] = process.argv.slice(2);
const d = new DatabaseSync(db, { readOnly: true });
const q = (sql, ...a) => { try { return d.prepare(sql).all(...a); } catch (e) { return [{ error: e.message }]; } };
const u = d.prepare('SELECT id, time_zone FROM users WHERE login=?').get(login);
if (!u) { console.log('аккаунт не найден'); process.exit(0); }
const show = (title, rows) => { console.log('\n--- ' + title + ' ---'); console.table(rows); };
show('счёт (копейки)', q('SELECT balance, reserved FROM money_accounts WHERE user_id=?', u.id));
console.log('часовой пояс:', u.time_zone || '(по умолчанию Москва)');
show('обещания с деньгами', q(`SELECT id, name, stake_mode, stake_amount, stake_recipient, created_day, archived, schedule, week_target
  FROM habits WHERE user_id=? AND stake_mode='money'`, u.id));
show('принятые денежные условия', q('SELECT habit_id, effective_day, amount, week_target, accepted_at FROM money_terms WHERE user_id=?', u.id));
show('курсор расчёта', q('SELECT habit_id, last_day FROM money_settlement_cursors WHERE user_id=?', u.id));
show('неустойки', q('SELECT habit_id, day, amount, status, created_at FROM money_penalties WHERE user_id=? ORDER BY day DESC LIMIT 20', u.id));
show('пруфы за 14 дней', q("SELECT habit_id, day, status FROM proofs WHERE user_id=? AND day>=date('now','-14 days') ORDER BY day DESC", u.id));
show('отметки за 14 дней', q(`SELECT c.habit_id, c.day, c.done, c.count, c.skip FROM completions c JOIN habits h ON h.id=c.habit_id
  WHERE h.user_id=? AND h.stake_mode='money' AND c.day>=date('now','-14 days') ORDER BY c.day DESC`, u.id));
show('открытые пополнения', q("SELECT id, amount, status, provider_payment_id IS NOT NULL AS sent, created_at FROM money_payment_intents WHERE user_id=? AND status IN ('created','pending')", u.id));
// совместные обещания
show('обещания (связка buddy)', q("SELECT id, name, buddy, archived, created_day FROM habits WHERE user_id=? ORDER BY created_day DESC", u.id));
show('мои приглашения «делать вместе»', q("SELECT code, habit_id, created_at, created_at>datetime('now','-7 days') AS live FROM habit_invites WHERE owner_id=?", u.id));
show('друзья', q('SELECT u2.login, f.confirmed, f.created_at FROM friendships f JOIN users u2 ON u2.id=f.friend_id WHERE f.user_id=?', u.id));
show('заявки в друзья (исх./вх.)', q(`SELECT 'out' AS dir, u2.login FROM friend_requests r JOIN users u2 ON u2.id=r.recipient_id WHERE r.sender_id=?
  UNION ALL SELECT 'in', u2.login FROM friend_requests r JOIN users u2 ON u2.id=r.sender_id WHERE r.recipient_id=?`, u.id, u.id));
show('вход (последние сессии)', q("SELECT created_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 3", u.id));
JS
done
echo
echo "--- журнал денежных задач (последние) ---"
journalctl -u disbit --since '-3 days' --no-pager 2>/dev/null | grep '\[money\]' | tail -15
