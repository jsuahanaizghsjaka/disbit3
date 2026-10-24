#!/bin/sh
# Called by root systemd unit. Never sources arbitrary shell from an env file.
set -eu
instance="${1:-}"
case "$instance" in production|staging) ;; *) echo 'Expected production or staging' >&2; exit 2;; esac
root="/var/lib/disbit-$instance"
destination="/var/backups/disbit-$instance/$(date -u +%Y%m%dT%H%M%SZ)"
test -f "$root/disbit.db"
test -d "$root/proofs"
systemctl is-active --quiet "disbit@$instance"
umask 077
mkdir -p "/var/backups/disbit-$instance"
# Always restart after backup failure; exit remains non-zero for monitoring.
trap 'systemctl start "disbit@$instance"' EXIT
systemctl stop "disbit@$instance"
/usr/bin/node "/opt/disbit/$instance/current/scripts/backup.mjs" create "$root/disbit.db" "$root/proofs" "$destination" --offline
