param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = if ($env:ALWAYSRUN_DATA) { [System.IO.Path]::GetFullPath($env:ALWAYSRUN_DATA) } else { Join-Path $taskRoot 'data' }
$taskRuntimeFile = Join-Path $taskData 'runtime.json'
$taskNode = $null
if (Test-Path -LiteralPath $taskRuntimeFile) {
    $taskRuntime = Get-Content -LiteralPath $taskRuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Test-Path -LiteralPath $taskRuntime.node) { $taskNode = $taskRuntime.node }
}
if (-not $taskNode) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
$taskSetup = & $taskNode (Join-Path $taskRoot 'scripts\setup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Alwaysrun setup failed. Node.js 24 or newer is required.' }
$taskConfig = Get-Content -LiteralPath (Join-Path $taskData 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskUrl = "http://127.0.0.1:$($taskConfig.port)"
try {
    $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 2
    if ($taskHealth.service -eq 'alwaysrun') {
        Write-Output "Alwaysrun is already running: $taskUrl"
        if (-not $NoBrowser) { Start-Process $taskUrl }
        exit 0
    }
} catch {}
$taskLog = Join-Path $taskData 'logs'
New-Item -ItemType Directory -Path $taskLog -Force | Out-Null
$taskServer = Join-Path $taskRoot 'src\server.mjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLog 'server.out.log') -RedirectStandardError (Join-Path $taskLog 'server.err.log')
for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 2
        if ($taskHealth.service -eq 'alwaysrun') {
            Write-Output "Alwaysrun started (PID $($taskProcess.Id)): $taskUrl"
            if (-not $NoBrowser) { Start-Process $taskUrl }
            exit 0
        }
    } catch {}
    if ($taskProcess.HasExited) { throw "Alwaysrun stopped. Inspect $taskLog" }
}
throw "Alwaysrun is starting slowly. Inspect $taskLog"
