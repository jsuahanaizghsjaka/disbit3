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
chmod 600 "$envfile.next"
# A healthy application does not prove that the payment credentials work.
# Read-only provider check before replacing settings or restarting the service.
if python3 - "$envfile.next" <<'PY'
import base64, sys, urllib.request, urllib.error
with open(sys.argv[1], 'rb') as source:
    env = dict(line.rstrip(b'\r\n').split(b'=', 1) for line in source if b'=' in line)
auth = base64.b64encode(env[b'YOOKASSA_SHOP_ID'] + b':' + env[b'YOOKASSA_SECRET_KEY']).decode()
request = urllib.request.Request('https://api.yookassa.ru/v3/payments?limit=1',
    headers={'Authorization': 'Basic ' + auth})
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise RuntimeError('unexpected status')
except urllib.error.HTTPError as error:
    print('YooKassa credential check failed: HTTP ' + str(error.code) + '. Existing settings unchanged.', file=sys.stderr)
    sys.exit(1)
except Exception:
    print('YooKassa credential check unavailable. Existing settings unchanged.', file=sys.stderr)
    sys.exit(1)
print('YooKassa credentials verified (HTTP 200).')
PY
then
 mv "$envfile.next" "$envfile"
else
 rm -f "$envfile.next"
 exit 1
fi
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
