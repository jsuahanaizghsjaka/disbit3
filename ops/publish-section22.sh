#!/bin/sh
# Run as root after reviewing. Uses the already staged, tested release.
set -eu
release=/srv/disbit/releases/525acdf
test -f "$release/backend/lib/account-erasure.js"
test -x /usr/bin/ffprobe
previous=$(readlink -f /srv/disbit/current)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/srv/disbit/backups/pre-section22-$stamp
restored=/srv/disbit/backups/restored-section22-$stamp
umask 077
mkdir -p /srv/disbit/backups /etc/systemd/system/disbit.service.d
test -e /srv/disbit/data/deletions.jsonl || install -m 600 -o deploy -g deploy /dev/null /srv/disbit/data/deletions.jsonl
# Record rollback target before changing code. The DB is never rolled back automatically.
printf '%s\n' "$previous" > /srv/disbit/backups/section22-previous-release.txt
trap 'systemctl start disbit' EXIT
systemctl stop disbit
/usr/bin/node "$release/scripts/backup.mjs" create /srv/disbit/data/disbit.db /srv/disbit/data/proofs "$backup" --offline
/usr/bin/node "$release/scripts/backup.mjs" restore "$backup" "$restored" --deletions /srv/disbit/data/deletions.jsonl
printf 'RELEASE_SHA=525acdf\nDELETION_JOURNAL_REQUIRED=1\nDELETION_JOURNAL_PATH=/srv/disbit/data/deletions.jsonl\n' > /etc/disbit/section22-production.env
printf '[Service]\nEnvironmentFile=/etc/disbit/section22-production.env\n' > /etc/systemd/system/disbit.service.d/zzzzzz-section22.conf
ln -sfn "$release" /srv/disbit/current
systemctl daemon-reload
systemctl start disbit
trap - EXIT
ready=0
for attempt in 1 2 3 4 5; do
 if curl --fail --silent http://127.0.0.1:3000/api/ready | grep -q '525acdf'; then ready=1;break;fi
 sleep 2
done
if [ "$ready" != 1 ]; then
 systemctl stop disbit
 ln -sfn "$previous" /srv/disbit/current
 rm -f /etc/systemd/system/disbit.service.d/zzzzzz-section22.conf
 systemctl daemon-reload
 systemctl start disbit
 echo 'New release failed readiness; code rolled back. Data was not replaced.' >&2
 exit 1
fi
echo "Published 525acdf. Verified backup: $backup"
echo 'Run production media smoke and external HTTPS checks before accepting release.'
