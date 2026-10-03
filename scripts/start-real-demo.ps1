param(
  [ValidateSet('openai', 'openrouter')][string]$Provider = 'openai',
  [string]$Model = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
try {
  if (-not (Test-Path -LiteralPath '.env')) { throw 'Configure a private .env before starting the demo.' }
  if (-not $Model) { $Model = if ($Provider -eq 'openrouter') { 'openai/gpt-4.1-mini' } else { 'gpt-4o-mini' } }
  $modelVariable = if ($Provider -eq 'openrouter') { 'OPENROUTER_MODEL' } else { 'OPENAI_MODEL' }
  $names = @($modelVariable, 'PII_ENABLED', 'PII_PERSON_ENABLED', 'SOURCE_TEXT_MAX', 'QUESTION_MAX')
  $saved = @{}
  foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  [Environment]::SetEnvironmentVariable($modelVariable, $Model, 'Process')
  $env:PII_ENABLED = 'true'
  $env:PII_PERSON_ENABLED = 'true'
  $env:SOURCE_TEXT_MAX = '1000'
  $env:QUESTION_MAX = '500'
  npm run pii:init-key
  if ($LASTEXITCODE -ne 0) { throw 'HMAC initialization failed.' }
  $compose = @('compose', '-f', 'docker-compose.yml')
  if (Test-Path -LiteralPath 'qa/local/docker-extra-ca.pem') { $compose += @('-f', 'docker-compose.extra-ca.yml') }
  $compose += @('-f', "docker-compose.$Provider.yml")
  & docker @compose up --build -d --wait --wait-timeout 180
  if ($LASTEXITCODE -ne 0) { throw 'Demo startup failed; inspect service health without printing secrets.' }
  Write-Host "Real-provider demo: http://localhost:8080 ($Provider / $Model). Synthetic input only; each submission may be charged."
} finally {
  if ($saved) { foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') } }
  Pop-Location
}
