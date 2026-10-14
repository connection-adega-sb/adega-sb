# release-0012.ps1 - ADEGA SB - release de ponta a ponta da migration 0012 (venda com estoque negativo)
#   (venda com estoque negativo - trava por empresa em tenants.config.estoque.permitir_negativo)
# Uso (Windows PowerShell 5.1, na pasta do STAGING):
#   cd C:\Projetos\adega-sb-staging; powershell -ExecutionPolicy Bypass -File scripts\release-0012.ps1
# Ordem (para na PRIMEIRA falha; nada de producao roda se staging falhar):
#   1. checagens (branch staging, next dev desligado, pasta de producao limpa)
#   2. banco STAGING: link -> preflight -> db push -> pgTAP 0012 (gate)
#   3. testes: npm run e2e (gates) -> npm run e2e:pdv (funcional)
#   4. commit + push da branch staging
#   5. espera o CI do commit ficar verde (gh, ate 25 min)
#   6. banco PRODUCAO: link -> preflight -> db push -> pgTAP 0012 (gate) -> link de volta ao STAGING (sempre)
#   7. codigo PRODUCAO: pasta de producao -> fetch -> merge --ff-only -> push main (Vercel publica)
# Log completo: C:\Projetos\adega-sb-docs\release-0012.log
# Arquivo ASCII de proposito (PowerShell 5.1 nao le UTF-8 sem BOM).

param([switch]$StagingJaAplicado)   # use quando a 0012 ja entrou no STAGING numa tentativa anterior
$ErrorActionPreference = 'Continue'
# pastas derivadas da posicao deste script (funciona em F:\, J:\ ou outra letra)
$BASE = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$STG = Join-Path $BASE 'adega-sb-staging'
$PRD = Join-Path $BASE 'adega-sb'
$REF_STG = 'rogkczrtcfxurmnjvlwk'
$REF_PRD = 'nhnlbptzjjibtmsgvcaw'
$LOG = Join-Path $BASE 'adega-sb-docs\release-0012.log'
$linkadoProducao = $false

function Log([string]$m) { Add-Content -Path $LOG -Value $m -Encoding utf8 }
function Etapa([string]$n, [string]$t) {
  $linha = "==> [$n] $t  ($(Get-Date -Format 'dd/MM HH:mm:ss'))"
  Write-Host ''; Write-Host $linha -ForegroundColor Cyan; Log $linha
}
function Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green; Log "    OK  $m" }
function Falha([string]$m) {
  Write-Host ''; Write-Host "FALHOU: $m" -ForegroundColor Red; Log "FALHOU: $m"
  if ($script:linkadoProducao) {
    Set-Location $STG
    npx supabase@latest link --project-ref $REF_STG | Out-Null
    Write-Host '    (vinculo da CLI voltou para o STAGING)' -ForegroundColor Yellow; Log '    vinculo voltou para o STAGING'
  }
  Write-Host 'Mande as ultimas 30 linhas desta janela (ou o arquivo release-0012.log).' -ForegroundColor Yellow
  exit 1
}
# roda um comando nativo mostrando a saida na tela E gravando no log; devolve o exit code
function Rodar([string]$desc, [scriptblock]$cmd) {
  Log "    > $desc"
  & $cmd 2>&1 | ForEach-Object { $t = "$_"; Write-Host $t; Add-Content -Path $LOG -Value $t -Encoding utf8 }
  return $LASTEXITCODE
}

Set-Content -Path $LOG -Value "release-0012 - inicio $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding utf8

