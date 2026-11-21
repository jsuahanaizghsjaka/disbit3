# Run from the disbit3 folder in PowerShell: .\ops\diagnose.ps1 <твой логин>
# Read-only: disk usage on the server and the money state of one account.
param([string]$Login = '')
$ErrorActionPreference = 'Stop'
$key = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$server = 'deploy@188.225.34.65'
scp -i $key ops/diagnose-server.sh "${server}:/tmp/disbit-diagnose.sh"
ssh -t -i $key $server "sudo sh /tmp/disbit-diagnose.sh '$Login'; rm -f /tmp/disbit-diagnose.sh"
