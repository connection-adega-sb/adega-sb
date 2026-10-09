# AGENTS.md — ADEGA SB

> **Doc viva.** Criado em 2026-10-08 · Última atualização: **2026-10-09 15:10** (rotação da `sb_secret_` do staging concluída — nova chave validada, `e2e:pdv` 27/27 re-executado; F3 PDV + catálogo mínimo **em staging E produção**: `0003` nas duas bases, seed de demonstração nas duas, `/pdv` no ar, E2E funcional 27/27).
> **Status:** Fase 0 CONCLUÍDA · Fase 1 **CONCLUÍDA EM STAGING E PRODUÇÃO** (`https://adega-sb.netlify.app`, branch `main`) · **F3 PDV + catálogo mínimo CONCLUÍDO EM STAGING E PRODUÇÃO** (release 09/10 12:49–13:06, ritual §6) · próxima: fechar F1 §7.0 / catálogo profundo (**`0004` livre**).
> Leia também: `F:\Projetos\adega-sb-docs\HANDOFF-IA.md` (documento global de passagem). Toda decisão nova entra aqui **no mesmo commit** da mudança.

## Regra nº 1 — um passo por vez, com validação

Ao orientar o Joaquim: **uma ação por mensagem** (um bloco de comando, uma consulta SQL ou um clique), com o **resultado esperado**. Só avance depois de ver a saída/print e validar ("Passo N validado"). Se não bateu, corrija o mesmo passo. Nunca mande os comandos dos passos seguintes antes. Mostre "Passo N de M".

## Custom Instructions: ADHD-Friendly Output

O desenvolvedor lendo isso tem TDAH. Formate TODAS as respostas para que um cérebro com TDAH possa agir imediatamente.

1. **Comece com a próxima ação:** a primeira linha é um comando, caminho ou snippet. Zero preâmbulo.
2. **Numere tarefas:** listas curtas, um passo = uma ação, máximo 5 itens.
3. **Seja direto:** sem cordialidades nem fechamentos vazios.
4. **Estimativas exatas:** tempo em minutos.
5. **Estado visível:** reafirme o progresso a cada interação.

## Empresa

| Campo | Valor | Fonte |
|---|---|---|
| Nome empresarial | SIMONE ALVES NASCIMENTO 16167027889 | comprovante CNPJ (07/10/2026) |
| Nome fantasia | **ADEGA SB** (caixa-alta, brandbook de 08/10) | brandbook |
| CNPJ | 43.466.024/0001-43 · ATIVA desde 10/09/2021 | comprovante |
| Natureza / porte | Empresário Individual · porte **ME** no comprovante · cliente declara **MEI** | **divergência — pendência 1** |
| CNAEs | 47.23-7-00 (principal, bebidas) + 47.89-0-99 · 47.21-1-03 · 47.29-6-01 (tabacaria) · 47.55-5-02 · 47.21-1-02 · 47.72-5-00 · 47.89-0-05 | comprovante |
| Endereço declarado | R. Jerônimo de Ataíde, 10 · Jardim Silvinia · São Bernardo do Campo/SP · CEP 09791-290 | cliente (08/10) |
| Endereço no CNPJ | Estr. do Montanhão, 91134 · CEP 09791-250 | **divergente — pendência 2** |
| Telefones | (11) 4109-1988 (CNPJ) · WhatsApp (11) 98197-0910 | comprovante / cliente |

## Ambientes — dev/staging vs produção

| Ambiente | Pasta local | Branch | Banco (Supabase) | Deploy |
|---|---|---|---|---|
| **Staging/dev** (onde se trabalha) | `F:\Projetos\adega-sb-staging` | `staging` | `connection-adega-sb-staging` · `rogkczrtcfxurmnjvlwk` | local (`npm run dev`); branch deploy no Netlify a configurar |
| Produção (só recebe merge) | `F:\Projetos\adega-sb` | `main` | `connection-adega-sb` · `nhnlbptzjjibtmsgvcaw` | **Netlify** `adega-sb` → `https://adega-sb.netlify.app` (deploy automático em push de `main`) |
| Documentação | `F:\Projetos\adega-sb-docs` | fora do git | — | — |

