$appDir = $PSScriptRoot
$indexPath = Join-Path $appDir "index.html"
$iconPath = Join-Path $appDir "icons\app.ico"

$edgePaths = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) {
  Write-Host "Microsoft Edge не найден на этом компьютере. Установите Edge и запустите скрипт снова." -ForegroundColor Red
  exit 1
}

$fileUri = ([uri]$indexPath).AbsoluteUri
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "disbit.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $edge
$shortcut.Arguments = "--app=`"$fileUri`" --window-size=430,900"
if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
$shortcut.Description = "disbit - privychki so shtrafom"
$shortcut.WorkingDirectory = $appDir
$shortcut.Save()

Write-Host "Готово! Ярлык disbit создан на рабочем столе." -ForegroundColor Green
