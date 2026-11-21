$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../server-backups'))
$key = Join-Path $env:USERPROFILE '.ssh/disbit_timeweb_ed25519'
$remote = 'deploy@188.225.34.65'
$files = & ssh -o BatchMode=yes -o ConnectTimeout=15 -i $key $remote 'sha256sum /srv/disbit/backups/disbit-*.tar.gz'
if ($LASTEXITCODE -ne 0) { throw 'Cannot list remote backups' }
$verified = 0
foreach ($line in $files) {
 if ($line -notmatch '^([a-f0-9]{64})\s+/srv/disbit/backups/(disbit-(\d{4}-\d{2}-\d{2})_\d{4}\.tar\.gz)$') { throw 'Unexpected backup inventory' }
 $digest=$Matches[1]; $name=$Matches[2]; $date=[datetime]::ParseExact($Matches[3],'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
 if ($date -lt [datetime]::UtcNow.AddDays(-30)) { continue }
 $target=Join-Path $root $name
 if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target).Hash.ToLower() -ne $digest) {
  $incoming=$target+'.incoming'
  & scp -q -o BatchMode=yes -o ConnectTimeout=15 -i $key "${remote}:/srv/disbit/backups/$name" $incoming
  if ($LASTEXITCODE -ne 0) { throw 'Download failed' }
  if ((Get-FileHash -LiteralPath $incoming).Hash.ToLower() -ne $digest) { throw 'Backup checksum mismatch' }
  Move-Item -LiteralPath $incoming -Destination $target -Force
 }
 $verified++
}
if ($verified -eq 0) { throw 'No recent backups verified; retention not run' }
$removed=0
foreach ($file in Get-ChildItem -LiteralPath $root -File) {
 if ($file.Name -notmatch '^disbit-(\d{4}-\d{2}-\d{2})_\d{4}\.tar\.gz$') { continue }
 $date=[datetime]::ParseExact($Matches[1],'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
 if ($date -ge [datetime]::UtcNow.AddDays(-30)) { continue }
 if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked backup' }
 if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file.FullName)) -ne $root) { throw 'Backup outside approved directory' }
 Remove-Item -LiteralPath $file.FullName
 $removed++
}
[IO.File]::WriteAllText((Join-Path $root 'last-verified-sync.json'),(@{at=[datetime]::UtcNow.ToString('o');verified=$verified;removed=$removed}|ConvertTo-Json))
Write-Output "Verified backups: $verified; expired local archives removed: $removed"
