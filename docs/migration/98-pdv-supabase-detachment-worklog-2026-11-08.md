# 98 — Diário de desacoplamento do Supabase no PDV

Data: 2026-11-08
Branch: migration/neon-preparation
Base auditada: 131cd1b2056a724126930d7c5ca9371e24b5dee8
Escopo: auditoria estática; nenhum banco, bucket, secret, ambiente Vercel ou Production foi alterado.

## Achados

- src/lib/auth-client.ts fixa isBetterAuthEnabled = true.
- src/components/LoginScreen.tsx ainda importa @/lib/supabase e contém ramos Supabase para login, logout, restauração de sessão e cadastro. Com o seletor fixo em true, esses ramos não são escolhidos no fluxo normal, mas continuam compilados e mantêm a dependência.
- O cadastro Better Auth chama POST /api/mobflow/signup.
- src/routes/api/mobflow/signup.ts usa AWS S3 SDK com Cloudflare R2 e Neon. Exige as quatro variáveis R2, falha fechado se ausentes/incompletas e remove o objeto se a gravação dos metadados Neon falhar. Falta validar o caminho real Vercel → R2 → Neon → leitura autorizada pelo Admin.
- src/routes/api/mobflow/receiving.ts usa Neon. O store ainda possui caminho legado para RPCs Supabase quando o provider antigo está selecionado. Não remover RPCs antes de testar aceitos, devolvidos, extras, repetidos e concorrentes.
- src/lib/store.ts usa Neon Realtime, mas app_state ainda é utilizado como hidratação/persistência. O consumidor incremental não substitui todos os fluxos.
- package.json ainda declara @supabase/supabase-js e src/lib/supabase.ts permanece.
- supabase/functions e supabase/migrations contêm artefatos legados que devem ser preservados até fechar o inventário de consumidores.
- O schema relacional/backfill foi exercitado em banco Neon isolado, mas 0006, 0007 e 0008 permanecem DRAFT e não devem ser aplicados ao Preview sem revisão explícita.

## Próximas ações seguras

1. Remover apenas os ramos Supabase inalcançáveis de LoginScreen.tsx, preservando o comportamento Better Auth de login, logout e signup.
2. Mapear todos os imports de @/lib/supabase e usos de supabase. na branch.
3. Migrar consumidores remanescentes (configurações, gerência, recuperação, catálogo e cobrança pública) para APIs Neon/R2 ou destino definido com o Admin.
4. Testar upload real de comprovante e leitura pelo Admin.
5. Testar recebimento Neon com idempotência e concorrência.
6. Completar schema relacional, comandos por domínio, outbox/pull incremental e testes com dois dispositivos.
7. Só depois de zero consumidores remover src/lib/supabase.ts, @supabase/supabase-js e artefatos runtime Supabase não necessários.

## Proteções

Somente migration/neon-preparation. Não alterar main, Production, Supabase original, MobFlow Admin ou ColetaFlow. Não apagar dados, usuários, buckets, RPCs ou configurações remotas. Não alterar a conta administrativa ou sua senha. Nenhum deployment foi iniciado.
