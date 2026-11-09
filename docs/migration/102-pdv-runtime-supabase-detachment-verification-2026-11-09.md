# 102 — Verificação de desacoplamento operacional do Supabase no PDV

Data: 2026-11-09
Branch: `migration/neon-preparation`
Base: `4c2f5d870805b0ea97c7c3c1b387d29d9c0347d1`

## Resultado da verificação

A revisão do código atual confirmou que os principais caminhos de autenticação, sessão, recuperação, cadastro, cobrança e sincronização já estão usando Better Auth, APIs próprias e Neon. Os pontos listados nos checkpoints 98/99 que ainda apareciam como pendentes foram atualizados depois daqueles documentos.

### Arquivos verificados

| Arquivo | Evidência atual |
|---|---|
| `src/lib/auth-client.ts` | Cliente Better Auth; flag Better Auth fixa em true |
| `src/components/LoginScreen.tsx` | Login Better Auth; cadastro e leitura da cobrança por `/api/mobflow/signup`; sem ramo Supabase no componente |
| `src/components/AppHeader.tsx` | Logout por `mobflowAuthClient.signOut()` |
| `src/lib/manager-auth.ts` | Reautenticação por `/api/mobflow/reauth-manager` |
| `src/routes/gerencia.tsx` | Recuperação, contexto de sessão e operações de gerência por APIs próprias |
| `src/routes/recuperar-senha.tsx` | Redefinição por `/api/mobflow/manager-password-recovery` |
| `src/routes/fiado.tsx` | Validação de senha por `/api/mobflow/login` |
| `src/routes/baixa-produtos.tsx` | Nenhuma referência Supabase encontrada na revisão do arquivo |
| `src/routes/configuracoes.tsx` | Usuários, sessão e logotipo por APIs próprias |
| `src/routes/api/mobflow/signup.ts` | Neon para cadastro/configuração de cobrança; Cloudflare R2 para comprovantes |
| `src/routes/api/mobflow/login.ts` | Neon e Better Auth |
| `src/routes/api/mobflow/session-context.ts` | Contexto da sessão autenticada |
| `src/routes/api/mobflow/users.ts` | Gestão de usuários no Neon e arquivos operacionais no R2 |
| `src/routes/api/mobflow/reauth-manager.ts` | Reautenticação no Neon |
| `src/routes/api/mobflow/manager-password-recovery.ts` | Tokens e recuperação no Neon |
| `src/lib/server/mobflow-auth.ts` | Exige Better Auth no Preview; não mantém fallback de bearer Supabase |
| `src/lib/store.ts` | Usa APIs próprias e Neon Realtime; nenhuma chamada Supabase/RPC encontrada na revisão |

## Dependências

- `package.json` não declara `@supabase/supabase-js`.
- `bun.lock` não contém referência ao SDK Supabase.
- `src/lib/supabase.ts` não existe na branch atual.
- Os fluxos de login, logout, cadastro, recuperação, baixa, fiado e gerência revisados não importam nem chamam o cliente Supabase.

## Legado preservado deliberadamente

Os arquivos históricos em `supabase/functions/*`, `supabase/migrations/*` e scripts de migração permanecem no repositório como material de referência/rollback. Não foram removidos nesta verificação porque:
- a ausência de chamadas internas nos arquivos revisados não prova ausência de consumidores externos;
- migrations antigas documentam a origem do schema e não devem ser apagadas como parte da remoção do runtime;
- a retirada definitiva das Edge Functions ainda depende de confirmação de webhooks, integrações e automações externas.

Não foi feita alteração no projeto Supabase original, em secrets, buckets, dados ou produção.

## Verificação de CI

O commit-base consultado apresentava status Vercel `success`. Isso confirma somente o status reportado pelo provedor para aquele commit; não substitui os testes E2E de login, cadastro, recuperação, sincronização, recebimento e dois dispositivos.

## Pendências restantes da Parte 1

1. Fazer busca final de chamadas REST/dinâmicas e referências Supabase em todos os arquivos do repositório e workflows, além dos call sites revisados.
2. Conferir variáveis de ambiente e consumidores externos sem expor valores secretos.
3. Testar os fluxos no Preview, inclusive recebimento Neon (aceito, devolvido, extra, repetido e concorrente), cadastro, comprovante R2 e sessão Better Auth.
4. Remover os artefatos de runtime Supabase somente após a confirmação de ausência de consumidores externos e aprovação do cutover.

## Proteções

Somente a branch `migration/neon-preparation` foi consultada. Nenhuma alteração em `main`, Production, MobFlow Admin, ColetaFlow, dados reais, senhas, buckets ou secrets foi feita por este checkpoint.
