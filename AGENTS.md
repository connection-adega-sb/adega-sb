# AGENTS.md — ADEGA SB

> **Doc viva.** Criado em 2026-10-08 · Última atualização: **2026-10-10 03:26** (cadastro rápido de produto no meio da venda + login no módulo do papel CONCLUÍDOS EM STAGING E PRODUÇÃO: `0007` nas duas bases, pgTAP **173/173 nas três**, `/pdv` e `/bar` validados no browser, `e2e:pdv` 32/32).
> **Status:** Fase 0 CONCLUÍDA · Fase 1 **CONCLUÍDA EM STAGING E PRODUÇÃO** (`https://adega-sb.netlify.app`, branch `main`) · **F3 PDV + catálogo mínimo CONCLUÍDO EM STAGING E PRODUÇÃO** (release 09/10 12:49–13:06, ritual §6) · **Etapa 2 catálogo/estoque (`0004` + `/estoque`) CONCLUÍDA EM STAGING E PRODUÇÃO** (10/10 00:16) · **F4.1 bar — migration `0005` (mesas/comandas/copão) CONCLUÍDA EM STAGING E PRODUÇÃO** (10/10 00:54, ritual §6) · **`0006` (comanda_remover_item) + seed do bar (10 mesas + Caixa #02) + UI `/bar` CONCLUÍDOS EM STAGING E PRODUÇÃO** (10/10 02:30, ritual §6) · **`0007` produto_criar + cadastro rápido no meio da venda + login no módulo do papel CONCLUÍDOS EM STAGING E PRODUÇÃO** (10/10 03:26, ritual §6).
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

1. **Conferir numeração:** `Get-ChildItem supabase\migrations` → usar o próximo número livre. Hoje: `0001` … `0007` → **próxima: `0008`**.
2. **Preflight:** `npx supabase@latest db query --linked --file supabase/preflight/NNNN_preflight.sql` (com o link certo) → linha `preflight NNNN OK`. (O passo do SQL Editor do navegador virou rotina pela CLI a partir da 0007.)
3. **Migration:** `npx supabase@latest link --project-ref <ref>` → `npx supabase@latest db push --yes` (ver `--dry-run` antes para conferir a lista). **Nunca** colar a migration no SQL Editor (o `db push` tentaria de novo). Se precisar: `npx supabase@latest migration repair --status applied NNNN`.
4. **pgTAP:** `node scripts/gate-pgtap.cjs supabase/tests/NNNN_test.sql supabase/tests/_gate_NNNN.sql` + `npx supabase@latest db query --linked --file supabase/tests/_gate_NNNN.sql` → **exit 0** = todos passaram (o gate injeta `raise exception` antes do `rollback` se `num_failed() > 0`; a CLI só devolve o **último** statement, então o resumo `ok N -` que aparecer é só a última linha). Local: `powershell -ExecutionPolicy Bypass -File supabase\tests\rodar-pgtap-local.ps1` (container postgres:17 + pgTAP, roda as 7 migrations).
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
5. **`npm run build` durante um `next dev` ativo corrompe o dev server:** o build grava a produção em `.next`, a mesma pasta que o dev serve → a página fica presa em "Carregando estoque." e o console acusa `404` nos chunks com `MIME type ('text/plain')`. Correção: matar o dev (`Get-NetTCPConnection -LocalPort 3000` → `Stop-Process -Id <PID>`), `Remove-Item .next -Recurse -Force` e subir de novo. O `npm run e2e` é seguro (usa `.next-e2e` próprio).

## Testes

1. **E2E do produto** — duas suítes. **Gates:** `npm run e2e` (`e2e/run.cjs`) — guarda o `.env.local`, faz build própria em `.next-e2e` **sem** ele, roda `e2e/acesso-gate.cjs` (portas 3101/3102) e devolve o `.env.local`. Sem banco: valida fail-closed (sem env → 503; sem sessão → `/login?next=`). **Hoje: 23/23** (ganhou `A4d` e `B12` para `/bar`) — roda na CI a cada push. **Funcional:** `npm run e2e:pdv` (`e2e/pdv-funcional.cjs`) — **só local** (precisa `.env.local` real + seed): cria o usuário `caixa.e2e@adega-sb.invalid` via service role, sobe o build em 3103 e exercita o PDV de verdade (leitor, multiplicador, mesma-linha, busca, desconto, estoque baixo, +18, recusa de estoque do servidor, venda real com baixa no banco, sangria acima do teto, fechamento "Caixa confere.", drawer mobile 390 px) + **cadastro rápido no meio da venda** (`P28` login sem `next` → `/pdv`; `P29` busca sem resultado → cadastro com EAN preenchido; `P30` produto entra na comanda; `P31` `criado_por` + saldo + movimento `entrada`/`cadastro`; `P32` finaliza R$ 7,90 e confere `saida_venda` −1). **Hoje: 32/32** (máquina do Joaquim, 10/10 03:0x). No fim ele **desativa** o produto que criou (`ativo = false`) — sem isso o catálogo de demonstração acumula item novo a cada rodada (a `0007` dá para desativar, não para apagar: `estoque_movimentos` é append-only e tem FK no produto). Comparação de dinheiro na suíte precisa de `.replace(/[\u00A0\u202F]/g,' ')` (pt-BR usa espaço inquebrável).
2. **pgTAP** — `0001_test.sql` (27) + `0002_test.sql` (14) + `0003_test.sql` (18) + `0004_test.sql` (40) + `0005_test.sql` (40) + `0006_test.sql` (12) + `0007_test.sql` (22) = **173/173 nas TRÊS bases** (local, staging e produção) + **local** via `powershell -ExecutionPolicy Bypass -File supabase\tests\rodar-pgtap-local.ps1` (container postgres:17 + pgTAP, aplica as 7 migrations num psql único e derruba em qualquer `not ok`). Em produção/staging roda sem senha via `node scripts/gate-pgtap.cjs supabase/tests/000X_test.sql supabase/tests/_gate_000X.sql` + `supabase db query --linked --file ...` (o gate derruba o comando se `num_failed() > 0`). **Pegadinha 10/10:** o CLI novo recusa `--project-ref` — usar `db query --linked`. **Pegadinha 10/10:** a CLI devolve só o **último** statement de um arquivo multiplano — não serve para "ler o resumo do pgTAP"; por isso o gate e o `exit 0`.
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
2. **Banco:** `0001` … `0007` aplicadas (preflight OK nas duas, pgTAP **173/173** nas três bases). Master `joaquimmscoelhoam@gmail.com` criado pela pasta de produção.
3. **Ritual de release (staging → produção):** validar no staging (type-check, lint, build, e2e) → commit/push `staging` → CI verde → migrations novas em produção (preflight → `link` prod → `db push` → pgTAP → **`link` de volta ao staging**) → na pasta de produção: `git fetch; git merge --ff-only origin/staging; git push origin main` → Netlify publica → smoke test.
4. **Pegadinha (09/10):** a secret de produção apareceu num print com o "olho" aberto → **rotacionada** (nova `netlifyproducao`, antiga apagada). Regra: nunca clicar no olho de secret; copiar pelo botão.
5. **Pegadinha (09/10):** o Netlify serve arquivo estático antes da rota do Next — `public/prototipos/index.html` respondia em `/prototipos/`. Nunca criar `index.html` dentro de `public/<rota-do-app>/`.
6. **Pegadinha:** projeto Netlify "Private" exige login no Netlify (janela anônima vê "This site is private").

## Cadastro rápido no meio da venda + login no módulo do papel (2026-10-10 03:26)

1. **Pedido (10/10):** (a) entrar com usuário/senha já cair no módulo do papel; (b) em qualquer módulo de venda, cadastrar produto que ainda não está no catálogo, com o produto entrando na venda e o operador finalizando sem sair da tela.
2. **`0007_produto_criar`:** função `security definer` + `grant service_role` apenas; tenant derivado do `p_usuario` (**nunca** do navegador); valida tipo/unidade/conteúdo/categoria/EAN antes do insert; saldo inicial entra via `estoque_movimentar(... 'entrada' ... origem_tipo='cadastro')` (movimento auditado, `estoque_movimentos` segue append-only); coluna nova **`produtos.criado_por uuid references profiles(id)`** — a trigger `produtos_audit` (0003) grava a linha. **Papéis que podem cadastrar:** `master, gerente, caixa, bartender, estoquista` (const `PAPEIS_CADASTRO` em `src/app/produtos/actions.ts`); sem trava extra de saldo — a trilha é o `criado_por` + `motivo` em `estoque_movimentos` (flag para restringir depois se o cliente pedir).
3. **`rotaInicial(papel)`** (`src/lib/papeis.ts`): `/pdv` → `/bar` → `/estoque` → `/painel`, usando `papelPodeAcessar`. O papel é lido com `supabaseAdmin()` (o cookie de sessão ainda não vale no mesmo request); `next` explícito continua **vencendo** (`destinoSeguro`).
4. **`src/components/CadastroRapidoProduto.tsx`** (compartilhado por PDV e bar): o modal só monta o `FormData`, chama `criarProdutoRapido` direto (não `useActionState`), fecha e devolve o produto ao chamador. Esc tratado dentro do componente (via ref, para não re-registrar o listener).
5. **Bar — 3 pontos:** com comanda aberta e sem pendência +18 → `adicionarItem` direto; produto +18 → refetch e deixa selecionado na comanda pedindo confirmação de idade; sem comanda → refetch + troca p/ aba `mesas` com instrução. **PDV:** botão `+ Produto novo` + dica "busca sem resultado → Cadastrar este produto" com prefill de código de barras (`/^\d{6,}$/` decide nome × EAN); `onCriado` → `adicionar(p)` se o caixa estiver aberto, senão só aviso. O handler de teclado tem `if (cadastro) … return` **antes** de F2/F8/F12.
6. **Validado no navegador (10/10 03:0x):** login sem `next` → `/pdv` ✓ · comanda M01 com produto simples → faturado → baixa ✓ · +18 sem idade → não lança, pré-seleciona e mostra o aviso certo ✓ · sem comanda → troca de aba com instrução ✓ · Esc fecha ✓ · aba Venda rápida ✓ · no banco: `criado_por` = master, `entrada +24 (cadastro)`, `saida_venda −1`, saldo bar 23 ✓.

## PDV com o layout do protótipo + os 3 módulos do topo (2026-10-10)

1. **Pedido (10/10):** o `/pdv` real tem que ter **o layout de `/prototipos/pdv.html`** e os **3 botões do header funcionando** — com dado do **banco**, nunca com o dado de mentira do protótipo. O cliente recusou deixar os botões "para depois", porque o projeto foi desenhado seguindo os protótipos.
2. **Layout novo de `src/app/pdv/Pdv.tsx`** (raiz `flex h-dvh flex-col overflow-hidden`): header = logo + status `● PDV · <caixa> ABERTO/FECHADO · data` + select do caixa + os 3 botões + operador · `main` full-height com o `h1` "Ponto de venda - passe o leitor ou digite o produto", busca full-width (lupa à esquerda, badge do multiplicador, ✕ limpar, chip `Leitor ativo · F2` e `+ Produto novo` à direita) e o painel de resultados ocupando a sobra da altura (cabeçalho `Código/Produto/Estoque/Preço`, linha clicável com a qtd já na comanda, rodapé "N produtos encontrados", estados vazios: "Pronto para vender" com `↑↓ navega · Enter adiciona · 3* antes do termo…", "Caixa fechado" com `Abrir caixa`, "Nenhum produto encontrado" com `Cadastrar este produto`) · comanda em coluna com cabeçalho (ícone + badge + `Limpar`), corpo rolável, `role=alert` do aviso e rodapé (`Subtotal`, `% Desconto (R$)`, `Total a pagar`, forma de pagamento com ícones em `radiogroup`, valor recebido + troco quando é dinheiro, `+18`, `Caixa (F8)` / `Finalizar venda (F12)`). **Todos os `data-testid` e o comportamento dos atalhos foram preservados.**
3. **Tokens e ícones:** `globals.css` ganhou `--radius-panel`, `--shadow-card`, `--shadow-soft`, `--shadow-acao` e `--font-display` — **mesmos valores do `tailwind.config` embutido em `public/prototipos/pdv.html`** (sem eles `shadow-acao`/`rounded-panel` eram classe morta). `src/components/Icone.tsx` traz os traços 24×24 do protótipo (busca, código, carrinho, lixo, ±, %, caixa, globo, caminhão, usuário, cadeado, pacote, pix, cartão, dinheiro, loja, alerta) — sem biblioteca de ícone nova.
4. **Os 3 botões, todos com dado real** (server actions novas em `src/app/pdv/actions.ts`):
   - **Precificação** → `src/components/PrecificacaoModal.tsx` + `listarPrecificacao` / `aplicarPrecoVarejo`: as fichas da `0004` (`fichas_tecnicas` + `fichas_tecnicas_insumos`), CMV = **Σ (dose ÷ conteúdo) × `custo_medio`** (a mesma conta da `ficha_consumir`), markup, preço sugerido e margem. "Aplicar no PDV" grava `produtos.preco_varejo` (**só master/gerente** — o servidor recusa caixa) e **exige um 2º clique** quando o sugerido fica abaixo do preço atual (o markup 2,5 do seed produz preço menor que o praticado).
   - **Site da loja** → `src/components/SiteLojaModal.tsx` + `catalogoSite`: o catálogo real (`produtos` ativos + saldo somado de `estoque_saldos`), busca e chips de categoria; o rodapé declara que carrinho e pedido entram na fase F5.
   - **Vendas e entregas** → `src/components/VendasDiaModal.tsx` + `vendasDoDia` + tecla **F9** (entrou no handler de atalhos, atrás do guarda dos modais): aba **Balcão** com as vendas do dia (`vendas` + `venda_itens`, hora/canal/operador/itens/pagamento/total + card de faturado/ticket/dinheiro + total no pé); abas **Delivery** e **App** mostram as 5 colunas do kanban zeradas e o aviso de que **não existe tabela de pedido/entrega** — isso é F5.
5. **Validado:** `tsc` 0 · lint 0 · build OK · `npm run e2e` **23/23** · `npm run e2e:pdv` **32/32** · no navegador os 3 modais com dado real (3 fichas de copão, 28 produtos no ar, 15 vendas / R$ 206,35 no dia). **2 gates ajustados** por causa do layout: `P16` (`'Nenhum item ainda.'` → `'Nenhum item na comanda'`) e `P26` (o botão do drawer precisa continuar condicionado a `drawer`, senão ele fica no DOM e o `waitFor({state:'detached'})` estoura).

**Pegadinha desta entrega:** o E2E conta linhas com `[data-testid^="pdv-item-"]` — todo `data-testid` novo que começa com ``pdv-item-`` quebra a contagem (os meus usaram `pdv-site-item-`, `pdv-preco-item-`, `pdv-venda-`).

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
4. **Bar tem caixa próprio.** `copao_vender` (0005) recusa sessão de outro local (`sessao.local_id <> p_local`), então cada local bar precisa do próprio `caixas` + sessão aberta; `comanda_fechar` só exige mesmo tenant. O seed cria `Caixa #02 · Bar`.
5. **`comanda_fechar` não libera a mesa de propósito** — o log de status (`mesas_status_log`) fica auditável por etapa. O passo seguinte é `mesa_fechar`. A UI `/bar` chama os dois em sequência (e o `abrirMesa` se autocorrige: mesa com comanda já faturada → `mesa_fechar` + `mesa_abrir`), senão a mesa fica "ocupada" com uma comanda morta.
6. **`copao_vender` não recebe `p_maior18`** (só `comanda_adicionar` tem). O gate de +18 da venda avulsa é conferido na server action, no ponto de entrada do servidor.

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
12. **Catálogo de demonstração nas duas bases** (28 produtos, estoques fictícios, `motivo='carga inicial do catalogo de exemplo'`): substituir pelo catálogo real na fase 2 (0004) — apagar os de exemplo antes de importar. **Movimentação em 10/10:** o `e2e:pdv` zera estoque a cada rodada, então um inventário de teste (03:19) deixou os 28 produtos em saldo 0 — reposicionados com `entrada` auditada (`motivo='reposicionamento do catalogo de demonstracao'`) até a carga do catálogo real; e5 produtos de teste criados pelo E2E/cadastro rápido foram desativados (`ativo = false`, não dá para apagar: FK em `estoque_movimentos` que é append-only), deixando os 28 ativos do catálogo.
13. **"Entrei e o produto não existe"** — pedido do cliente resolvido em 10/10: cadastro no meio da venda no PDV e no bar (seção própria acima).
14. **Delivery/App não têm tabela** (F5): o botão **Site da loja** do PDV já abre o catálogo real, mas carrinho/checkout/pedido/entrega não existem no banco — por isso as abas **Delivery** e **App** do F9 aparecem zeradas com o aviso no lugar de inventar dado. Criar `pedidos`/`entregas` (migration `0008`) é o que destrava o quadro kanban e o próprio site.

---

**Contadores vivos** (2026-10-10 03:30): migrations **7** (`0001` … `0007`) — **aplicadas nas duas bases** (staging e produção) · tabelas: **25** (25 com RLS, 0 sem; `0006` e `0007` só criam função — a `0007` soma a coluna `produtos.criado_por`) · pgTAP **173/173** (`0001` 27 + `0002` 14 + `0003` 18 + `0004` 40 + `0005` 40 + `0006` 12 + `0007` 22) em local, staging **e** produção · E2E: gates **23** (CI) + funcional PDV **32** (`npm run e2e:pdv`, local; 10/10 03:0x) · CI verde em `8ac5738`, `818ff3d`, `63cb16b`, `429e598`, `a63100b`, `742f566` (staging **e** main), `3887390` (staging `37956389987` + main `37956669676`), `f38bf9d` (docs, `37964264268`), `f160349` (staging `38021745683` + main `38022074731`), **`4c339b8`** (staging `38030579329` + main `38030940909`) · rotas **15** + middleware · seed de demonstração: **28 produtos / 9 categorias / 2 caixas / 10 mesas / 3 copões** nas duas bases · usuários: staging **3**, produção **1** (master) · protótipo **40/40** · especificação **137** regras / **32** tabelas.
