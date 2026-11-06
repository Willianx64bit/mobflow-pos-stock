# MobFlow PDV — inventário do schema atual

Data: 2026-11-06
Origem: CSV exportado de consulta somente leitura ao catálogo PostgreSQL do projeto Supabase PDV.
Escopo: tabelas, colunas, defaults, constraints, índices e indicadores de RLS. Nenhum dado de negócio foi exportado por esta consulta.

## Resultado confirmado

- 7 tabelas em `public`.
- RLS habilitado nas 7 tabelas.
- `relforcerowsecurity` está desativado nas 7 tabelas; não confundir RLS habilitado com FORCE ROW LEVEL SECURITY.
- Todas as tabelas abaixo foram identificadas no catálogo consultado.
- Este inventário não contém as expressões das policies, definições completas de funções, triggers, grants, views, tipos customizados, buckets/policies de Storage ou conteúdo das tabelas.

## Tabelas e estrutura

### `public.profiles`
Colunas: `id uuid` (PK, FK para `auth.users(id)`), `username text` (único), `cnpj text`, `created_at timestamptz DEFAULT now()`, `account_id uuid` (FK para `auth.users(id)`), `role text DEFAULT 'manager'`, `active boolean DEFAULT true`, `display_name text NULL`, `permissions jsonb DEFAULT ["PDV", "Conferência"]`.
Constraint: role limitado a `manager`, `pdv`, `admin`.
Índice adicional: `profiles_account_id_idx(account_id)`.
Observação: manter distinção entre `id` do usuário e `account_id` da conta/gerente.

### `public.app_state`
Colunas: `owner_id uuid` (PK, FK para `auth.users(id)` com ON DELETE CASCADE), `state jsonb`, `updated_at timestamptz DEFAULT now()`.
Observação: estado operacional JSONB; preservar formato e CAS de gravação. Não migrar com transformação de JSON sem comparação e testes.

