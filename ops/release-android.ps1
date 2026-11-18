# Builds the signed Android release from the current commit.
# Run from the disbit3 folder in PowerShell:  .\ops\release-android.ps1
# Needs: Node.js, Android Studio (its JBR and SDK), android\keystore.properties.
# Gradle works outside OneDrive (%LOCALAPPDATA%\DisbitBuilds), which earlier
# failed with AccessDeniedException; sources and the key stay where they are.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$gradleFile = Get-Content android\app\build.gradle -Raw
$version = [regex]::Match($gradleFile, 'versionName "([^"]+)"').Groups[1].Value
$code = [regex]::Match($gradleFile, 'versionCode (\d+)').Groups[1].Value
if (-not $version -or -not $code) { throw 'Не нашёл versionName/versionCode в android\app\build.gradle' }
if (git status --porcelain --untracked-files=no) { throw 'Есть незакоммиченные изменения в отслеживаемых файлах' }
if (-not (Test-Path android\keystore.properties)) { throw 'Нет android\keystore.properties — без него APK не подпишется ключом прежних версий' }

if (-not $env:JAVA_HOME) {
  foreach ($jbr in "$env:ProgramFiles\Android\Android Studio\jbr", "$env:LOCALAPPDATA\Programs\Android Studio\jbr") {
    if (Test-Path "$jbr\bin\java.exe") { $env:JAVA_HOME = $jbr; break }
  }
}
if (-not $env:JAVA_HOME) { throw 'Не найден JDK: установи Android Studio или задай JAVA_HOME' }
if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

if (-not (Test-Path node_modules\@capacitor\android)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install' } }
npx cap sync android
if ($LASTEXITCODE) { throw 'cap sync android' }

$out = Join-Path $env:LOCALAPPDATA "DisbitBuilds\$version"
$init = Join-Path $env:TEMP "disbit-build-dir.gradle"
$outGradle = $out -replace '\\', '/'
Set-Content -Path $init -Encoding ASCII -Value "allprojects { layout.buildDirectory = new File('$outGradle', '_' + project.name) }"
Push-Location android
try {
  .\gradlew.bat --init-script $init :app:assembleRelease :app:testDebugUnitTest
  if ($LASTEXITCODE) { throw 'Gradle: сборка не прошла' }
} finally { Pop-Location }

$apk = Join-Path $out '_app\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "Не найден $apk" }
New-Item -ItemType Directory -Force release-artifacts | Out-Null
$target = "release-artifacts\disbit-$version-release.apk"
Copy-Item $apk $target -Force
$apksigner = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if ($apksigner) {
  & $apksigner.FullName verify --print-certs $target | Select-String 'SHA-256'
  if ($LASTEXITCODE) { throw 'apksigner: подпись не прошла проверку' }
}
$hash = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
Write-Host "Готово: $target (versionName $version, versionCode $code)"
Write-Host "SHA-256: $hash"
Write-Host 'Сертификат должен совпадать с 1.0.8: 7e95ad23adccf196a54aa73ab1a192f97a1f54c699d6932802945e544befd701'
