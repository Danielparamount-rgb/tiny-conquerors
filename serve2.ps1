param([int]$Port = 8742)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $root on http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = $ctx.Request.Url.AbsolutePath.TrimStart('/')
  if ($ctx.Request.HttpMethod -eq "POST" -and $path -eq "save") {
    # body = base64 image; query ?name=foo.jpg -> saved beside the server
    $name = $ctx.Request.QueryString["name"]; if (-not $name) { $name = "shot.jpg" }
    $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
    $b64 = $reader.ReadToEnd()
    [IO.File]::WriteAllBytes((Join-Path $root $name), [Convert]::FromBase64String($b64))
    $ctx.Response.StatusCode = 200
    $ctx.Response.Close()
    continue
  }
  if ([string]::IsNullOrEmpty($path)) { $path = "tiny-conquerors.html" }
  $file = Join-Path $root $path
  if (Test-Path $file) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    # Real MIME types matter here: a browser refuses to register a service
    # worker served as text/html, which is why local SW testing used to be
    # impossible. Everything unknown still falls back to text/html.
    $ctx.Response.ContentType = switch ([IO.Path]::GetExtension($file).ToLower()) {
      ".js"          { "application/javascript; charset=utf-8" }
      ".mjs"         { "application/javascript; charset=utf-8" }
      ".json"        { "application/json; charset=utf-8" }
      ".webmanifest" { "application/manifest+json; charset=utf-8" }
      ".css"         { "text/css; charset=utf-8" }
      ".png"         { "image/png" }
      ".jpg"         { "image/jpeg" }
      ".jpeg"        { "image/jpeg" }
      ".svg"         { "image/svg+xml" }
      ".ico"         { "image/x-icon" }
      default        { "text/html; charset=utf-8" }
    }
    # No-store keeps the browser cache out of service-worker update tests;
    # a stale sw.js is exactly the bug this rig is here to reproduce.
    $ctx.Response.Headers.Add("Cache-Control", "no-store")
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
