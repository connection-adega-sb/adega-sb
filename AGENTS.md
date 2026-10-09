# AGENTS.md — Adega SB

> **Doc viva.** Criado em 2026-10-08 · Última atualização: 2026-10-08 15:00 (Fase 1 codificada e validada localmente; kit oficial de identidade aplicado).
> **Status:** Fase 0 CONCLUÍDA · Fase 1 **PARCIAL** — código em `F:\Projetos\adega-sb-staging` validado local (type-check, lint, build 11 rotas, E2E 17/17, pgTAP 27/27 em Postgres local); **falta**: primeiro push, migration 0001 nas 2 bases Supabase, deploy Vercel.
> Toda decisão nova de ambiente, fluxo, arquitetura ou convenção entra aqui **no mesmo commit** da mudança.

## Custom Instructions: ADHD-Friendly Output

O desenvolvedor lendo isso tem TDAH. Formate TODAS as respostas para que um cérebro com TDAH possa agir imediatamente.

**Regras Absolutas:**
1. **Comece com a próxima ação:** A primeira linha DEVE ser um comando, caminho ou snippet de código. Zero preâmbulos.
2. **Numere tarefas com múltiplas etapas:** Use listas numeradas curtas. Um passo = uma ação isolada. Máximo de 5 itens por lista.
3. **Seja Direto:** Sem frases de cordialidade. Remova fechamentos vazios.
4. **Estimativas Exatas:** Dê estimativas de tempo específicas (minutos).
5. **Estado Visível:** Reafirme o progresso e externalize o estado a cada interação.

## Empresa (fonte: comprovante CNPJ emitido em 07/10/2026 + declaração do cliente em 08/10/2026)

| Campo | Valor | Fonte |
|---|---|---|
| Nome empresarial | SIMONE ALVES NASCIMENTO 16167027889 | comprovante CNPJ |
| Nome fantasia | **ADEGA SB** (caixa-alta, como no brandbook atualizado em 08/10/2026; no CNPJ: `********`) | brandbook / comprovante |
| CNPJ | 43.466.024/0001-43 · aberto em 10/09/2021 · ATIVA | comprovante CNPJ |
| Natureza / porte | 213-5 Empresário (Individual) · porte **ME** no comprovante · cliente declara **MEI** | comprovante × declaração — **divergência, ver Pendências** |
| CNAE principal | 47.23-7-00 Comércio varejista de bebidas | comprovante |
| CNAEs secundários | 47.89-0-99 · 47.21-1-03 · 47.29-6-01 (tabacaria) · 47.55-5-02 · 47.21-1-02 · 47.72-5-00 · 47.89-0-05 | comprovante |
| Endereço declarado (08/10) | Rua Jerônimo de Ataíde, 10 · Jardim Silvinia · São Bernardo do Campo/SP · CEP 09791-290 | cliente |
| Endereço no CNPJ (07/10) | Estr. do Montanhão, 91134 · Montanhão · CEP 09791-250 | comprovante — **divergente** |
| Contato no CNPJ | (11) 4109-1988 · e-mail do comprovante | comprovante |
| WhatsApp da loja | (11) 98197-0910 | cliente (07/10) |
| Capital social | R$ 10.000,00 · QSA não se aplica à natureza jurídica | consulta QSA |

## Ambientes — dev/staging vs produção

| Ambiente | Pasta local | Branch git | Banco/Backend | Deploy |
|---|---|---|---|---|
| Produção | `F:\Projetos\adega-sb` | `main` | Supabase `connection-adega-sb` · ref `nhnlbptzjjibtmsgvcaw` | Vercel — dispara em push/merge em `main` |
| Staging/dev | `F:\Projetos\adega-sb-staging` | `staging` (ou qualquer branch != `main`) | Supabase `connection-adega-sb-staging` · ref `rogkczrtcfxurmnjvlwk` | Vercel Preview — push de branch != `main` |
| Documentação | `F:\Projetos\adega-sb-docs` | — (fora do repo de código) | — | — |

