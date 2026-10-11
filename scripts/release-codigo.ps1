# release-codigo.ps1 - ADEGA SB - release de CODIGO sem migration (staging -> CI -> producao)
# Uso (na pasta do STAGING):
#   powershell -ExecutionPolicy Bypass -File scripts\release-codigo.ps1 -Mensagem "fix: ..." -Arquivos a.tsx,b.ts
# Etapas (para na PRIMEIRA falha):
#   1. checagens (branch staging, porta 3000 livre, pasta de producao limpa)
#   2. npm run e2e (gates, sem banco)
#   3. commit + push da branch staging (so os arquivos informados)
#   4. espera o CI do commit ficar verde (ate 25 min)
#   5. producao: fetch -> merge --ff-only -> push main
# Log: F:\Projetos\adega-sb-docs\release-codigo.log  (arquivo ASCII de proposito)
param(
  [Parameter(Mandatory = $true)][string]$Mensagem,
  [Parameter(Mandatory = $true)][string[]]$Arquivos
)
$ErrorActionPreference = 'Continue'
# com -File o PowerShell entrega a lista 'a,b,c' como UM texto: separa aqui
$Arquivos = @($Arquivos | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
# pastas derivadas da posicao deste script (funciona em F:\, J:\ ou outra letra)
$BASE = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$STG = Join-Path $BASE 'adega-sb-staging'
$PRD = Join-Path $BASE 'adega-sb'
$LOG = Join-Path $BASE 'adega-sb-docs\release-codigo.log'

function Log([string]$m) { Add-Content -Path $LOG -Value $m -Encoding utf8 }
function Etapa([string]$n, [string]$t) { $l = "==> [$n] $t  ($(Get-Date -Format 'dd/MM HH:mm:ss'))"; Write-Host ''; Write-Host $l -ForegroundColor Cyan; Log $l }
function Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green; Log "    OK  $m" }
function Falha([string]$m) { Write-Host ''; Write-Host "FALHOU: $m" -ForegroundColor Red; Log "FALHOU: $m"; Write-Host 'Mande as ultimas 30 linhas desta janela.' -ForegroundColor Yellow; exit 1 }
function Rodar([string]$desc, [scriptblock]$cmd) {
  Log "    > $desc"
  & $cmd 2>&1 | ForEach-Object { $t = "$_"; Write-Host $t; Add-Content -Path $LOG -Value $t -Encoding utf8 }
  return $LASTEXITCODE
}

Set-Content -Path $LOG -Value "release-codigo - inicio $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $Mensagem" -Encoding utf8

Etapa '1/5' 'Checagens'
Set-Location $STG
if ((git branch --show-current).Trim() -ne 'staging') { Falha 'a pasta de staging nao esta na branch staging' }
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Falha 'tem servidor na porta 3000 (npm run dev?). Feche com Ctrl+C.' }
Set-Location $PRD
$sujo = git status --short
if ($sujo) { Falha "a pasta de PRODUCAO tem arquivos alterados:`n$sujo" }
Set-Location $STG
foreach ($f in $Arquivos) { if (-not (Test-Path $f)) { Falha "arquivo nao encontrado: $f" } }
Ok 'staging, porta 3000 livre, producao limpa, arquivos presentes'

Etapa '2/5' 'npm run e2e (gates)'
if ((Rodar 'npm run e2e' { npm run e2e }) -ne 0) { Falha 'npm run e2e' }
Ok 'gates verdes'

Etapa '3/5' 'Commit + push staging'
git add -- $Arquivos
git commit -m $Mensagem -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | Out-Host
if ($LASTEXITCODE -ne 0) { Falha 'git commit (nada para commitar?)' }
if ((Rodar 'git push origin staging' { git push origin staging }) -ne 0) { Falha 'git push origin staging' }
$sha = (git rev-parse HEAD).Trim()
Ok "commit $($sha.Substring(0,7)) enviado"

Etapa '4/5' "Esperando o CI de $($sha.Substring(0,7)) (ate 25 min)"
$fim = (Get-Date).AddMinutes(25); $conclusao = ''
while ((Get-Date) -lt $fim) {
  Start-Sleep -Seconds 30
  $runs = (gh run list --branch staging --limit 10 --json headSha,status,conclusion | Out-String) | ConvertFrom-Json
  $run = $runs | Where-Object { $_.headSha -eq $sha } | Select-Object -First 1
  if ($run -and $run.status -eq 'completed') { $conclusao = $run.conclusion; break }
  Write-Host "    CI: $(if ($run) { $run.status } else { 'ainda nao apareceu' })..."
}
if ($conclusao -ne 'success') { Falha "CI nao ficou verde (conclusao: '$conclusao')" }
Ok 'CI verde'

Etapa '5/5' 'Producao: merge --ff-only -> push main'
Set-Location $PRD
if ((Rodar 'git fetch' { git fetch origin }) -ne 0) { Falha 'git fetch' }
if ((Rodar 'git merge --ff-only' { git merge --ff-only origin/staging }) -ne 0) { Falha 'merge --ff-only' }
if ((Rodar 'git push origin main' { git push origin main }) -ne 0) { Falha 'git push origin main' }
$main = (git rev-parse --short HEAD).Trim()
Set-Location $STG
Ok "main = $main (Netlify publica em ~3 min)"
Write-Host ''; Write-Host "RELEASE CONCLUIDO - main = $main" -ForegroundColor Green
Log "RELEASE CONCLUIDO - main = $main - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
