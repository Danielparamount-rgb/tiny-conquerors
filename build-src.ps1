# Rebuild tiny-conquerors.html from the src/ modules.
# The game still SHIPS as one self-contained file (the artifact CSP demands it);
# src/ exists so humans can navigate 15k lines. Edit src/, run this, then the
# normal deploy checklist (build-app.ps1, bump sw VERSION, commit, push).
# Editing tiny-conquerors.html directly still works in a pinch - but then run
# split the other way or your edit is lost on the next build. Prefer src/.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$parts = Get-ChildItem (Join-Path $root 'src') -File | Sort-Object Name
$sb = New-Object System.Text.StringBuilder
foreach ($p in $parts) {
  [void]$sb.Append([IO.File]::ReadAllText($p.FullName))
}
$out = Join-Path $root 'tiny-conquerors.html'
[IO.File]::WriteAllText($out, $sb.ToString())
Write-Host ("built tiny-conquerors.html from {0} modules ({1:n0} bytes)" -f $parts.Count, (Get-Item $out).Length)
