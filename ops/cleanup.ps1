# Run from the disbit3 folder in PowerShell:
#   .\ops\cleanup.ps1          — показать, что будет удалено (ничего не удаляет)
#   .\ops\cleanup.ps1 -Apply   — удалить
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$key = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$server = 'deploy@188.225.34.65'
$flag = if ($Apply) { '--apply' } else { '' }
scp -i $key ops/cleanup-server.sh "${server}:/tmp/disbit-cleanup.sh"
ssh -t -i $key $server "sudo sh /tmp/disbit-cleanup.sh $flag; rm -f /tmp/disbit-cleanup.sh"
