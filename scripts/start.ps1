param(
  [int]$Port = 4173
)

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "K-Wellness CareOS is running at http://localhost:$Port"
Write-Host "Press Ctrl+C to stop."

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".ico" = "image/x-icon"
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 3000
      $client.SendTimeout = 3000
      $stream = $client.GetStream()
      $stream.ReadTimeout = 3000
      $stream.WriteTimeout = 3000
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while (($line = $reader.ReadLine()) -ne "" -and $null -ne $line) { }

      $requestPath = "/"
      if ($requestLine -match "^[A-Z]+\s+([^\s]+)") {
        $requestPath = [System.Uri]::UnescapeDataString(($Matches[1] -split "\?")[0])
      }
      if ($requestPath -eq "/") { $requestPath = "/index.html" }

      $relativePath = $requestPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $siteRoot $relativePath))
      if (-not $candidate.StartsWith($siteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = Join-Path $siteRoot "index.html"
      }

      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $candidate = Join-Path $siteRoot "index.html"
      }

      $bytes = [System.IO.File]::ReadAllBytes($candidate)
      $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush()
    }
    catch [System.IO.IOException] {
      # Browsers can cancel an in-flight asset request during reload/navigation.
      # Keep the local server alive and continue accepting the next request.
    }
    catch [System.ObjectDisposedException] {
      # The client closed the connection before the response completed.
    }
    finally {
      $client.Dispose()
    }
  }
}
finally {
  $listener.Stop()
}
