# 100 — Inventário de variáveis Vercel Preview (sem valores)

Data: 2026-11-08
Projeto: MobFlow PDV
Branch de Preview consultada: migration/neon-preparation
Consulta: listagem de metadados de variáveis com valores descriptivos desabilitados. Nenhum secret foi lido.

## Resultado
Foram encontradas 16 variáveis Preview vinculadas à branch. Não apareceu nenhuma variável com nome `SUPABASE_*` ou `VITE_SUPABASE_*` neste escopo.

Nomes encontrados:
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `NEON_REALTIME_SECRET`
- `VITE_NEON_REALTIME_URL`
- `RESEND_API_KEY`
- `GMAIL_SMTP_HOST`
- `GMAIL_SMTP_PORT`
- `MOBFLOW_APP_URL`
- `MOBFLOW_AUTH_PROVIDER`
- `VITE_MOBFLOW_AUTH_PROVIDER`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `NEON_DATABASE_URL`

## Limite
Esta consulta cobre somente Preview + branch `migration/neon-preparation`. Não prova ausência de variáveis Supabase em Production, Development, outras branches Preview, ambientes customizados, GitHub Actions, secrets do repositório ou serviços externos. Não remover nem alterar variáveis de outros escopos sem inventário específico.
