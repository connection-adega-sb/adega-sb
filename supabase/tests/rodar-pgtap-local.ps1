# rodar-pgtap-local.ps1 · valida migrations + pgTAP num Postgres 17 local (Docker).
# Por quê: `supabase db query --linked` executa cada statement numa transação separada — não serve
# para teste transacional (plan/finish + rollback + dados de teste). Aqui roda um psql único.
# Uso: powershell -ExecutionPolicy Bypass -File supabase\tests\rodar-pgtap-local.ps1 [-Manter]
param(
  [string]$Porta   = "54329",
  [string]$Senha   = "pgtap_local_0004",
  [string]$PsqlExe = "docker exec -i adega-pgtap-0004 psql -U postgres -d postgres",
  [switch]$Manter  # mantém o container no fim (para depurar)
)
$ErrorActionPreference = "Stop"
# pasta do repo: .../adega-sb-staging (3 níveis acima deste arquivo em supabase/tests/)
$raiz = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
Set-Location $raiz
$tmp = $env:TEMP

function Passo($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "    OK  $m" -ForegroundColor Green }

# Roda um arquivo .sql dentro do container (psql único, ON_ERROR_STOP). Lança exceção se o psql falhar.
function Rodar-Sql([string]$arqSql, [string]$rotulo) {
  $entrada = (Resolve-Path $arqSql).Path
  $saida   = Join-Path $tmp ("pgtap_" + [IO.Path]::GetRandomFileName() + ".out")
  cmd /c "docker exec -i adega-pgtap-0004 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -A -t < `"$entrada`" > `"$saida`" 2>&1"
  $codigo = $LASTEXITCODE
  $texto  = if (Test-Path $saida) { Get-Content $saida -Raw } else { "" }
  Remove-Item $saida -ErrorAction SilentlyContinue
  if ($codigo -ne 0) { Write-Host $texto; throw "psql falhou em '$rotulo' (exit $codigo)" }
  return $texto
}

# 0. Docker de pé?
Passo "Checando Docker..."
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker não respondeu. Abra o Docker Desktop e rode de novo." }
Ok "Docker respondendo"

$container = "adega-pgtap-0004"
Passo "Subindo postgres:17 na porta $Porta..."
cmd /c "docker rm -f $container >nul 2>&1"
docker pull postgres:17 *> $null
docker run -d --name $container -e POSTGRES_PASSWORD=$Senha -p "${Porta}:5432" postgres:17 *> $null

