# Run from the disbit3 folder in PowerShell: .\ops\publish-release.ps1
# Ships the current commit to staging, then production, with the existing deploy key.
$ErrorActionPreference = 'Stop'
$key = "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519"
$server = 'deploy@188.225.34.65'
$sha = (git rev-parse --short=7 HEAD).Trim()
if (git status --porcelain --untracked-files=no) { throw 'Есть незакоммиченные изменения в отслеживаемых файлах' }
$tar = Join-Path $env:TEMP "disbit-$sha.tar"
git -c core.autocrlf=false archive --format=tar -o $tar HEAD
scp -i $key $tar "${server}:/tmp/disbit-$sha.tar"
foreach ($mode in 'staging', 'production') {
  ssh -t -i $key $server "tar -xOf /tmp/disbit-$sha.tar ops/publish-release.sh | sudo sh -s $mode $sha"
  if ($LASTEXITCODE -ne 0) { throw "Публикация на $mode не прошла, предыдущая версия восстановлена" }
}
Write-Host "Опубликовано: $sha. Проверка: https://disbit.ru/terms.html"
