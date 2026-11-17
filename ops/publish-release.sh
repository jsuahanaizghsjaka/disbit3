#!/bin/sh
# Publish one release to staging or production. Run on the server as root:
#   tar -xOf /tmp/disbit-<sha>.tar ops/publish-release.sh | sh -s <staging|production> <sha>
# Makes an offline backup, proves it restores, switches the release, checks readiness,
# and returns to the previous release on any failure. The database is never replaced.
set -eu
mode=${1:?staging or production}
sha=${2:?release commit required}
case "$mode" in
 staging) root=/srv/disbit-staging; service=disbit-staging; port=3102 ;;
 production) root=/srv/disbit; service=disbit; port=3000 ;;
 *) exit 2 ;;
esac
case "$sha" in *[!0-9a-f]*|"") exit 2 ;; esac
release=$root/releases/$sha
previous=$(readlink -f "$root/current")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=$root/backups/pre-release-$sha-$stamp
envfile=$root/security-audit-release.env
dropin=/etc/systemd/system/$service.service.d/zzzzzzzzzz-security-audit.conf
test -f /tmp/disbit-$sha.tar
test "$release" != "$previous"
mkdir -p "$release" "$root/backups" "$(dirname "$dropin")"
tar -xf /tmp/disbit-$sha.tar -C "$release"
if [ ! -d "$release/backend/node_modules" ]; then cp -a "$previous/backend/node_modules" "$release/backend/node_modules"; fi
(cd "$release/backend" && npm ls --omit=dev >/dev/null)
umask 077
printf '%s\n' "$previous" > "$root/backups/previous-release.txt"
pid=$(systemctl show "$service" -p MainPID --value)
python3 - "$pid" "$backup" <<'PY'
import sys
pid,backup=sys.argv[1:]
env=dict(x.decode().split('=',1) for x in open('/proc/'+pid+'/environ','rb').read().split(b'\0') if b'=' in x)
open(backup+'.paths','w').write(env['DB_PATH']+'\n'+env['PROOFS_DIR']+'\n'+env.get('DELETION_JOURNAL_PATH','')+'\n')
PY
previous_env=$(cat "$envfile" 2>/dev/null || true)
switched=0
rollback() {
 result=$?
 if [ "$result" != 0 ]; then
  if [ "$switched" = 1 ]; then
   ln -sfn "$previous" "$root/current"
   if [ -n "$previous_env" ]; then printf '%s\n' "$previous_env" > "$envfile"; fi
   systemctl daemon-reload
  fi
  systemctl restart "$service"
  echo "Publication of $sha on $mode failed; previous release restored, database not replaced." >&2
 fi
}
trap rollback EXIT
systemctl stop "$service"
database=$(sed -n '1p' "$backup.paths"); media=$(sed -n '2p' "$backup.paths"); journal=$(sed -n '3p' "$backup.paths")
node "$release/scripts/backup.mjs" create "$database" "$media" "$backup" --offline
node "$release/scripts/backup.mjs" restore "$backup" "$backup-restored" --deletions "$journal"
switched=1
printf 'RELEASE_SHA=%s\n' "$sha" > "$envfile"; chmod 644 "$envfile"
test -e "$dropin" || printf '[Service]\nEnvironmentFile=%s\n' "$envfile" > "$dropin"
ln -sfn "$release" "$root/current"
systemctl daemon-reload
systemctl start "$service"
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
 if curl -fsS "http://127.0.0.1:$port/api/ready" | grep -q "$sha"; then ready=1; break; fi
 sleep 2
done
test "$ready" = 1
test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/blocking/plan")" = 401
for page in terms.html privacy.html consent.html review.html; do
 test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/$page")" = 200
done
curl -fsS "http://127.0.0.1:$port/terms.html" | grep -q '781636212757'
trap - EXIT
echo "Published $sha on $mode; backup verified: $backup-restored"
