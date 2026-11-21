#!/bin/sh
set -eu
sha=6c23997
mode=${1:?staging or production}
case "$mode" in
 staging) root=/srv/disbit-staging; service=disbit-staging; port=3102 ;;
 production) root=/srv/disbit; service=disbit; port=3000 ;;
 *) exit 2 ;;
esac
release=$root/releases/$sha
previous=$(readlink -f "$root/current")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=$root/backups/pre-blocking-preview-$stamp
dropin=/etc/systemd/system/$service.service.d/zzzzzzz-blocking-preview.conf
test ! -e "$dropin"
test -f /tmp/disbit-6c23997.tar
mkdir -p "$release" "$root/backups" "$(dirname "$dropin")"
test "$release" != "$previous"
tar -xf /tmp/disbit-6c23997.tar -C "$release"
if [ ! -d "$release/backend/node_modules" ]; then cp -a "$previous/backend/node_modules" "$release/backend/node_modules"; fi
cd "$release/backend"
npm ls --omit=dev >/dev/null
umask 077
printf '%s\n' "$previous" > "$root/backups/blocking-preview-previous-release.txt"
# Back up the effective database/media paths without printing credentials.
pid=$(systemctl show "$service" -p MainPID --value)
python3 - "$pid" "$backup" "$release" <<'PY'
import sys,subprocess
pid,backup,release=sys.argv[1:]
env=dict(x.decode().split('=',1) for x in open('/proc/'+pid+'/environ','rb').read().split(b'\0') if b'=' in x)
db=env['DB_PATH'];media=env['PROOFS_DIR']
open(backup+'.paths','w').write(db+'\n'+media+'\n'+env.get('DELETION_JOURNAL_PATH','')+'\n')
PY
switched=0
rollback() {
 result=$?
 if [ "$result" != 0 ]; then
  if [ "$switched" = 1 ]; then
   ln -sfn "$previous" "$root/current"
   rm -f "$dropin"
   systemctl daemon-reload
  fi
  systemctl restart "$service"
  echo 'Publication failed; previous code restored; database not replaced.' >&2
 fi
}
trap rollback EXIT
systemctl stop "$service"
database=$(sed -n '1p' "$backup.paths")
media=$(sed -n '2p' "$backup.paths")
journal=$(sed -n '3p' "$backup.paths")
node "$release/scripts/backup.mjs" create "$database" "$media" "$backup" --offline
node "$release/scripts/backup.mjs" restore "$backup" "$backup-restored" --deletions "$journal"
switched=1
printf 'RELEASE_SHA=%s\n' "$sha" > "$root/blocking-preview-release.env"
chmod 644 "$root/blocking-preview-release.env"
printf '[Service]\nEnvironmentFile=%s/blocking-preview-release.env\n' "$root" > "$dropin"
ln -sfn "$release" "$root/current"
systemctl daemon-reload
systemctl start "$service"
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
 if curl -fsS "http://127.0.0.1:$port/api/ready" | grep -q "$sha"; then ready=1;break;fi
 sleep 2
done
test "$ready" = 1
test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/blocking/plan")" = 401
trap - EXIT
echo "Published $sha on $mode; verified restore: $backup-restored"
