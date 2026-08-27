# Забирает свежие бэкапы disbit с сервера на локальный диск (offsite-копия).
# Отдельная инфраструктура от VPS: если сервер Timeweb погибнет целиком —
# это единственное, что переживёт. Папка внутри OneDrive — значит есть и
# третья копия в облаке Microsoft.
#
# Запускается по расписанию (см. регистрацию задачи в README рядом).

$ErrorActionPreference = "Stop"

$KeyPath = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$Host_ = "deploy@188.225.34.65"
$RemoteDir = "/srv/disbit/backups/"
$LocalDir = "$PSScriptRoot"

if (-not (Test-Path $KeyPath)) {
    Write-Error "SSH-ключ не найден: $KeyPath"
    exit 1
}

Write-Output "[$(Get-Date -Format o)] Забираю бэкапы с сервера..."

# rsync на сервере есть, но локально на Windows его нет — используем scp,
# он копирует всё, что новее уже скачанного, за счёт -p (сохраняет даты)
# и явного списка файлов новее последней локальной копии
$remoteFiles = & ssh -i $KeyPath -o BatchMode=yes -o ConnectTimeout=15 $Host_ `
    "ls -1 $RemoteDir*.tar.gz 2>/dev/null"

if (-not $remoteFiles) {
    Write-Output "На сервере пока нет ни одного бэкапа."
    exit 0
}

$copied = 0
foreach ($f in ($remoteFiles -split "`n" | Where-Object { $_.Trim() })) {
    $name = Split-Path $f -Leaf
    $localPath = Join-Path $LocalDir $name
    if (-not (Test-Path $localPath)) {
        & scp -i $KeyPath -o BatchMode=yes -q "${Host_}:$f" $localPath
        if ($LASTEXITCODE -eq 0) {
            Write-Output "  скачан: $name"
            $copied++
        } else {
            Write-Warning "  не удалось скачать: $name"
        }
    }
}

# локально храним копии за последние 30 дней — вдвое дольше, чем на сервере,
# так что даже если сервер почистит старое до нашего следующего запуска,
# запас всё равно остаётся
Get-ChildItem $LocalDir -Filter "disbit-*.tar.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force

Write-Output "[$(Get-Date -Format o)] Готово. Новых файлов: $copied."
