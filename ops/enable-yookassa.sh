#!/bin/sh
# Turns live YooKassa payments on (or off) for production. Run on the server as root:
#   sh /srv/disbit/current/ops/enable-yookassa.sh on  /home/deploy/.yookassa-key
#   sh /srv/disbit/current/ops/enable-yookassa.sh off
# The key file is read once and removed. The key is never printed or put on a command line.
set -eu
action=${1:?on or off}
root=/srv/disbit; service=disbit; port=3000; shop=1527679
envfile=$root/yookassa.env
dropin=/etc/systemd/system/$service.service.d/zzzzzzzzzz-yookassa.conf
mkdir -p "$(dirname "$dropin")"
umask 077

ready() {
 for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$port/api/ready" >/dev/null 2>&1; then return 0; fi
  sleep 2
 done
 return 1
}

if [ "$action" = off ]; then
 rm -f "$dropin"
 systemctl daemon-reload; systemctl restart "$service"; ready
 echo "Live payments are off (PAYMENTS_PROVIDER from the main environment)."
 exit 0
fi
test "$action" = on
keyfile=${2:?key file required}
key=$(tr -d '\r\n ' < "$keyfile"); rm -f "$keyfile"
case "$key" in live_*) ;; *) echo "Нужен боевой секретный ключ ЮKassa (начинается с live_)." >&2; exit 2 ;; esac

previous=$(cat "$envfile" 2>/dev/null || true)
previous_dropin=$(cat "$dropin" 2>/dev/null || true)
printf 'PAYMENTS_PROVIDER=yookassa\nYOOKASSA_TEST_ENABLED=0\nYOOKASSA_SHOP_ID=%s\nYOOKASSA_SECRET_KEY=%s\n' "$shop" "$key" > "$envfile.next"
chmod 600 "$envfile.next"; mv "$envfile.next" "$envfile"
printf '[Service]\nEnvironmentFile=%s\n' "$envfile" > "$dropin"; chmod 644 "$dropin"
systemctl daemon-reload; systemctl restart "$service"
if ready && curl -fsS "http://127.0.0.1:$port/api/health" | grep -q '"livePayments":true'; then
 echo "Live payments are on. Webhook for ЮKassa: https://disbit.ru/api/wallet/webhook"
 exit 0
fi
echo "Server did not start with live payments; switching back." >&2
if [ -n "$previous" ]; then printf '%s\n' "$previous" > "$envfile"; else rm -f "$envfile"; fi
if [ -n "$previous_dropin" ]; then printf '%s\n' "$previous_dropin" > "$dropin"; else rm -f "$dropin"; fi
systemctl daemon-reload; systemctl restart "$service"; ready || true
echo "Inspect service diagnostics on the server; credentials are not printed." >&2
exit 1
