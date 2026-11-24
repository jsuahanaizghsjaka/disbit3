# Настройка бота Disbit в Telegram. Токен вводится скрыто и нигде не печатается.
# Запуск из корня репозитория:  .\ops\setup-telegram.ps1 -Env staging   (затем production)
param(
  [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Env,
  [Parameter(Mandatory)][string]$BotUsername,
  [string]$MiniAppShortName = 'app'
)
$ErrorActionPreference = 'Stop'
$site = if ($Env -eq 'production') { 'https://disbit.ru' } else { 'https://staging.disbit.ru' }
$secure = Read-Host 'Токен бота от @BotFather' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
function Call($method, $body) {
  $json = $body | ConvertTo-Json -Depth 6 -Compress
  Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/$method" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
}
$me = Call 'getMe' @{}
if ($me.result.username -ne $BotUsername.TrimStart('@')) { throw "Токен принадлежит другому боту: @$($me.result.username)" }
Call 'setWebhook' @{ url = "$site/api/telegram/webhook"; secret_token = $secret; allowed_updates = @('message','callback_query','my_chat_member'); drop_pending_updates = $true } | Out-Null
Call 'setMyCommands' @{ commands = @(
  @{command='today';description='Обещания на сегодня'}, @{command='stats';description='Серии и неделя'},
  @{command='remind';description='Напоминания и тихие часы'}, @{command='invite';description='Позвать друга'},
  @{command='stop';description='Отключить сообщения бота'}, @{command='help';description='Как работает Disbit'}) } | Out-Null
Call 'setChatMenuButton' @{ menu_button = @{ type='web_app'; text='Открыть Disbit'; web_app=@{ url = "$site/tg/" } } } | Out-Null
$file = Join-Path $env:USERPROFILE "disbit-telegram-$Env.env"
@("TELEGRAM_BOT_TOKEN=$token","TELEGRAM_WEBHOOK_SECRET=$secret","TELEGRAM_BOT_USERNAME=$($BotUsername.TrimStart('@'))","TELEGRAM_MINIAPP_SHORTNAME=$MiniAppShortName") | Set-Content -Path $file -Encoding ascii
Write-Host "Готово. Webhook: $site/api/telegram/webhook"
Write-Host "Значения для сервера сохранены в $file (не коммитьте). Скопируйте на сервер в /etc/disbit/$Env-telegram.env (root, chmod 600), затем удалите локальный файл."
