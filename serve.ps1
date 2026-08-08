# Load environment variables from .env file if present
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
if ([string]::IsNullOrEmpty($scriptPath)) {
    $scriptPath = $pwd.Path
}
$envFile = Join-Path $scriptPath ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $name = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($name, $val, [System.EnvironmentVariableTarget]::Process)
        }
    }
}

$portsToTry = @(3000, 3001, 3002, 8080)
$listener = $null
$port = 3000

foreach ($p in $portsToTry) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$p/")
        $l.Start()
        $listener = $l
        $port = $p
        break
    } catch {
        if ($l -ne $null) {
            try { $l.Close() } catch {}
        }
    }
}

if ($listener -eq $null -or -not $listener.IsListening) {
    Write-Host "Failed to bind dev server to any port."
    exit 1
}

try {
    Write-Host "========================================="
    Write-Host " Rihal Dev Server is Running!"
    Write-Host " URL: http://localhost:$port/"
    Write-Host " API Proxy Route: http://localhost:$port/api/gemini/generate"
    Write-Host " Press Ctrl+C in this terminal to stop."
    Write-Host "========================================="

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $url = $request.Url.LocalPath

        # Handle API Proxy endpoint securely on server side
        if ($url -eq "/api/gemini/generate" -and $request.HttpMethod -eq "POST") {
            $apiKey = [System.Environment]::GetEnvironmentVariable("GEMINI_API_KEY")
            if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey -eq "your_gemini_api_key_here") {
                $response.StatusCode = 400
                $errJson = '{"error": "GEMINI_API_KEY is not configured in .env file."}'
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.Close()
                continue
            }

            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $postBody = $reader.ReadToEnd()
            $reader.Close()

            try {
                $postBytes = [System.Text.Encoding]::UTF8.GetBytes($postBody)
                $geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=$apiKey"
                $geminiResponse = Invoke-RestMethod -Uri $geminiUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes
                $jsonResponse = $geminiResponse | ConvertTo-Json -Depth 10
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($jsonResponse)
                $response.StatusCode = 200
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } catch {
                try {
                    $postBytes = [System.Text.Encoding]::UTF8.GetBytes($postBody)
                    $fallbackUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$apiKey"
                    $geminiResponse = Invoke-RestMethod -Uri $fallbackUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes
                    $jsonResponse = $geminiResponse | ConvertTo-Json -Depth 10
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($jsonResponse)
                    $response.StatusCode = 200
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                } catch {
                    $response.StatusCode = 500
                    $errMessage = $_.Exception.Message
                    $errJson = "{`"error`": `"Gemini API Proxy Error: $errMessage`"}"
                    $buffer = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $buffer.Length
                    $response.OutputStream.Write($buffer, 0, $buffer.Length)
                }
            }
            $response.Close()
            continue
        }

        if ($url -eq "/") {
            $url = "/index.html"
        }
        
        $targetPath = Join-Path $scriptPath $url.Replace('/', '\')

        if (Test-Path $targetPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($targetPath)
            
            $ext = [System.IO.Path]::GetExtension($targetPath).ToLower()
            $contentType = "text/plain"
            switch ($ext) {
                ".html" { $contentType = "text/html; charset=utf-8" }
                ".css"  { $contentType = "text/css; charset=utf-8" }
                ".js"   { $contentType = "application/javascript; charset=utf-8" }
                ".png"  { $contentType = "image/png" }
                ".jpg"  { $contentType = "image/jpeg" }
                ".jpeg" { $contentType = "image/jpeg" }
                ".gif"  { $contentType = "image/gif" }
                ".svg"  { $contentType = "image/svg+xml" }
                ".json" { $contentType = "application/json; charset=utf-8" }
            }
            
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $response.Close()
    }
} catch {
    Write-Host "Error: $_"
} finally {
    if ($listener -ne $null) {
        $listener.Stop()
    }
    Write-Host "Server stopped."
}
