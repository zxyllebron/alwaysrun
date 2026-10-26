$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = if ($env:ALWAYSRUN_DATA) { [System.IO.Path]::GetFullPath($env:ALWAYSRUN_DATA) } else { Join-Path $taskRoot 'data' }
$taskConfig = Get-Content -LiteralPath (Join-Path $taskData 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskUrl = "http://127.0.0.1:$($taskConfig.port)"
$taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 5
if ($taskHealth.service -ne 'alwaysrun') { throw 'The target port is not Alwaysrun.' }
$taskSession = Invoke-RestMethod -Uri "$taskUrl/api/bootstrap" -TimeoutSec 5
Invoke-RestMethod -Method Post -Uri "$taskUrl/api/shutdown" -Headers @{ 'X-Alwaysrun-Token' = $taskSession.token } -ContentType 'application/json' -Body '{}' -TimeoutSec 15 | Out-Null
Write-Output 'Alwaysrun shutdown requested. Its active task is being interrupted.'
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 1 | Out-Null }
    catch { Write-Output 'Alwaysrun stopped.'; exit 0 }
}
throw 'Shutdown is still pending; inspect the server log before restarting.'
