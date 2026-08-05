# Assembles the deployable PWA into .\app\index.html from the canonical game file.
# The game source stays wrapper-free (the Claude artifact publisher adds its own);
# this script adds the PWA head + service-worker registration for the Render build.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$game = [IO.File]::ReadAllText("$root\tiny-conquerors.html")
$head = @'
<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#241a10">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
</head><body>
'@
$tail = @'

<script>
if ('serviceWorker' in navigator)
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
</script>
</body></html>
'@
[IO.File]::WriteAllText("$root\app\index.html", $head + $game + $tail)
"app/index.html built: $((Get-Item "$root\app\index.html").Length) bytes"