# ------------------------------------------------------------------ 1. checagens
Etapa '1/7' 'Checagens'
Set-Location $STG
$branch = (git branch --show-current).Trim()
if ($branch -ne 'staging') { Falha "a pasta de staging esta na branch '$branch' (esperado: staging)" }
Ok 'branch staging'
$dev = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($dev) { Falha 'tem um servidor na porta 3000 (npm run dev?). Feche com Ctrl+C e rode de novo.' }
Ok 'next dev desligado'
Set-Location $PRD
$sujo = git status --short
if ($sujo) { Falha "a pasta de PRODUCAO tem arquivos alterados (ninguem edita producao):`n$sujo" }
Ok 'pasta de producao limpa'
Set-Location $STG
foreach ($f in @('supabase\migrations\0012_estoque_negativo.sql', 'supabase\preflight\0012_preflight.sql', 'supabase\tests\0012_test.sql')) {
  if (-not (Test-Path $f)) { Falha "arquivo nao encontrado: $f" }
}
Ok 'arquivos da 0012 presentes'

# ------------------------------------------------------------------ 2. banco STAGING
Etapa '2/7' 'Banco STAGING: preflight -> db push -> pgTAP 0012'
if ((Rodar 'link staging' { npx supabase@latest link --project-ref $REF_STG }) -ne 0) { Falha 'link staging' }
if ($StagingJaAplicado) {
  Ok '0012 ja estava no staging (tentativa anterior) - pulando preflight e db push; o pgTAP abaixo confere'
} else {
if ((Rodar 'preflight 0012 staging' { npx supabase@latest db query --linked --file supabase/preflight/0012_preflight.sql }) -ne 0) { Falha 'preflight 0012 no STAGING' }
Ok 'preflight 0012 staging'
if ((Rodar 'db push staging' { npx supabase@latest db push --yes }) -ne 0) { Falha 'db push no STAGING' }
Ok '0012 aplicada no staging'
}
node scripts/gate-pgtap.cjs supabase/tests/0012_test.sql supabase/tests/_gate_0012.sql | Out-Null
if ((Rodar 'pgTAP 0012 staging' { npx supabase@latest db query --linked --file supabase/tests/_gate_0012.sql }) -ne 0) { Falha 'pgTAP 0012 no STAGING (algum teste falhou)' }
Ok 'pgTAP 0012 staging: 8/8'

# ------------------------------------------------------------------ 3. testes
Etapa '3/7' 'Testes: npm run e2e (gates) e npm run e2e:pdv (funcional)'
if ((Rodar 'npm run e2e' { npm run e2e }) -ne 0) { Falha 'npm run e2e (gates)' }
Ok 'gates 28/28'
if ((Rodar 'npm run e2e:pdv' { npm run e2e:pdv }) -ne 0) { Falha 'npm run e2e:pdv (funcional)' }
Ok 'funcional PDV 49/49'

# ------------------------------------------------------------------ 4. commit + push staging
Etapa '4/7' 'Commit + push da branch staging'
$arquivos = @(
  'AGENTS.md', 'e2e/pdv-funcional.cjs', 'scripts/release-0012.ps1', 'src/components/FecharContaModal.tsx',
  'src/components/PixQrModal.tsx', 'src/components/RelatorioFechamento.tsx', 'src/lib/pix.ts', 'src/app/pdv/Pdv.tsx', 'src/app/pdv/actions.ts',
  'package.json', 'package-lock.json',
  'supabase/migrations/0012_estoque_negativo.sql', 'supabase/preflight/0012_preflight.sql',
  'supabase/rollback/0012_rollback.sql', 'supabase/tests/0012_test.sql'
)
git add -- $arquivos
git commit -m "feat(pdv): estoque negativo na venda (0012) + QR Code PIX ao receber + conta mais rapida + relatorio impresso do fechamento" -m "0012: estoque_movimentar aceita saldo negativo em saida_venda e consumo_ficha; transferencia, perda e inventario continuam travados. Trava por empresa em tenants.config.estoque.permitir_negativo (sem a chave = permitido). Fechar conta: botao Voltar visivel. P14 do e2e:pdv liga a trava so durante o teste. Receber (balcao e conta, menos credito) pergunta Gerar QR Code PIX? - BR Code estatico com valor (src/lib/pix.ts, CRC16 conferido com o exemplo do BCB), chave em tenants.config.pix (so master cadastra); pagou pelo QR grava como PIX. Conta: +/- e leitor otimistas (tela na hora, banco grava atras), fechar espera gravar; confirmacao +18 dentro do Fechar conta. Relatorio de fechamento impresso (A4/80mm): abre sozinho ao fechar o turno e como leitura parcial com o caixa aberto - vendas por forma, descontos, sangrias/suprimentos, recebimentos de credito, esperado x contado, produtos vendidos, assinaturas. pgTAP 8/8, e2e 28/28, e2e:pdv 49/49." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | Out-Host
if ($LASTEXITCODE -ne 0) { Falha 'git commit (nada para commitar?)' }
if ((Rodar 'git push origin staging' { git push origin staging }) -ne 0) { Falha 'git push origin staging' }
$sha = (git rev-parse HEAD).Trim()
Ok "commit $($sha.Substring(0,7)) enviado para staging"

