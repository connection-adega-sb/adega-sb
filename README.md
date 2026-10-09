# ADEGA SB — sistema de gestão

Balcão (PDV), bar, depósito, delivery, plataformas de entrega e distribuidora. Next.js 15 + TypeScript + Supabase.
Regras de trabalho: **AGENTS.md** (leia antes de qualquer mudança). Documentação viva: `F:\Projetos\adega-sb-docs`.

## Rodar local

```powershell
cd F:\Projetos\adega-sb-staging
npm ci
Copy-Item .env.example .env.local   # preencher com as chaves do Supabase STAGING
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
| `supabase/migrations/` | `0001_acesso.sql` (tenants, locais, profiles, profile_locais, audit_log) |
| `supabase/preflight/` | roda antes da migration; recusa se as tabelas já existirem |
| `supabase/tests/` | pgTAP (`0001_test.sql`: 27 asserts) |
| `supabase/rollback/` | desfaz enquanto não houver perfis |

Ritual por migration (staging primeiro, produção antes do merge): preflight → migration → pgTAP. Passo a passo no AGENTS.md.

## Primeiro acesso

```powershell
cd F:\Projetos\adega-sb-staging
npm run master -- seu-email@dominio "Seu Nome"
```

A senha inicial aparece uma única vez. Entre em `/login`, troque a senha e crie a equipe em `/admin/usuarios`.
