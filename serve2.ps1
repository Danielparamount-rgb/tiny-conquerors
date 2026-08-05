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
    $ctx.Response.ContentType = "text/html; charset=utf-8"
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
