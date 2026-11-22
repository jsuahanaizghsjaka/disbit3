#!/bin/sh
# Disk cleanup on the server. Default: dry run (prints what would be removed).
#   sudo sh cleanup-server.sh            — report only
#   sudo sh cleanup-server.sh --apply    — remove
# Never touches data/ (database, proofs), yookassa.env, the current release,
# the previous release or the newest backups.
set -u
apply=0; [ "${1:-}" = "--apply" ] && apply=1
KEEP_RELEASES=4      # newest releases kept besides current and previous
KEEP_BACKUPS=5       # newest pre-release backups kept (the "-restored" copies are only proof of restore)
freed=0

remove() {   # remove <path> <reason>
  [ -e "$1" ] || return 0
  size=$(du -xsk "$1" 2>/dev/null | cut -f1)
  freed=$((freed + ${size:-0}))
  printf '  %-8s %s  (%s)\n' "$(du -xsh "$1" 2>/dev/null | cut -f1)" "$1" "$2"
  [ "$apply" = 1 ] && rm -rf -- "$1"
}

echo "=== Где место (корень) ==="
df -h / | tail -1
du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -12
echo; echo "--- /var и /home подробнее ---"
du -xh --max-depth=2 /var /home /root /opt 2>/dev/null | sort -rh | head -15
swapon --show 2>/dev/null
echo

[ "$apply" = 1 ] && echo "=== УДАЛЯЮ ===" || echo "=== Будет удалено (пробный прогон, ничего не удалено) ==="
for root in /srv/disbit /srv/disbit-staging; do
  [ -d "$root/releases" ] || continue
  current=$(readlink -f "$root/current" 2>/dev/null)
  previous=$(cat "$root/backups/previous-release.txt" 2>/dev/null)
  echo "[$root] текущий: $(basename "$current"), предыдущий: $(basename "${previous:-—}")"
  n=0
  for dir in $(ls -1td "$root"/releases/*/ 2>/dev/null); do
    dir=${dir%/}; real=$(readlink -f "$dir")
    if [ "$real" = "$current" ] || [ "$real" = "$previous" ]; then continue; fi
    n=$((n + 1)); [ "$n" -le "$KEEP_RELEASES" ] && continue
    remove "$dir" "старый релиз"
  done
  for dir in "$root"/backups/*-restored; do
    [ -d "$dir" ] && remove "$dir" "копия-проверка восстановления"
  done
  n=0
  for dir in $(ls -1td "$root"/backups/*/ 2>/dev/null); do
    dir=${dir%/}
    case "$dir" in *-restored) continue ;; esac
    n=$((n + 1)); [ "$n" -le "$KEEP_BACKUPS" ] && continue
    remove "$dir" "старый бэкап"
    [ -f "$dir.paths" ] && { [ "$apply" = 1 ] && rm -f "$dir.paths"; }
  done
done
for f in /tmp/disbit-*.tar; do [ -f "$f" ] && remove "$f" "архив выпуска"; done

echo
echo "Системное:"
echo "  журнал systemd: $(journalctl --disk-usage 2>/dev/null | grep -o '[0-9.]*[KMG]') → оставить 100M"
echo "  кэш apt: $(du -xsh /var/cache/apt 2>/dev/null | cut -f1)"
if [ "$apply" = 1 ]; then
  journalctl --vacuum-size=100M >/dev/null 2>&1
  apt-get clean >/dev/null 2>&1
fi
echo
echo "Освобождается в /srv и /tmp: $((freed / 1024)) МБ (+ журнал и кэш apt)"
[ "$apply" = 1 ] && df -h / | tail -1
