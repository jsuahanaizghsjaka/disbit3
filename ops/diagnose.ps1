# Run from the disbit3 folder in PowerShell: .\ops\diagnose.ps1 sinon disbit_visual_1024
# Read-only: disk usage on the server and the money state of one account.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Logins = @())
$ErrorActionPreference = 'Stop'
$key = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$server = 'deploy@188.225.34.65'
scp -i $key ops/diagnose-server.sh "${server}:/tmp/disbit-diagnose.sh"
$names = ($Logins | Where-Object { $_ -match '^[A-Za-z0-9_.-]+$' }) -join ' '
ssh -t -i $key $server "sudo sh /tmp/disbit-diagnose.sh $names; rm -f /tmp/disbit-diagnose.sh"
