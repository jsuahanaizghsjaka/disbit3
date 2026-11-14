#!/bin/sh
set -eu
umask 077
root=/srv/disbit/backups
mkdir -p "$root"
target="$root/backup-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'systemctl start disbit' EXIT
systemctl stop disbit
/usr/bin/node /srv/disbit/current/scripts/backup.mjs create /srv/disbit/data/disbit.db /srv/disbit/data/proofs "$target" --offline
systemctl start disbit
trap - EXIT
/usr/bin/node /srv/disbit/current/scripts/backup-retention.mjs "$root" --apply
