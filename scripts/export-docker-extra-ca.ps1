#Exports a local HTTPS inspection root (e.g. Avast Web Shield) for Docker image builds and API runtime TLS.

#Output is git-ignored under qa/local/. Do not commit the PEM.



$ErrorActionPreference = 'Stop'

$securityModulePath = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module $securityModulePath -ErrorAction Stop


$repoRoot = Split-Path -Parent $PSScriptRoot

$outDir = Join-Path $repoRoot 'qa\local'

$outFile = Join-Path $outDir 'docker-extra-ca.pem'



$patterns = @('Avast Web/Mail Shield Root', 'Avast Web/Mail Shield')

$cert = Get-ChildItem Cert:\LocalMachine\Root | Where-Object {

  $subj = $_.Subject

  foreach ($p in $patterns) {

    if ($subj -like "*$p*") { return $true }

  }

  $false

} | Select-Object -First 1



if (-not $cert) {

  Write-Error @"

No HTTPS inspection root certificate found in LocalMachine\Root.

Either disable HTTPS scanning for registry.npmjs.org and your LLM provider, or export your vendor root manually to:

  $outFile

An existing PEM file was not modified.

"@

}



New-Item -ItemType Directory -Force -Path $outDir | Out-Null



$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)

$base64 = [System.Convert]::ToBase64String($bytes)

$pem = "-----BEGIN CERTIFICATE-----`n"

for ($i = 0; $i -lt $base64.Length; $i += 64) {

  $pem += $base64.Substring($i, [Math]::Min(64, $base64.Length - $i)) + "`n"

}

$pem += "-----END CERTIFICATE-----`n"

[System.IO.File]::WriteAllText($outFile, $pem, [System.Text.UTF8Encoding]::new($false))

Write-Host "Wrote $outFile ($($cert.Subject))"

Write-Host "Use: docker compose -f docker-compose.yml -f docker-compose.extra-ca.yml up --build"


