# Run from the disbit3 folder in PowerShell after the release is published:
#   .\ops\enable-yookassa.ps1          — ask for the live secret key and turn payments on
#   .\ops\enable-yookassa.ps1 -Off     — turn live payments off again
# The key is typed here (hidden), sent over SSH to a private file and removed after use.
param([switch]$Off)
$ErrorActionPreference = 'Stop'
$ssh = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$server = 'deploy@188.225.34.65'
$script = '/srv/disbit/current/ops/enable-yookassa.sh'
if ($Off) {
  ssh -t -i $ssh $server "sudo sh $script off"
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось выключить платежи' }
  return
}
$secure = Read-Host 'Секретный ключ ЮKassa (live_...)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $key.StartsWith('live_')) { throw 'Нужен боевой ключ: он начинается с live_' }
$remoteHome = ($key | ssh -i $ssh $server 'umask 077; cat > ~/.yookassa-key && printf %s "$HOME"')
Remove-Variable key
if ($LASTEXITCODE -ne 0 -or -not $remoteHome) { throw 'Не удалось передать ключ на сервер' }
ssh -t -i $ssh $server "sudo sh $script on $remoteHome/.yookassa-key"
if ($LASTEXITCODE -ne 0) { throw 'Сервер не запустился с платежами, прежний режим восстановлен' }
Write-Host 'Платежи включены. В ЮKassa укажи HTTP-уведомления: https://disbit.ru/api/wallet/webhook'
Write-Host 'События: payment.succeeded, payment.canceled, refund.succeeded'