Repositório único: `https://github.com/connection-adega-sb/adega-sb` (`.git`).
**Estado em 2026-10-08 16:53 UTC:** `git ls-remote origin` → **0 refs** (sem commit). Em 2026-10-08 15:00 BRT o código da Fase 1 está pronto para o **primeiro push** na branch `staging` (passo a passo em "Primeiro push").

Stack declarada: GitHub · Supabase (PostgreSQL + Auth + RLS) · Vercel · Next.js + TypeScript (+ JavaScript) · Python (scripts/gerador) · Docker (Supabase local) · ngrok (webhooks em dev) · Mercado Pago (PIX/cartão) · Resend (e-mail) · Netlify (**papel a decidir** — ver Pendências; deploy oficial do app é Vercel).

Segredos: **só em env** (`.env.local` fora do git + painel Vercel/Supabase). Nunca em `.md`, nunca em commit. Nomes padrão:
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SECRET_KEY` (service role, só servidor) · `SUPABASE_DB_URL` · `RESEND_API_KEY` · `MP_ACCESS_TOKEN` · `MP_WEBHOOK_SECRET` · `IFOOD_CLIENT_ID` · `IFOOD_CLIENT_SECRET`.
Tokens de GitHub, Resend, anon e service_role existem (referências truncadas recebidas em 08/10) — **não copiar valores para cá**.

Migrations: Supabase CLI. Vincular e aplicar por base:

```powershell
cd F:\Projetos\adega-sb-staging
supabase link --project-ref rogkczrtcfxurmnjvlwk   # staging
supabase db push
```

Antes de criar a próxima migration, **conferir a numeração real** em `supabase/migrations/` (em 2026-10-08 16:55: `0001_acesso.sql` e `0002_permissoes_data_api.sql`; próxima livre **`0003`**, reservada ao PRD de catálogo e estoque).

## Primeiro push (uma vez só)

```powershell
cd F:\Projetos\adega-sb-staging
git init -b staging
git remote add origin https://github.com/connection-adega-sb/adega-sb.git
git add . ; git commit -m "Fase 1: fundação Next.js + acesso (migration 0001, login, middleware, E2E acesso-gate)"
git push -u origin staging
```

Pasta de produção (depois que a 0001 estiver nas duas bases e a CI verde):

```powershell
cd F:\Projetos
git clone https://github.com/connection-adega-sb/adega-sb.git adega-sb-tmp
Move-Item adega-sb-tmp\.git F:\Projetos\adega-sb\.git ; Remove-Item adega-sb-tmp -Recurse -Force
cd F:\Projetos\adega-sb ; git checkout -b main origin/staging ; git push -u origin main
```

## Ritual de migration (por migration, nas duas bases)

Ferramentas: Supabase CLI via `npx supabase@latest` (não precisa instalar; pede a senha do banco) e o **SQL Editor** do painel.

1. **Staging — preflight:** SQL Editor do projeto `rogkczrtcfxurmnjvlwk` → colar `supabase/preflight/NNNN_preflight.sql` → resultado `preflight NNNN OK`.
2. **Staging — migration:** `cd F:\Projetos\adega-sb-staging` → `npx supabase@latest link --project-ref rogkczrtcfxurmnjvlwk` → `npx supabase@latest db push` (registra em `supabase_migrations`; **nunca** aplicar a migration colando no SQL Editor, senão o `db push` tenta de novo).
3. **Staging — pgTAP:** SQL Editor → colar `supabase/tests/NNNN_test.sql` → `finish()` **sem linhas** = todos passaram; qualquer linha "Looks like you failed" = parar.
4. **Produção** (`nhnlbptzjjibtmsgvcaw`): repetir 1→3 com `link --project-ref nhnlbptzjjibtmsgvcaw` **antes** do merge em `main`.
5. Com psql instalado, o pgTAP mostra cada assert: `psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/NNNN_test.sql`.

## Fluxo obrigatório para qualquer mudança de código ou de banco

1. Trabalhar sempre em `F:\Projetos\adega-sb-staging`; nunca editar direto em `F:\Projetos\adega-sb`.
2. Validar local primeiro: `npm run type-check` → `npm run lint` → `npm run build` → `npm run e2e`.
3. Commit + push na branch `staging`, nunca direto em `main`.
4. Migration: aplicar/testar no banco de staging; depois **aplicar em produção (preflight → migration → pgTAP) ANTES do merge** que deploya. Pegadinha: rodar os comandos no **PowerShell 7 (`pwsh`)**; `supabase start`/teste local exige **Docker Desktop aberto**.
5. Só depois de validado, merge em `main` — único gatilho que toca produção.

Push ao GitHub: conta da organização `connection-adega-sb` via `gh auth login` (device flow). Token pessoal existe (referência truncada); expiração **a registrar aqui** no primeiro push.

Merge é local, sem PR: com CI verde, `cd F:\Projetos\adega-sb` → `git fetch` → `git merge origin/staging` → `git push origin main` (deploy dispara).

Essa regra vale para qualquer IA ou pessoa trabalhando neste projeto a partir de 2026-10-08, mesmo sem ser lembrada a cada tarefa.

## Regras permanentes de sessão (auto-aplicáveis)

1. **Validação antes de qualquer commit** — tudo em staging: `type-check` → `lint` → `build`, com o dev server **parado** antes do build.
2. **Migrations — conferir a numeração na pasta antes de criar** — listar `supabase/migrations/` e usar o próximo número livre; nunca confiar em memória de sessão. Nasce e é testada no staging; o mesmo SQL vai para produção só depois.
3. **Este arquivo faz parte da entrega** — decisão/padrão novo entra aqui no mesmo commit.
4. **Documentação viva** — decisões ficam em `F:\Projetos\adega-sb-docs`: `parecer-acesso-enterprise.md`, `roadmap-enterprise.md`, `PRD-*.md` por módulo e `auditoria-cisa-AAAA-MM-DD.html` (nova data a cada entrega). Comentário datado no código só em ponto não-óbvio.
5. **CI obrigatória** — todo push roda `.github/workflows/ci.yml` (lint → type-check → build → E2E). Vermelha = não faz merge. `gh run watch <id> --exit-status` (workdir dentro do repo). **Criada em 08/10; roda a partir do primeiro push.**
6. **Número só de execução real ou leitura no código** — afirmação "funciona" leva `arquivo:linha` ou "check executado"; "não existe" leva busca negativa.
7. **Manter o que já temos** — as regras e telas dos protótipos (pasta `adega-sb-docs\referencia\`) são o contrato funcional. Mudar uma regra exige registrar a mudança no PRD do módulo e aqui.

## Testes

1. **pgTAP** por migration: `supabase/tests/NNNN_test.sql` (+ `supabase/preflight/NNNN_preflight.sql` e `supabase/rollback/NNNN_rollback.sql`). Gate = `falhas = 0`, nas **duas bases** (ver "Ritual de migration"). **Hoje: 1 suíte (`0001_test.sql`, 27 asserts) — 27/27 em Postgres 18 local; nas bases Supabase: pendente.**
2. **E2E Playwright do produto** (`e2e/*.cjs`, Chromium): `npm run e2e` → `e2e/run.cjs` roda as suítes em ordem e para no primeiro FAIL. **Hoje: 1 suíte (`acesso-gate.cjs`) · última execução 2026-10-08: 17 checks, 17 PASS · 0 falhas.** A suíte sobe o build sozinha nas portas 3101/3102 (rode `npm run build` antes; nada pode estar ocupando essas portas). Primeira vez na máquina: `npx playwright install chromium`.
3. **Suíte dos protótipos (referência funcional, não é o produto):** `adega-sb-docs\referencia\qa\proto-adega.cjs` — **1 suíte · última execução 2026-10-08 17:50 UTC (reexecutada após logo e endereço novos): 40 checks, 40 PASS · 0 falhas** (`proto-adega.result.json`). Imprime `TOTAL:` no fim. Precisa de `QA_LIBS` apontando para uma pasta com `node_modules` (playwright, react 18 UMD, react-dom, @babel/standalone). É a **base de helpers** das suítes E2E do produto: cada check vira check do módulo real.
4. Smokes de produção (só leitura): `e2e/prod-smoke-*.cjs` — **a criar na Fase 1**.

## Acesso e identidade — Fase 1 (2026-10-08)

1. **Entrega** — Next.js 15.5 + React 19 + TypeScript + Tailwind 4; Supabase SSR (`@supabase/ssr`). Arquivos: `src/middleware.ts` (fail-closed), `src/lib/papeis.ts` (10 papéis + acesso por rota), `src/lib/sessao.ts` (`exigirSessao`), `src/app/login`, `src/app/painel`, `src/app/conta/senha`, `src/app/admin/usuarios` (só master; senha inicial exibida 1×), `scripts/criar-master.mjs` (`npm run master -- email "Nome"`), `supabase/migrations/0001_acesso.sql`.
2. **Regras** — sem env → 503 (`/indisponivel`); sem sessão → `/login?next=`; perfil inexistente/inativo ou papel sem acesso → 403 (`/sem-acesso`); `next` só aceita caminho interno (bloqueia `//host`); papel vale **por local** (`profile_locais`); master e gerente valem para todos os locais.
3. **Pegadinha** — fonte Source Sans 3 vem do pacote `@fontsource/source-sans-3` (servida pelo app), não do `next/font/google`: o build não depende de rede externa.
4. **Pegadinha** — `.gitignore` ignora `.env*`, com exceção `!.env.example`. Nunca commitar `.env.local`.
5. **Pegadinha** — o pgTAP insere em `auth.users` só `(id, email)`. Validado num Postgres 18 com esqueleto do Supabase; se a versão do Auth do projeto exigir outra coluna, o erro aparece no assert 18 → acrescentar a coluna no INSERT do teste (não na migration).
6. **Pegadinha (descoberta no staging, 08/10 16:50)** — o projeto Supabase **não concede** SELECT/INSERT/UPDATE/DELETE em tabela nova: `anon`, `authenticated` e `service_role` ficaram só com REFERENCES, TRIGGER, TRUNCATE. Sintoma: `criar-master` não lê o tenant e o login não acha o perfil. Correção: `0002_permissoes_data_api.sql` (concede o mínimo e revoga TRUNCATE/TRIGGER/REFERENCES). **Regra:** toda migration nova termina com os `grant` explícitos das tabelas que cria, e o pgTAP confere com `has_table_privilege`.
7. **Pegadinha** — `audit_log` é append-only (trigger recusa update/delete com 42501) e guarda `antes/depois` em `jsonb` (exceção registrada à regra 5 de modelagem: é snapshot de auditoria).
8. **Teste** — E2E `e2e/acesso-gate.cjs` **17/17** (local e na máquina do Joaquim, 08/10) · pgTAP `0001_test.sql` 27 + `0002_test.sql` 14 = **41/41** em Postgres 18 local com as permissões padrão iguais às do staging · **0001 aplicada no staging em 08/10 16:43** (`db push` OK; 3 locais conferidos no SQL Editor) · 0002 e pgTAP no staging: pendentes.
9. **Pendências** — aplicar 0002 no staging e 0001+0002 em produção (dev); criar master (cliente); deploy Vercel com env por ambiente (dev); suíte E2E de login real com usuário de teste no staging (dev, após a 0001); MFA para master/gerente (Fase 2).

## Referência funcional — protótipos (2026-10-07)

1. **O que existe** — 4 protótipos HTML (React 18 + Tailwind) gerados por um modelo único multimarca: PDV (com site da loja no mesmo link), Vendas, Compras, Site. Pasta `adega-sb-docs\referencia\prototipos\`. Especificação: `referencia\especificacao\modulo-pdv.md` (53 regras), `modulo-vendas.md` (55), `modulo-compras.md` (29) = **137 regras com ID**, **32 tabelas desenhadas** (`create table` nos três módulos) — contagem por leitura em 2026-10-08.
2. **Pegadinha** — os protótipos guardam estado no navegador (localStorage); no produto, todo valor (preço, total, taxa, status) é **recalculado no servidor**. Nunca confiar em total vindo do navegador (o protótipo já precisou de `toFixed(2)` para não gravar `83.88000000000001`).
3. **Pegadinha** — publicado como artifact, abrir o site em **nova aba** dá `ERR_BLOCKED_BY_RESPONSE`; o protótipo abre o site num quadro do próprio PDV. No produto a ponte é API (`pedidoApp` + status por SSE/consulta), não armazenamento do navegador.
4. **Teste** — `proto-adega.cjs` 40/40.

## Identidade visual (2026-10-07 · kit oficial 2026-10-08)

1. Brandbook 2026: azul profundo `#232F3E`, laranja `#FF9900`, grafite `#000`, pérola `#E9EAEC`, fonte Source Sans 3. Tokens em `referencia\especificacao\identidade-visual.md`. Brandbook atualizado em 08/10 (`adega-sb-docs\identidade-visual\ADEGA SB brandbook.pdf`): única mudança de texto = nome em caixa-alta **ADEGA SB** (cores e fontes iguais — diff do texto das 13 páginas).
2. **Kit oficial** (`identidade-visual\Print|Web|Social media`, 06/10): logo nas versões colour/black/white/reversed (PNG 2000×825, SVG, EPS, PDF) e favicons. App usa `public/brand/logo-colour.png` (colour com o azul tornado transparente) e `logo-black.png`.
3. **Pegadinha do kit** — os arquivos `symbol-*` são **idênticos** aos `logo-*` (SVG byte a byte; PNG mesma imagem): o kit não tem o símbolo isolado, e os favicons trazem o logo inteiro ("ADEGA SB" ilegível em 16–48 px). **Provisório:** símbolo (só o brinde) derivado do logo oficial → `public/brand/simbolo-*.png` e `src/app/icon.png`. Pedir ao designer o símbolo e os favicons oficiais.
4. **Pegadinha** — laranja `#FF9900` com texto branco = 2,1:1 (reprova WCAG). Botão de ação = `#A85F00` (4,9:1). `#FF9900` só no logo e em destaque sobre o azul (6,3:1).
5. **Pegadinha** — o logo já contém "ADEGA SB": o topo não repete o nome em texto (fica `sr-only`).
6. **Pegadinha (CSS)** — `backdrop-filter` no topo vira "containing block" de `position: fixed`; o menu móvel ficou preso no topo. Sem `backdrop-filter` no topo móvel.

## Vendas, delivery e site (2026-10-07)

1. **Decisão** — toda venda do caixa (F12) é venda padrão de balcão; F9 abre Vendas do dia (Balcão · Delivery · App); venda de balcão pode virar delivery (romaneio); pedido do app/site já nasce entrega (regras DL-01…DL-13).
2. **Pegadinha** — itens `adulto` exigem "maior de 18, documento conferido" no PDV e aceite no site/app (Lei 13.106/2015); confirmação de idade na entrada do site.
3. **Teste** — protótipo: `PDV-10`, `ST-02`, `ST-08`, `DL-13a`, `DL-13b` PASS.
4. **Pendências** — taxas por bairro e horários são de exemplo. ~~Bairros centrados no Montanhão~~ — **RESOLVIDA em 08/10**: protótipos com o endereço da R. Jerônimo de Ataíde, 10 (Jardim Silvinia, CEP 09791-290) e taxa base no Jardim Silvinia. Confirmar a grafia oficial do bairro no CEP ("Silvinia" × "Silvina").

## Precificação, copão e tabacaria (2026-10-07)

1. **Decisão** — ficha técnica do copão: custo na receita = preço ÷ embalagem × quantidade; CMV = soma; preço = CMV × markup (padrão 2,5; faixa 2,0–3,0), arredondado ao múltiplo de R$ 5 **mais próximo**. Fracionamento: custo ÷ unidades × (1 + margem), arredondado **para cima** (troco). Regras PR-01…PR-08.
2. **Pegadinha** — os dois arredondamentos são diferentes de propósito (copão: mais próximo; fracionado: para cima).
3. **Regra legal** — produto fumígeno (`fumigeno = true`) **nunca** é fracionado (venda de cigarro avulso é ilegal — Lei 9.294/1996 e ANVISA), só maço lacrado, sempre +18, **fora do site e do app**.
4. **Teste** — protótipo `PR-01`…`PR-06`, `PDV-09`, `ST-04` PASS.

## Regras de modelagem de dados (adotadas desde a 1ª migration)

1. Todo ID é UUID v4 (`gen_random_uuid()`) — nunca serial. (Os SQL de referência dos protótipos já seguem isso.)
2. Toda tabela de negócio carrega `tenant_id uuid not null` — nunca assume loja única (há **3 locais**: loja/balcão, bar, depósito; e futuras unidades).
3. Toda tabela de negócio com estoque ou venda carrega `local_id` quando o fato acontece em um local físico.
4. RLS ligado em **toda** tabela nova; deny-all por padrão; policy explícita por necessidade.
5. Nada de coluna JSON para dado consultável — vira tabela com índice. (Payload bruto de webhook — iFood, Mercado Pago — pode ficar em `jsonb` **só** na tabela de log da integração.)
6. Dinheiro em `numeric(12,2)`; quantidade em `numeric(12,3)` (ml, kg, fração de garrafa).

## Pendências nomeadas

1. **Enquadramento e CNAE** (cliente + contador) — comprovante mostra porte ME / Empresário Individual, sem CNAE de bar (56.11-2) nem de atacado/distribuidora de bebidas (46.35-4) nem de transporte; cliente declara MEI com funcionários, bar, depósito e distribuidora. Confirmar regime (MEI tem limite de faturamento, de empregado e lista fechada de atividades) **antes** do módulo fiscal.
2. **Endereço** (cliente) — CNPJ ainda no Montanhão (CEP 09791-250); operação declarada na Rua Jerônimo de Ataíde, 10 (CEP 09791-290). Atualizar RFB/Prefeitura/SEFAZ; IE a informar.
3. **Verificação dos bancos** (dev) — esta sessão não alcançou os dois projetos Supabase (conector sem acesso à organização; REST bloqueado pela rede). Rodar o inventário (parecer §1) **antes** do preflight da 0001.
6. **Símbolo e favicons oficiais** (designer) — o kit entregue repete o logo nos arquivos `symbol-*`; em uso: símbolo derivado provisório.
7. **Pasta `diversos`** (cliente) — `diversos\Adega_SB_docs` e `diversos\Adega_SB_PDV_e_site` são as versões de 07/10 03:31 (antes do site dentro do PDV, do copão/tabacaria e do endereço novo). Arquivar em `adega-sb-docs\_arquivo\2026-10-07`; a referência válida é `referencia\`.
4. **Referências citadas e não anexadas** — `QA-PROCEDIMENTO-TESTES.md` e `GOVERNANCA-IA-E-DESENVOLVIMENTO.md`: anexar para alinhar o procedimento de QA e governança.
5. **Netlify × Vercel** (cliente) — default: app no Vercel; Netlify sem papel até decisão.

---

**Contadores vivos** (2026-10-08 16:55): migrations **2** (`0001`, `0002`) · staging: 0001 aplicada · tabelas **5** previstas pela 0001 (5 com RLS) — nas bases Supabase **não verificado** · suítes pgTAP **2** / **41** asserts PASS (Postgres local) · E2E do produto **1** suíte / **17** checks PASS · rotas no build **11** + middleware · CI: workflow criada, **ainda não rodou no GitHub** · protótipo **1** suíte / **40** checks PASS · especificação **137** regras / **32** tabelas desenhadas.
