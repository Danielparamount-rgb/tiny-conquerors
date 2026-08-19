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
# The build stamp comes out of app\sw.js so there is only ever one version to
# bump. It is shown in the corner of the start screen, which is how you tell at
# a glance whether a phone is actually running the build you just shipped.
$swSrc = [IO.File]::ReadAllText("$root\app\sw.js")
if ($swSrc -notmatch "VERSION\s*=\s*'([^']+)'") { throw "No VERSION found in app\sw.js" }
$ver = $Matches[1]

$tail = @'

<script>
(function(){
  var BUILD = '__BUILD_VERSION__';
  // The game reads this for the multiplayer version gate (gameVer() falls back
  // to 'dev' when the wrapper is absent, i.e. local test.html / the artifact).
  window.GAMEVER = BUILD;
  addEventListener('load', function(){
    var ov = document.getElementById('startOverlay');
    if (!ov) return;
    var d = document.createElement('div');
    d.textContent = 'build ' + BUILD;
    d.style.cssText = 'position:absolute;right:9px;bottom:7px;font-size:10px;letter-spacing:.5px;' +
                      'opacity:.4;pointer-events:none;';
    ov.appendChild(d);
  });

  if (!('serviceWorker' in navigator)) return;
  var reg = null, had = !!navigator.serviceWorker.controller;
  function check(){ if (reg) reg.update().catch(function(){}); }

  addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').then(function(r){ reg = r; check(); }).catch(function(){});
  });

  // An installed PWA is usually resumed, not reloaded, so coming back to the
  // foreground is the only moment some phones ever look for a new build.
  addEventListener('visibilitychange', function(){ if (!document.hidden) check(); });

  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (!had) return;  // first ever install - there is nothing to replace
    var ov = document.getElementById('startOverlay');
    // Never yank the page out from under a live match, least of all a
    // multiplayer one where a reload drops the player out of lockstep.
    if (!ov || ov.style.display !== 'none') location.reload();
    else if (typeof toast === 'function') toast('New version ready - restart the app to update');
  });
})();
</script>
</body></html>
'@
$tail = $tail.Replace('__BUILD_VERSION__', $ver)
[IO.File]::WriteAllText("$root\app\index.html", $head + $game + $tail)
"build stamp: $ver"
"app/index.html built: $((Get-Item "$root\app\index.html").Length) bytes"