Repositório: `https://github.com/connection-adega-sb/adega-sb` · branch padrão **`main`** (produção) · `staging` (trabalho). Em 2026-10-09 03:00 ambas em `818ff3d`.

**Nunca** editar código em `F:\Projetos\adega-sb`. Produção só recebe `git merge origin/staging` depois de CI verde e migrations aplicadas nas duas bases.

## Contas e credenciais (sem valores)

1. **Netlify:** time `connection-adega-sb`, projeto `adega-sb` (privado até o fechamento). Variáveis: `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (mesmo valor em todos os contextos — trocar por contexto ao ligar o branch deploy) · `SUPABASE_SECRET_KEY` **secret**, só no contexto Production (chave `netlifyproducao` do Supabase prod).
1. **GitHub:** `gh` tem 2 contas: `nuvem-de-papel` (outro projeto) e **`connection-adega-sb`** (ativa desde 09/10 00:22). `gh auth setup-git` já rodado. Identidade git **local** do repo: `Joaquim Mário <joaquimmscoelhoam@gmail.com>`. Antes de `push`, `gh auth status` deve mostrar `connection-adega-sb` ativa (`gh auth switch` troca).
2. **Supabase CLI:** `npx supabase@latest` (2.120.0), logado em 08/10; projeto vinculado (`link`) = **staging**. O `link` usou o login, sem pedir senha do banco.
3. **Segredos:** só em `.env.local` (fora do git) e nos painéis. Nomes: `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SECRET_KEY` (começa com `sb_secret_`; só servidor) · `SUPABASE_DB_URL` (pgTAP via psql). Futuros: `RESEND_API_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `IFOOD_CLIENT_ID/SECRET`.
4. **Pegadinha (08/10):** colaram o **JWT Secret** (começava com `-GrYw_`) no lugar da Secret key → `Invalid API key`. A chave certa fica em Project Settings → **API Keys → Secret keys** e começa com `sb_secret_`. O comando de gravação do `.env.local` (HANDOFF §5) recusa outra coisa.

## Fluxo obrigatório (código e banco)

1. Trabalhar em `F:\Projetos\adega-sb-staging`, branch `staging`.
2. Validar: `npm run type-check` → `npm run lint` → `npm run build` → `npm run e2e`, com `npm run dev` **parado**.
3. Commit + `git push` em `staging` → CI verde (`gh run watch <id> --exit-status`).
4. Migration: staging primeiro (ritual abaixo); produção **antes** do merge que deploya.
5. Merge em `main` (pasta de produção) é o **único** gatilho de produção.

## Ritual de migration (por migration, nas duas bases)

1. **Conferir numeração:** `Get-ChildItem supabase\migrations` → usar o próximo número livre. Hoje: `0001_acesso`, `0002_permissoes_data_api` → **próxima: `0003`** (PRD de catálogo e estoque).
2. **Preflight:** SQL Editor do projeto → colar `supabase/preflight/NNNN_preflight.sql` → `preflight NNNN OK`.
3. **Migration:** `npx supabase@latest link --project-ref <ref>` → `npx supabase@latest db push` → confirmar Yes. **Nunca** colar a migration no SQL Editor (o `db push` tentaria de novo). Se precisar: `npx supabase@latest migration repair --status applied NNNN`.
4. **pgTAP:** `Get-Content supabase\tests\NNNN_test.sql -Raw | docker run --rm -i postgres:17 psql "<string do Session pooler>" -v ON_ERROR_STOP=1` (Docker aberto; use o **Session pooler**, a conexão Direct pode falhar no Windows). Gate: nenhum `not ok`. O SQL Editor mostra só o último resultado — não serve como gate.
5. **Depois de produção:** voltar o vínculo para staging: `npx supabase@latest link --project-ref rogkczrtcfxurmnjvlwk`.
6. **Toda migration termina com `grant` explícitos** (o projeto NÃO concede nada em tabela nova — ver Fase 1, item 6) e o pgTAP confere com `has_table_privilege`.

## Regras permanentes de sessão

