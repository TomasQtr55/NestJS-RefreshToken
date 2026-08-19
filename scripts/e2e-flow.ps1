$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Tom\Desktop\repos\refToken'
$tmp = 'C:\Users\Tom\AppData\Local\Temp\opencode'

$auth = Start-Process node -ArgumentList 'dist/main' -WorkingDirectory "$root\auth-ms" -RedirectStandardOutput "$tmp\auth-out.log" -RedirectStandardError "$tmp\auth-err.log" -PassThru -WindowStyle Hidden
$gw = Start-Process node -ArgumentList 'dist/main' -WorkingDirectory "$root\gateway" -RedirectStandardOutput "$tmp\gw-out.log" -RedirectStandardError "$tmp\gw-err.log" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body = $null, [string]$Token = $null)
  $params = @{
    Method = $Method
    Uri = "http://localhost:3000$Path"
    Headers = @{}
  }
  if ($Token) { $params.Headers['Authorization'] = "Bearer $Token" }
  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Compress)
  }
  try {
    $resp = Invoke-RestMethod @params
    return @{ status = 200; body = $resp }
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ status = $code; body = $_.ErrorDetails.Message }
  }
}

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  $mark = if ($Ok) { 'PASS' } else { 'FAIL' }
  Write-Output ("[{0}] {1} {2}" -f $mark, $Name, $Detail)
}

Write-Output '--- E2E: refresh token flow ---'

# Unique email per run so the script is repeatable against the same DB.
$email = "demo-$([guid]::NewGuid().ToString('N').Substring(0,8))@facultad.com"
Write-Output "test user: $email"

$r = Invoke-Api -Method Post -Path '/auth/register' -Body @{ email = $email; password = 'super-secret-1' }
Check '1. register returns id+email (no passwordHash)' ($r.status -eq 200 -or $r.status -eq 201) ($r.body | ConvertTo-Json -Compress)

$r = Invoke-Api -Method Post -Path '/auth/register' -Body @{ email = $email; password = 'super-secret-1' }
Check '2. duplicate email -> 409' ($r.status -eq 409) ("got $($r.status)")

$r = Invoke-Api -Method Post -Path '/auth/login' -Body @{ email = $email; password = 'wrong-password' }
Check '3. wrong password -> 401' ($r.status -eq 401) ("got $($r.status)")

$r = Invoke-Api -Method Post -Path '/auth/login' -Body @{ email = $email; password = 'super-secret-1' }
$access1 = $r.body.accessToken; $refresh1 = $r.body.refreshToken
Check '4. login returns accessToken + refreshToken' ([bool]$access1 -and [bool]$refresh1) ''

$r = Invoke-Api -Method Get -Path '/users/me' -Token $access1
Check '5. GET /users/me with valid token -> 200 + payload' ($r.status -eq 200 -and $r.body.email -eq $email) ($r.body | ConvertTo-Json -Compress)

$r = Invoke-Api -Method Get -Path '/users/me'
Check '6. GET /users/me without token -> 401' ($r.status -eq 401) ("got $($r.status)")

$r = Invoke-Api -Method Post -Path '/auth/refresh' -Body @{ refreshToken = $refresh1 }
$access2 = $r.body.accessToken; $refresh2 = $r.body.refreshToken
Check '7. refresh rotates -> new pair' ([bool]$access2 -and [bool]$refresh2 -and $refresh2 -ne $refresh1) ''

$r = Invoke-Api -Method Post -Path '/auth/refresh' -Body @{ refreshToken = $refresh1 }
Check '8. reuse of rotated token -> 401 (theft detected)' ($r.status -eq 401) ($r.body)

$r = Invoke-Api -Method Post -Path '/auth/refresh' -Body @{ refreshToken = $refresh2 }
Check '9. new token also rejected -> family was revoked' ($r.status -eq 401) ("got $($r.status)")

$r = Invoke-Api -Method Post -Path '/auth/login' -Body @{ email = $email; password = 'super-secret-1' }
$refresh3 = $r.body.refreshToken
$r = Invoke-Api -Method Post -Path '/auth/logout' -Body @{ refreshToken = $refresh3 }
Check '10. logout -> success' ($r.status -eq 200 -or $r.status -eq 201) ''
$r = Invoke-Api -Method Post -Path '/auth/refresh' -Body @{ refreshToken = $refresh3 }
Check '11. refresh after logout -> 401 (revoked)' ($r.status -eq 401) ("got $($r.status)")

Stop-Process -Id $auth.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $gw.Id -Force -ErrorAction SilentlyContinue
Write-Output '--- done ---'