### `public.companies`
Colunas: `account_id uuid` (PK, FK para `auth.users(id)` com ON DELETE CASCADE), `company_name text`, `cnpj text`, `username text`, `email text`, `phone text`, `plan_code text DEFAULT 'complete'`, `monthly_price numeric DEFAULT 69.90`, `subscription_status text DEFAULT 'pending_payment'`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`, `payment_method text DEFAULT 'pix'`, `payment_confirmed_at timestamptz NULL`, `payment_confirmed_by uuid NULL` (FK para auth.users com ON DELETE SET NULL), `payment_notes text NULL`, `payment_request_token uuid DEFAULT gen_random_uuid()`, `payment_proof_path text NULL`, `payment_submitted_at timestamptz NULL`, `manager_setup_token uuid NULL`, `manager_setup_completed_at timestamptz NULL`, `subscription_expires_at timestamptz NULL`.
Constraints: CNPJ com 14 dígitos; nome entre 2 e 120 caracteres; preço > 0 e <= 9999.99; método de pagamento somente pix; plano somente complete; status em pending_payment/active/past_due/suspended/cancelled; unicidade de CNPJ e username.
Índices: PK/account_id; CNPJ único; username único; status; email normalizado único por `lower(email)`; token de pagamento único; token de setup único quando não nulo; vencimento quando não nulo.

### `public.account_allowlist`
Colunas: `username text` (PK), `cnpj text`, `active boolean DEFAULT true`, `created_at timestamptz DEFAULT now()`.

### `public.manager_security`
Colunas: `id boolean DEFAULT true` (PK e CHECK id=true), `password_hash text`.
Observação: tabela singleton legada; não descartar sem localizar dependências e política atual.

### `public.manager_security_by_account`
Colunas: `account_id uuid` (PK), `password_hash text`, `updated_at timestamptz DEFAULT now()`.
Observação: segurança de gerência por conta; não exportar hashes como seeds nem registrá-los em documentação.

### `public.manager_password_recovery_tokens`
Colunas: `id uuid DEFAULT gen_random_uuid()` (PK), `account_id uuid` (FK para auth.users com ON DELETE CASCADE), `token_hash text` (único), `expires_at timestamptz`, `used_at timestamptz NULL`, `created_at timestamptz DEFAULT now()`.
Índice adicional: `(account_id, created_at DESC)`.
Observação: preservar uso único, expiração e atomicidade de consumo do token com a troca da senha.

## Pontos de atenção

1. A relação com `auth.users` aparece em várias FKs. A migração não pode simplesmente remover essas FKs: precisa definir como identidade/autenticação será mantida ou substituída.
2. `profiles.id` e `profiles.account_id` têm papéis diferentes. Não colapsar ambos em um único ID.
3. RLS está habilitado, mas as policies não estão neste CSV. Não presumir que a segurança está completa apenas porque `rls_enabled=true`.
4. O CSV não lista triggers, funções, grants, policies, Storage nem dados. Esses itens continuam pendentes de auditoria.
5. `companies` possui índices únicos por email normalizado, CNPJ, username e tokens; todos devem ser preservados no desenho de destino.
6. Os hashes em `manager_security*` e tokens de recuperação são dados sensíveis. Não copiar valores para documentação, Git ou ambiente de teste.

## Policies RLS e triggers — segundo CSV

Consulta executada no catálogo para schemas `public` e `private`, excluindo triggers internos.

Foram retornadas 4 policies e 0 triggers visíveis:

| Tabela | Policy | Operação | Role | Regra |
|---|---|---|---|---|
| `app_state` | `state account insert` | INSERT | authenticated | `owner_id = private.current_account_id()` via WITH CHECK |
| `app_state` | `state account select` | SELECT | authenticated | `owner_id = private.current_account_id()` via USING |
| `app_state` | `state account update` | UPDATE | authenticated | A mesma condição em USING e WITH CHECK |
| `profiles` | `profiles account select` | SELECT | authenticated | Permite o próprio perfil (`id = auth.uid()`) ou gerente lendo perfis da própria conta (`account_id = private.current_account_id()`) |

### Interpretação cautelosa

- As policies retornadas só cobrem SELECT em `profiles` e SELECT/INSERT/UPDATE em `app_state`.
- Não foram retornadas policies para `companies`, `account_allowlist`, `manager_security`, `manager_security_by_account` ou `manager_password_recovery_tokens`.
- Como essas cinco tabelas têm RLS habilitado no inventário anterior, a ausência de policies aplicáveis a `authenticated` pode significar que o acesso é feito por Edge Functions/backend com privilégios elevados. Isso ainda precisa ser confirmado no código e nos grants; não assumir acesso público nem criar policies novas por conveniência.
- A consulta retornou zero triggers não internos em `public` e `private`. Isso não prova ausência de triggers em outros schemas, nem de triggers internos do PostgreSQL/Supabase.
- A regra de `profiles` não trouxe policy de INSERT/UPDATE/DELETE. Preservar esse comportamento até localizar todos os fluxos que alteram perfis.
- As expressões dependem de `auth.uid()`, `private.current_account_id()` e `private.current_account_role()`. A migração de identidade precisa substituir essas dependências com autorização equivalente, sem enfraquecer isolamento por conta.

## Funções PostgreSQL — terceiro CSV

Consulta de catálogo somente leitura retornou 7 funções nos schemas `public` e `private`. O CSV contém as definições completas; esta documentação resume seus contratos sem copiar dados sensíveis.

| Função | Retorno | SECURITY DEFINER | Permissões observadas | Papel |
|---|---|---:|---|---|
| `private.current_account_id()` | uuid | sim | postgres, authenticated | Resolve a conta do usuário pelo perfil; usa `auth.uid()` como fallback. |
| `private.current_account_role()` | text | sim | postgres, authenticated | Resolve role do perfil; fallback `pdv`. |
| `public.accept_receiving(text)` | boolean | sim | postgres, authenticated, service_role | Aceita recebimento já decidido, bloqueia a linha de estado e atualiza estoque/recebimento no JSONB. |
| `public.enforce_mobflow_account_allowlist()` | trigger | sim | postgres, service_role | Valida username extraído do email contra `account_allowlist`. |
| `public.finalize_receiving_decisions(text,jsonb)` | boolean | sim | postgres, authenticated, service_role | Valida decisões, bloqueia estado e atualiza estoque e recebimento em uma operação. |
| `public.mobflow_save_state(uuid,timestamptz,jsonb)` | jsonb | sim | postgres, authenticated, service_role | Gravação CAS com validação de conta, lock, timestamp e retorno explícito de conflito. |
| `public.rls_auto_enable()` | event_trigger | sim | postgres, service_role | Event trigger function que habilita RLS em tabelas criadas em `public`. |

### Requisitos de preservação

1. **CAS (`mobflow_save_state`) é crítico.** Mantém a verificação `auth.uid()`, exige que `private.current_account_id()` corresponda ao `p_owner_id`, aceita apenas JSON object, usa `FOR UPDATE`, trata criação concorrente com `ON CONFLICT DO NOTHING` e retorna `saved=false` com estado/timestamp atuais quando há conflito. Na atualização, garante timestamp estritamente crescente com `greatest(clock_timestamp(), updated_at + 1 microsecond)`. Não substituir por upsert cego nem read-modify-write no cliente.
2. **Recebimento é transacional.** `accept_receiving` e `finalize_receiving_decisions` bloqueiam a linha `app_state` com `FOR UPDATE`, validam estado/decisões e alteram estoque e status dentro da mesma função. Regressões devem cobrir decisão aceitar/devolver, itens extras, repetição de chamada e concorrência.
3. **Há diferença entre as duas funções de recebimento.** `finalize_receiving_decisions` valida explicitamente que produtos aceitos existam no array `products`; `accept_receiving` espera que as decisões já estejam concluídas e não repete essa mesma verificação de existência. Não fundir nem substituir uma pela outra sem rastrear os chamadores.
4. **Identidade e tenancy dependem de Supabase Auth.** As funções auxiliares chamam `auth.uid()`; qualquer mudança de autenticação exige implementar contexto de identidade confiável e autorização equivalente antes de migrar policies/RPCs.
5. **SECURITY DEFINER exige cuidado.** Todas as sete funções são SECURITY DEFINER e definem search_path; preservar privilégios mínimos, owner controlado, nomes totalmente qualificados e search_path seguro. Não conceder execução a usuários/clientes sem necessidade.
6. **Allowlist:** a função de trigger é concedida a postgres/service_role, não a authenticated. O CSV não mostrou trigger comum anexado a tabela, portanto sua associação precisa ser conferida por catálogo de triggers/event triggers e no fluxo de cadastro.
7. **RLS automático:** `rls_auto_enable()` é uma função de event trigger, não um trigger de tabela. A consulta de `pg_event_trigger` confirmou que `ensure_rls` está habilitado (`evtenabled = O`), para `ddl_command_end`, com tags `CREATE TABLE`, `CREATE TABLE AS` e `SELECT INTO`, chamando `rls_auto_enable()`. A função/event trigger pertence ao owner `postgres`.

### Limitações do CSV de funções

- O resultado contém apenas funções com `prokind='f'` nos schemas `public` e `private`; não inclui procedures, aggregates, funções de outros schemas, triggers/event triggers associados, policies de Storage nem configuração Auth.
- A coluna de permissões representa ACL da função, mas precisamos conferir grants efetivos, roles herdadas e privilégios de tabelas/sequences.
- As funções usam referências Supabase (`auth.uid()`, `auth.users`, `service_role`); elas não são diretamente portáveis para Neon sem camada de identidade e autorização equivalente.

## Event triggers — quarto resultado

Consulta somente leitura em `pg_event_trigger` retornou 7 event triggers, todos habilitados (`evtenabled = O`):

| Event trigger | Evento | Tags | Função | Owner |
|---|---|---|---|---|
| `ensure_rls` | `ddl_command_end` | CREATE TABLE, CREATE TABLE AS, SELECT INTO | `rls_auto_enable()` | postgres |
| `issue_graphql_placeholder` | `sql_drop` | DROP EXTENSION | `set_graphql_placeholder()` | supabase_admin |
| `issue_pg_cron_access` | `ddl_command_end` | CREATE EXTENSION | `grant_pg_cron_access()` | supabase_admin |
| `issue_pg_graphql_access` | `ddl_command_end` | CREATE EXTENSION | `grant_pg_graphql_access()` | supabase_admin |
| `issue_pg_net_access` | `ddl_command_end` | CREATE EXTENSION | `grant_pg_net_access()` | supabase_admin |
| `pgrst_ddl_watch` | `ddl_command_end` | sem filtro de tags | `pgrst_ddl_watch()` | supabase_admin |
| `pgrst_drop_watch` | `sql_drop` | sem filtro de tags | `pgrst_drop_watch()` | supabase_admin |

### Interpretação para migração

- **`ensure_rls` é comportamento de segurança relevante.** Confirma que o event trigger chama `rls_auto_enable()` após comandos DDL de criação de tabelas indicados. No destino, precisamos garantir que novas tabelas também recebam RLS por um mecanismo deliberado (por exemplo, migration templates/checks ou automação própria). Não presumir que o event trigger Supabase será portável nem criar um equivalente sem avaliar privilégios e escopo.
- Os cinco eventos de GraphQL, pg_cron e pg_net são hooks internos de integração/extensões do Supabase. Devem ser avaliados conforme as extensões e serviços realmente usados no PDV; não copiar automaticamente para Neon.
- `pgrst_ddl_watch` e `pgrst_drop_watch` notificam o PostgREST sobre DDL/drop. São específicos da integração PostgREST/Supabase e não devem ser replicados no Neon se o destino não usar PostgREST.
- Os sete registros estavam habilitados no momento da consulta. A consulta não prova que todas as extensões correspondentes estão instaladas nem que os serviços externos estão em uso.
- Os owners `postgres` e `supabase_admin` pertencem ao ambiente Supabase; não transportar esses owners literalmente para o destino.

## Próximas inspeções — somente leitura

1. Grants efetivos de tabelas, sequences, schemas e funções, incluindo roles herdadas.
2. Buckets e policies do Storage, em especial arquivos de comprovantes de pagamento.
3. Publicação Realtime e tabelas inscritas.
4. Call sites das RPCs e Edge Functions, além de configuração Auth relevante.
5. Views, tipos, extensões e demais objetos ainda não catalogados.

## Segurança da auditoria

Todas as consultas descritas neste documento foram somente leitura. Nenhum INSERT, UPDATE, DELETE, DDL, deploy, importação de dados ou alteração de configuração foi executado. As alterações feitas até aqui foram apenas documentação na branch isolada `migration/neon-preparation`; `main`, produção, Supabase e Neon não foram modificados.