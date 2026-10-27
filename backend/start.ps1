$stdio = "$PSScriptRoot\data"
Start-Process -FilePath "$PSScriptRoot\biralo.exe" -ArgumentList "-port","8080" -WorkingDirectory $stdio -WindowStyle Hidden
Start-Sleep 3
$h = Invoke-RestMethod "http://localhost:8080/api/v1/health" -TimeoutSec 5
Write-Output "backend up: channels=$($h.channels) sources=$($h.sources | ConvertTo-Json -Compress)"