# ------------------------------------------------------------------ 5. CI
Etapa '5/7' "Esperando o CI do commit $($sha.Substring(0,7)) (ate 25 min)"
$fim = (Get-Date).AddMinutes(25)
$conclusao = ''
while ((Get-Date) -lt $fim) {
  Start-Sleep -Seconds 30
  $runs = (gh run list --branch staging --limit 10 --json headSha,status,conclusion | Out-String) | ConvertFrom-Json
  $run = $runs | Where-Object { $_.headSha -eq $sha } | Select-Object -First 1
  if ($run -and $run.status -eq 'completed') { $conclusao = $run.conclusion; break }
  Write-Host "    CI: $(if ($run) { $run.status } else { 'ainda nao apareceu' })..."
}
if ($conclusao -ne 'success') { Falha "CI do commit $($sha.Substring(0,7)) nao ficou verde (conclusao: '$conclusao')" }
Ok 'CI verde'

# ------------------------------------------------------------------ 6. banco PRODUCAO
Etapa '6/7' 'Banco PRODUCAO: preflight -> db push -> pgTAP 0012 -> link de volta ao staging'
$script:linkadoProducao = $true
if ((Rodar 'link producao' { npx supabase@latest link --project-ref $REF_PRD }) -ne 0) { Falha 'link producao' }
if ((Rodar 'preflight 0012 producao' { npx supabase@latest db query --linked --file supabase/preflight/0012_preflight.sql }) -ne 0) { Falha 'preflight 0012 na PRODUCAO' }
Ok 'preflight 0012 producao'
if ((Rodar 'db push producao' { npx supabase@latest db push --yes }) -ne 0) { Falha 'db push na PRODUCAO' }
Ok '0012 aplicada na producao'
if ((Rodar 'pgTAP 0012 producao' { npx supabase@latest db query --linked --file supabase/tests/_gate_0012.sql }) -ne 0) { Falha 'pgTAP 0012 na PRODUCAO (algum teste falhou)' }
Ok 'pgTAP 0012 producao: 8/8'
if ((Rodar 'link staging (volta)' { npx supabase@latest link --project-ref $REF_STG }) -ne 0) { Falha 'link de volta ao staging' }
$script:linkadoProducao = $false
Ok 'vinculo da CLI de volta ao STAGING'

# ------------------------------------------------------------------ 7. codigo PRODUCAO
Etapa '7/7' 'Codigo PRODUCAO: merge --ff-only origin/staging -> push main'
Set-Location $PRD
if ((Rodar 'git fetch' { git fetch origin }) -ne 0) { Falha 'git fetch na producao' }
if ((Rodar 'git merge --ff-only' { git merge --ff-only origin/staging }) -ne 0) { Falha 'merge --ff-only na producao' }
if ((Rodar 'git push origin main' { git push origin main }) -ne 0) { Falha 'git push origin main' }
$main = (git rev-parse --short HEAD).Trim()
Ok "main = $main (Vercel publica em ~2 min: https://adega-sb.vercel.app)"
Set-Location $STG

Write-Host ''
Write-Host "RELEASE 0012 CONCLUIDO - main = $main" -ForegroundColor Green
Log "RELEASE 0012 CONCLUIDO - main = $main - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
