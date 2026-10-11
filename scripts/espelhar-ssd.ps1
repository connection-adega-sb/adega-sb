# espelhar-ssd.ps1 - ADEGA SB - copia o projeto para o SSD externo (sem lixo)
# Uso: powershell -ExecutionPolicy Bypass -File F:\Projetos\adega-sb-staging\scripts\espelhar-ssd.ps1 -Destino J:\Projetos
# Copia: adega-sb-staging, adega-sb (producao) e adega-sb-docs, COM o .git (historico) e o .env.local.
# Nao copia: node_modules, .next, .next-e2e, caches e builds (recriados com npm ci), supabase\.temp (refazer o link),
#            adega-sb-docs\_arquivo (versoes antigas) e casa-de-bolos-aconchego.html (outro projeto).
# Arquivo ASCII de proposito (PowerShell 5.1).
param([string]$Destino = 'J:\Projetos', [string]$Origem = 'F:\Projetos')

$ErrorActionPreference = 'Continue'
$drive = Split-Path -Qualifier $Destino
if (-not (Test-Path "$drive\")) { Write-Host "FALHOU: unidade $drive nao encontrada (SSD conectado?)" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

$lixoDirs = @('node_modules', '.next', '.next-e2e', 'coverage', 'test-results', 'playwright-report', '.turbo', '.temp', 'out', 'build')
$lixoArqs = @('tsconfig.tsbuildinfo', 'npm-debug.log*', '_gate_local_*.sql')
$falhou = $false

foreach ($p in @('adega-sb-staging', 'adega-sb', 'adega-sb-docs')) {
  $de = Join-Path $Origem $p; $para = Join-Path $Destino $p
  if (-not (Test-Path $de)) { Write-Host "FALHOU: origem nao existe: $de" -ForegroundColor Red; $falhou = $true; continue }
  Write-Host ''; Write-Host "==> $de  ->  $para" -ForegroundColor Cyan
  $xd = @() + $lixoDirs
  $xf = @() + $lixoArqs
  if ($p -eq 'adega-sb-docs') { $xd += (Join-Path $de '_arquivo'); $xf += 'casa-de-bolos-aconchego.html' }
  # /E subpastas  /COPY:DAT dados+atributos+datas  /R:2 /W:2 poucas tentativas  /NP sem porcentagem  /NFL /NDL resumo enxuto
  robocopy $de $para /E /COPY:DAT /R:2 /W:2 /NP /NFL /NDL /XD $xd /XF $xf | Out-Host
  if ($LASTEXITCODE -ge 8) { Write-Host "FALHOU: robocopy em $p (codigo $LASTEXITCODE)" -ForegroundColor Red; $falhou = $true }
  else { Write-Host "    OK  $p copiado" -ForegroundColor Green }
}

Write-Host ''; Write-Host '==> Conferencia no destino' -ForegroundColor Cyan
foreach ($p in @('adega-sb-staging', 'adega-sb')) {
  $para = Join-Path $Destino $p
  $sha = (git -C $para log --oneline -1 2>&1 | Out-String).Trim()
  Write-Host "    $p : $sha"
}
foreach ($f in @('adega-sb-staging\.env.local', 'adega-sb-staging\AGENTS.md', 'adega-sb-docs\HANDOFF-IA.md', 'adega-sb-docs\CONTINUAR-NO-NOTEBOOK.md')) {
  $ok = Test-Path (Join-Path $Destino $f)
  Write-Host ("    {0,-45} {1}" -f $f, $(if ($ok) { 'OK' } else { 'FALTANDO' }))
  if (-not $ok) { $falhou = $true }
}
if ($falhou) { Write-Host ''; Write-Host 'ESPELHO COM FALHA - mande a saida para o Claude' -ForegroundColor Red; exit 1 }
Write-Host ''; Write-Host "ESPELHO CONCLUIDO em $Destino - pode desligar este computador" -ForegroundColor Green
