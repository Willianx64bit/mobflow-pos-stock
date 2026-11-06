# MobFlow PDV — estimativa de volume para plano de migração

Data da leitura: 06/11/2026  
Origem: consultas SELECT agregadas no projeto Supabase PDV de produção. Os valores são uma fotografia do momento e podem mudar; não foram exportados registros nem conteúdo de usuários.

## Contagens observadas

| Fonte | Registros |
|---|---:|
| `auth.users` | 7 |
| `public.profiles` | 7 |
| `public.companies` | 2 |
| `public.app_state` | 2 |
| `public.account_allowlist` | 9 |
| `public.manager_password_recovery_tokens` | 4 |
| `storage.objects` no bucket privado `mobflow-payment-proofs` | 0 |

## Tamanho observado do estado operacional

- `app_state`: 2 linhas.
- Payload JSONB somado: aproximadamente 19 kB.
- Média aproximada: 9,8 kB por linha.
- Maior snapshot: aproximadamente 19 kB.

A consulta mediu `pg_column_size(state)`, não o tamanho total físico do banco, índices, WAL, arquivos de Storage ou histórico de backups.

## Implicações para o plano

- O volume atual observado é pequeno para uma carga inicial; a dificuldade da migração não está no volume, mas na compatibilidade de Auth, permissões, transações, sincronização e comportamento do app.
- O bucket de comprovantes não tinha objetos no momento da consulta. Mesmo assim, o fluxo de upload e a configuração privada continuam sendo dependências funcionais e devem ser preservados para cadastros futuros.
- As contagens não autorizam importar dados reais para Neon. A carga só poderá ser planejada após decisão de arquitetura, aprovação explícita e estratégia segura de credenciais/identidade.
- Em uma migração ensaiada, validar consistência entre usuários Auth, profiles, companies, allowlist e app_state, incluindo chaves estrangeiras e contas bloqueadas/inativas.

## Segurança e escopo

Somente consultas agregadas SELECT. Nenhum dado de usuário foi exibido/exportado; nenhuma linha foi modificada; nenhum dado foi copiado para Neon. MobFlow Admin e ColetaFlow permanecem fora do escopo.
