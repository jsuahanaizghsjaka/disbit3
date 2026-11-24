$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Disbit\DeletionJournal'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot secure local journal directory' }
$temporary = Join-Path $root ('incoming-' + [guid]::NewGuid().ToString('N'))
$current = Join-Path $root 'current.jsonl'
try {
 & scp.exe -q -o BatchMode=yes -o ConnectTimeout=15 -i "$env:USERPROFILE\.ssh\disbit_timeweb_ed25519" 'deploy@188.225.34.65:/srv/disbit/data/deletions.jsonl' $temporary
 if ($LASTEXITCODE -ne 0) { throw 'Journal download failed; previous copy preserved' }
 foreach ($line in [IO.File]::ReadLines($temporary)) {
  if (-not $line.Trim()) { continue }
  $record = $line | ConvertFrom-Json
  if (-not $record.id -or $record.identity -notmatch '^[a-f0-9]{64}$' -or -not $record.at) { throw 'Invalid journal record' }
 }
 if (Test-Path -LiteralPath $current) {
  $old = [IO.File]::ReadAllText($current)
  if (-not [IO.File]::ReadAllText($temporary).StartsWith($old, [StringComparison]::Ordinal)) { throw 'Remote journal is not an extension of the previous copy' }
  [IO.File]::Replace($temporary, $current, (Join-Path $root 'previous.jsonl'))
 } else { Move-Item -LiteralPath $temporary -Destination $current }
 [IO.File]::WriteAllText((Join-Path $root 'last-success.txt'), [DateTime]::UtcNow.ToString('o'))
 Write-Output 'Deletion journal synchronized; contents not displayed.'
} finally {
 if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