# Espera aceitar conexões
Passo "Esperando o Postgres aceitar conexões..."
$pronto = $false
for ($i = 0; $i -lt 40; $i++) {
  cmd /c "docker exec $container pg_isready -U postgres >nul 2>&1"
  if ($LASTEXITCODE -eq 0) { $pronto = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $pronto) { cmd /c "docker logs $container >`"$tmp\pgtap_log.txt`" 2>&1"; throw "Postgres não ficou pronto em 80s (log em $tmp\pgtap_log.txt)." }
Ok "Postgres pronto"

try {
  # 1. pgTAP embutido (a imagem base não traz; pacote oficial PGDG)
  Passo "Instalando pgTAP no container (postgresql-17-pgtap)..."
  cmd /c "docker exec $container bash -c `"apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq postgresql-17-pgtap >/dev/null 2>&1`""
  if ($LASTEXITCODE -ne 0) { throw "falha ao instalar postgresql-17-pgtap" }
  Ok "pgTAP instalado"

  # 2. Extensões + shim de auth (roles, auth.users, auth.uid) — mesmos nomes das bases Supabase
  Passo "Preparando extensões + shim de auth..."
  Rodar-Sql "supabase\tests\_local_auth_shim.sql" "_local_auth_shim" | Out-Null
  foreach ($ext in @(
    "create extension if not exists pgcrypto;",
    "create extension if not exists pg_trgm;",
    "create schema if not exists extensions;",
    "create extension if not exists pgtap with schema extensions;",
    # no Supabase real authenticated/anon/service_role têm USAGE em extensions; sem isso,
    # o teste que faz `set local role authenticated` não enxerga as funções do pgTAP
    "grant usage on schema extensions to anon, authenticated, service_role;"
  )) {
    $f = Join-Path $tmp "pgtap_ext.sql"; Set-Content $f $ext -Encoding UTF8
    Rodar-Sql $f $ext | Out-Null
  }
  Ok "ambiente base pronto"

  # 3. As 5 migrations em ordem (0001 cria tenant + 3 locais; 0005 é a nova)
  Passo "Aplicando migrations 0001 → 0005..."
  foreach ($n in @("0001_acesso", "0002_permissoes_data_api", "0003_pdv_catalogo", "0004_catalogo_estoque", "0005_bar")) {
    $arq = "supabase\migrations\$n.sql"
    if (-not (Test-Path $arq)) { throw "migration não encontrada: $arq" }
    Rodar-Sql $arq $n | Out-Null
    Ok "$n aplicada"
  }

  # 4. Testes anteriores (estruturais): 0001 (27) + 0002 (14) + 0003 (18) = 59
  Passo "Rodando pgTAP 0001 + 0002 + 0003 (esperado 59/59)..."
  $totalAntes = 0
  foreach ($t in @("0001_test", "0002_test", "0003_test")) {
    $gate = "supabase\tests\_gate_local_$t.sql"
    node scripts\gate-pgtap.cjs "supabase\tests\$t.sql" $gate | Out-Null
    $saida = Rodar-Sql $gate $t
    Remove-Item $gate -ErrorAction SilentlyContinue
    $falhas = ($saida -split "`n" | Where-Object { $_ -match "^not ok" })
    $oks    = ($saida -split "`n" | Where-Object { $_ -match "^ok " })
    if ($falhas.Count -gt 0) { Write-Host $saida; throw "$($t): $($falhas.Count) assert(s) falharam" }
    $totalAntes += $oks.Count
    Ok "$t · $($oks.Count) asserts, 0 falhas"
  }

  # 5. Teste da 0004 (comportamental: transferência, inventário cego, fichas, venda de copão)
  Passo "Rodando pgTAP 0004 (40 asserts, comportamental)..."
  $gate4 = "supabase\tests\_gate_0004.sql"
  node scripts\gate-pgtap.cjs "supabase\tests\0004_test.sql" $gate4 | Out-Null
  $saida4 = Rodar-Sql $gate4 "0004_test"
  $falhas4 = ($saida4 -split "`n" | Where-Object { $_ -match "^not ok" })
  $oks4    = ($saida4 -split "`n" | Where-Object { $_ -match "^ok " })
  Write-Host ($saida4 -split "`n" | Where-Object { $_ -match "^(ok|not ok)" })
  if ($falhas4.Count -gt 0) { throw "0004: $($falhas4.Count) assert(s) falharam" }
  $totalAntes += $oks4.Count

  # 6. Teste da 0005 (comportamental: mesas, comandas, dividir, aceite F4 do copão no bar)
  Passo "Rodando pgTAP 0005 (40 asserts, comportamental)..."
  $gate5 = "supabase\tests\_gate_0005.sql"
  node scripts\gate-pgtap.cjs "supabase\tests\0005_test.sql" $gate5 | Out-Null
  $saida5 = Rodar-Sql $gate5 "0005_test"
  Remove-Item $gate5 -ErrorAction SilentlyContinue
  $falhas5 = ($saida5 -split "`n" | Where-Object { $_ -match "^not ok" })
  $oks5    = ($saida5 -split "`n" | Where-Object { $_ -match "^ok " })
  Write-Host ($saida5 -split "`n" | Where-Object { $_ -match "^(ok|not ok)" })
  if ($falhas5.Count -gt 0) { throw "0005: $($falhas5.Count) assert(s) falharam" }

  Write-Host ""
  Write-Host "PGTAP LOCAL: TUDO VERDE — $($totalAntes - $oks4.Count) anteriores + $($oks4.Count) da 0004 + $($oks5.Count) da 0005" -ForegroundColor Green
}
finally {
  if ($Manter) { Write-Host "container '$container' mantido na porta $Porta (para depurar)" -ForegroundColor Yellow }
  else { Passo "Derrubando container..."; cmd /c "docker rm -f $container >nul 2>&1"; Ok "limpo" }
}