1. Validação antes de todo commit (fluxo acima).
2. Numeração de migration conferida na pasta, nunca de memória.
3. Este arquivo é parte da entrega: decisão nova entra aqui no mesmo commit.
4. Documentação viva em `F:\Projetos\adega-sb-docs`: `HANDOFF-IA.md`, `parecer-acesso-enterprise.md`, `roadmap-enterprise.md`, `PRD-*.md`, `auditoria-cisa-AAAA-MM-DD.html` (nova data a cada entrega).
5. CI vermelha = não faz merge.
6. Número só de execução real ou leitura no código; "não existe" só com busca negativa.
7. **Manter o que já temos:** protótipos e especificação (`adega-sb-docs\referencia\`) são o contrato funcional.
8. Um passo por vez com validação (Regra nº 1).

## Pegadinhas do Windows / PowerShell

1. SQL (`select ...`) vai no **SQL Editor** do navegador; `cd`, `npx`, `node`, `npm`, `git`, `gh` vão no **PowerShell**.
2. `npm run <script> -- arg "Nome Composto"` perde as aspas no PowerShell → rodar `node` direto: `node --env-file=.env.local scripts/criar-master.mjs email "Nome Completo"`.
3. Colar vários comandos de uma vez gruda linhas (`db pushcd ...`). Colar um bloco e esperar o `PS F:\...>` voltar.
4. Arquivos gravados por PowerShell: `-Encoding ascii` (sem BOM).

## Testes

1. **E2E do produto** — duas suítes. **Gates:** `npm run e2e` (`e2e/run.cjs`) — guarda o `.env.local`, faz build própria em `.next-e2e` **sem** ele, roda `e2e/acesso-gate.cjs` (portas 3101/3102) e devolve o `.env.local`. Sem banco: valida fail-closed (sem env → 503; sem sessão → `/login?next=`). **Hoje: 21/21** — roda na CI a cada push. **Funcional:** `npm run e2e:pdv` (`e2e/pdv-funcional.cjs`) — **só local** (precisa `.env.local` real + seed): cria o usuário `caixa.e2e@adega-sb.invalid` via service role, sobe o build em 3103 e exercita o PDV de verdade (leitor, multiplicador, mesma-linha, busca, desconto, estoque baixo, +18, recusa de estoque do servidor, venda real com baixa no banco, sangria acima do teto, fechamento "Caixa confere.", drawer mobile 390 px). **Hoje: 27/27** (máquina do Joaquim, 09/10 12:48; re-executado 15:05 após a rotação da `sb_secret_`). Comparação de dinheiro na suíte precisa de `.replace(/[\u00A0\u202F]/g,' ')` (pt-BR usa espaço inquebrável).
2. **pgTAP** — `0001_test.sql` (27) + `0002_test.sql` (14) + `0003_test.sql` (18) = **59/59 nas DUAS bases** (staging e produção). Em produção roda sem senha via `node scripts/gate-pgtap.cjs supabase/tests/000X_test.sql supabase/tests/_gate_000X.sql` + `supabase db query --linked --file ...` (o gate derruba o comando se `num_failed() > 0`).
3. **Protótipos** — `adega-sb-docs\referencia\qa\proto-adega.cjs`: **40/40** (2026-10-08 17:50 UTC).
4. **Validação manual no staging (2026-10-08/09):** master criado e logado · troca de senha obrigatória (master e caixa) · usuário Caixa no local Loja criado pela tela · Caixa não vê "Usuários e acessos" · Caixa recebe **403** em `/admin/usuarios` (09/10 00:10) · área Protótipos lista 4 cards (09/10 01:02).

## Fase 1 — Acesso e identidade (2026-10-08 → 09)

1. **Entrega:** Next.js 15.5 + React 19 + TS + Tailwind 4 + `@supabase/ssr`. `src/middleware.ts` (fail-closed), `src/lib/papeis.ts` (10 papéis + acesso por rota), `src/lib/sessao.ts`, rotas `/login`, `/painel`, `/conta/senha`, `/admin/usuarios` (master), `/prototipos` (master/gerente), `/sem-acesso`, `/indisponivel`, `/api/health`; `scripts/criar-master.mjs`.
2. **Regras:** sem env → 503 · sem sessão → `/login?next=` · sem perfil/ativo/papel → 403 · `next` só caminho interno · papel por local (`profile_locais`); master/gerente = todos.
3. **Banco:** `0001_acesso` (tenants, locais loja/bar/depósito, profiles, profile_locais, audit_log append-only; RLS deny-all + 2 policies de leitura própria) · `0002_permissoes_data_api` (grants mínimos; revoga TRUNCATE/TRIGGER/REFERENCES).
4. **Pegadinha:** fonte via `@fontsource/source-sans-3` (build sem rede externa).
5. **Pegadinha:** `.gitignore` → `.env*` (exceto `!.env.example`), `supabase/.temp/` (cache do CLI com o endereço do pooler — tirado do 1º commit em 09/10), `/.next-e2e/`.
6. **Pegadinha (08/10 16:50):** o projeto Supabase **não concede** SELECT/INSERT/UPDATE/DELETE em tabela nova (só REFERENCES/TRIGGER/TRUNCATE) → `0002`. Regra: grants explícitos em toda migration.
7. **Pegadinha:** protótipos em `public/prototipos/` usam `X-Frame-Options: SAMEORIGIN` (o PDV abre o site num quadro); o resto do app usa `DENY` (`next.config.ts`).
8. **Pegadinha (CI):** avisos de Node.js 20 nas actions e migração do `ubuntu-latest` para Ubuntu 26 em 19/10/2026 → atualizar para `actions/checkout@v5` e `actions/setup-node@v5`.

## Produção (no ar desde 2026-10-09 03:30)

1. **URL:** `https://adega-sb.netlify.app` (Netlify, deploy automático em push de `main`). Supabase prod: Site URL e Redirect `https://adega-sb.netlify.app/**`.
2. **Banco:** `0001` + `0002` aplicadas (preflight OK, 3 locais, RLS 5/5, grants conferidos, pgTAP 41/41). Master `joaquimmscoelhoam@gmail.com` criado pela pasta de produção.
3. **Ritual de release (staging → produção):** validar no staging (type-check, lint, build, e2e) → commit/push `staging` → CI verde → migrations novas em produção (preflight → `link` prod → `db push` → pgTAP → **`link` de volta ao staging**) → na pasta de produção: `git fetch; git merge --ff-only origin/staging; git push origin main` → Netlify publica → smoke test.
4. **Pegadinha (09/10):** a secret de produção apareceu num print com o "olho" aberto → **rotacionada** (nova `netlifyproducao`, antiga apagada). Regra: nunca clicar no olho de secret; copiar pelo botão.
5. **Pegadinha (09/10):** o Netlify serve arquivo estático antes da rota do Next — `public/prototipos/index.html` respondia em `/prototipos/`. Nunca criar `index.html` dentro de `public/<rota-do-app>/`.
6. **Pegadinha:** projeto Netlify "Private" exige login no Netlify (janela anônima vê "This site is private").

## Referência funcional (2026-10-07) — "o que já tínhamos"

1. Protótipos HTML: PDV (`pdv.html`, com site e app do cliente), Site, Vendas, Compras — em `adega-sb-docs\referencia\prototipos\` e dentro do app em `/prototipos` (só master/gerente). Dados **só no navegador**.
2. Especificação: `modulo-pdv.md` (53 regras), `modulo-vendas.md` (55), `modulo-compras.md` (29) = **137 regras**, **32 tabelas desenhadas**.
3. Cada protótipo vira módulo real: estoque F2 · PDV F3 · bar F4 · delivery/site F5 · plataformas F6 · distribuidora F7 · compras F8.
4. Pegadinha: no produto, todo valor é recalculado no servidor (nunca total vindo do navegador).

## Identidade visual

1. Brandbook 2026: azul `#232F3E`, laranja `#FF9900` (só marca/destaque), ação `#A85F00` (AA), pérola `#E9EAEC`, Source Sans 3.
2. Kit oficial em `adega-sb-docs\identidade-visual\`. **Pegadinha:** `symbol-*` = `logo-*` (kit sem símbolo isolado) → símbolo e favicons **provisórios** derivados (`public/brand/simbolo-*`, `src/app/icon.png`).

## Regras de negócio herdadas (valem para os próximos módulos)

1. Item `adulto`: confirmação de maioridade no PDV e no site/app (Lei 13.106/2015).
2. Item `fumigeno`: nunca fracionado, só embalagem lacrada, +18, fora do site e do app (Lei 9.294/1996).
3. Copão: CMV pela ficha técnica, markup 2,5 (2,0–3,0), arredonda ao múltiplo de R$ 5 mais próximo; fracionado arredonda para cima.

## Regras de modelagem

1. UUID v4 · 2. `tenant_id` em toda tabela de negócio · 3. `local_id` onde há fato físico · 4. RLS deny-all + policy explícita · 5. **grants explícitos** · 6. sem JSON para dado consultável (exceção: snapshot de auditoria e payload bruto de webhook) · 7. dinheiro `numeric(12,2)`, quantidade `numeric(12,3)`.

## Pendências nomeadas

1. **Enquadramento e CNAE** (cliente + contador): MEI × ME; sem CNAE de bar, atacado e transporte. Bloqueia o fiscal.
2. **Endereço** (cliente): CNPJ no Montanhão × operação no Jardim Silvinia; IE a informar; confirmar grafia "Silvinia" × "Silvina".
3. ~~Produção~~ **RESOLVIDA 09/10** (roteiro de 24 passos executado; ver seção Produção).
4. ~~pgTAP nas bases~~ **RESOLVIDA 09/10:** 41/41 em staging e em produção.
5. **PDV em /prototipos no Netlify:** o Netlify servia `public/prototipos/index.html` no lugar da página `/prototipos` → arquivo renomeado para `pdv.html` (commit de correção). Validar em produção após o merge.
6. **Símbolo e favicons oficiais** (designer).
7. **CI**: actions v5 (avisos de 09/10).
8. ~~Netlify~~ **RESOLVIDA 09/10:** hospedagem = Netlify (Vercel fora da stack). Pendente: branch deploy do `staging` com chaves de staging por contexto.
9. **Referências não anexadas:** `QA-PROCEDIMENTO-TESTES.md`, `GOVERNANCA-IA-E-DESENVOLVIMENTO.md`.
10. **Usuário de teste `CaixaTeste`** (`providercyber@gmail.com`) existe no staging — manter só no staging.
11. ~~**Rotação da `sb_secret_` do staging**~~ — **RESOLVIDA 09/10 15:01–15:05**: cliente gerou nova chave no Supabase (Project Settings → API Keys → **New secret key**, nome `netlifystaging`), salvou em `nova-secret-staging.txt`; a IA trocou no `.env.local` sem ecoar o valor, validou (chamada real: 28 produtos no staging), re-executou `e2e:pdv` **27/27** com a chave nova e apagou o arquivo. Chave antiga (colada no chat em 09/10) morta no painel.
12. **Catálogo de demonstração nas duas bases** (28 produtos, estoques fictícios, `motivo='carga inicial do catalogo de exemplo'`): substituir pelo catálogo real na fase 2 (0004) — apagar os de exemplo antes de importar.

---

**Contadores vivos** (2026-10-09 15:10): migrations **3** (`0001`, `0002`, `0003`) — **aplicadas nas duas bases** (staging e produção) · tabelas: **14** (14 com RLS) · pgTAP **59/59** (`0001` 27 + `0002` 14 + `0003` 18) em local, staging e produção · E2E: gates **21** (CI) + funcional PDV **27** (`npm run e2e:pdv`, local; **re-executado 09/10 15:05 com a `sb_secret_` rotacionada, 27/27**) · CI verde em `8ac5738`, `818ff3d`, `63cb16b`, `429e598`, `a63100b`, `742f566` (staging **e** main), `3887390` (staging `37956389987` + main `37956669676`), `f38bf9d` (docs, `37964264268`) · rotas **13** + middleware · seed de demonstração: **28 produtos / 9 categorias / 1 caixa** nas duas bases · usuários: staging **2**, produção **1** (master) · protótipo **40/40** · especificação **137** regras / **32** tabelas.
