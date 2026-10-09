# ADEGA SB — sistema de gestão

Balcão (PDV), bar, depósito, delivery, plataformas de entrega e distribuidora. Next.js 15 + TypeScript + Supabase.
Regras de trabalho: **AGENTS.md** (leia antes de qualquer mudança). Documentação viva: `F:\Projetos\adega-sb-docs`.

## Rodar local

```powershell
cd F:\Projetos\adega-sb-staging
npm ci
Copy-Item .env.example .env.local   # chaves do STAGING; secret começa com sb_secret_ (não é o JWT Secret)
npm run dev                          # http://localhost:3000
```

## Validar antes de qualquer commit

```powershell
cd F:\Projetos\adega-sb-staging
npm run type-check; npm run lint; npm run build; npm run e2e
```

`npm run e2e` sobe o build sozinho nas portas 3101/3102 (sem banco) e confere o fail-closed. Primeira vez na máquina: `npx playwright install chromium`.

## Banco (Supabase)

| Pasta | Conteúdo |
|---|---|
| `supabase/migrations/` | `0001_acesso.sql` (tenants, locais, profiles, profile_locais, audit_log) · `0002_permissoes_data_api.sql` (grants explícitos) |
| `supabase/preflight/` | roda antes da migration; recusa se as tabelas já existirem |
| `supabase/tests/` | pgTAP (`0001_test.sql`: 27 · `0002_test.sql`: 14) |
| `supabase/rollback/` | desfaz enquanto não houver perfis |

Ritual por migration (staging primeiro, produção antes do merge): preflight → migration → pgTAP. Passo a passo no AGENTS.md.

## Primeiro acesso

```powershell
cd F:\Projetos\adega-sb-staging
node --env-file=.env.local scripts/criar-master.mjs seu-email@dominio "Seu Nome"
```

(No PowerShell, `npm run master -- ... "Nome Composto"` perde as aspas — use o `node` direto.)

A senha inicial aparece uma única vez. Entre em `/login`, troque a senha e crie a equipe em `/admin/usuarios`.

## Protótipos (referência funcional)

`/prototipos` (master/gerente): PDV com site, Site, Vendas, Compras — arquivos em `public/prototipos/`, dados só no navegador.

## Produção

Nunca editar código fora do staging. Roteiro único: `F:\Projetos\adega-sb-docs\HANDOFF-IA.md` §6.
